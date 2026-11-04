import type {PersistentEnv} from './persistence.js';
import {value} from './collector/parser.js';
const sensitive=/(?:id$|sid|mac|imei|imsi|phone|lat|lon|lng|gps|route|track|coordinate|location|address|token|cookie|password|security|user)/i;
export function inspectHRVTree(input:unknown){
 const hrv_fields:Array<{path:string;type:string;value?:unknown}>=[],arrays:Array<{path:string;length:number;item_keys:string[]}>=[],strings:Array<{path:string;length:number;encoding:string;decoded_bytes?:number}>=[];let nodes=0,truncated=false;
 function visit(v:unknown,path:string,depth:number){if(++nodes>20000||depth>24){truncated=true;return;}if(Array.isArray(v)){arrays.push({path,length:v.length,item_keys:[...new Set(v.slice(0,20).flatMap(x=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).filter(k=>!sensitive.test(k)):[]))]});for(let i=0;i<v.length;i++){if(nodes>20000){truncated=true;break;}visit(v[i],path+'['+i+']',depth+1);}return;}
 if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){if(sensitive.test(k)||['next_key','cursor','next_cursor'].includes(k))continue;const p=path?path+'.'+k:k;if(/hrv|rmssd|sdnn|rr_interval|rri|ibi/i.test(k))hrv_fields.push({path:p,type:Array.isArray(x)?'array':x===null?'null':typeof x,...(typeof x==='number'||typeof x==='boolean'||x===null?{value:x}:{})});visit(x,p,depth+1);}return;}
 if(typeof v==='string'){try{const d=JSON.parse(v);if(d&&typeof d==='object'){strings.push({path,length:v.length,encoding:'json'});visit(d,path+'::json',depth+1);return;}}catch{}if(v.length>=24&&v.length<=3*1024*1024&&/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)){let bytes;try{bytes=atob(v.replace(/-/g,'+').replace(/_/g,'/')).length;}catch{}strings.push({path,length:v.length,encoding:bytes===undefined?'opaque_string':'base64_candidate_unverified',...(bytes===undefined?{}:{decoded_bytes:bytes})});}else strings.push({path,length:v.length,encoding:'opaque_string'});}}
 visit(input,'',0);return {hrv_fields,arrays,strings,nodes,truncated,source_values_modified:false};
}
export async function cachedHRVInspection(env:PersistentEnv,start:string,end:string){
 const rows=(await env.DB!.prepare("SELECT record_id,date_cn,raw_json FROM raw_records WHERE metric='sleep' AND date_cn>=? AND date_cn<=? ORDER BY recorded_at,record_id LIMIT 201").bind(start,end).all<{record_id:string;date_cn:string;raw_json:string}>()).results;
 return {source:'cached_raw_sleep',records:rows.slice(0,200).map(r=>{try{return {sleep_record_ref:r.record_id,date:r.date_cn,inspection:inspectHRVTree(value(JSON.parse(r.raw_json)))};}catch{return {sleep_record_ref:r.record_id,date:r.date_cn,error_code:'RAW_DECODE_FAILED'};}}),truncated:rows.length>200,network_requests_performed:false};
}
