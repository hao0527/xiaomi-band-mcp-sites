import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCipheriv,createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {runPersistentSync,triggerSync,getSyncProgress,probeNativeWorkout,fetchPendingNativeWorkout,toolCall,MiFitnessAdapter} from '../worker/index.js';

const now=Date.now(),date=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),at=Date.parse(date+'T12:00:00+08:00')/1000;
const yesterday=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const id='00000000-0000-4000-8000-000000000001';
let mf,db;
const env=()=>({DB:db,PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'});
const tables=['raw_records','raw_versions','sync_jobs','sync_history','sync_logs','activity_details','activity_detail_versions','daily_summary','workout_native_cache','metric_capabilities'];
async function schema(d){for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await d.prepare(q).run();}
async function job(d=db,complete=0,index=5){await d.prepare('INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,complete,run_id,run_started_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?)').bind(yesterday,date,index,date,complete,id,now-1000,now).run();await d.prepare("INSERT INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-01-01',7,'2025-12-01','synthetic-history',1)").run();}
function sport(n=0,version=4){return {time:at+n*10,sid:'synthetic-device',key:'strength_training',value:{time:at+n*10,start_time:at+n*10,end_time:at+n*10+3,duration:3,timezone:32,proto_type:8,version}};}
async function save(raw,ref='synthetic-sport-0',d=db,day=date){await d.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at) VALUES(?,'sport',?,?,'synthetic-source',?,'parsed',1)").bind(ref,raw.time,day,JSON.stringify(raw)).run();}
function suffix(raw){const b=Buffer.alloc(6);b.writeUInt32LE(raw.value.time);b.writeInt8(32,4);b[5]=160;return b.toString('base64url')+'_'+createHash('sha1').update(raw.sid).digest('base64url')+'_'+raw.value.time;}
function plain(raw,version=4){const b=Buffer.alloc(35);b.writeUInt32LE(raw.value.time);b[4]=32;b[5]=version;b[6]=8;b[8]=0xcc;b[9]=0xcc;b.writeUInt32LE(3,10);b.writeUInt32LE(raw.value.time,14);b[18]=128;b.writeUInt32LE(3,19);b.set([101,0,97,20,131,1,98,21,151,2,99,22],23);return b;}
function fixture(records=[sport()],mode='ok',pageSports=[]){
 const counts={logins:0,auth:0,lookup:0,downloads:0,pages:0,operational:0},key=Buffer.alloc(16,3),links={};
 for(const raw of records)links[suffix(raw)]={url:'https://cn.fds.api.xiaomi.com/synthetic/'+raw.value.time,obj_key:key.toString('base64url'),method:'GET'};
 const download=async(url,init)=>{
  counts.downloads++;assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers,undefined);assert(init.signal);
  if(mode==='download_network')throw Error('synthetic uncertain network');if(mode==='download_429')return new Response(null,{status:429});
  const raw=records.find(x=>url.endsWith('/'+x.value.time));assert(raw);const p=plain(raw,mode==='unknown_format'?7:4);if(mode==='bad_header')p.writeUInt32LE(raw.value.time+1);
  const c=createCipheriv('aes-128-cbc',key,Buffer.from('1234567887654321'));return new Response(Buffer.concat([c.update(p),c.final()]).toString('base64url'));
 };
 const transport=async(url,init)=>{
  const u=new URL(url);
  if(u.hostname.endsWith('.fds.api.xiaomi.com'))return download(url,init);
  if(u.hostname==='account.xiaomi.com'){counts.logins++;counts.auth++;return new Response('&&&START&&&'+JSON.stringify(mode==='login_rejected'?{code:70016}:{code:0,ssecurity:btoa('0123456789012345'),passToken:'synthetic',userId:'synthetic',location:'https://sts-hlth.io.mi.com/healthapp/sts'}));}
  if(u.hostname==='sts-hlth.io.mi.com'){counts.auth++;if(mode==='sts_redirect')return new Response(null,{status:302,headers:{Location:'https://sts-hlth.io.mi.com/again'}});return new Response(null,{headers:{'Set-Cookie':'serviceToken=synthetic; Path=/; Secure'}});}
  if(u.pathname==='/healthapp/service/gen_download_url'){
   counts.lookup++;assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert(init.signal);assert.match(new Headers(init.headers).get('Cookie'),/serviceToken=synthetic/);
   assert.equal(u.searchParams.has('did'),false);assert(u.searchParams.has('_nonce'));assert(u.searchParams.has('signature'));
   if(mode==='lookup_network')throw Error('synthetic uncertain network');if(mode.startsWith('lookup_')&&Number.isInteger(Number(mode.slice(7))))return new Response(null,{status:Number(mode.slice(7))});
   if(mode==='business_auth')return Response.json({code:401,result:{}});
   if(mode==='empty')return Response.json({code:0,result:{}});
   if(mode==='lease_lost')await db.prepare('UPDATE sync_jobs SET lease_until=0').run();
   if(mode==='evil_host')return Response.json({code:0,result:Object.fromEntries(Object.entries(links).map(([k,v])=>[k,{...v,url:'https://evil.invalid/private'}]))});
   return Response.json({code:0,result:links});
  }
  if(u.pathname==='/app/v1/operate/get_sport_operational_data'){counts.operational++;return Response.json({code:0,result:{}});}
  counts.pages++;return Response.json({code:0,result:{sport_records:pageSports,data_list:[],has_more:false}});
 };
 return {counts,transport,download};
}

test.before(async()=>{mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('REAL_NETWORK_FORBIDDEN');}});db=await mf.getD1Database('DB');await schema(db);});
test.beforeEach(async()=>{for(const t of tables)await db.prepare('DELETE FROM '+t).run();});
test.after(()=>mf.dispose());

test('ordinary sync downloads a newly committed sport in the same batch using its single login, then cache-only MCP reads native points',async()=>{
 await job();const f=fixture([sport()],'ok',[sport()]),history=await db.prepare('SELECT * FROM sync_history').first();
 const r=await runPersistentSync(env(),f.transport,now,{liveOnly:true,maxPages:1,nativeDownload:f.download});
 assert.equal(r.recordsProcessed,1);assert.equal(r.native_files.stored,1);assert.equal(r.native_file_batch.evidence.session_source,'current_sync');assert.equal(r.native_file_batch.evidence.login_attempts,0);
 assert.deepEqual(f.counts,{logins:1,auth:2,lookup:1,downloads:1,pages:1,operational:0});
 const row=await db.prepare("SELECT record_id FROM raw_records WHERE metric='sport'").first(),saved=await db.prepare('SELECT * FROM workout_native_cache').first();assert.equal(saved.payload_base64,plain(sport()).toString('base64'));
 assert(!/synthetic-device|obj_key|serviceToken|https:/.test(saved.evidence_json));
 const samples=await toolCall(env(),'get_activity_heart_rate_samples',{record_ref:row.record_id,limit:2});assert.equal(samples.series_source,'xiaomi_native_workout_fds_format8_v4');assert.equal(samples.total_samples,3);assert.equal(samples.next_offset,2);assert.deepEqual(samples.samples.map(x=>x.at),[at,at+1]);
 assert.deepEqual(await db.prepare('SELECT * FROM sync_history').first(),history);assert.equal((await db.prepare('SELECT lease_until FROM sync_jobs').first()).lease_until,0);
 await runPersistentSync(env(),f.transport,now,{liveOnly:true,maxPages:1,nativeDownload:f.download});assert.equal(f.counts.lookup,1);assert.equal(f.counts.downloads,1);
});

test('one file per batch, live dates only, native-only continuation keeps same ID and all metric/history checkpoints',async()=>{
 await job(db,1);await save(sport(0));await save(sport(1),'synthetic-sport-1');await save(sport(2),'synthetic-older',db,'2026-01-01');
 await db.prepare('UPDATE sync_jobs SET updated_at=?').bind(now-600000).run();
 const f=fixture([sport(0),sport(1),sport(2)],'empty'),before=await db.prepare('SELECT * FROM sync_jobs').first(),history=await db.prepare('SELECT * FROM sync_history').first();
 const p=await getSyncProgress(env(),id);assert.equal(p.status,'partial');assert.equal(p.complete,false);assert.equal(p.metrics_complete,true);assert.equal(p.native_files.pending,2);assert.equal(f.counts.logins,0);
 const first=await triggerSync(env(),id,f.transport,now);assert.equal(first.sync_id,id);assert.equal(first.complete,false);assert.equal(first.native_files.pending,1);assert.equal(first.batch.pages,0);assert.equal(f.counts.lookup,1);
 const second=await triggerSync(env(),id,f.transport,now);assert.equal(second.sync_id,id);assert.equal(second.status,'completed');assert.equal(second.native_files.pending,0);assert.equal(second.native_files.not_stored_at_check,2);assert.equal(f.counts.lookup,2);assert.equal(f.counts.downloads,0);assert.equal(f.counts.pages,0);assert.equal(f.counts.operational,0);
 const n=f.counts.logins;assert.equal((await triggerSync(env(),id,f.transport,now)).reused_recent_result,true);assert.equal(f.counts.logins,n);
 assert.deepEqual(await db.prepare('SELECT * FROM sync_jobs').first(),before);assert.deepEqual(await db.prepare('SELECT * FROM sync_history').first(),history);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_native_cache WHERE record_ref='synthetic-older'").first()).n,0);
});

for(const mode of ['lookup_401','lookup_429','lookup_500','lookup_204','lookup_network','business_auth','download_429','download_network','evil_host','bad_header','lease_lost']){
 test(`native ${mode} stops, persists a fixed failure and prevents automatic retry/login`,async()=>{
  await job();await save(sport());const f=fixture([sport()],mode),history=await db.prepare('SELECT * FROM sync_history').first();
  await assert.rejects(runPersistentSync(env(),f.transport,now,{liveOnly:true,maxPages:1,nativeDownload:f.download}),e=>e.code==='NATIVE_FILE_FETCH_FAILED');
  const cache=await db.prepare('SELECT * FROM workout_native_cache').first();assert.equal(cache.status,'failed');assert.equal(cache.payload_base64,null);assert(!cache.evidence_json.includes('https:'));assert.equal(f.counts.logins,1);assert.equal(f.counts.lookup,1);assert(f.counts.downloads<=1);
  const n=f.counts.logins;await triggerSync(env(),id,f.transport,now);assert.equal(f.counts.logins,n);await probeNativeWorkout(env(),'synthetic-sport-0',()=>{throw Error('NO_RELOGIN');});assert.equal(f.counts.logins,n);assert.deepEqual(await db.prepare('SELECT * FROM sync_history').first(),history);
 });
}

test('unsupported decoder version still preserves the complete native file and returns the explicitly labeled minute fallback',async()=>{
 await job();await save(sport());const f=fixture([sport()],'unknown_format');await runPersistentSync(env(),f.transport,now,{liveOnly:true,maxPages:1,nativeDownload:f.download});
 assert.equal((await db.prepare("SELECT payload_base64 FROM workout_native_cache WHERE record_ref='synthetic-sport-0'").first()).payload_base64,plain(sport(),7).toString('base64'));
 const d=await toolCall(env(),'get_activity_detail',{record_ref:'synthetic-sport-0'});assert.equal(d.native_curve.status,'downloaded_decoder_unverified');assert.equal(d.native_curve.total_samples,0);
});

test('shared lease blocks a selected native request before login; empty/failed/checking are reused; expired budget leaves queue pending',async()=>{
 await job();await save(sport());await db.prepare('UPDATE sync_jobs SET lease_token=\'synthetic-other-job\',lease_until=?').bind(Date.now()+60000).run();let calls=0;
 assert.equal((await probeNativeWorkout(env(),'synthetic-sport-0',async()=>{calls++;throw Error('NO_LOGIN');})).status,'busy');assert.equal(calls,0);
 const r=await fetchPendingNativeWorkout(env(),new MiFitnessAdapter(),'synthetic-other-job',yesterday,date,Date.now()-1);assert.equal(r.status,'deferred_time_budget');assert.equal((await getSyncProgress(env(),id)).native_files.pending,1);
 for(const status of ['failed','checking','not_stored_at_check']){
  await db.prepare('INSERT OR REPLACE INTO workout_native_cache(record_ref,status,checked_at) VALUES(?,?,1)').bind('synthetic-sport-0',status).run();
  assert.equal((await probeNativeWorkout(env(),'synthetic-sport-0',()=>{throw Error('NO_RELOGIN');})).status,status);
 }
});

test('missing native reference metadata is explicit and does not invent a file reference or perform a lookup',async()=>{
 await job();const raw=sport();delete raw.value.time;await save(raw);const f=fixture([]);await runPersistentSync(env(),f.transport,now,{liveOnly:true,maxPages:1,nativeDownload:f.download});
 const cache=await db.prepare('SELECT status,evidence_json FROM workout_native_cache').first();assert.equal(cache.status,'schema_unverified');assert.equal(JSON.parse(cache.evidence_json).error_code,'NATIVE_SOURCE_NOT_USABLE');assert.equal(f.counts.lookup,0);assert.equal(f.counts.downloads,0);
});

for(const mode of ['login_rejected','sts_redirect'])test(`operator ${mode} consumes at most two auth requests and keeps a durable stop marker`,async()=>{
 await job();await save(sport());const f=fixture([sport()],mode),before=await db.prepare('SELECT * FROM sync_jobs').first();const r=await probeNativeWorkout(env(),'synthetic-sport-0',f.transport,f.download);assert.equal(r.status,'failed');assert.equal(f.counts.logins,1);assert(f.counts.auth<=2);assert.equal(f.counts.lookup,0);
 await probeNativeWorkout(env(),'synthetic-sport-0',()=>{throw Error('NO_RELOGIN');});assert.deepEqual(await db.prepare('SELECT * FROM sync_jobs').first(),before);
});

test('actual Worker trigger route resumes the native phase, with synthetic outbound only and unchanged ten-tool discovery',async()=>{
 const f=fixture(),worker=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic'},outboundService:request=>f.transport(request.url,{method:request.method,headers:request.headers,redirect:'manual',signal:request.signal,...(new URL(request.url).hostname.endsWith('.fds.api.xiaomi.com')?{credentials:'omit',headers:undefined}:{})})});
 try{
  const d=await worker.getD1Database('DB');await schema(d);await job(d,1);await save(sport(),'synthetic-worker-sport',d);
  const r=await worker.dispatchFetch('https://local.invalid/api/mcp-trigger-sync',{method:'POST',headers:{'X-Site-Sync-Intent':'refresh','Content-Type':'application/json'},body:JSON.stringify({sync_id:id})});assert.equal(r.status,200);const body=await r.json();assert.equal(body.complete,true,JSON.stringify(body));assert.equal(body.native_files.stored,1);assert.equal(f.counts.logins,1);assert.equal(f.counts.lookup,1);assert.equal(f.counts.downloads,1);
  const list=await worker.dispatchFetch('https://local.invalid/mcp',{method:'POST',body:JSON.stringify({id:1,method:'tools/list'})});assert.equal((await list.json()).result.tools.length,10);
 }finally{await worker.dispose();}
});

test('short metric budget defers a walking file without poisoning it; native-only continuation decodes it',async()=>{
 await job();
 const walk={...sport(),key:'walking'};
 const f=fixture([walk],'ok',[walk]);
 const batch=await runPersistentSync(env(),f.transport,now,{liveOnly:true,maxPages:1,budgetMs:18000,nativeDownload:f.download});
 assert.equal(batch.native_file_batch.status,'deferred_time_budget');
 assert.equal(batch.native_files.pending,1);
 assert.equal(f.counts.lookup,0);
 assert.equal(await db.prepare('SELECT status FROM workout_native_cache').first(),null);
 const next=await runPersistentSync(env(),f.transport,now,{liveOnly:true,budgetMs:18000,nativeDownload:f.download});
 assert.equal(next.pages,0);
 assert.equal(next.native_files.stored,1);
 const saved=await db.prepare("SELECT record_id FROM raw_records WHERE metric='sport'").first();
 const result=await toolCall(env(),'get_activity_heart_rate_samples',{record_ref:saved.record_id});
 assert.deepEqual(result.samples.map(x=>x.at),[at,at+1,at+2]);
});

test('ordinary sync resumes a legacy local timeout just once while preserving all other stop markers',async()=>{
 await job(db,1);
 const f=fixture();
 const legacy={session_source:'current_sync',error_code:'NATIVE_TIME_LIMIT',download_requests:0,reference_requests:1};
 for(const [i,evidence] of [legacy,{...legacy,download_requests:1},{...legacy,error_code:'NETWORK_FAILURE'},{...legacy,budget_resume:1}].entries()){
  const ref='synthetic-sport-'+i;
  await save(sport(i),ref);
  await db.prepare("INSERT INTO workout_native_cache(record_ref,status,evidence_json,checked_at) VALUES(?,'failed',?,1)").bind(ref,JSON.stringify(evidence)).run();
 }
 assert.equal((await getSyncProgress(env(),id)).native_files.pending,1);
 const result=await runPersistentSync(env(),f.transport,now,{liveOnly:true,budgetMs:18000,nativeDownload:f.download});
 assert.equal(result.native_files.stored,1);
 assert.equal(result.native_files.pending,0);
 assert.equal(result.native_files.failed,3);
 assert.equal(result.native_file_batch.evidence.previous_checked_at,1);
 assert.equal(result.native_file_batch.evidence.budget_resume,1);
 assert.equal(f.counts.lookup,1);
 assert.equal(f.counts.downloads,1);
});
