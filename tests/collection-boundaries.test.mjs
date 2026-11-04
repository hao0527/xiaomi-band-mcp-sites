import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {MiFitnessAdapter,runPersistentSync,parseRecord} from '../worker/index.js';

const date='2026-10-20',at=Date.parse(date+'T00:00:00+08:00')/1000;
const session={security:new Uint8Array(16).fill(1),cookies:'serviceToken=synthetic',userId:'synthetic',passToken:'synthetic'};
for(const [mode,code] of [[401,'AUTH_EXPIRED'],[429,'UPSTREAM_RATE_LIMITED'],[500,'UPSTREAM_HTTP_ERROR'],[204,'UPSTREAM_HTTP_ERROR'],['network','NETWORK_FAILURE']]){
 test(`one ${mode} failure stops without retry or sleep`,async()=>{
  let calls=0,sleeps=0;
  const a=new MiFitnessAdapter(async()=>{calls++;if(mode==='network')throw Error('synthetic network uncertainty');return new Response(null,{status:mode,headers:{'Retry-After':'0'}});},async()=>{sleeps++;});
  a.setSession(session);
  await assert.rejects(a.request('/app/v1/data/get_fitness_data_by_time',{key:'sleep'}),e=>e.code===code);
  assert.equal(calls,1);assert.equal(sleeps,0);
 });
}
test('exact seconds, adjacent and overlapping windows agree under a filtering mock; out-of-window source is not evidence of real loss',async()=>{
 const a=new MiFitnessAdapter(),requests=[],source=[-1,0,86399,86400].map(n=>({time:at+n,value:{bpm:60}}));
 a.request=async(path,payload)=>{requests.push({path,payload});return {data_list:source,has_more:false};};
 const p=await a.page('heart_rate',date,date,null),next=await a.page('heart_rate','2026-10-21','2026-10-21',null),overlap=await a.page('heart_rate',date,'2026-10-21',null);
 assert.deepEqual(p.records.map(r=>r.time-at),[0,86399]);
 assert.deepEqual(next.records.map(r=>r.time-at),[86400]);
 assert.deepEqual(overlap.records.map(r=>r.time),[...p.records,...next.records].map(r=>r.time));
 assert.deepEqual(requests[0],{path:'/app/v1/data/get_fitness_data_by_time',payload:{key:'heart_rate',start_time:at,end_time:at+86399}});
});
test('ordinary pagination preserves the cursor even when every returned row is outside the window',async()=>{
 const a=new MiFitnessAdapter(),calls=[];
 a.request=async(path,payload)=>{calls.push(payload);return payload.next_key?{data_list:[{time:at,value:{bpm:60}}],has_more:false}:{data_list:[{time:at-1,value:{bpm:61}}],has_more:true,next_key:'synthetic-next'};};
 const first=await a.page('heart_rate',date,date,null);assert.equal(first.records.length,0);assert.equal(first.hasMore,true);
 const second=await a.page('heart_rate',date,date,first.nextKey);assert.equal(second.records.length,1);assert.equal(calls[1].next_key,'synthetic-next');
});
test('cross-midnight source date and normalized workout start date are distinct, without changing either timestamp',()=>{
 const raw={time:at+86520,value:{start_time:at+86300,end_time:at+86500,duration:200}};
 const parsed=parseRecord('sport',raw);assert.equal(parsed.date,date);assert.equal(parsed.time,raw.time);assert.equal(parsed.data.start_at,at+86300);
});
test('fatal HTTP or rate-limit failure cannot advance the sync cursor or alter history',async()=>{
 const mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('LIVE_OUTBOUND_FORBIDDEN');}});
 try{
  const db=await mf.getD1Database('DB');for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
  const now=Date.parse('2026-11-04T12:00:00+08:00'),env={DB:db,MI_USER_ID:'synthetic',MI_PASS_TOKEN:'synthetic',PERSIST_SYNC_ENABLED:'true'};
  for(const status of [429,500,204]){
   await db.prepare('DELETE FROM sync_jobs').run();
   await db.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,seen_json,updated_at) VALUES(1,'2026-11-03','2026-11-04',3,'2026-11-04','synthetic-cursor','[\"synthetic-cursor\"]',?)").bind(now).run();
   await db.prepare("INSERT OR IGNORE INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-10-31',5,'2026-10-01','history-cursor',1)").run();
   const history=await db.prepare('SELECT * FROM sync_history').first();let health=0;
   const transport=async url=>{const host=new URL(url).hostname;if(host==='account.xiaomi.com')return new Response('&&&START&&&'+JSON.stringify({code:0,ssecurity:btoa('0123456789012345'),userId:'synthetic',passToken:'synthetic',location:'https://sts-hlth.io.mi.com/healthapp/sts'}));if(host==='sts-hlth.io.mi.com')return new Response(null,{headers:{'Set-Cookie':'serviceToken=synthetic; Secure; Path=/'}});health++;return new Response(null,{status});};
   await assert.rejects(runPersistentSync(env,transport,now,{liveOnly:true,maxPages:2}),e=>e.code===(status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_HTTP_ERROR'));
   assert.equal(health,1);const j=await db.prepare('SELECT metric_index,cursor,seen_json,lease_until FROM sync_jobs').first();
   assert.deepEqual(j,{metric_index:3,cursor:'synthetic-cursor',seen_json:'["synthetic-cursor"]',lease_until:0});assert.deepEqual(await db.prepare('SELECT * FROM sync_history').first(),history);
  }
 }finally{await mf.dispose();}
});
