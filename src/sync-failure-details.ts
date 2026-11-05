import {CollectorError,safeRequestFailure} from './collector/http.js';
import type {Database} from './persistence.js';

export async function saveSyncFailure(d:Database,runId:string|null,error:unknown,metric:string|null,date:string|null,at:number){
 if(!(error instanceof CollectorError))return;const detail=safeRequestFailure(error.request_failure);if(!detail)return;
 await d.prepare('INSERT INTO sync_failure_details(run_id,metric,date_cn,error_code,details_json,observed_at) VALUES(?,?,?,?,?,?)').bind(runId,metric,date,error.code,JSON.stringify(detail),at).run();
 await d.prepare('DELETE FROM sync_failure_details WHERE id NOT IN (SELECT id FROM sync_failure_details ORDER BY id DESC LIMIT 1000)').run();
}
export async function readSyncFailure(d:Database,runId:string|null,updatedAt:number,errorCode:string|null){
 if(!runId)return null;
 const row=await d.prepare('SELECT metric,date_cn,error_code,details_json,observed_at FROM sync_failure_details WHERE run_id=? ORDER BY id DESC LIMIT 1').bind(runId).first<{metric:string|null;date_cn:string|null;error_code:string;details_json:string;observed_at:number}>();if(!row)return null;
 let details;try{details=safeRequestFailure(JSON.parse(row.details_json));}catch{return null;}if(!details)return null;
 return {metric:row.metric,date:row.date_cn,error_code:row.error_code,details,observed_at:row.observed_at,observed_at_unit:'unix_millisecond',is_current_failure:row.observed_at===updatedAt&&row.error_code===errorCode};
}
