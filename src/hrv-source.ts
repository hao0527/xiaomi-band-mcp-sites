/** Owner-reported App reconciliation validates field mapping/units only.
 * Evidence values remain private; no personal measurements are shipped in source.
 * A single-owner observation is not cross-device or cross-account validation.
 */
const appMappedFields:Record<string,string>={
 avg_hrv:'睡眠平均HRV',max_hrv:'睡眠最高HRV',min_hrv:'睡眠最低HRV',
 hrv_base_min:'个人基准下限',hrv_base_max:'个人基准上限'
};
const appMappingEvidence={
 verified_date:'2026-11-04',method:'owner_reported_app_reconciliation',
 evidence_scope:'single_owner_single_sleep_date',
 app:'小米运动健康',independently_inspected_app:false,
 private_value_evidence:'owner_supplied_comparison_not_embedded_in_public_source',
 applies_to:'sleep_summary_field_mapping_and_unit_only',
 record_app_reconciled:null,algorithm_verified:false
};
/** Cache-only passthrough. Five field units have scoped App evidence; algorithm remains unknown. */
const fields=['avg_hrv','min_hrv','max_hrv','hrv_median','hrv_std','hrv_base_min','hrv_base_max','hrv_lower_quantile','hrv_upper_quantile','hrv_analysis_timestamp'] as const;
function safeValue(v:unknown):unknown{if(Array.isArray(v))return v.map(safeValue);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!/token|cookie|password|ssecurity|authorization|userid|cuserid|deviceid|sid/i.test(k.replace(/[_-]/g,''))).map(([k,x])=>[k,safeValue(x)]));return v;}
export function extractSleepHRV(p:Record<string,unknown>){
 const source_fields:Record<string,unknown>={};
 // Preserve source structures while excluding credential/identifier keys.
 for(const k of Object.keys(p))if((fields.includes(k as typeof fields[number])||/^hrv_[a-z_]+$/.test(k)||/^[a-z_]+_hrv$/.test(k))&&!/token|cookie|password|security|authorization|user|device|sid/i.test(k)){
  source_fields[k]=safeValue(p[k]);
 }
 const present=Object.keys(source_fields).length>0,known=fields.filter(k=>Object.hasOwn(source_fields,k));
 const allZero=known.length===fields.length&&known.every(k=>source_fields[k]===0);
 const positive=typeof source_fields.avg_hrv==='number'&&Number.isFinite(source_fields.avg_hrv)&&source_fields.avg_hrv>0;
 return {source:'xiaomi_cloud.sleep.value',kind:'raw',unit:null,algorithm:null,validated_hrv_metric:false,source_fields_present:present,has_positive_source_average:positive,
 status:!present?'missing':allZero?'zero_placeholder_unverified':positive?'source_fields_available':'source_values_unverified',
 source_fields,field_metadata:Object.fromEntries(Object.keys(source_fields).map(k=>[k,{source:'sleep.value.'+k,unit:appMappedFields[k]?'ms':null,kind:'raw',confidence:appMappedFields[k]?'source_reported':'unverified',mapping_verified:!!appMappedFields[k],unit_verified:!!appMappedFields[k],algorithm_verified:false,meaning:appMappedFields[k]??(k==='hrv_analysis_timestamp'?'Source analysis timestamp; event semantics and time unit unverified':'Source HRV field; unit and algorithm unverified'),...(appMappedFields[k]?{verification:appMappingEvidence}:{})}])),
 unit_scope:'per_field_metadata_mixed_verification',algorithm_verified:false,source_complete:p.is_uncomplete===true?false:p.is_uncomplete===false?true:null,
 warnings:[...(present?['UNIT_UNVERIFIED','ALGORITHM_UNVERIFIED']:[]),...(allZero?['ZERO_PLACEHOLDER_UNVERIFIED']:[]),...(Object.hasOwn(source_fields,'hrv_std')&&source_fields.hrv_std===0?['SOURCE_STD_ZERO_NOT_VALIDATED']:[])]};
}
export function sleepHRVFromRaw(raw:string){try{const r=JSON.parse(raw);const p=typeof r.value==='string'?JSON.parse(r.value):r.value;if(!p||typeof p!=='object'||Array.isArray(p))throw 0;return extractSleepHRV(p);}catch{return {...extractSleepHRV({}),status:'raw_decode_failed',warnings:['RAW_DECODE_FAILED']};}}
