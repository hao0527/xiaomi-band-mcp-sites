import {RequestTrace} from './request-diagnostics.js';
import {encryptRequest,rc4,text,unb64,auxiliaryEncrypted,nonce,pythonJSON,signedNonce} from './crypto.js';
import {CollectorError,allowedURL,boundedText,nativeFetcher,type Fetcher,type RequestFailureDetails,type StepRetryAttempt} from './http.js';
import {loginWithToken,type Session} from './auth.js';
import {object,validateRaw,dateRange} from './parser.js';
import type {MetricKey,Page,RejectedRecord,RawRecord} from './models.js';
export const FITNESS_PATH='/app/v1/data/get_fitness_data_by_time';export const SPORT_PATH='/app/v1/data/get_sport_records_by_time';
export const AGGREGATE_PATH='/app/v1/data/get_aggregated_fitness_data_by_time';export const SPORT_OPERATIONAL_PATH='/app/v1/operate/get_sport_operational_data';
export const NATIVE_FILE_PATH='/healthapp/service/gen_download_url';
export interface RetryPolicy {now?:()=>number;maxWaitMs?:number;totalWaitMs?:number;retryStepHeaders?:boolean;}
const STEP_PAGE_TIMEOUT_MS=20000;
const FIRST_STEP_HEADERS_TIMEOUT_MS=8000;
const STEP_RETRY_DELAY_MS=500;
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
  // Native-file lookup reuses the current backend session; it never logs in again.
  async nativeFileReference(payload:Record<string,unknown>,signal=AbortSignal.timeout(20000)):Promise<Record<string,unknown>>{
    if(!this.session)throw new CollectorError('AUTH_REQUIRED');
    const n=nonce(),params=await auxiliaryEncrypted('GET','/service/gen_download_url',{data:pythonJSON(payload)},this.session.security,n);
    const trace=new RequestTrace('native_reference',signal);let r:Response;try{r=await this.transport('https://hlth.io.mi.com'+NATIVE_FILE_PATH+'?'+new URLSearchParams(params),{method:'GET',redirect:'manual',signal,headers:{Cookie:this.session.cookies+'; userId='+this.session.userId,region_tag:'cn'}});}catch(e){if(e instanceof CollectorError)throw e;throw trace.failure('response_headers');}
    trace.headers(r.status);
    if(r.status!==200){trace.httpError();await r.body?.cancel();if(r.status===401||r.status===403){this.session=null;throw new CollectorError('AUTH_EXPIRED');}throw new CollectorError(r.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR');}
    let raw:string;try{raw=await boundedText(r,undefined,trace.reader);trace.received();}catch(e){if(e instanceof CollectorError){trace.bodyError();throw e;}throw trace.failure('response_body');}
    let body:Record<string,unknown>;try{body=object(JSON.parse(raw.startsWith('{')?raw:text(rc4(await signedNonce(this.session.security,n),unb64(raw)))));}catch{throw new CollectorError('INVALID_CLOUD_RESPONSE');}
    if([401,403,-6,-10001,2].includes(Number(body.code))){this.session=null;throw new CollectorError('AUTH_EXPIRED');}
    if(body.code!==0)throw new CollectorError('UPSTREAM_BUSINESS_ERROR');return object(body.result??{});
  }
  async request(path:typeof FITNESS_PATH|typeof SPORT_PATH|typeof AGGREGATE_PATH|typeof SPORT_OPERATIONAL_PATH,payload:Record<string,unknown>):Promise<Record<string,unknown>>{
    const session=this.session;
    if(!session)throw new CollectorError('AUTH_REQUIRED');
    const url=allowedURL('https://hlth.io.mi.com'+path).href;
    const timeoutMs=path===FITNESS_PATH&&payload.key==='heart_rate'?30000:STEP_PAGE_TIMEOUT_MS;
    const operation:RequestFailureDetails['operation']=path===SPORT_PATH?'sport_records':path===AGGREGATE_PATH?'daily_aggregate':path===SPORT_OPERATIONAL_PATH?'sport_operational':'fitness_data';
    const metric=payload.key??(path===SPORT_PATH?'sport':null);

    // Sign each attempt with a fresh nonce but use the same session and page query.
    const first=await encryptRequest(payload,path,session.security,this.makeNonce?.());
    const deadline=AbortSignal.timeout(timeoutMs);
    const send=(request:typeof first,attempt?:StepRetryAttempt,headersDeadline?:AbortController)=>
      this.readFitnessResponse(url,request,session,deadline,timeoutMs,operation,metric,attempt,headersDeadline);

    if(!this.retryPolicy.retryStepHeaders||path!==FITNESS_PATH||metric!=='steps')return send(first);

    const headersDeadline=new AbortController();
    try{
      return await send(first,{attempt:1,headers_timeout_ms:FIRST_STEP_HEADERS_TIMEOUT_MS},headersDeadline);
    }catch(error){
      const detail=error instanceof CollectorError?error.request_failure:undefined;
      if(!headersDeadline.signal.aborted||deadline.aborted||detail?.kind!=='timeout'||detail.stage!=='response_headers'||!detail.request_id)throw error;
      await this.sleep(STEP_RETRY_DELAY_MS);
      if(deadline.aborted)throw error;
      const second=await encryptRequest(payload,path,session.security,this.makeNonce?.());
      if(deadline.aborted)throw error;
      return send(second,{attempt:2,retry_of_request_id:detail.request_id});
    }
  }

  private async readFitnessResponse(url:string,{form,key}:Awaited<ReturnType<typeof encryptRequest>>,session:Session,
    deadline:AbortSignal,timeoutMs:number,operation:RequestFailureDetails['operation'],metric:unknown,
    attempt?:StepRetryAttempt,headersDeadline?:AbortController){
    const signal=headersDeadline?AbortSignal.any([deadline,headersDeadline.signal]):deadline;
    const trace=new RequestTrace(operation,signal,timeoutMs,metric,undefined,attempt);
    const headerTimer=headersDeadline&&setTimeout(()=>headersDeadline.abort(new DOMException('Response headers timed out','TimeoutError')),FIRST_STEP_HEADERS_TIMEOUT_MS);
    let response:Response;
    try{
      signal.throwIfAborted();
      response=await this.transport(url,{method:'POST',redirect:'manual',signal,headers:{Cookie:session.cookies,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form).toString()});
      signal.throwIfAborted();
    }catch(error){
      if(error instanceof CollectorError)throw error;
      throw trace.failure('response_headers');
    }finally{
      if(headerTimer!==undefined)clearTimeout(headerTimer);
    }

    trace.headers(response.status);
    if(response.status===401||response.status===403){trace.httpError();this.session=null;throw new CollectorError('AUTH_EXPIRED');}
    if(response.status!==200){trace.httpError();await response.body?.cancel();throw new CollectorError(response.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR');}
    let raw:string;
    try{
      raw=await boundedText(response,undefined,trace.reader);
      signal.throwIfAborted();
      trace.received();
    }catch(error){
      if(error instanceof CollectorError){trace.bodyError();throw error;}
      throw trace.failure('response_body');
    }
    let body:Record<string,unknown>;
    try{body=object(JSON.parse(raw.startsWith('{')?raw:text(rc4(key,unb64(raw)))));}catch{throw new CollectorError('INVALID_CLOUD_RESPONSE');}
    const code=body.code,message=String(body.message??'').toLowerCase();
    if([401,403,-6,-10001,2].includes(Number(code))||['authentication failed','invalid credential','invalid pass token','login required','not logged in','session expired','unauthorized'].some(v=>message.includes(v))){this.session=null;throw new CollectorError('AUTH_EXPIRED');}
    if(code!==0)throw new CollectorError('UPSTREAM_BUSINESS_ERROR');
    return object(body.result??{});
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
