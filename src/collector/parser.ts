import {normalizeSleep} from '../sleep-normalizer.js';
/* Selective adapter port. Copyright (c) 2026 Aleksej Kubulashvili; MIT. */
import type {CleanRecord,MetricKey,RawRecord} from './models.js';
import {CollectorError} from './http.js';
export function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new CollectorError('INVALID_OBJECT');return v as Record<string,unknown>;}
export function num(v:unknown,fallback?:number):number {if(v===null||v===undefined){if(fallback!==undefined)return fallback;throw new CollectorError('MISSING_NUMBER');}if((typeof v!=='number'&&typeof v!=='string')||v===''||!Number.isFinite(Number(v)))throw new CollectorError('INVALID_NUMBER');return Number(v);}
export function positive(v:unknown,fallback=0){const n=num(v,fallback);if(n<0)throw new CollectorError('NEGATIVE_VALUE');return n;}
export function validateRaw(v:unknown):RawRecord{const r=object(v);if(!Number.isSafeInteger(r.time)||Number(r.time)<0||Number(r.time)>4102444800)throw new CollectorError('INVALID_SECONDS_TIMESTAMP');if(r.sid!==undefined&&typeof r.sid!=='string')throw new CollectorError('INVALID_SID');if(r.key!==undefined&&typeof r.key!=='string')throw new CollectorError('INVALID_KEY');if(r.zone_offset!==undefined&&(!Number.isInteger(r.zone_offset)||Math.abs(Number(r.zone_offset))>86400))throw new CollectorError('INVALID_OFFSET');value(r as unknown as RawRecord);return r as unknown as RawRecord;}
export function value(r:RawRecord){try{const v=typeof r.value==='string'?JSON.parse(r.value):r.value;return typeof v==='number'&&Number.isFinite(v)?{value:v}:object(v);}catch{throw new CollectorError('INVALID_RECORD_VALUE');}}
export function dateCN(seconds:number){return new Date(seconds*1000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});}
export function dateRange(start:string,end:string){const parse=(s:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new CollectorError('INVALID_DATE');return Date.parse(s+'T00:00:00+08:00')/1000;};const a=parse(start),b=parse(end)+86399;if(a>b||b-a>366*86400)throw new CollectorError('INVALID_RANGE');return {start:a,end:b};}
export const addDays=(date:string,n:number)=>dateCN(Date.parse(date+'T00:00:00+08:00')/1000+n*86400);
export function parseRecord(key:MetricKey,input:RawRecord):CleanRecord{
  const r=validateRaw(input),p=value(r);const base:CleanRecord={key,sid:r.sid??'',time:r.time,date:dateCN(r.time),data:{}};
  const optional=(v:unknown)=>{if(v===undefined||v===null)return null;const n=positive(v);return n===0?null:n;};
  if(key==='steps')base.data={steps:Math.trunc(positive(p.steps)),distance_m:p.distance==null?null:positive(p.distance),active_kcal:p.calories==null?null:positive(p.calories)};
  else if(key==='calories')base.data={active_kcal:positive(p.calories)};
  else if(key==='heart_rate'||key==='resting_heart_rate'){
    const timestamp=key==='resting_heart_rate'?num(p.date_time||r.time):r.time;if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>4102444800)throw new CollectorError('INVALID_SECONDS_TIMESTAMP');
    base.date=dateCN(timestamp);base.data={timestamp,bpm:Math.trunc(positive(p.bpm)),sample_type:key==='resting_heart_rate'?'resting':num(p.type,0)===0?'passive':'active'};
  }else if(key==='sleep'){
    const normalized=normalizeSleep(p,r.time);base.date=dateCN(normalized.end_at);base.data=normalized;
  }else if(key==='sport'){
    const start=num(p.start_time||r.time),duration=Math.trunc(positive(p.duration||0)),end=num(p.end_time||(start+duration));if(end<start||end-start>86400*30)throw new CollectorError('INVALID_WORKOUT_RANGE');
    base.date=dateCN(start);base.data={start_at:start,end_at:end,duration_minutes:Math.floor(duration/60)||Math.floor((end-start)/60),activity_type:String(r.category||r.key||p.sport_type||'workout'),distance_m:optional(p.distance),calories_kcal:p.calories==null?null:positive(p.calories),total_calories_kcal:p.total_cal==null?null:positive(p.total_cal),duration_seconds:duration,recovery_time_raw:p.recover_time??null,avg_heart_rate_bpm:optional(p.avg_hrm),max_heart_rate_bpm:optional(p.max_hrm),avg_pace_sec_per_km:optional(p.avg_pace),max_pace_sec_per_km:optional(p.max_pace),total_steps:optional(p.steps||p.total_steps)};
  }else if(key==='steps_daily_aggregate'){
    const steps=num(p.steps??p.value);if(!Number.isSafeInteger(steps)||steps<0)throw new CollectorError('INVALID_STEPS');base.data={value:steps,daily_steps:steps,distance_m:p.distance??null,source_report_calories_kcal:p.calories??null,source_tag:'daily_report',source_key:'steps',unit_status:'step_count',parser_version:'quality-v2'};
  }else if(key==='spo2'){
    const n=num(p.spo2??p.value);if(n<=0||n>100)throw new CollectorError('INVALID_SPO2');base.data={spo2_pct:n};
  }else if(key==='stress'){
    const n=num(p.stress??p.score??p.value??p.stress_value);if(n<0||n>100)throw new CollectorError('INVALID_STRESS');base.data={stress_score:n};
  }else if(key==='abnormal_heart_beat'){
    const start=num(p.start_time??r.time),end=num(p.end_time??start);if(end<start)throw new CollectorError('INVALID_EVENT_RANGE');base.data={start_at:start,end_at:end,duration_seconds:end-start,event_type:'source_reported_abnormal_heart_beat',interpretation:'not_a_diagnosis'};
  }else {
    const fields:Record<string,number>={};for(const [k,v] of Object.entries(p)){if(typeof v==='number'&&Number.isFinite(v)&&!/(?:id$|sid|mac|imei|imsi|phone|lat|lon|location|address|token|cookie|password|security)/i.test(k))fields[k]=v;}
    if(!Object.keys(fields).length)throw new CollectorError('SCHEMA_UNVERIFIED');
    base.data={source_fields:fields,unit_status:'unverified'};
    const choices:Record<string,string[]>={steps_daily_aggregate:['steps','value'],weight:['weight'],intensity:['intensity','value','duration'],valid_stand:['valid_stand','stand','value'],energy:['energy','value'],goal:['goal','value','steps'],pai:['daily_pai','pai','value'],blood_pressure:['systolic','high_pressure','value'],blood_sugar:['blood_sugar','value'],headset:['value'],vo2_max:['vo2_max','value'],menstruation:['value']};
    const field=(choices[key]??[]).find(k=>typeof fields[k]==='number');if(field){base.data.value=fields[field];base.data.value_field=field;}
  }return base;
}
// HRV has no verified source key, metric, unit or algorithm in either reference.
export const hrvCapability={supported:true,source:'sleep.value',unit:null,algorithm:null,validated_hrv_metric:false,reason:'SLEEP_SOURCE_HRV_UNIT_AND_ALGORITHM_UNVERIFIED'} as const;
