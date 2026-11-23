import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {MiFitnessAdapter,runPersistentSync,getSyncProgress,networkFailure} from '../worker/index.js';
import {createHash} from 'node:crypto';

const now=Date.now();
const date=new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const recordedAt=Date.parse(date+'T00:00:00+08:00')/1000;
const cursor='private-first-page-cursor';
const security=new Uint8Array(16).fill(1);
const timeoutReason=()=>new DOMException('mock upstream timeout','TimeoutError');
const waitForAbort=signal=>new Promise((_,reject)=>{
  if(signal.aborted)reject(signal.reason);
  else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
});
function captureRequests(t){
  const logs=[];
  for(const method of ['info','error'])t.mock.method(console,method,message=>logs.push(JSON.parse(message)));
  return logs;
}
function shortenRetryTimers(t){
  const schedule=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>schedule(callback,[8000,500].includes(ms)?5:ms,...args));
}
function adapter(transport){
  const a=new MiFitnessAdapter(transport,undefined,undefined,{retryStepHeaders:true});
  a.setSession({security,cookies:'serviceToken=private-synthetic-cookie',userId:'123',passToken:'private-token'});
  return a;
}

let mf,db;
test.before(async()=>{
  mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB']});
  db=await mf.getD1Database('DB');
  const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
  for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
});
test.after(async()=>{await mf?.dispose();});
const env=()=>({DB:db,PERSIST_SYNC_ENABLED:'true',MI_USER_ID:'123',MI_PASS_TOKEN:'private-token'});
const checkpoint=()=>db.prepare('SELECT run_id,metric_index,current_date,cursor,seen_json,run_error_code FROM sync_jobs').first();

// Independently decode the captured signed form so the test compares the actual page
// query and confirms that the retry did not reuse the encrypted request.
function decodeForm(body){
  const form=new URLSearchParams(body);
  const n=Buffer.from(form.get('_nonce'),'base64');
  const key=createHash('sha256').update(security).update(n).digest();
  const state=Uint8Array.from({length:256},(_,i)=>i);
  let j=0;
  for(let i=0;i<256;i++){
    j=(j+state[i]+key[i%key.length])%256;
    [state[i],state[j]]=[state[j],state[i]];
  }
  let i=0;
  j=0;
  function next(){
    i=(i+1)%256;
    j=(j+state[i])%256;
    [state[i],state[j]]=[state[j],state[i]];
    return state[(state[i]+state[j])%256];
  }
  for(let drop=0;drop<1024;drop++)next();
  const plain=Uint8Array.from(Buffer.from(form.get('data'),'base64'),byte=>byte^next());
  return {nonce:form.get('_nonce'),payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain))};
}

test('live sync retries the same signed page once and commits only one page under the original run ID',async t=>{
  const logs=captureRequests(t);
  shortenRetryTimers(t);
  await db.prepare(`INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,seen_json,updated_at,run_id,run_started_at)
    VALUES(1,?,?,0,?,?,?,?,?,?)`).bind(date,date,date,cursor,JSON.stringify([cursor]),now,crypto.randomUUID(),now).run();
  const before=await checkpoint();
  const requests=[];
  let logins=0;
  const transport=async(url,init)=>{
    const host=new URL(url).hostname;
    if(host==='account.xiaomi.com'){
      logins++;
      return new Response('&&&START&&&'+JSON.stringify({code:0,userId:'123',passToken:'private-token',ssecurity:btoa(String.fromCharCode(...security)),location:'https://sts-hlth.io.mi.com/healthapp/sts'}));
    }
    if(host==='sts-hlth.io.mi.com')return new Response(null,{headers:{'Set-Cookie':'serviceToken=private-synthetic-cookie; Path=/; Secure'}});
    requests.push({cookie:init.headers.Cookie,...decodeForm(init.body)});
    if(requests.length===1)return waitForAbort(init.signal);
    return Response.json({code:0,result:{data_list:[{time:recordedAt,sid:'synthetic-device',value:{steps:7}}],has_more:true,next_key:'private-next-page'}});
  };
  const result=await runPersistentSync(env(),transport,now,{liveOnly:true,maxPages:1});
  assert.equal(logins,1);
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0].payload,{key:'steps',next_key:cursor,start_time:recordedAt,end_time:recordedAt+86399});
  assert.deepEqual(requests[1].payload,requests[0].payload);
  assert.equal(requests[1].cookie,requests[0].cookie);
  assert.notEqual(requests[1].nonce,requests[0].nonce);
  assert.equal(result.pages,1);
  assert.equal(result.recordsProcessed,1);
  const after=await checkpoint();
  assert.equal(after.run_id,before.run_id);
  assert.equal(after.cursor,'private-next-page');
  assert.equal(after.run_error_code,null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM raw_records').first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sync_logs WHERE status='page_committed'").first()).n,1);
  const first=logs.find(x=>x.phase==='network_failure');
  const second=logs.find(x=>x.phase==='body_received');
  assert.deepEqual(first.retry,{attempt:1,headers_timeout_ms:8000});
  assert.deepEqual(second.retry,{attempt:2,retry_of_request_id:first.request_id});
  assert(!JSON.stringify(logs).includes(cursor));
  assert(!JSON.stringify(logs).includes('private-synthetic-cookie'));
});

test('both timeouts persist the linked second attempt and leave the page checkpoint intact',async t=>{
  const logs=captureRequests(t);
  shortenRetryTimers(t);
  const original=AbortSignal.timeout;
  const budget=new AbortController();
  const before=await checkpoint();
  let calls=0;
  let deadlineSignals=0;
  t.mock.method(AbortSignal,'timeout',ms=>{
    if(ms===20000&&++deadlineSignals===3)return budget.signal;
    return original.call(AbortSignal,ms);
  });
  const transport=async(url,init)=>{
    const host=new URL(url).hostname;
    if(host==='account.xiaomi.com')return new Response('&&&START&&&'+JSON.stringify({code:0,userId:'123',passToken:'private-token',ssecurity:btoa(String.fromCharCode(...security)),location:'https://sts-hlth.io.mi.com/healthapp/sts'}));
    if(host==='sts-hlth.io.mi.com')return new Response(null,{headers:{'Set-Cookie':'serviceToken=synthetic; Path=/; Secure'}});
    if(++calls===2){
      assert.equal(init.signal,budget.signal);
      budget.abort(timeoutReason());
    }
    return waitForAbort(init.signal);
  };
  await assert.rejects(runPersistentSync(env(),transport,now,{liveOnly:true,maxPages:1}),{code:'NETWORK_FAILURE'});
  assert.equal(calls,2);
  assert.deepEqual(await checkpoint(),{...before,run_error_code:'NETWORK_FAILURE'});
  const progress=await getSyncProgress(env(),before.run_id);
  const first=logs.find(x=>x.phase==='network_failure');
  assert.equal(progress.status,'failed');
  assert.equal(progress.last_request_failure.details.stage,'response_headers');
  assert.equal(progress.last_request_failure.details.timeout_cap_ms,20000);
  assert.deepEqual(progress.last_request_failure.details.retry,{attempt:2,retry_of_request_id:first.request_id});
  assert.equal(progress.failure_recovery.sync_id,before.run_id);
});

test('headers clear the short timer and body timeout never retries, while the shared deadline remains active',async t=>{
  captureRequests(t);
  shortenRetryTimers(t);
  const budget=new AbortController();
  t.mock.method(AbortSignal,'timeout',ms=>{
    assert.equal(ms,20000);
    return budget.signal;
  });
  let calls=0;
  const a=adapter(async(_url,{signal})=>{
    calls++;
    return new Response(new ReadableStream({async pull(stream){
      await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(signal.aborted,false);
      budget.abort(timeoutReason());
      assert.equal(signal.aborted,true);
      stream.error(signal.reason);
    }}));
  });
  await assert.rejects(a.page('steps',date,date,null),e=>e.code==='NETWORK_FAILURE'&&e.request_failure.stage==='response_body'&&e.request_failure.kind==='timeout');
  assert.equal(calls,1);
});

test('HTTP and transport failures do not retry, and other metrics keep their full header allowance',async t=>{
  captureRequests(t);
  const original=globalThis.setTimeout;
  let shortTimers=0;
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{
    if(ms===8000)shortTimers++;
    return original(callback,ms,...args);
  });
  for(const [response,code] of [[()=>new Response(null,{status:401}),'AUTH_EXPIRED'],[()=>new Response(null,{status:429}),'UPSTREAM_RATE_LIMITED'],[()=>{throw Error('synthetic');},'NETWORK_FAILURE']]){
    let calls=0;
    const a=adapter(async()=>{calls++;return response();});
    await assert.rejects(a.page('steps',date,date,null),{code});
    assert.equal(calls,1);
  }
  assert.equal(shortTimers,3);
  const a=adapter(async()=>Response.json({code:0,result:{data_list:[]}}));
  await a.page('heart_rate',date,date,null);
  await a.page('steps_daily_aggregate',date,date,null);
  assert.equal(shortTimers,3);
});

for (const [scenario,budgetMs,failTwice] of [
  ['same batch',45000,false], ['next batch',18000,false], ['two timeouts',18000,true]
]){
  test('resting heart rate retries the original page once: '+scenario,async t=>{
    const runId=crypto.randomUUID();
    await db.prepare(`INSERT OR REPLACE INTO sync_jobs
      (id,start_date,end_date,metric_index,current_date,cursor,updated_at,run_id,run_started_at)
      VALUES(1,?,?,4,?,?,?,?,?)`).bind(date,date,date,cursor,now,runId,now).run();
    t.mock.method(MiFitnessAdapter.prototype,'login',async()=>{});
    let calls=0;
    t.mock.method(MiFitnessAdapter.prototype,'page',async(key,start,end,next)=>{
      assert.deepEqual([key,start,end,next],['resting_heart_rate',date,date,cursor]);
      if(++calls===1||failTwice)throw networkFailure(AbortSignal.abort(timeoutReason()),Date.now()-20000,'fitness_data','response_headers');
      return {records:[],hasMore:false,nextKey:null};
    });
    const batch=()=>runPersistentSync(env(),undefined,now,{liveOnly:true,maxPages:1,budgetMs});
    if(budgetMs===18000){
      const partial=await batch();
      assert.equal(partial.retry_deferred,true);
      assert.equal(partial.pages,0);
      assert.equal(calls,1);
      assert.equal((await checkpoint()).cursor,cursor);
    }
    if(failTwice){
      await assert.rejects(batch(),{code:'NETWORK_FAILURE'});
      await assert.rejects(batch(),{code:'NETWORK_FAILURE'});
      assert.equal((await checkpoint()).cursor,cursor);
    }else{
      assert.equal((await batch()).pages,1);
      assert.equal((await checkpoint()).metric_index,5);
      assert.equal((await db.prepare('SELECT resting_hr_retry_after FROM sync_jobs').first()).resting_hr_retry_after,null);
    }
    assert.equal((await checkpoint()).run_id,runId);
    assert.equal(calls,2);
  });
}

test('resting heart rate body timeout bypasses the header retry',async t=>{
  const runId=crypto.randomUUID();
  await db.prepare(`UPDATE sync_jobs SET run_id=?,run_error_code=NULL,resting_hr_retry_after=NULL
    WHERE id=1`).bind(runId).run();
  t.mock.method(MiFitnessAdapter.prototype,'login',async()=>{});
  const read=t.mock.method(MiFitnessAdapter.prototype,'page',async()=>{
    throw networkFailure(AbortSignal.abort(timeoutReason()),Date.now()-20000,'fitness_data','response_body',200);
  });
  await assert.rejects(runPersistentSync(env(),undefined,now,{liveOnly:true,maxPages:1}),{code:'NETWORK_FAILURE'});
  assert.equal(read.mock.callCount(),1);
  assert.equal((await checkpoint()).cursor,cursor);
  assert.equal((await db.prepare('SELECT resting_hr_retry_after FROM sync_jobs').first()).resting_hr_retry_after,null);
});
