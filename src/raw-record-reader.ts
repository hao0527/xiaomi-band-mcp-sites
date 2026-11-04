import type {PersistentEnv} from './persistence.js';
import {CollectorError} from './collector/http.js';
const normalizedKey=(k:string)=>k.replace(/[_\s-]/g,'').toLowerCase();
const credentialKey=/token|cookie|password|security|authorization|secret|credential|sessionkey|objkey|signature|privatekey|accesskey|apikey|aeskey|rc4key|^auth$|^session$/i;
const identifierKeys=new Set(['id','sid','did','userid','cuserid','accountid','deviceid','sourceid','sourcesidlist','mac','macaddress','imei','imsi','phone','phonenumber','email','name','username','nickname','serialnumber','sn']);
const locationKeys=new Set(['lat','latitude','lon','lng','longitude','gps','route','track','coordinates','coordinate','location','address']);
// Structure-only classification of an already bounded/redacted JSON value.
// Zero and false remain source content; no health meaning is inferred.
export function sourceResponseEmpty(v:unknown):boolean{
 if(v===null||v===undefined||v==='')return true;
 if(Array.isArray(v))return v.every(sourceResponseEmpty);
 if(v&&typeof v==='object')return Object.values(v).every(sourceResponseEmpty);
 return false;
}
export function redactRawRecord(input:unknown){
 const redactions={credential_fields:0,identifier_fields:0,location_fields:0,url_values:0,sensitive_strings:0};let nodes=0;
 function clean(v:unknown,depth:number):unknown{if(++nodes>200000||depth>40)throw new CollectorError('RAW_REDACTION_LIMIT');if(Array.isArray(v))return v.map(x=>clean(x,depth+1));if(v&&typeof v==='object'){
  const out:Record<string,unknown>=Object.create(null);for(const [k,x]of Object.entries(v)){const n=normalizedKey(k);if(credentialKey.test(n)){redactions.credential_fields++;continue;}if(identifierKeys.has(n)||/userid|cuserid|deviceid|accountid|sourceid|sourcesidlist/.test(n)){redactions.identifier_fields++;continue;}if(locationKeys.has(n)||/latitude|longitude|^(?:start|end)(?:lat|lon|lng)$/.test(n)){redactions.location_fields++;continue;}out[k]=clean(x,depth+1);}return out;}
 if(typeof v==='string'){
  // Parse only JSON containers, preserving ordinary scalar strings and binary encodings.
  if(/^[\[{]/.test(v.trim())){try{const decoded=JSON.parse(v);const before=JSON.stringify(redactions),next=clean(decoded,depth+1);return JSON.stringify(redactions)===before?v:JSON.stringify(next);}catch(e){if(e instanceof CollectorError)throw e;}}
  if(/https?:\/\//i.test(v)){redactions.url_values++;return '[REDACTED_URL_VALUE]';}
  if(/(?:pass[_-]?token|service[_-]?token|ssecurity|authorization|cookie|password|secret|credential)\s*[:=]|\bBearer\s+\S+/i.test(v)){redactions.sensitive_strings++;return '[REDACTED_SENSITIVE_STRING]';}
 }
 return v;
 }
 return {value:clean(input,0),redactions};
}
export async function rawRecord(env:PersistentEnv,recordRef:string,offset=0,limit=8192,snapshotHash?:string,component='metric_record'){
 if(!['metric_record','activity_operational','ingestion_quarantine'].includes(component))throw new CollectorError('INVALID_COMPONENT');
 if(typeof recordRef!=='string'||!/^[A-Za-z0-9+/_=-]{8,100}$/.test(recordRef))throw new CollectorError('INVALID_RECORD_REF');
 if(!Number.isSafeInteger(offset)||offset<0)throw new CollectorError('INVALID_OFFSET');if(!Number.isInteger(limit)||limit<256||limit>16384)throw new CollectorError('INVALID_LIMIT');
 if(snapshotHash!==undefined&&(typeof snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(snapshotHash)))throw new CollectorError('INVALID_SNAPSHOT');
 if(offset>0&&!snapshotHash)throw new CollectorError('RAW_SNAPSHOT_REQUIRED');if(!env.DB)throw new CollectorError('DATABASE_NOT_READY');
 let row:{record_id:string;metric:string;recorded_at:number|null;date_cn:string|null;source_hash:string|null;raw_json:string;parse_status:string;synced_at:number},preservation:unknown=null,quarantineContext:unknown=null;
 if(component==='ingestion_quarantine'){
  const q=await env.DB.prepare('SELECT quarantine_id,metric,requested_start,requested_end,reason_code,raw_json,redactions_json,last_seen_at FROM ingestion_quarantine WHERE quarantine_id=?').bind(recordRef).first<{quarantine_id:string;metric:string;requested_start:string;requested_end:string;reason_code:string;raw_json:string;redactions_json:string;last_seen_at:number}>();
  if(!q)return {status:'not_found',record_ref:recordRef,component,network_requests_performed:false};
  row={record_id:q.quarantine_id,metric:q.metric,recorded_at:null,date_cn:null,source_hash:null,raw_json:q.raw_json,parse_status:'quarantined',synced_at:q.last_seen_at};quarantineContext={requested_start:q.requested_start,requested_end:q.requested_end,reason_code:q.reason_code,source_time_not_invented:true};
 }else{
  const r=await env.DB.prepare('SELECT record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at FROM raw_records WHERE record_id=?').bind(recordRef).first<{record_id:string;metric:string;recorded_at:number;date_cn:string;source_hash:string;raw_json:string;parse_status:string;synced_at:number}>();
  if(!r)return {status:'not_found',record_ref:recordRef,component,network_requests_performed:false};row=r;
  if(component==='activity_operational'){
   if(r.metric!=='sport')return {status:'component_not_applicable',record_ref:recordRef,component,network_requests_performed:false};
   const op=await env.DB.prepare('SELECT status,raw_json,raw_meta_json,fetched_at FROM activity_details WHERE record_ref=?').bind(recordRef).first<{status:string;raw_json:string|null;raw_meta_json:string|null;fetched_at:number}>();
   if(!op?.raw_json)return {status:op?.status==='fetched'?'legacy_projected_cache_no_raw_response':'raw_not_fetched',record_ref:recordRef,component,raw_response_available:false,network_requests_performed:false};
   let meta:Record<string,unknown>={};try{meta=JSON.parse(op.raw_meta_json??'{}');}catch{}
   preservation=redactRawRecord(meta).value;row={...r,raw_json:op.raw_json,parse_status:'operational_'+op.status,synced_at:typeof meta.raw_fetched_at==='number'?meta.raw_fetched_at:op.fetched_at};
  }
 }
 let parsed:unknown;try{parsed=JSON.parse(row.raw_json);}catch{return {status:'raw_envelope_invalid_json',record_ref:recordRef,metric:row.metric,raw_preserved_in_d1:true,raw_content_withheld_reason:'UNPARSED_CONTENT_SECRET_SAFETY',network_requests_performed:false};}
 const clean=redactRawRecord(parsed),json=JSON.stringify(clean.value),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(component==='metric_record'?json:component+'\0'+json)),hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 if(component==='activity_operational')preservation={...(preservation as Record<string,unknown>),source_response_empty:sourceResponseEmpty(clean.value),source_response_empty_rule:'no_nonempty_leaf_v1'};
 if(snapshotHash&&snapshotHash!==hash)throw new CollectorError('RECORD_CHANGED_RESTART');
 if(offset>json.length||(offset>0&&/[\uD800-\uDBFF]/.test(json[offset-1])&&/[\uDC00-\uDFFF]/.test(json[offset]??'')))throw new CollectorError('INVALID_OFFSET');
 let end=Math.min(offset+limit,json.length);if(end<json.length&&/[\uD800-\uDBFF]/.test(json[end-1])&&/[\uDC00-\uDFFF]/.test(json[end]))end--;
 return {status:'available',component,preservation,quarantine_context:quarantineContext,record_ref:row.record_id,metric:row.metric,recorded_at:row.recorded_at,stored_date_cn:row.date_cn,source_ref:row.source_hash,parse_status:row.parse_status,last_ingested_at:row.synced_at,snapshot_hash:hash,offset,limit,next_offset:end<json.length?end:null,total_characters:json.length,offset_unit:'utf16_code_unit',timestamp_units:{recorded_at:'unix_second',last_ingested_at:'unix_millisecond'},complete_meaning:'end_of_record_reached_concat_all_chunks_from_offset_0',raw_json_chunk:json.slice(offset,end),complete:end===json.length,redactions:clean.redactions,raw_preserved_in_d1:true,source_fields_unmodified_except_explicit_redactions:true,unit_policy:'unknown_source_units_are_not_inferred',network_requests_performed:false,timezone:'Asia/Shanghai'};
}
export const rawReadErrors=new Set(['INVALID_COMPONENT','INVALID_RECORD_REF','INVALID_OFFSET','INVALID_LIMIT','INVALID_SNAPSHOT','RAW_SNAPSHOT_REQUIRED','RECORD_CHANGED_RESTART','RAW_REDACTION_LIMIT']);
