import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {MiFitnessAdapter,triggerSync,getSyncProgress,toolCall,networkFailure,safeRequestFailure} from '../worker/index.js';

const now=Date.now(),date=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),at=Date.parse(date+'T12:00:00+08:00')/1000;
let mf,db;
const env=()=>({DB:db,PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'});
const secret='NEVER_STORE_EXCEPTION_MESSAGE_OR_URL';
test.before(async()=>{
 mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}});db=await mf.getD1Database('DB');
 for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
});
test.beforeEach(async()=>{for(const name of ['sync_jobs','sync_history','sync_logs','sync_failure_details','raw_records','raw_versions','daily_summary','activity_details','activity_detail_versions','workout_native_cache','metric_capabilities'])await db.prepare('DELETE FROM '+name).run();});
test.after(()=>mf.dispose());
function session(adapter){adapter.setSession({security:new Uint8Array(16).fill(1),cookies:'serviceToken=synthetic',userId:'synthetic',passToken:'synthetic'});return adapter;}

test('network classification uses trusted abort state and fixed fields, discarding exception text and unknown properties',()=>{
 const timeout=new AbortController();timeout.abort(new DOMException(secret,'TimeoutError'));
 const e=networkFailure(timeout.signal,Date.now()-25,'fitness_data','response_headers');assert.equal(e.code,'NETWORK_FAILURE');assert.equal(e.request_failure.kind,'timeout');assert(e.request_failure.elapsed_ms>=25);assert(!JSON.stringify(e).includes(secret));
 const safe=safeRequestFailure({...e.request_failure,token:secret,url:'https://private.invalid/'+secret});assert.deepEqual(safe,e.request_failure);assert.equal(safeRequestFailure({...safe,operation:secret}),null);assert.equal(safeRequestFailure({...safe,operation:{toString:()=> 'fitness_data'}}),null);
 const aborted=new AbortController();aborted.abort(new DOMException(secret,'AbortError'));assert.equal(networkFailure(aborted.signal,Date.now(),'fitness_data','response_headers').request_failure.kind,'aborted');
});

test('adapter distinguishes a timed-out request from a failed response stream without retrying or guessing HTTP status',async t=>{
 const original=AbortSignal.timeout,controller=new AbortController();t.mock.method(AbortSignal,'timeout',()=>controller.signal);let calls=0;
 const a=session(new MiFitnessAdapter(async()=>{calls++;controller.abort(new DOMException(secret,'TimeoutError'));throw Error(secret);}));
 await assert.rejects(a.page('steps',date,date,null),e=>e.code==='NETWORK_FAILURE'&&e.request_failure.kind==='timeout'&&e.request_failure.stage==='response_headers'&&e.request_failure.http_status===null);assert.equal(calls,1);
 t.mock.restoreAll();assert.equal(AbortSignal.timeout,original);
 const b=session(new MiFitnessAdapter(async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(Error(secret));}}));}));
 await assert.rejects(b.page('sport',date,date,null),e=>e.code==='NETWORK_FAILURE'&&e.request_failure.kind==='response_read_error'&&e.request_failure.stage==='response_body'&&e.request_failure.operation==='sport_records'&&e.request_failure.http_status===200);assert.equal(calls,2);
});

test('explicit recovery keeps the original task/checkpoints, saves a private timeout diagnostic, and ingests sport only after the failure is explicitly resumed',async t=>{
 const original=AbortSignal.timeout,controller=new AbortController();let fail=true,logins=0,health=0;
 t.mock.method(AbortSignal,'timeout',ms=>fail?controller.signal:original.call(AbortSignal,ms));
 await db.prepare("INSERT INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-01-01',7,'2025-12-01','synthetic-history',1)").run();const history=await db.prepare('SELECT * FROM sync_history').first();
 const transport=async(url)=>{
  const u=new URL(url);if(u.hostname==='account.xiaomi.com'){logins++;return new Response('&&&START&&&'+JSON.stringify({code:0,userId:'synthetic',passToken:'synthetic',ssecurity:btoa('0123456789012345'),location:'https://sts-hlth.io.mi.com/healthapp/sts'}));}
  if(u.hostname==='sts-hlth.io.mi.com')return new Response(null,{headers:{'Set-Cookie':'serviceToken=synthetic; Path=/; Secure'}});
  health++;if(fail){controller.abort(new DOMException(secret,'TimeoutError'));throw Error(secret);}
  if(u.pathname==='/healthapp/service/gen_download_url')return Response.json({code:0,result:{}});
  return Response.json({code:0,result:{data_list:[],sport_records:[{time:at,sid:'synthetic-device',key:'strength_training',value:{time:at,start_time:at,end_time:at+3,duration:3,timezone:32,proto_type:8}}],has_more:false}});
 };
 const bad=await triggerSync(env(),undefined,transport,now);assert.equal(bad.status,'failed');assert.equal(bad.error_code,'NETWORK_FAILURE');assert.equal(bad.last_request_failure.details.kind,'timeout');assert.equal(bad.last_request_failure.metric,'steps');assert.equal(bad.last_request_failure.date,date);assert.equal(bad.last_request_failure.is_current_failure,true);assert.equal(bad.explicit_retry_available,true);assert.equal(health,1);assert.equal(logins,1);
 const checkpoint=await db.prepare('SELECT metric_index,current_date,cursor,seen_json,run_id FROM sync_jobs').first(),saved=await db.prepare('SELECT * FROM sync_failure_details').first();assert.equal(checkpoint.metric_index,0);assert(!JSON.stringify(saved).includes(secret));
 const count=health;await triggerSync(env(),bad.sync_id,transport,now);await getSyncProgress(env(),bad.sync_id);assert.equal(health,count);assert.equal(logins,1);
 fail=false;let good=await triggerSync(env(),bad.sync_id,transport,now,true);assert.equal(good.sync_id,bad.sync_id);assert.equal(good.status,'partial');assert.equal(good.last_request_failure.is_current_failure,false);assert.equal(good.failure_diagnostics_available,false);assert.equal(good.explicit_retry_available,false);
 const sports=await toolCall(env(),'get_metric_records',{metrics:['sport'],start_date:date,end_date:date});assert.equal(sports.records.length,1);
 for(let n=0;!good.complete&&n<8;n++)good=await triggerSync(env(),bad.sync_id,transport,now);assert.equal(good.status,'completed');assert.equal(good.sync_id,bad.sync_id);assert.deepEqual(await db.prepare('SELECT * FROM sync_history').first(),history);assert.deepEqual(await db.prepare('SELECT * FROM sync_failure_details').first(),saved);
 const before=await db.prepare('SELECT COUNT(*) AS n FROM sync_failure_details').first();const response=await mf.dispatchFetch('https://local.invalid/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'synthetic'},body:JSON.stringify({id:1,method:'tools/call',params:{name:'get_sync_progress',arguments:{sync_id:bad.sync_id}}})});assert.equal(response.status,200);const body=await response.json(),progress=JSON.parse(body.result.content[0].text);assert.equal(progress.last_request_failure.details.kind,'timeout');assert.equal(progress.last_request_failure.is_current_failure,false);assert.deepEqual(await db.prepare('SELECT COUNT(*) AS n FROM sync_failure_details').first(),before);
});

test('legacy NETWORK_FAILURE is not retrospectively called a timeout, and detailed reads do not start a recovery',async()=>{
 const id='00000000-0000-4000-8000-000000000001';await db.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,run_id,run_started_at,run_error_code,updated_at) VALUES(1,?,?,0,?, ?,?,'NETWORK_FAILURE',?)").bind(date,date,date,id,now,now).run();
 const p=await getSyncProgress(env(),id);assert.equal(p.error_code,'NETWORK_FAILURE');assert.equal(p.last_request_failure,null);assert.equal(p.failure_diagnostics_available,false);assert.equal(p.explicit_retry_available,true);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sync_failure_details').first()).n,0);
});

test('additive diagnostic migration is repeatable and preserves the preceding task and source schema',async()=>{
 const old=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}});
 try{
  const d=await old.getD1Database('DB'),schema=(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split('CREATE TABLE IF NOT EXISTS sync_failure_details')[0];for(const q of schema.split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();
  await d.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,updated_at,run_error_code) VALUES(1,?,?,0,?,'synthetic-cursor',1,'NETWORK_FAILURE')").bind(date,date,date).run();const before=await d.prepare('SELECT * FROM sync_jobs').first();
  const sql=await readFile(new URL('../drizzle/0008_sync_failure_details.sql',import.meta.url),'utf8');for(let i=0;i<2;i++)for(const q of sql.replaceAll('--> statement-breakpoint','').split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();assert.deepEqual(await d.prepare('SELECT * FROM sync_jobs').first(),before);assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM sync_failure_details').first()).n,0);
 }finally{await old.dispose();}
});
