import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {getSyncProgress,triggerSync,toolCall,MiFitnessAdapter,rpc} from '../worker/index.js';

const now=Date.now(),today=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10),at=Date.parse(today+'T08:00:00+08:00')/1000,id='00000000-0000-4000-8000-000000000001';
const metrics=['steps','calories','sleep','heart_rate','resting_heart_rate','sport','spo2','stress','weight','abnormal_heart_beat','intensity','valid_stand','energy','goal','pai','blood_pressure','blood_sugar','headset','vo2_max','menstruation','steps_daily_aggregate'];
let mf,db;
const env=()=>({DB:db,PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'});
const tables=['raw_records','raw_versions','sync_jobs','sync_history','sync_logs','sync_failure_details','activity_details','activity_detail_versions','workout_native_cache','daily_summary'];
async function snapshot(){const state={};for(const t of tables)state[t]=(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results;return state;}
test.before(async()=>{mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}});db=await mf.getD1Database('DB');for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();});
test.after(()=>mf.dispose());
test.beforeEach(async()=>{
 for(const t of tables)await db.prepare('DELETE FROM '+t).run();
 await db.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,run_id,run_started_at,run_error_code,updated_at) VALUES(1,?,?,3,?, ?,?,'NETWORK_FAILURE',?)").bind(yesterday,today,yesterday,id,now-5000,now-1000).run();
 await db.prepare("INSERT INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-01-01',7,'2025-12-01','synthetic-history',1)").run();
 const sleep={time:at,value:{bedtime:at-3600,wake_up_time:at,duration:60,sleep_awake_duration:0}};
 await db.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at) VALUES('synthetic-cached-sleep','sleep',?,?,'synthetic',?,'parsed',?)").bind(at,today,JSON.stringify(sleep),now-2000).run();
 await db.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,clean_json,parse_status,synced_at) VALUES('synthetic-cached-heart','heart_rate',?,?,'synthetic',?,'{\"bpm\":70}','parsed',?)").bind(at,today,JSON.stringify({time:at,value:{bpm:70}}),now-2000).run();
 for(const metric of metrics)await db.prepare("INSERT INTO sync_logs(at,status,metric,date_cn,record_count) VALUES(?,'page_committed',?,?,?)").bind(now-3000,metric,today,['sleep','heart_rate'].includes(metric)?1:0).run();
 for(const metric of ['steps','calories','sleep'])await db.prepare("INSERT INTO sync_logs(at,status,metric,date_cn,record_count) VALUES(?,'page_committed',?,?,0)").bind(now-2500,metric,yesterday).run();
 await db.prepare("INSERT INTO sync_logs(at,status,metric,date_cn,record_count,error_code) VALUES(?,'failed','heart_rate',?,0,'NETWORK_FAILURE')").bind(now-1000,yesterday).run();
});

test('yesterday refresh failure stays visible while today committed data remains readable, including actual Worker MCP reads',async()=>{
 const before=await snapshot(),p=await getSyncProgress(env(),id,now);
 assert.equal(p.status,'failed');assert.equal(p.complete,false);assert.equal(p.error_code,'NETWORK_FAILURE');assert.equal(p.cached_reads_allowed,true);assert.equal(p.data_analysis_allowed,true);assert.match(p.data_analysis_allowed_scope,/deprecated_alias/);assert.equal(p.sync_failure_invalidates_cache,false);assert.equal(p.next_action,'stop_sync_read_committed_cache');
 const current=p.date_collection_status.find(x=>x.date===today),old=p.date_collection_status.find(x=>x.date===yesterday);assert.equal(current.collection_state,'checked');assert.equal(current.metrics_succeeded,21);assert.equal(current.metrics_failed,0);assert.equal(current.cached_records_present,true);assert.equal(old.metrics_failed,1);assert.equal(old.metrics_pending,17);assert.equal(old.collection_state,'partial');assert.equal(current.upstream_upload_complete,'unknown');
 const summary=await toolCall(env(),'get_daily_summary',{date:today});assert.equal(summary.summary.sleep_minutes,60);assert.equal(summary.sync.cached_reads_allowed,true);assert.equal(summary.sync.metric_results_scope,'requested_date');assert.equal(summary.sync.sync_failure_invalidates_cache,false);assert.equal(summary.sync.network_requests_performed,false);
 assert.equal((await toolCall(env(),'get_metric_records',{metrics:['sleep'],start_date:today,end_date:today})).records.length,1);
 const blocked=await triggerSync(env(),id,()=>{throw Error('NO_AUTOMATIC_LOGIN');},now);assert.equal(blocked.status,'failed');assert.equal(blocked.cached_reads_allowed,true);
 const response=await mf.dispatchFetch('https://local.invalid/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'synthetic'},body:JSON.stringify({id:1,method:'tools/call',params:{name:'get_daily_summary',arguments:{date:today}}})});assert.equal(response.status,200);const body=await response.json();assert.equal(JSON.parse(body.result.content[0].text).summary.sleep_minutes,60);
 const tools=(await rpc(env(),{id:2,method:'tools/list'})).result.tools;assert.equal(tools.length,10);assert(!tools.find(x=>x.name==='trigger_sync').description.includes('之后才能读取摘要分析'));assert.match(tools.find(x=>x.name==='get_daily_summary').description,/无需先同步/);assert.deepEqual(await snapshot(),before);
});

test('a new heart-rate timeout stops one attempted refresh and keeps the cache readable without allowing another login',async t=>{
 const original=AbortSignal.timeout,controller=new AbortController();t.mock.method(AbortSignal,'timeout',ms=>ms===30000?controller.signal:original.call(AbortSignal,ms));let logins=0,health=0;
 const history=await db.prepare('SELECT * FROM sync_history').first(),raw=(await db.prepare('SELECT * FROM raw_records ORDER BY record_id').all()).results;
 const transport=async url=>{const u=new URL(url);if(u.hostname==='account.xiaomi.com'){logins++;return new Response('&&&START&&&'+JSON.stringify({code:0,userId:'synthetic',passToken:'synthetic',ssecurity:btoa('0123456789012345'),location:'https://sts-hlth.io.mi.com/healthapp/sts'}));}if(u.hostname==='sts-hlth.io.mi.com')return new Response(null,{headers:{'Set-Cookie':'serviceToken=synthetic; Path=/; Secure'}});health++;controller.abort(new DOMException('synthetic only','TimeoutError'));throw Error('NEVER_STORE_RAW_ERROR');};
 const failed=await triggerSync(env(),id,transport,now,true);assert.equal(failed.status,'failed');assert.equal(failed.cached_reads_allowed,true);assert.equal(failed.data_analysis_allowed,true);assert.equal(failed.last_request_failure.details.timeout_cap_ms,30000);assert.equal(failed.last_request_failure.details.kind,'timeout');assert.equal(failed.next_action,'stop_sync_read_committed_cache');assert.equal(logins,1);assert.equal(health,1);
 await triggerSync(env(),id,transport,now);assert.equal(logins,1);assert.equal(health,1);assert.equal((await toolCall(env(),'get_daily_summary',{date:today})).summary.sleep_minutes,60);assert.deepEqual((await db.prepare('SELECT * FROM raw_records ORDER BY record_id').all()).results,raw);assert.deepEqual(await db.prepare('SELECT * FROM sync_history').first(),history);
});

test('only daily heart-rate transport gets a 30-second ceiling; step/report/sport requests keep 20 seconds and no retry',async t=>{
 const deadlines=[];t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return new AbortController().signal;});let calls=0;
 const a=new MiFitnessAdapter(async()=>{calls++;return Response.json({code:0,result:{data_list:[],sport_records:[],has_more:false}});});a.setSession({security:new Uint8Array(16).fill(1),cookies:'serviceToken=synthetic',userId:'synthetic',passToken:'synthetic'});
 for(const key of ['heart_rate','steps','steps_daily_aggregate','sport'])await a.page(key,yesterday,yesterday,null);
 assert.deepEqual(deadlines,[30000,20000,20000,20000]);assert.equal(calls,4);
});

test('permission to read does not invent cache data or imply upload completeness; missing database still reports unavailable',async()=>{
 await db.prepare('DELETE FROM raw_records').run();const p=await getSyncProgress(env(),id,now);assert.equal(p.cached_reads_allowed,true);assert.equal(p.cached_records_available,false);assert.equal(p.upstream_upload_complete,'unknown');const summary=await toolCall(env(),'get_daily_summary',{date:today});assert.equal(summary.summary.sleep_minutes,null);assert.equal(summary.quality.status,'no_data');assert(summary.quality.warnings.includes('NO_DATA'));
 assert.equal((await getSyncProgress({})).cached_reads_allowed,false);
});
