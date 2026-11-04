import {encryptRequest,rc4,text,unb64} from './crypto.js';
import {CollectorError,allowedURL,boundedText,nativeFetcher,type Fetcher} from './http.js';
import {loginWithToken,type Session} from './auth.js';
import {object,validateRaw,dateRange} from './parser.js';
import type {MetricKey,Page,RejectedRecord,RawRecord} from './models.js';
export const FITNESS_PATH='/app/v1/data/get_fitness_data_by_time';export const SPORT_PATH='/app/v1/data/get_sport_records_by_time';
export const AGGREGATE_PATH='/app/v1/data/get_aggregated_fitness_data_by_time';export const SPORT_OPERATIONAL_PATH='/app/v1/operate/get_sport_operational_data';
export interface RetryPolicy {now?:()=>number;maxWaitMs?:number;totalWaitMs?:number;}
// Never retry earlier than a valid upstream Retry-After. Excessive waits defer the task.
export function retryAfterMs(value:string|null,now:number):number|null {
  if(value===null)return null;const v=value.trim();
  if(/^\d+$/.test(v))return Number(v)*1000;
  if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /.test(v))return null;
  const date=Date.parse(v);return Number.isFinite(date)?Math.max(0,date-now):null;
}
export class MiFitnessAdapter {
  private session:Session|null=null;
  constructor(private transport:Fetcher=nativeFetcher(),private sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),private makeNonce?:()=>Uint8Array,private retryPolicy:RetryPolicy={}){}
  async login(userId:string,passToken:string){this.session=null;this.session=await loginWithToken(this.transport,userId,passToken);}
  // Session injection is backend-only and intended for deterministic tests / secret-store hydration.
  setSession(session:Session){this.session=session;}
  async request(path:typeof FITNESS_PATH|typeof SPORT_PATH|typeof AGGREGATE_PATH|typeof SPORT_OPERATIONAL_PATH,payload:Record<string,unknown>):Promise<Record<string,unknown>>{
    if(!this.session)throw new CollectorError('AUTH_REQUIRED');allowedURL('https://hlth.io.mi.com'+path);
    // Keep constructor arguments compatible, but never repeat an uncertain request.
    // A later attempt requires an explicit caller decision and the same checkpoint.
      const {form,key}=await encryptRequest(payload,path,this.session.security,this.makeNonce?.());
      let r:Response;try{r=await this.transport('https://hlth.io.mi.com'+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Cookie:this.session.cookies,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form).toString()});}
      catch(e){if(e instanceof CollectorError)throw e;throw new CollectorError('NETWORK_FAILURE');}
      if(r.status===401||r.status===403){this.session=null;throw new CollectorError('AUTH_EXPIRED');}
      if(r.status!==200){await r.body?.cancel();throw new CollectorError(r.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR');}
      let raw:string;try{raw=await boundedText(r);}catch(e){if(e instanceof CollectorError)throw e;throw new CollectorError('NETWORK_FAILURE');}let body:Record<string,unknown>;
      try{body=object(JSON.parse(raw.startsWith('{')?raw:text(rc4(key,unb64(raw)))));}catch{throw new CollectorError('INVALID_CLOUD_RESPONSE');}
      const code=body.code,message=String(body.message??'').toLowerCase();
      if([401,403,-6,-10001,2].includes(Number(code))||['authentication failed','invalid credential','invalid pass token','login required','not logged in','session expired','unauthorized'].some(v=>message.includes(v))){this.session=null;throw new CollectorError('AUTH_EXPIRED');}
      if(code!==0)throw new CollectorError('UPSTREAM_BUSINESS_ERROR');return object(body.result??{});
  }
  async page(key:MetricKey,start:string,end:string,cursor:string|null):Promise<Page>{
    const times=dateRange(start,end),payload:Record<string,unknown>={start_time:times.start,end_time:times.end};
    if(key==='sport')payload.limit=50;else payload.key=key;if(cursor)payload.next_key=cursor;if(key==='steps_daily_aggregate'){delete payload.start_time;delete payload.end_time;payload.startTime=times.start*1000;payload.endTime=(times.end+1)*1000-1;payload.tag='daily_report';payload.key='steps';payload.reverse=true;if(cursor){delete payload.next_key;payload.cursor=cursor;}}
    const result=await this.request(key==='sport'?SPORT_PATH:key==='steps_daily_aggregate'?AGGREGATE_PATH:FITNESS_PATH,payload),raw=result[key==='sport'?'sport_records':'data_list']??[];
    if(!Array.isArray(raw))throw new CollectorError('INVALID_PAGE');if(raw.length>5000)throw new CollectorError('PAGE_RECORD_LIMIT');if(result.has_more!==undefined&&typeof result.has_more!=='boolean')throw new CollectorError('INVALID_HAS_MORE');
    const next=result.next_key;if(next!==undefined&&next!==null&&typeof next!=='string')throw new CollectorError('INVALID_CURSOR');if(typeof next==='string'&&next.length>4096)throw new CollectorError('INVALID_CURSOR');
    const belowWindow=key==='steps_daily_aggregate'&&raw.some(x=>x&&typeof x==='object'&&Number.isSafeInteger((x as Record<string,unknown>).time)&&Number((x as Record<string,unknown>).time)>=0&&((x as Record<string,unknown>).sid===undefined||typeof (x as Record<string,unknown>).sid==='string')&&Number((x as Record<string,unknown>).time)<times.start);const hasMore=result.has_more===true&&!belowWindow;if(hasMore&&!next)throw new CollectorError('CURSOR_MISSING');
    const records:RawRecord[]=[],rejected:RejectedRecord[]=[];for(const [index,item] of raw.entries()){try{const r=object(item);if(!Number.isSafeInteger(r.time)||Number(r.time)<0||Number(r.time)>4102444800)throw new CollectorError('INVALID_SECONDS_TIMESTAMP');if(r.sid!==undefined&&typeof r.sid!=='string')throw new CollectorError('INVALID_SID');if(Number(r.time)>=times.start&&Number(r.time)<=times.end)records.push(r as unknown as RawRecord);}catch(e){const reason=e instanceof CollectorError&&['INVALID_OBJECT','INVALID_SECONDS_TIMESTAMP','INVALID_SID'].includes(e.code)?e.code as RejectedRecord['reason']:'INVALID_OBJECT';rejected.push({raw:item,reason,index});}}return {records,hasMore,nextKey:hasMore?String(next):null,...(rejected.length?{rejected}:{})};
  }
}
