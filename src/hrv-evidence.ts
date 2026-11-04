import type {PersistentEnv} from './persistence.js';
import {CollectorError} from './collector/http.js';
import {dateRange} from './collector/parser.js';
import {sleepHRVFromRaw} from './hrv-source.js';
export const reconciledHRVFields=['avg_hrv','max_hrv','min_hrv','hrv_base_min','hrv_base_max'] as const;
type Bundle=ReturnType<typeof sleepHRVFromRaw>;
export type HRVEvidence={date:string;fields:Record<string,number>;matched_record_refs:string[];saved_at:number;method:'owner_reported_app_reconciliation'};
export async function readHRVEvidence(env:PersistentEnv,start:string,end:string){
 const r=await env.DB!.prepare("SELECT policy_json FROM aggregation_policies WHERE metric>=? AND metric<=?").bind('hrv_app_reference:'+start,'hrv_app_reference:'+end).all<{policy_json:string}>();
 return r.results.map(x=>JSON.parse(x.policy_json) as HRVEvidence);
}
export function attachHRVEvidence(bundle:Bundle,date:string,recordRef:string,evidence:HRVEvidence[]){
 const ref=evidence.find(x=>x.date===date),matches=ref?ref.matched_record_refs.includes(recordRef)&&reconciledHRVFields.every(k=>bundle.source_fields[k]===ref.fields[k]):null;
 return {...bundle,app_reconciliation:{status:ref?(matches?'matched':'mismatch'):'no_reference',record_app_reconciled:matches,reference_date:ref?.date??null,verified_at:ref?.saved_at??null,method:ref?.method??null},field_metadata:Object.fromEntries(Object.entries(bundle.field_metadata).map(([k,m])=>[k,{...m,...(reconciledHRVFields.includes(k as typeof reconciledHRVFields[number])?{verification:{...('verification' in m?m.verification:{}),record_app_reconciled:matches,reference_date:ref?.date??null,private_evidence_persisted:!!ref}}:{})}]))};
}
export async function saveHRVEvidence(env:PersistentEnv,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CollectorError('INVALID_HRV_REFERENCE');
 const b=input as Record<string,unknown>;if(Object.keys(b).some(k=>!['date','app_values'].includes(k))||typeof b.date!=='string')throw new CollectorError('INVALID_HRV_REFERENCE');dateRange(b.date,b.date);
 if(!b.app_values||typeof b.app_values!=='object'||Array.isArray(b.app_values))throw new CollectorError('INVALID_HRV_REFERENCE');const fields=b.app_values as Record<string,number>;
 if(Object.keys(fields).length!==reconciledHRVFields.length||reconciledHRVFields.some(k=>typeof fields[k]!=='number'||!Number.isFinite(fields[k])||fields[k]<=0))throw new CollectorError('INVALID_HRV_REFERENCE');
 const rows=(await env.DB!.prepare("SELECT record_id,raw_json FROM raw_records WHERE metric='sleep' AND date_cn=?").bind(b.date).all<{record_id:string;raw_json:string}>()).results;
 const refs=rows.filter(r=>{const h=sleepHRVFromRaw(r.raw_json);return h.has_positive_source_average&&reconciledHRVFields.every(k=>h.source_fields[k]===fields[k]);}).map(r=>r.record_id);
 if(!refs.length)throw new CollectorError('HRV_REFERENCE_MISMATCH');
 const evidence:HRVEvidence={date:b.date,fields,matched_record_refs:refs,saved_at:Date.now(),method:'owner_reported_app_reconciliation'};
 await env.DB!.prepare('INSERT INTO aggregation_policies(metric,policy_json,verified_at) VALUES(?,?,?) ON CONFLICT(metric) DO UPDATE SET policy_json=excluded.policy_json,verified_at=excluded.verified_at').bind('hrv_app_reference:'+b.date,JSON.stringify(evidence),evidence.saved_at).run();
 return {status:'matched',date:b.date,matched_records:refs.length,verified_fields:reconciledHRVFields,unit:'ms',algorithm_verified:false,evidence_stored:'site_d1',raw_records_modified:false};
}
