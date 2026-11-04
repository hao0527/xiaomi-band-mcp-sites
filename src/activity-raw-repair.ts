import type {PersistentEnv} from './persistence.js';
import type {RawRecord} from './collector/models.js';
import {MiFitnessAdapter,SPORT_OPERATIONAL_PATH} from './collector/adapter.js';
import {CollectorError,nativeFetcher,type Fetcher} from './collector/http.js';
import {operationalRequest,preserveOperationalResponse} from './activity-details.js';
import {redactRawRecord,sourceResponseEmpty} from './raw-record-reader.js';

function validateRef(ref:string){if(typeof ref!=='string'||!/^[A-Za-z0-9+/_=-]{8,100}$/.test(ref))throw new CollectorError('INVALID_RECORD_REF');}
const errors=new Set(['AUTH_EXPIRED','LOGIN_REJECTED','LOGIN_HTTP_ERROR','STS_HTTP_ERROR','SERVICE_TOKEN_MISSING','INTERACTIVE_AUTH_REQUIRED','NETWORK_FAILURE','UPSTREAM_RATE_LIMITED','UPSTREAM_HTTP_ERROR','UPSTREAM_BUSINESS_ERROR','INVALID_CLOUD_RESPONSE','RESPONSE_TOO_LARGE','RAW_REDACTION_LIMIT','REPAIR_REQUEST_LIMIT','REPAIR_TIME_LIMIT','SYNC_LEASE_LOST']);
export async function readActivityRawRepair(env:PersistentEnv,ref:string){
 validateRef(ref);if(!env.DB)throw new CollectorError('DATABASE_NOT_READY');const d=env.DB;
 const source=await d.prepare("SELECT date_cn FROM raw_records WHERE metric='sport' AND record_id=?").bind(ref).first<{date_cn:string}>();if(!source)return {status:'not_found',eligible:false,raw_response_available:false,network_requests_performed:false};
 const cache=await d.prepare('SELECT status,raw_json,raw_meta_json FROM activity_details WHERE record_ref=?').bind(ref).first<{status:string;raw_json:string|null;raw_meta_json:string|null}>();
 const prior=await d.prepare('SELECT status,audit_json FROM activity_raw_repairs WHERE record_ref=?').bind(ref).first<{status:string;audit_json:string}>();
 if(cache?.raw_json){let empty:boolean|null=null;try{empty=sourceResponseEmpty(redactRawRecord(JSON.parse(cache.raw_json)).value);}catch{}return {status:'already_available',eligible:false,raw_response_available:true,source_response_empty:empty,source_date:source.date_cn,cached:true,repair_status:prior?.status??null,network_requests_performed:false};}
 if(prior)return {...JSON.parse(prior.audit_json),status:prior.status,eligible:false,cached:true,network_requests_performed:false,next_action:'inspect_saved_attempt_do_not_retry_login'};
 return {status:cache?.status==='fetched'?'legacy_raw_missing':'not_legacy_projected_cache',eligible:cache?.status==='fetched',raw_response_available:false,source_date:source.date_cn,cached:true,network_requests_performed:false};
}

// One explicit cached legacy reference, no automatic queue or retry. This is not MCP.
export async function repairActivityRaw(env:PersistentEnv,ref:string,transport:Fetcher=nativeFetcher(true)){
 const before=await readActivityRawRepair(env,ref);if(!before.eligible)return before;
 if(env.PERSIST_SYNC_ENABLED!=='true')throw new CollectorError('PERSIST_SYNC_DISABLED');
 if(!env.MI_USER_ID||!env.MI_PASS_TOKEN)throw new CollectorError('SECRETS_NOT_CONFIGURED');
 if(Date.now()>=Date.parse('2027-01-01T00:00:00+08:00'))throw new CollectorError('HOSTING_COST_REVIEW_REQUIRED');
 const d=env.DB!,lease='activity_raw_repair_'+crypto.randomUUID(),began=Date.now();
 const lock=await d.prepare('UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?').bind(lease,began+180000,began).run();if(!lock.meta.changes)throw new CollectorError('SYNC_BUSY_OR_NOT_INITIALIZED');
 const budget={login_attempts:1,auth_http_requests:2,health_requests:1,retries:0,elapsed_ms:45000};
 let claimed=false,status='checking',error:string|null=null,auth=0,health=0,logins=0,stored:Record<string,unknown>|null=null;
 const audit=()=>({status,error_code:error,source_date:before.source_date,endpoint:SPORT_OPERATIONAL_PATH,budget,login_attempts:logins,auth_http_requests:auth,health_requests:health,retries:0,raw_response_available:!!stored,storage:stored,checkpoints_advanced:false,native_files_requested:false,checked_at:Date.now()});
 try{
  // Recheck after taking the same lease as live/history sync.
  const latest=await readActivityRawRepair(env,ref);if(!latest.eligible)return latest;
  const row=await d.prepare("SELECT raw_json FROM raw_records WHERE record_id=? AND metric='sport'").bind(ref).first<{raw_json:string}>();
  let raw:RawRecord,payload:ReturnType<typeof operationalRequest>;
  try{raw=JSON.parse(row!.raw_json);payload=operationalRequest(raw);if(typeof raw.sid!=='string'||!raw.sid||typeof raw.key!=='string'||!raw.key||![payload.start_time,payload.end_time].every(x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)||Number(payload.end_time)<Number(payload.start_time))throw 0;}catch{throw new CollectorError('REPAIR_SOURCE_NOT_USABLE');}
  const claim=await d.prepare("INSERT OR IGNORE INTO activity_raw_repairs(record_ref,status,audit_json,checked_at) VALUES(?,'checking',?,?)").bind(ref,JSON.stringify(audit()),began).run();if(!claim.meta.changes)return await readActivityRawRepair(env,ref);claimed=true;
  const active=async()=>{if(!await d.prepare('SELECT 1 AS ok FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?').bind(lease,Date.now()).first())throw new CollectorError('SYNC_LEASE_LOST');};
  const once:Fetcher=async(url,init)=>{
   if(Date.now()-began>=budget.elapsed_ms)throw new CollectorError('REPAIR_TIME_LIMIT');await active();
   const target=new URL(url),isHealth=target.hostname==='hlth.io.mi.com';
   if(isHealth){if(target.pathname!==SPORT_OPERATIONAL_PATH||health>=1)throw new CollectorError('REPAIR_REQUEST_LIMIT');health++;}else{if(auth>=2)throw new CollectorError('REPAIR_REQUEST_LIMIT');auth++;}
   let r:Response;try{r=await transport(url,init);}catch{throw new CollectorError('NETWORK_FAILURE');}
   if(r.status!==200){await r.body?.cancel();throw new CollectorError(r.status===401||r.status===403?'AUTH_EXPIRED':r.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR');}return r;
  };
  const a=new MiFitnessAdapter(once);logins++;await a.login(env.MI_USER_ID,env.MI_PASS_TOKEN);
  const response=await a.request(SPORT_OPERATIONAL_PATH,payload);await active();stored=await preserveOperationalResponse(d,ref,response,true);
  status=stored.source_response_empty?'completed_empty_response':'completed';
 }catch(e){if(!claimed)throw e;status='failed';error=e instanceof CollectorError&&errors.has(e.code)?e.code:'ACTIVITY_RAW_REPAIR_FAILED';}
 finally{
  try{if(claimed)await d.prepare('UPDATE activity_raw_repairs SET status=?,audit_json=?,checked_at=? WHERE record_ref=?').bind(status,JSON.stringify(audit()),Date.now(),ref).run();}
  finally{await d.prepare('UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').bind(lease).run();}
 }
 return {...audit(),eligible:false,cached:false,network_requests_performed:auth+health>0};
}
