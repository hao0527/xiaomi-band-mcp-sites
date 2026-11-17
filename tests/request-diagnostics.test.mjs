import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {RequestTrace,MiFitnessAdapter,triggerSync,getSyncProgress,safeRequestFailure} from '../worker/index.js';
const secret='DO_NOT_LOG_TOKEN_URL_HEADERS_OR_HEALTH_CONTENT';
const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
function session(a){a.setSession({security:new Uint8Array(16).fill(1),cookies:'serviceToken='+secret,userId:secret,passToken:secret});return a;}
function capture(t){const logs=[];for(const method of ['info','error'])t.mock.method(console,method,line=>logs.push(JSON.parse(line)));return logs;}

test('partial-body timeout preserves exact phase timings, bytes and correlation while stripping unknown fields',t=>{
 const logs=capture(t);let now=1000;t.mock.method(Date,'now',()=>now);
 const c=new AbortController(),trace=new RequestTrace('fitness_data',c.signal,20000,'steps');
 now=1100;trace.headers(200);now=1120;trace.reader.chunk(3);now=1140;trace.reader.chunk(5);now=1200;c.abort(new DOMException(secret,'TimeoutError'));
 const error=trace.failure('response_body'),d=error.request_failure;
 assert.equal(d.elapsed_ms,200);assert.equal(d.headers_elapsed_ms,100);assert.equal(d.body_elapsed_ms,100);assert.equal(d.first_byte_elapsed_ms,120);assert.equal(d.last_chunk_elapsed_ms,140);assert.equal(d.body_idle_ms,60);assert.equal(d.body_bytes_received,8);assert.equal(d.body_chunks_received,2);assert.equal(d.body_complete,false);assert.equal(d.kind,'timeout');assert.equal(d.http_status,200);
 assert.deepEqual(logs.map(x=>x.phase),['started','headers_received','network_failure']);assert(logs.every(x=>x.request_id===d.request_id));assert.deepEqual(safeRequestFailure({...d,url:secret,headers:{Cookie:secret},response:secret}),d);assert(!JSON.stringify(logs).includes(secret));
 assert.equal(safeRequestFailure({...d,body_bytes_received:-1}),null);assert.equal(safeRequestFailure({...d,headers_elapsed_ms:201}),null);assert.equal(safeRequestFailure({...d,request_id:secret}),null);
});

test('timeout before headers and timeout before first byte remain distinct rather than inventing timings',t=>{
 capture(t);let now=1000;t.mock.method(Date,'now',()=>now);const c=new AbortController();
 const early=new RequestTrace('fitness_data',c.signal,30000,'heart_rate');now=1300;c.abort(new DOMException(secret,'TimeoutError'));const a=early.failure('response_headers').request_failure;
 assert.equal(a.headers_elapsed_ms,null);assert.equal(a.body_elapsed_ms,null);assert.equal(a.first_byte_elapsed_ms,null);assert.equal(a.body_idle_ms,null);assert.equal(a.body_bytes_received,0);assert.equal(a.body_chunks_received,0);assert.equal(a.http_status,null);assert.equal(a.timeout_cap_ms,30000);
 const late=new RequestTrace('fitness_data',c.signal);now=1350;late.headers(200);now=1450;const b=late.failure('response_body').request_failure;assert.equal(b.headers_elapsed_ms,50);assert.equal(b.body_elapsed_ms,100);assert.equal(b.body_idle_ms,100);assert.equal(b.first_byte_elapsed_ms,null);assert.equal(b.last_chunk_elapsed_ms,null);assert.notEqual(a.request_id,b.request_id);
});

test('adapter logs successful multi-chunk reads and empty bodies without exposing contents or headers',async t=>{
 const logs=capture(t);let calls=0;
 const bytes=new TextEncoder().encode(JSON.stringify({code:0,result:{data_list:[],has_more:false,unknown:secret}}));
 const a=session(new MiFitnessAdapter(async()=>{calls++;let part=0;return new Response(new ReadableStream({pull(c){if(part===0)c.enqueue(bytes.slice(0,8));else if(part===1)c.enqueue(bytes.slice(8));else c.close();part++;}}),{headers:{'X-Private':secret,'Set-Cookie':secret}});}));
 await a.page('steps',date,date,null);assert.equal(calls,1);
 const complete=logs.find(x=>x.phase==='body_received');assert.equal(complete.body_complete,true);assert.equal(complete.body_chunks_received,2);assert.equal(complete.body_bytes_received,bytes.length);assert.equal(complete.metric,'steps');assert.equal(complete.http_status,200);assert.equal(complete.first_byte_elapsed_ms!==null,true);assert.equal(logs.length,3);assert(!JSON.stringify(logs).includes(secret));
 logs.length=0;const trace=new RequestTrace('native_reference',new AbortController().signal);trace.headers(200);trace.reader.complete();trace.received();const empty=logs.at(-1);assert.equal(empty.body_bytes_received,0);assert.equal(empty.body_complete,true);assert.equal(empty.first_byte_elapsed_ms,null);
});

test('the actual stream observer retains partial bytes at failure and does not retry',async t=>{
 const logs=capture(t);const c=new AbortController();t.mock.method(AbortSignal,'timeout',()=>c.signal);let calls=0,part=0;
 const a=session(new MiFitnessAdapter(async()=>{calls++;return new Response(new ReadableStream({pull(stream){if(part++===0)stream.enqueue(new TextEncoder().encode(secret));else{c.abort(new DOMException(secret,'TimeoutError'));stream.error(Error(secret));}}}));}));
 await assert.rejects(a.page('steps',date,date,null),e=>{const d=e.request_failure;assert.equal(d.diagnostic_version,2);assert.equal(d.body_bytes_received,new TextEncoder().encode(secret).length);assert.equal(d.body_chunks_received,1);assert.equal(d.body_complete,false);assert.equal(d.kind,'timeout');assert.equal(d.stage,'response_body');assert.deepEqual(safeRequestFailure(d),d);return true;});assert.equal(calls,1);assert(!JSON.stringify(logs).includes(secret));
});

test('native references use the same diagnostics and a broken logger cannot change request outcome',async t=>{
 const logs=capture(t);let calls=0;const a=session(new MiFitnessAdapter(async()=>{calls++;throw Error(secret);}));
 await assert.rejects(a.nativeFileReference({private_field:secret}),e=>e.code==='NETWORK_FAILURE'&&e.request_failure.operation==='native_reference'&&e.request_failure.diagnostic_version===2);assert.equal(calls,1);assert(!JSON.stringify(logs).includes(secret));
 for(const method of ['info','error'])t.mock.method(console,method,()=>{throw Error(secret);});await assert.rejects(a.nativeFileReference({private_field:secret}),e=>e.code==='NETWORK_FAILURE');assert.equal(calls,2);const b=session(new MiFitnessAdapter(async()=>Response.json({code:0,result:{data_list:[],has_more:false}})));assert.equal((await b.page('steps',date,date,null)).records.length,0);
});

test('extended failures persist through cache-only MCP progress and survive recovery state without a schema migration',async t=>{
 const logs=capture(t);const mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}});
 try{
  const db=await mf.getD1Database('DB');for(const sql of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  const env={DB:db,PERSIST_SYNC_ENABLED:'true',MI_USER_ID:secret,MI_PASS_TOKEN:secret};let calls=0;
  const transport=async(url)=>{calls++;const u=new URL(url);if(u.hostname==='account.xiaomi.com')return new Response('&&&START&&&'+JSON.stringify({code:0,userId:secret,passToken:secret,ssecurity:btoa('0123456789012345'),location:'https://sts-hlth.io.mi.com/healthapp/sts'}));if(u.hostname==='sts-hlth.io.mi.com')return new Response(null,{headers:{'Set-Cookie':'serviceToken=synthetic; Path=/; Secure'}});throw Error(secret);};
  const bad=await triggerSync(env,undefined,transport);assert.equal(bad.status,'failed');const d=bad.last_request_failure.details;assert.equal(d.diagnostic_version,2);assert.equal(d.headers_elapsed_ms,null);assert.equal(d.body_bytes_received,0);assert.equal(bad.last_request_failure.is_current_failure,true);
  const stored=await db.prepare('SELECT * FROM sync_failure_details').first();assert.deepEqual(JSON.parse(stored.details_json),d);assert(!JSON.stringify(stored).includes(secret));const linked=logs.find(l=>l.event==='xiaomi_sync_request_failed');assert.equal(linked.request_id,d.request_id);assert.equal(linked.sync_id,bad.sync_id);
  const n=calls;const response=await mf.dispatchFetch('https://local.invalid/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'synthetic'},body:JSON.stringify({id:1,method:'tools/call',params:{name:'get_sync_progress',arguments:{sync_id:bad.sync_id}}})});const body=await response.json();assert.deepEqual(body.result.structuredContent.last_request_failure.details,d);assert.equal(calls,n);
  await db.prepare('UPDATE sync_jobs SET run_error_code=NULL').run();const recovered=await getSyncProgress(env,bad.sync_id);assert.equal(recovered.last_request_failure.is_current_failure,false);assert.deepEqual(recovered.last_request_failure.details,d);assert.equal(calls,n);
 }finally{await mf.dispose();}
});
