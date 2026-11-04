import type {PersistentEnv} from './persistence.js';
import {CollectorError} from './collector/http.js';
const normalizedKey=(k:string)=>k.replace(/[_\s-]/g,'').toLowerCase();
const credentialKey=/token|cookie|password|security|authorization|secret|credential|sessionkey|objkey|signature|privatekey|accesskey|apikey|aeskey|rc4key|^auth$|^session$/i;
const identifierKeys=new Set(['id','sid','did','userid','cuserid','accountid','deviceid','sourceid','sourcesidlist','mac','macaddress','imei','imsi','phone','phonenumber','email','name','username','nickname','serialnumber','sn']);
const locationKeys=new Set(['lat','latitude','lon','lng','longitude','gps','route','track','coordinates','coordinate','location','address']);
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
export async function rawRecord(env:PersistentEnv,recordRef:string,offset=0,limit=8192,snapshotHash?:string){
 if(typeof recordRef!=='string'||!/^[A-Za-z0-9+/_=-]{8,100}$/.test(recordRef))throw new CollectorError('INVALID_RECORD_REF');
 if(!Number.isSafeInteger(offset)||offset<0)throw new CollectorError('INVALID_OFFSET');if(!Number.isInteger(limit)||limit<256||limit>16384)throw new CollectorError('INVALID_LIMIT');
 if(snapshotHash!==undefined&&(typeof snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(snapshotHash)))throw new CollectorError('INVALID_SNAPSHOT');
 if(offset>0&&!snapshotHash)throw new CollectorError('RAW_SNAPSHOT_REQUIRED');if(!env.DB)throw new CollectorError('DATABASE_NOT_READY');
 const row=await env.DB.prepare('SELECT record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at FROM raw_records WHERE record_id=?').bind(recordRef).first<{record_id:string;metric:string;recorded_at:number;date_cn:string;source_hash:string;raw_json:string;parse_status:string;synced_at:number}>();
 if(!row)return {status:'not_found',record_ref:recordRef,network_requests_performed:false};
 let parsed:unknown;try{parsed=JSON.parse(row.raw_json);}catch{return {status:'raw_envelope_invalid_json',record_ref:recordRef,metric:row.metric,raw_preserved_in_d1:true,raw_content_withheld_reason:'UNPARSED_CONTENT_SECRET_SAFETY',network_requests_performed:false};}
 const clean=redactRawRecord(parsed),json=JSON.stringify(clean.value),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json)),hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 if(snapshotHash&&snapshotHash!==hash)throw new CollectorError('RECORD_CHANGED_RESTART');
 if(offset>json.length||(offset>0&&/[\uD800-\uDBFF]/.test(json[offset-1])&&/[\uDC00-\uDFFF]/.test(json[offset]??'')))throw new CollectorError('INVALID_OFFSET');
 let end=Math.min(offset+limit,json.length);if(end<json.length&&/[\uD800-\uDBFF]/.test(json[end-1])&&/[\uDC00-\uDFFF]/.test(json[end]))end--;
 return {status:'available',record_ref:row.record_id,metric:row.metric,recorded_at:row.recorded_at,stored_date_cn:row.date_cn,source_ref:row.source_hash,parse_status:row.parse_status,last_ingested_at:row.synced_at,snapshot_hash:hash,offset,limit,next_offset:end<json.length?end:null,total_characters:json.length,offset_unit:'utf16_code_unit',timestamp_units:{recorded_at:'unix_second',last_ingested_at:'unix_millisecond'},complete_meaning:'end_of_record_reached_concat_all_chunks_from_offset_0',raw_json_chunk:json.slice(offset,end),complete:end===json.length,redactions:clean.redactions,raw_preserved_in_d1:true,source_fields_unmodified_except_explicit_redactions:true,unit_policy:'unknown_source_units_are_not_inferred',network_requests_performed:false,timezone:'Asia/Shanghai'};
}
export const rawReadErrors=new Set(['INVALID_RECORD_REF','INVALID_OFFSET','INVALID_LIMIT','INVALID_SNAPSHOT','RAW_SNAPSHOT_REQUIRED','RECORD_CHANGED_RESTART','RAW_REDACTION_LIMIT']);
