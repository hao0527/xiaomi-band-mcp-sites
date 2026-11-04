import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {repairActivityRaw,readActivityRawRepair,rawRecord,activityDetail,fetchActivityDetails,rpc} from '../worker/index.js';

let mf,db;const date='2026-11-03',at=Date.parse(date+'T12:00:00+08:00')/1000,ref='synthetic-legacy-sport';
const env=()=>({DB:db,PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'});
const protectedTables=['raw_records','raw_versions','sync_jobs','sync_history','sync_logs','daily_summary','workout_native_cache','aggregation_policies','metric_capabilities','ingestion_quarantine'];
async function snapshot(){const out={};for(const t of protectedTables)out[t]=(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results;return out;}
async function sport(id=ref){await db.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at) VALUES(?,'sport',?,?,'synthetic-source',?,'parsed',1)").bind(id,at,date,JSON.stringify({time:at,sid:'synthetic-device',key:'strength_training',value:{start_time:at,end_time:at+1200,duration:1200}})).run();}
test.before(async()=>{mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'},outboundService:()=>{throw Error('REAL_NETWORK_FORBIDDEN');}});db=await mf.getD1Database('DB');for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();});
test.after(()=>mf.dispose());
test.beforeEach(async()=>{
 for(const t of [...protectedTables,'activity_details','activity_detail_versions','activity_raw_repairs'])await db.prepare('DELETE FROM '+t).run();
 await sport();await sport('synthetic-other-legacy');
 await db.prepare("INSERT INTO activity_details(record_ref,status,clean_json,fetched_at) VALUES(?,'fetched','{\"kept_numeric\":17}',7),('synthetic-other-legacy','fetched','{\"untouched\":1}',8)").bind(ref).run();
 await db.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,seen_json,updated_at) VALUES(1,'2026-11-03','2026-11-04',5,'2026-11-03','live-cursor','[\"live-cursor\"]',1)").run();
 await db.prepare("INSERT INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-11-01',5,'2026-10-01','history-cursor',2)").run();
 await db.prepare("INSERT INTO workout_native_cache(record_ref,status,payload_base64,checked_at) VALUES(?,'cached','AQID',1)").bind(ref).run();
});
const source=()=>({unknown_text:'keep complete response text',zero:0,items:Array.from({length:2205},(_,i)=>({value:i})),nested:{serviceToken:'NEVER',sid:'NEVER',latitude:1},download_url:'https://example.invalid/?token=NEVER'});
function fixture(mode='complete'){
 const counts={logins:0,auth:0,health:0,paths:[]};return {counts,transport:async url=>{
  const u=new URL(url);counts.paths.push(u.pathname);
  if(u.hostname==='account.xiaomi.com'){counts.auth++;counts.logins++;return new Response('&&&START&&&'+JSON.stringify(mode==='login'?{code:70016}:{code:0,ssecurity:btoa('0123456789012345'),passToken:'synthetic',userId:'synthetic',location:'https://sts-hlth.io.mi.com/healthapp/sts'}));}
  if(u.hostname==='sts-hlth.io.mi.com'){counts.auth++;return new Response(null,{status:mode==='redirect'?302:200,headers:{'Set-Cookie':'serviceToken=synthetic; Path=/; Secure'}});}
  counts.health++;assert.equal(u.pathname,'/app/v1/operate/get_sport_operational_data');
  if(mode==='network')throw Error('synthetic uncertain network');if([401,429,500,204].includes(mode))return new Response(null,{status:mode});
  if(mode==='broken')return new Response('{broken');if(mode==='business')return Response.json({code:1,message:'synthetic failure'});
  return Response.json({code:0,result:mode==='empty'?{}:source()});
 }};
}
async function fullRaw(){let offset=0,hash,parts=[];do{const r=await rawRecord(env(),ref,offset,4096,hash,'activity_operational');assert.equal(r.status,'available');parts.push(r.raw_json_chunk);hash??=r.snapshot_hash;offset=r.next_offset;}while(offset!==null);return JSON.parse(parts.join(''));}

test('legacy missing raw is explicit; one selected refetch preserves full response and versions without touching protected data or other caches',async()=>{
 const f=fixture(),before=await snapshot(),other=await db.prepare("SELECT * FROM activity_details WHERE record_ref='synthetic-other-legacy'").first();
 assert.equal((await rawRecord(env(),ref,0,8192,undefined,'activity_operational')).status,'legacy_projected_cache_no_raw_response');
 const result=await repairActivityRaw(env(),ref,f.transport);assert.equal(result.status,'completed');assert.equal(result.health_requests,1);assert.equal(result.auth_http_requests,2);assert.equal(result.retries,0);assert.equal(result.raw_response_available,true);
 const raw=await fullRaw();assert.equal(raw.items.length,2205);assert.equal(raw.unknown_text,'keep complete response text');assert.equal(raw.zero,0);assert(!JSON.stringify(raw).includes('NEVER'));
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity_detail_versions').first()).n,1);assert.deepEqual(await snapshot(),before);assert.deepEqual(await db.prepare("SELECT * FROM activity_details WHERE record_ref='synthetic-other-legacy'").first(),other);
 const again=await repairActivityRaw(env(),ref,()=>{throw Error('NO_RELOGIN');});assert.equal(again.status,'already_available');assert.equal(again.network_requests_performed,false);assert.deepEqual({logins:f.counts.logins,auth:f.counts.auth,health:f.counts.health},{logins:1,auth:2,health:1});
 const d=await activityDetail(env(),ref);assert.equal(d.operational_raw_available,true);assert.equal(d.operational_raw_missing_reason,null);
});
test('ordinary new operational fetch and legacy repair share lossless preservation, without rescheduling another legacy cache',async()=>{
 await repairActivityRaw(env(),ref,fixture().transport);await sport('synthetic-new-workout');let calls=0;
 await fetchActivityDetails(env(),{request:async()=>{calls++;return source();}});
 assert.equal(calls,1);const fresh=await db.prepare("SELECT raw_json,raw_meta_json FROM activity_details WHERE record_ref='synthetic-new-workout'").first();assert.equal(JSON.parse(fresh.raw_json).items.length,2205);assert.equal(JSON.parse(fresh.raw_json).unknown_text,'keep complete response text');assert.equal(JSON.parse(fresh.raw_meta_json).preservation_version,'redacted_complete_response_v1');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity_detail_versions').first()).n,2);assert.equal((await db.prepare("SELECT raw_json FROM activity_details WHERE record_ref='synthetic-other-legacy'").first()).raw_json,null);
});
for(const [mode,code] of [[401,'AUTH_EXPIRED'],[429,'UPSTREAM_RATE_LIMITED'],[500,'UPSTREAM_HTTP_ERROR'],[204,'UPSTREAM_HTTP_ERROR'],['network','NETWORK_FAILURE'],['broken','INVALID_CLOUD_RESPONSE'],['business','UPSTREAM_BUSINESS_ERROR'],['login','LOGIN_REJECTED'],['redirect','UPSTREAM_HTTP_ERROR']]){
 test(`repair ${mode} stops and its durable failure prevents another login`,async()=>{
  const f=fixture(mode),before=await snapshot(),cache=await db.prepare('SELECT * FROM activity_details WHERE record_ref=?').bind(ref).first();
  const r=await repairActivityRaw(env(),ref,f.transport);assert.equal(r.status,'failed');assert.equal(r.error_code,code);assert.equal(f.counts.logins,1);assert(f.counts.auth<=2);assert(f.counts.health<=1);assert.equal((await readActivityRawRepair(env(),ref)).status,'failed');
  await repairActivityRaw(env(),ref,()=>{throw Error('NO_RELOGIN');});assert.deepEqual(await snapshot(),before);assert.deepEqual(await db.prepare('SELECT * FROM activity_details WHERE record_ref=?').bind(ref).first(),cache);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity_detail_versions').first()).n,0);
 });
}
test('successful empty response is preserved as empty, retains old projection with explicit provenance and does not assert restored fields',async()=>{
 const r=await repairActivityRaw(env(),ref,fixture('empty').transport);assert.equal(r.status,'completed_empty_response');assert.equal(r.storage.source_response_empty,true);assert.equal(r.storage.projection_retained,true);assert.deepEqual(await fullRaw(),{});
 const d=await activityDetail(env(),ref);assert.equal(d.operational_data.kept_numeric,17);assert.equal(d.operational_projection.status,'retained_existing_projection_empty_new_projection');assert.equal(d.operational_projection.source_fetched_at,7);
});
test('already available, active lease, disabled sync, unindexable source and invalid references cannot log in',async()=>{
 await db.prepare('UPDATE activity_details SET raw_json=\'{}\' WHERE record_ref=?').bind(ref).run();assert.equal((await repairActivityRaw({...env(),MI_PASS_TOKEN:undefined},ref,()=>{throw Error('NO_LOGIN');})).status,'already_available');
 await db.prepare('UPDATE activity_details SET raw_json=NULL WHERE record_ref=?').bind(ref).run();await db.prepare('UPDATE sync_jobs SET lease_until=?').bind(Date.now()+60000).run();await assert.rejects(repairActivityRaw(env(),ref),e=>e.code==='SYNC_BUSY_OR_NOT_INITIALIZED');
 await db.prepare('UPDATE sync_jobs SET lease_until=0').run();await assert.rejects(repairActivityRaw({...env(),PERSIST_SYNC_ENABLED:'false'},ref),e=>e.code==='PERSIST_SYNC_DISABLED');
 await db.prepare('UPDATE raw_records SET raw_json=\'{}\' WHERE record_id=?').bind(ref).run();await assert.rejects(repairActivityRaw(env(),ref,()=>{throw Error('NO_LOGIN');}),e=>e.code==='REPAIR_SOURCE_NOT_USABLE');
 await assert.rejects(repairActivityRaw(env(),"invalid' ref"));assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity_raw_repairs').first()).n,0);
});
test('interrupted checking marker is a stop state, not an automatic retry',async()=>{
 await db.prepare("INSERT INTO activity_raw_repairs VALUES(?,'checking','{}',1)").bind(ref).run();const r=await repairActivityRaw(env(),ref,()=>{throw Error('NO_LOGIN');});assert.equal(r.status,'checking');assert.equal(r.next_action,'inspect_saved_attempt_do_not_retry_login');
});
test('operator route rejects ordinary visitors/cross origin and reads remain cache-only; MCP discovery stays ten',async()=>{
 const url='https://local.invalid/api/activity-raw-repair',body=JSON.stringify({record_ref:ref});
 for(const headers of [{},{'oai-authenticated-user-id':'synthetic-owner'},{'X-Site-Sync-Intent':'refresh',Origin:'https://other.invalid'}]){const r=await mf.dispatchFetch(url,{method:'POST',headers,body});assert([401,403].includes(r.status));}
 const r=await mf.dispatchFetch(url+'?ref='+ref,{headers:{'oai-authenticated-user-id':'synthetic-owner'}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).status,'legacy_raw_missing');
 assert.equal((await rpc(env(),{id:1,method:'tools/list'})).result.tools.length,10);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity_raw_repairs').first()).n,0);
});
test('incremental migration and actual Worker operator route preserve source/checkpoints and return complete cached raw',async()=>{
 const f=fixture(),worker=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'},outboundService:req=>f.transport(req.url)});
 try{
  const d=await worker.getD1Database('DB'),schema=(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split('CREATE TABLE IF NOT EXISTS activity_raw_repairs')[0];for(const q of schema.split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();
  const original=JSON.stringify({time:at,sid:'synthetic-device',key:'strength_training',value:{start_time:at,end_time:at+1200,duration:1200}});
  await d.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at) VALUES(?,'sport',?,?,'source',?,'parsed',1)").bind(ref,at,date,original).run();
  await d.prepare("INSERT INTO activity_details(record_ref,status,clean_json,fetched_at) VALUES(?,'fetched','{\"kept\":1}',7)").bind(ref).run();
  await d.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,?,?,5,?,'synthetic-live-cursor',1)").bind(date,date,date).run();
  const before=await d.prepare('SELECT * FROM sync_jobs').first(),old=await d.prepare('SELECT * FROM activity_details').first(),migration=await readFile(new URL('../drizzle/0007_activity_raw_repair.sql',import.meta.url),'utf8');
  for(let repeat=0;repeat<2;repeat++)for(const q of migration.split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();assert.deepEqual(await d.prepare('SELECT * FROM activity_details').first(),old);
  const response=await worker.dispatchFetch('https://local.invalid/api/activity-raw-repair',{method:'POST',headers:{'X-Site-Sync-Intent':'refresh','Content-Type':'application/json'},body:JSON.stringify({record_ref:ref})});assert.equal(response.status,200);assert.equal((await response.json()).status,'completed');
  assert.equal(f.counts.logins,1);assert.equal(f.counts.auth,2);assert.equal(f.counts.health,1);assert.deepEqual(await d.prepare('SELECT * FROM sync_jobs').first(),before);assert.equal((await d.prepare('SELECT raw_json FROM raw_records').first()).raw_json,original);
  assert.equal(JSON.parse((await d.prepare('SELECT raw_json FROM activity_details').first()).raw_json).items.length,2205);
 }finally{await worker.dispose();}
});
