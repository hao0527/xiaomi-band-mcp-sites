import type {PersistentEnv} from './persistence.js';
import {MiFitnessAdapter} from './collector/adapter.js';
import {CollectorError,nativeFetcher,type Fetcher} from './collector/http.js';
import {addDays,dateCN,dateRange,parseRecord} from './collector/parser.js';
import type {RawRecord} from './collector/models.js';
import {redactRawRecord} from './raw-record-reader.js';

const contract='adjacent_overlap_v1';
const codes=new Set(['AUTH_EXPIRED','LOGIN_REJECTED','LOGIN_HTTP_ERROR','STS_HTTP_ERROR','SERVICE_TOKEN_MISSING','INTERACTIVE_AUTH_REQUIRED','NETWORK_FAILURE','UPSTREAM_RATE_LIMITED','UPSTREAM_HTTP_ERROR','UPSTREAM_BUSINESS_ERROR','INVALID_CLOUD_RESPONSE','RESPONSE_TOO_LARGE','INVALID_PAGE','INVALID_HAS_MORE','INVALID_CURSOR','CURSOR_MISSING','PAGE_RECORD_LIMIT','RAW_REDACTION_LIMIT','AUDIT_REQUEST_LIMIT','AUDIT_TIME_LIMIT','AUDIT_PAGE_LIMIT','AUDIT_QUARANTINED_SOURCE','AUDIT_LEASE_LOST']);
type Metric='sleep'|'sport';
type Stored={status:string;audit_json:string};
const keyFor=(date:string)=>contract+':'+date;
const identity=(r:RawRecord)=>JSON.stringify([r.sid??'unknown',r.key??'',r.time]);
const members=(rows:RawRecord[])=>new Set(rows.map(identity));
const difference=(a:Set<string>,b:Set<string>)=>[...a].filter(x=>!b.has(x)).length;

export async function readWindowAudit(env:PersistentEnv,date:string){
 dateRange(date,date);if(!env.DB)throw new CollectorError('DATABASE_NOT_READY');
 const old=await env.DB.prepare('SELECT status,audit_json FROM collection_window_audits WHERE audit_id=?').bind(keyFor(date)).first<Stored>();
 return old?{...JSON.parse(old.audit_json),status:old.status,cached:true,network_requests_performed:false}:{status:'not_checked',cached:false,network_requests_performed:false};
}

// Operator-only evidence gathering. Never ingest observations or move sync cursors.
export async function auditCollectionWindows(env:PersistentEnv,date:string,transport:Fetcher=nativeFetcher(true)){
 const day=dateRange(date,date),today=dateCN(Math.floor(Date.now()/1000));
 if(addDays(date,1)>=today)throw new CollectorError('AUDIT_REQUIRES_CLOSED_WINDOWS');
 if(!env.DB||!env.MI_USER_ID||!env.MI_PASS_TOKEN)throw new CollectorError('SECRETS_NOT_CONFIGURED');
 if(Date.now()>=Date.parse('2027-01-01T00:00:00+08:00'))throw new CollectorError('HOSTING_COST_REVIEW_REQUIRED');
 const d=env.DB,prior=await readWindowAudit(env,date);if(prior.cached)return prior;
 const lease='window_audit_'+crypto.randomUUID(),lock=await d.prepare('UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?').bind(lease,Date.now()+180000,Date.now()).run();
 if(!lock.meta.changes)throw new CollectorError('SYNC_BUSY_OR_NOT_INITIALIZED');
 const id=keyFor(date),began=Date.now(),budget={login_attempts:1,auth_http_requests:2,health_requests:6,pages_per_window:1,retries:0,elapsed_ms:45000};
 const raw:Array<Record<string,unknown>>=[],pages:Array<Record<string,unknown>>=[],observations=new Map<string,RawRecord[]>();
 let health=0,auth=0,loginAttempts=0,status='complete',error:string|null=null;
 const report=()=>({request_contract_version:contract,status,error_code:error,date,timezone:'Asia/Shanghai',budget,login_attempts:loginAttempts,auth_http_requests:auth,health_requests:health,retries:0,pages,comparisons:[] as Array<Record<string,unknown>>,upstream_upload_complete:'unknown',raw_preserved:'site_d1_collection_window_audits',regular_cache_written:false,checkpoints_advanced:false,checked_at:Date.now()});
 let claimed=false;
 try{
  const claim=await d.prepare("INSERT OR IGNORE INTO collection_window_audits(audit_id,status,audit_json,raw_json,checked_at) VALUES(?,'checking',?,'[]',?)").bind(id,JSON.stringify({...report(),status:'checking'}),began).run();
  if(!claim.meta.changes)return await readWindowAudit(env,date);claimed=true;
  const once:Fetcher=async(url,init)=>{
   if(Date.now()-began>=budget.elapsed_ms)throw new CollectorError('AUDIT_TIME_LIMIT');
   const active=await d.prepare('SELECT 1 AS active FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?').bind(lease,Date.now()).first();if(!active)throw new CollectorError('AUDIT_LEASE_LOST');
   const isHealth=new URL(url).hostname==='hlth.io.mi.com';
   if(isHealth?++health>budget.health_requests:++auth>budget.auth_http_requests)throw new CollectorError('AUDIT_REQUEST_LIMIT');
   let r:Response;try{r=await transport(url,init);}catch{throw new CollectorError('NETWORK_FAILURE');}
   // Reject before login redirects, response parsing or any Adapter retry.
   if(r.status!==200){await r.body?.cancel();throw new CollectorError(r.status===401||r.status===403?'AUTH_EXPIRED':r.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR');}
   return r;
  };
  class AuditAdapter extends MiFitnessAdapter {
   async request(path:Parameters<MiFitnessAdapter['request']>[0],payload:Record<string,unknown>){
    const result=await super.request(path,payload),clean=redactRawRecord(result);
    raw.push({endpoint:path,payload,response:clean.value,redactions:clean.redactions,received_at:Date.now()});return result;
   }
  }
  const a=new AuditAdapter(once);loginAttempts++;await a.login(env.MI_USER_ID,env.MI_PASS_TOKEN);
  const previous=addDays(date,-1),next=addDays(date,1);
  for(const metric of ['sleep','sport'] as const){
   for(const [window,start,end] of [['adjacent',previous,previous],['exact',date,date],['overlap',previous,next]]){
    const page=await a.page(metric,start,end,null);observations.set(metric+':'+window,page.records);
    let differentNormalizedDate=0;for(const r of page.records){try{if(parseRecord(metric,r).date!==dateCN(r.time))differentNormalizedDate++;}catch{}}
    pages.push({metric,window,start_date:start,end_date:end,records:page.records.length,rejected:page.rejected?.length??0,has_more:page.hasMore,source_vs_normalized_date_differences:differentNormalizedDate});
    if(page.rejected?.length)throw new CollectorError('AUDIT_QUARANTINED_SOURCE');
    if(page.hasMore)throw new CollectorError('AUDIT_PAGE_LIMIT');
   }
  }
 }catch(e){error=e instanceof CollectorError&&codes.has(e.code)?e.code:'WINDOW_AUDIT_FAILED';status=['AUDIT_PAGE_LIMIT','AUDIT_QUARANTINED_SOURCE','AUDIT_TIME_LIMIT'].includes(error)?'partial':'failed';}
 finally{
  // Persist before releasing the shared lease, including partial/failed attempts.
  // A checking row left by interruption also prevents an automatic re-login.
  try{if(claimed){
   const audit=report();
   if(status==='complete')for(const metric of ['sleep','sport'] as const){
    const exact=observations.get(metric+':exact')!,adjacent=observations.get(metric+':adjacent')!,overlap=observations.get(metric+':overlap')!;
    const target=overlap.filter(r=>r.time>=day.start&&r.time<=day.end),both=overlap.filter(r=>r.time<=day.end),union=[...adjacent,...exact];
    const e=members(exact),t=members(target),b=members(both),u=members(union);
    const cache=(await d.prepare('SELECT raw_json FROM raw_records WHERE metric=? AND recorded_at>=? AND recorded_at<=?').bind(metric,day.start,day.end).all<{raw_json:string}>()).results;
    const cached:RawRecord[]=[];for(const r of cache){try{cached.push(JSON.parse(r.raw_json));}catch{}}
    const payloadById=new Map(exact.map(r=>[identity(r),JSON.stringify(redactRawRecord(r).value)]));
    audit.comparisons.push({metric,exact_only: difference(e,t),overlap_target_only:difference(t,e),adjacent_union_only:difference(u,b),overlap_two_days_only:difference(b,u),same_identity_payload_changed:target.filter(r=>payloadById.has(identity(r))&&payloadById.get(identity(r))!==JSON.stringify(redactRawRecord(r).value)).length,fresh_target_identities_absent_from_cache:difference(members([...exact,...target]),members(cached)),conclusion:e.size===t.size&&!difference(e,t)&&!difference(t,e)?'no_identity_difference_observed':'window_difference_observed_cause_unverified',not_proof_of:'upload_completeness_boundary_loss_or_late_upload_cause'});
   }
   await d.prepare('UPDATE collection_window_audits SET status=?,audit_json=?,raw_json=?,checked_at=? WHERE audit_id=?').bind(status,JSON.stringify(audit),JSON.stringify(raw),audit.checked_at,id).run();
  }}finally{await d.prepare('UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').bind(lease).run();}
 }
 return {...await readWindowAudit(env,date),cached:false,network_requests_performed:auth+health>0};
}
