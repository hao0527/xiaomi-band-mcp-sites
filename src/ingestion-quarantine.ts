import type {Database} from './persistence.js';
import type {MetricKey,RejectedRecord} from './collector/models.js';
import {redactRawRecord} from './raw-record-reader.js';
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function saveRejectedRecords(d:Database,metric:MetricKey,start:string,end:string,rejected:RejectedRecord[],now:number){
 const statements=[];for(const r of rejected){const clean=redactRawRecord(r.raw),raw=JSON.stringify(clean.value),id=await sha(JSON.stringify([metric,start,end,r.reason,raw]));statements.push(d.prepare('INSERT INTO ingestion_quarantine(quarantine_id,metric,requested_start,requested_end,reason_code,index_in_page,raw_json,redactions_json,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(quarantine_id) DO UPDATE SET last_seen_at=excluded.last_seen_at').bind(id,metric,start,end,r.reason,r.index,raw,JSON.stringify(clean.redactions),now,now));}
 for(let i=0;i<statements.length;i+=50)await d.batch(statements.slice(i,i+50));
}
