import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {auditCollectionWindows,readWindowAudit} from '../worker/index.js';

let mf,db;
const date='2026-10-20',at=Date.parse(date+'T12:00:00+08:00')/1000;
const env=()=>({DB:db,MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'});
test.before(async()=>{
 mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('LIVE_OUTBOUND_FORBIDDEN');}});
 db=await mf.getD1Database('DB');for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
});
test.after(()=>mf.dispose());
test.beforeEach(async()=>{
 for(const table of ['collection_window_audits','sync_jobs','sync_history','raw_records','raw_versions'])await db.prepare('DELETE FROM '+table).run();
 await db.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,seen_json,updated_at) VALUES(1,'2026-10-20','2026-10-21',3,'2026-10-20','synthetic-cursor','[\"synthetic-cursor\"]',1)").run();
 await db.prepare("INSERT INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-09-30',5,'2026-09-01','synthetic-history',2)").run();
});
const row=(time)=>({time,sid:'synthetic-device',value:{start_time:time-3600,end_time:time,duration:3600,unknown_label:'keep ordinary text',items:Array.from({length:2201},(_,i)=>i),token:'NEVER',location:{lat:1,lon:2}}});
function fixture(mode='complete'){
 const counts={auth:0,health:0,logins:0};
 return {counts,transport:async url=>{
  const host=new URL(url).hostname;
  if(host==='account.xiaomi.com'){counts.auth++;counts.logins++;if(mode==='login')return new Response('&&&START&&&'+JSON.stringify({code:70016}));return new Response('&&&START&&&'+JSON.stringify({code:0,ssecurity:btoa('0123456789012345'),userId:'synthetic',passToken:'synthetic',location:'https://sts-hlth.io.mi.com/healthapp/sts'}));}
  if(host==='sts-hlth.io.mi.com'){counts.auth++;return new Response(null,{status:mode==='redirect'?302:200,headers:{'Set-Cookie':'serviceToken=synthetic; Secure; Path=/',Location:'https://sts-hlth.io.mi.com/another'}});}
  counts.health++;
  if(mode==='network')throw Error('synthetic network uncertainty');if([401,429,500,204].includes(mode))return new Response(null,{status:mode});
  if(mode==='broken')return new Response('{broken');
  const n=(counts.health-1)%3,records=n===0?[row(at-86400)]:n===1?[row(at)]:[row(at-86400),row(at),row(at+86400)];
  if(mode==='difference'&&n===2)records.push(row(at+1));
  if(mode==='quarantine')records.push({time:'invalid',passToken:'NEVER'});
  const key=url.endsWith('get_sport_records_by_time')?'sport_records':'data_list';
  return Response.json({code:0,result:{[key]:records,has_more:mode==='page',...(mode==='page'?{next_key:'synthetic-cursor'}:{})}});
 }};
}
const tables=['raw_records','raw_versions','sync_jobs','sync_history','sync_logs','activity_details','activity_detail_versions','ingestion_quarantine','daily_summary','aggregation_policies','workout_native_cache','hrv_probe_cache'];
async function snapshot(){const out={};for(const t of tables)out[t]=(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results;return out;}

test('six one-page comparisons preserve complete redacted evidence, leave health/checkpoints unchanged and reuse cache without login',async()=>{
 const before=await snapshot(),f=fixture(),r=await auditCollectionWindows(env(),date,f.transport);
 assert.equal(r.status,'complete');assert.deepEqual(f.counts,{auth:2,health:6,logins:1});assert.equal(r.pages.length,6);assert.equal(r.comparisons.length,2);
 assert(r.comparisons.every(x=>x.exact_only===0&&x.overlap_target_only===0&&x.adjacent_union_only===0&&x.overlap_two_days_only===0&&x.not_proof_of));
 assert.deepEqual(await snapshot(),before);
 const saved=await db.prepare('SELECT * FROM collection_window_audits').first(),raw=JSON.parse(saved.raw_json);
 assert.equal(raw.length,6);assert(!saved.raw_json.includes('NEVER'));assert(!saved.raw_json.includes('synthetic-device'));assert.equal(raw[0].response.data_list[0].value.items.length,2201);assert.equal(raw[0].response.data_list[0].value.unknown_label,'keep ordinary text');
 assert.deepEqual(raw[0].payload,{start_time:at-129600,end_time:at-43201,key:'sleep'});
 assert.deepEqual(raw[2].payload,{start_time:at-129600,end_time:at+129599,key:'sleep'});
 assert.equal(raw[3].payload.limit,50);assert(!('startTime' in raw[3].payload));
 assert.equal((await auditCollectionWindows(env(),date,()=>{throw Error('NO_RELOGIN');})).cached,true);assert.equal((await readWindowAudit(env(),date)).network_requests_performed,false);
});
test('window differences are observations with an unknown cause, not an assertion of missing collection',async()=>{
 const f=fixture('difference'),r=await auditCollectionWindows(env(),date,f.transport);
 assert.equal(r.status,'complete');assert(r.comparisons.every(x=>x.overlap_target_only===1&&x.conclusion==='window_difference_observed_cause_unverified'));assert.equal(r.upstream_upload_complete,'unknown');
});
for(const [mode,code] of [[401,'AUTH_EXPIRED'],[429,'UPSTREAM_RATE_LIMITED'],[500,'UPSTREAM_HTTP_ERROR'],[204,'UPSTREAM_HTTP_ERROR'],['network','NETWORK_FAILURE'],['broken','INVALID_CLOUD_RESPONSE'],['page','AUDIT_PAGE_LIMIT'],['quarantine','AUDIT_QUARANTINED_SOURCE']]){
 test(`audit ${mode} stops after first health request and failure is cached`,async()=>{
  const before=await snapshot(),f=fixture(mode),r=await auditCollectionWindows(env(),date,f.transport);
  assert.equal(r.error_code,code);assert.equal(f.counts.health,1);assert.equal(f.counts.logins,1);assert.deepEqual(await snapshot(),before);
  await auditCollectionWindows(env(),date,()=>{throw Error('NO_RELOGIN');});
  if(mode==='page'||mode==='quarantine')assert.equal(JSON.parse((await db.prepare('SELECT raw_json FROM collection_window_audits').first()).raw_json).length,1);
 });
}
test('login rejection and an STS redirect cannot trigger a second login, redirect or health request',async()=>{
 for(const mode of ['login','redirect']){
  await db.prepare('DELETE FROM collection_window_audits').run();const f=fixture(mode),r=await auditCollectionWindows(env(),date,f.transport);
  assert.equal(r.status,'failed');assert.equal(f.counts.logins,1);assert.equal(f.counts.health,0);assert(f.counts.auth<=2);
  await auditCollectionWindows(env(),date,()=>{throw Error('NO_RELOGIN');});
 }
});
test('active sync, a durable checking claim or unclosed windows prevent any login',async()=>{
 await db.prepare('UPDATE sync_jobs SET lease_until=?').bind(Date.now()+60000).run();await assert.rejects(auditCollectionWindows(env(),date,()=>{throw Error('NO_LOGIN');}),e=>e.code==='SYNC_BUSY_OR_NOT_INITIALIZED');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM collection_window_audits').first()).n,0);
 await db.prepare('UPDATE sync_jobs SET lease_until=0').run();await db.prepare("INSERT INTO collection_window_audits VALUES(?,'checking','{}','[]',1)").bind('adjacent_overlap_v1:'+date).run();
 assert.equal((await auditCollectionWindows(env(),date,()=>{throw Error('NO_LOGIN');})).status,'checking');
 await assert.rejects(auditCollectionWindows(env(),new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),()=>{throw Error('NO_LOGIN');}),e=>e.code==='AUDIT_REQUIRES_CLOSED_WINDOWS');
});
test('Worker audit route rejects visitor writes and cross-origin calls before network; cached GET remains read-only',async()=>{
 const before=await snapshot();
 for(const headers of [{},{'oai-authenticated-user-id':'synthetic-owner'},{'X-Site-Sync-Intent':'refresh',Origin:'https://other.invalid'}]){
  const r=await mf.dispatchFetch('https://local.invalid/api/collection-window-audit',{method:'POST',headers,body:JSON.stringify({date})});assert([401,403].includes(r.status));
 }
 const r=await mf.dispatchFetch('https://local.invalid/api/collection-window-audit?date='+date,{headers:{'oai-authenticated-user-id':'synthetic-owner'}});
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).status,'not_checked');assert.deepEqual(await snapshot(),before);
});
test('full Worker route runs against synthetic upstream and stores evidence in its own D1 table',async()=>{
 const f=fixture(),worker=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'},outboundService:req=>f.transport(req.url)});
 try{
  const d=await worker.getD1Database('DB');const schema=(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split('CREATE TABLE IF NOT EXISTS collection_window_audits')[0];for(const q of schema.split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();
  await d.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2026-10-20','2026-10-21',3,'2026-10-20','synthetic-cursor',1)").run();
  await d.prepare("INSERT INTO activity_details(record_ref,status,clean_json,fetched_at) VALUES('synthetic-legacy','fetched','{\"kept\":1}',1)").run();
  const oldDetail=await d.prepare('SELECT * FROM activity_details').first(),migration=await readFile(new URL('../drizzle/0006_collection_window_audit.sql',import.meta.url),'utf8');
  for(let repeat=0;repeat<2;repeat++)for(const q of migration.split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();
  assert.deepEqual(await d.prepare('SELECT * FROM activity_details').first(),oldDetail);
  const res=await worker.dispatchFetch('https://local.invalid/api/collection-window-audit',{method:'POST',headers:{'X-Site-Sync-Intent':'refresh','Content-Type':'application/json'},body:JSON.stringify({date})});
  const result=await res.json();assert.equal(res.status,200);assert.equal(result.status,'complete');assert.deepEqual(f.counts,{auth:2,health:6,logins:1});
  assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM raw_records').first()).n,0);assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM collection_window_audits').first()).n,1);assert.equal((await d.prepare('SELECT cursor FROM sync_jobs').first()).cursor,'synthetic-cursor');
 }finally{await worker.dispose();}
});
