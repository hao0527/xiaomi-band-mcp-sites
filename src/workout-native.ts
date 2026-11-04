/* FDS naming and AES transport adapted from Jenwein/mifit, Copyright (c) 2026 Jenwein,
 * MIT; see licenses/mifit-MIT.txt. No upstream workout decoder is imported. */
import type {PersistentEnv} from './persistence.js';
import {MiFitnessAdapter,NATIVE_FILE_PATH} from './collector/adapter.js';
import {nativeFetcher,CollectorError,boundedText,type Fetcher} from './collector/http.js';
import {b64,unb64,digest,utf8} from './collector/crypto.js';
import {value} from './collector/parser.js';
import type {RawRecord} from './collector/models.js';
const endpoint=NATIVE_FILE_PATH;
const url64=(v:Uint8Array)=>b64(v).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function decodeURL64(s:string){if(!/^[A-Za-z0-9_-]*={0,2}$/.test(s)||s.replace(/=+$/,'').length%4===1)throw new CollectorError('FDS_BASE64_INVALID');const core=s.replace(/=+$/,'').replace(/-/g,'+').replace(/_/g,'/');return unb64(core+'='.repeat((4-core.length%4)%4));}
export async function fdsSuffix(sid:string,timestamp:number,tz:number,proto:number){if(!sid||!Number.isInteger(timestamp)||timestamp<0||timestamp>0xffffffff||!Number.isInteger(tz)||tz< -128||tz>127||!Number.isInteger(proto)||proto<0||proto>31)throw new CollectorError('FDS_REFERENCE_INVALID');const b=new Uint8Array(6),v=new DataView(b.buffer);v.setUint32(0,timestamp,true);v.setInt8(4,tz);b[5]=(128+(proto<<2))&255;return url64(b)+'_'+url64(await digest('SHA-1',utf8(sid)));}
export function allowedFDS(raw:string){if(/[^\x21-\x7e]|\\/.test(raw))throw new CollectorError('FDS_HOST_BLOCKED');let u:URL;try{u=new URL(raw);}catch{throw new CollectorError('FDS_HOST_BLOCKED');}if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!u.hostname.endsWith('.fds.api.xiaomi.com')||!/^(?:[a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$/.test(u.hostname))throw new CollectorError('FDS_HOST_BLOCKED');return u;}
export async function decryptFDS(body:string,key:string){try{const v=body.trim(),encoded=v.startsWith('"')?JSON.parse(v):v;if(typeof encoded!=='string')throw 0;const k=decodeURL64(key),ct=decodeURL64(encoded);if(![16,24,32].includes(k.length)||!ct.length||ct.length%16)throw 0;const secret=await crypto.subtle.importKey('raw',new Uint8Array(k),'AES-CBC',false,['decrypt']);return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv:utf8('1234567887654321')},secret,new Uint8Array(ct)));}catch{throw new CollectorError('FDS_DECRYPT_FAILED');}}
const errors=new Set(['AUTH_REQUIRED','AUTH_EXPIRED','LOGIN_REJECTED','INTERACTIVE_AUTH_REQUIRED','LOGIN_HTTP_ERROR','STS_HTTP_ERROR','SERVICE_TOKEN_MISSING','NETWORK_FAILURE','UPSTREAM_RATE_LIMITED','UPSTREAM_HTTP_ERROR','UPSTREAM_BUSINESS_ERROR','INVALID_CLOUD_RESPONSE','RESPONSE_TOO_LARGE','SYNC_LEASE_LOST','NATIVE_TIME_LIMIT','NATIVE_REQUEST_LIMIT','NATIVE_SOURCE_NOT_USABLE','FDS_HOST_BLOCKED','FDS_METHOD_BLOCKED','FDS_DECRYPT_FAILED','FDS_HEADER_INVALID','FDS_HEADER_MISMATCH','FDS_DOWNLOAD_HTTP_ERROR']);
const errorCode=(e:unknown)=>e instanceof CollectorError&&errors.has(e.code)?e.code:'NATIVE_FILE_FETCH_FAILED';
async function activeLease(env:PersistentEnv,lease:string){if(!await env.DB!.prepare('SELECT 1 AS ok FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?').bind(lease,Date.now()).first())throw new CollectorError('SYNC_LEASE_LOST');}
async function cached(env:PersistentEnv,ref:string){const old=await env.DB!.prepare('SELECT status,evidence_json,checked_at FROM workout_native_cache WHERE record_ref=?').bind(ref).first<{status:string;evidence_json:string;checked_at:number}>();return old?{status:old.status,evidence:JSON.parse(old.evidence_json) as Record<string,unknown>,checked_at:old.checked_at,cached:true}:null;}

// Shared by ordinary sync and the selected-record operator action. A durable row,
// including failed/empty/checking, is never automatically replaced or retried.
async function collectNativeWorkout(env:PersistentEnv,ref:string,lease:string,deadline:number,lookup:(payload:Record<string,unknown>,signal:AbortSignal)=>Promise<Record<string,unknown>>,download:Fetcher,evidence:Record<string,unknown>){
 const d=env.DB!,old=await cached(env,ref);if(old)return old;
 const row=await d.prepare("SELECT raw_json FROM raw_records WHERE metric='sport' AND record_id=?").bind(ref).first<{raw_json:string}>();if(!row)return {status:'not_found',cached:true};
 await activeLease(env,lease);
 const claim=await d.prepare("INSERT OR IGNORE INTO workout_native_cache(record_ref,status,evidence_json,checked_at) VALUES(?,'checking',?,?)").bind(ref,JSON.stringify(evidence),Date.now()).run();if(!claim.meta.changes)return (await cached(env,ref))!;
 let status='failed',payload:string|null=null;
 const permit=async()=>{await activeLease(env,lease);const remaining=deadline-Date.now();if(remaining<=0)throw new CollectorError('NATIVE_TIME_LIMIT');return AbortSignal.timeout(Math.min(20000,remaining));};
 try{
  let r:RawRecord,timestamp:number,tz:number,proto:number,suffix:string;
  try{r=JSON.parse(row.raw_json);const p=value(r);if(typeof p.time!=='number'||typeof p.timezone!=='number'||typeof p.proto_type!=='number')throw 0;timestamp=p.time;tz=p.timezone;proto=p.proto_type;suffix=await fdsSuffix(r.sid??'',timestamp,tz,proto);}catch{status='schema_unverified';throw new CollectorError('NATIVE_SOURCE_NOT_USABLE');}
  evidence.proto_type=proto;
  const map=await lookup({did:r.sid,items:[{timestamp,suffix}]},await permit());evidence.http_status=200;evidence.business_code=0;
  const entry=map[suffix+'_'+timestamp] as {url?:unknown;obj_key?:unknown;method?:unknown}|undefined;
  evidence.entry_present=!!entry;evidence.key_present=typeof entry?.obj_key==='string'&&!!entry.obj_key;
  if(typeof entry?.url!=='string'||typeof entry.obj_key!=='string'||!entry.obj_key){status='not_stored_at_check';evidence.error_code='FDS_NO_STORED_FILE';}
  else{
   if(entry.method&&entry.method!=='GET')throw new CollectorError('FDS_METHOD_BLOCKED');const target=allowedFDS(entry.url),signal=await permit();evidence.download_requests=1;
   let file:Response;try{file=await download(target.href,{method:'GET',credentials:'omit',redirect:'manual',signal});}catch{throw new CollectorError('NETWORK_FAILURE');}
   evidence.download_http_status=file.status;if(file.status!==200){await file.body?.cancel();throw new CollectorError(file.status===401||file.status===403?'AUTH_EXPIRED':file.status===429?'UPSTREAM_RATE_LIMITED':'FDS_DOWNLOAD_HTTP_ERROR');}
   const body=await boundedText(file,2*1024*1024),plain=await decryptFDS(body,entry.obj_key);if(plain.length<8)throw new CollectorError('FDS_HEADER_INVALID');
   const v=new DataView(plain.buffer,plain.byteOffset,plain.byteLength);if(v.getUint32(0,true)!==timestamp||v.getInt8(4)!==tz||plain[6]!==proto)throw new CollectorError('FDS_HEADER_MISMATCH');
   evidence.header={version:plain[5],proto_type:plain[6],storage_mode:plain[7],bytes:plain.length};status='downloaded_decoder_unverified';evidence.error_code='NATIVE_FORMAT_DECODER_NOT_VERIFIED';payload=b64(plain);
  }
  await activeLease(env,lease);
 }catch(e){if(status!=='schema_unverified')status='failed';payload=null;evidence.error_code=errorCode(e);}
 const at=Date.now();await d.prepare('UPDATE workout_native_cache SET status=?,evidence_json=?,payload_base64=?,checked_at=? WHERE record_ref=?').bind(status,JSON.stringify(evidence),payload,at,ref).run();
 return {status,evidence,checked_at:at,cached:false};
}

export async function nativeSyncState(env:PersistentEnv,start:string,end:string){
 const rows=(await env.DB!.prepare(`SELECT CASE WHEN n.record_ref IS NULL THEN 'pending' WHEN n.payload_base64 IS NOT NULL THEN 'stored' ELSE n.status END AS state,COUNT(*) AS count FROM raw_records r LEFT JOIN workout_native_cache n ON n.record_ref=r.record_id WHERE r.metric='sport' AND r.date_cn>=? AND r.date_cn<=? GROUP BY state`).bind(start,end).all<{state:string;count:number}>()).results;
 const count=(state:string)=>rows.find(r=>r.state===state)?.count??0,pending=count('pending');
 return {scope:{start_date:start,end_date:end,timezone:'Asia/Shanghai'},pending,stored:count('stored'),not_stored_at_check:count('not_stored_at_check'),failed:count('failed'),checking:count('checking'),schema_unverified:count('schema_unverified'),max_files_per_batch:1,max_reference_requests_per_batch:1,max_download_requests_per_batch:1,automatic_retry:false,upstream_upload_complete:'unknown',next_action:pending?'continue_trigger_sync':count('failed')||count('checking')?'inspect_saved_attempt_do_not_retry_login':'read_cached_activity'};
}

export async function fetchPendingNativeWorkout(env:PersistentEnv,adapter:MiFitnessAdapter,lease:string,start:string,end:string,deadline:number,download:Fetcher=fetch){
 if(Date.now()>=deadline)return {status:'deferred_time_budget',cached:true};
 const row=await env.DB!.prepare("SELECT r.record_id FROM raw_records r LEFT JOIN workout_native_cache n ON n.record_ref=r.record_id WHERE r.metric='sport' AND r.date_cn>=? AND r.date_cn<=? AND n.record_ref IS NULL ORDER BY r.recorded_at DESC,r.record_id LIMIT 1").bind(start,end).first<{record_id:string}>();
 if(!row)return {status:'no_pending_native_files',cached:true};
 const evidence:Record<string,unknown>={endpoint,method:'GET',signature_path:'/service/gen_download_url',requested_file_type:0,session_source:'current_sync',login_attempts:0,reference_requests:0,download_requests:0,max_reference_requests:1,max_download_requests:1,retries:0,gps_requested:false};
 const result=await collectNativeWorkout(env,row.record_id,lease,deadline,(payload,signal)=>{evidence.reference_requests=1;return adapter.nativeFileReference(payload,signal);},download,evidence);
 if(result.status==='failed')throw new CollectorError('NATIVE_FILE_FETCH_FAILED');return result;
}

export async function probeNativeWorkout(env:PersistentEnv,ref:string,transport:Fetcher=nativeFetcher(true),download:Fetcher=fetch){
 if(!env.DB)throw new CollectorError('DATABASE_NOT_READY');if(!/^[A-Za-z0-9+/_=-]{8,100}$/.test(ref))throw new CollectorError('INVALID_DETAIL_QUERY');
 const old=await cached(env,ref);if(old)return old;
 if(env.PERSIST_SYNC_ENABLED!=='true')throw new CollectorError('PERSIST_SYNC_DISABLED');if(!env.MI_USER_ID||!env.MI_PASS_TOKEN)throw new CollectorError('SECRETS_NOT_CONFIGURED');
 if(Date.now()>=Date.parse('2027-01-01T00:00:00+08:00'))throw new CollectorError('HOSTING_COST_REVIEW_REQUIRED');
 const d=env.DB,lease='native_file_'+crypto.randomUUID(),began=Date.now(),deadline=began+45000;
 const claim=await d.prepare('UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?').bind(lease,began+180000,began).run();if(!claim.meta.changes)return {status:'busy',error_code:'SYNC_BUSY'};
 const evidence:Record<string,unknown>={endpoint,method:'GET',signature_path:'/service/gen_download_url',requested_file_type:0,session_source:'selected_record_operator',login_attempts:0,auth_http_requests:0,reference_requests:0,download_requests:0,budget:{login_attempts:1,auth_http_requests:2,reference_requests:1,download_requests:1,elapsed_ms:45000},retries:0,gps_requested:false};
 const once:Fetcher=async(url,init)=>{
  await activeLease(env,lease);const remaining=deadline-Date.now();if(remaining<=0)throw new CollectorError('NATIVE_TIME_LIMIT');const target=new URL(url),health=target.hostname==='hlth.io.mi.com',counter=health?'reference_requests':'auth_http_requests';
  if(health&&target.pathname!==endpoint||Number(evidence[counter])>=(health?1:2))throw new CollectorError('NATIVE_REQUEST_LIMIT');evidence[counter]=Number(evidence[counter])+1;
  let r:Response;try{r=await transport(url,{...init,signal:AbortSignal.timeout(Math.min(20000,remaining))});}catch{throw new CollectorError('NETWORK_FAILURE');}
  if(r.status!==200){await r.body?.cancel();throw new CollectorError(r.status===401||r.status===403?'AUTH_EXPIRED':r.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR');}return r;
 };
 try{
  const adapter=new MiFitnessAdapter(once);
  return await collectNativeWorkout(env,ref,lease,deadline,async(payload,signal)=>{evidence.login_attempts=1;await adapter.login(env.MI_USER_ID!,env.MI_PASS_TOKEN!);return adapter.nativeFileReference(payload,signal);},download,evidence);
 }finally{await d.prepare('UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').bind(lease).run();}
}
