import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {toolCall} from '../worker/index.js';

const at=Date.parse('2026-10-20T12:00:00+08:00')/1000,ref='synthetic-series-source';
const minuteSource='daily_heart_rate_samples_in_workout_time_range_not_native_workout_frequency',nativeSource='xiaomi_native_workout_fds_format8_v4';
let mf,db;
function file(version=4,valid=true){const b=Buffer.alloc(35);b.writeUInt32LE(at);b[4]=32;b[5]=version;b[6]=8;b[8]=0xcc;b[9]=0xcc;b.writeUInt32LE(3,10);b.writeUInt32LE(at,14);b[18]=128;b.writeUInt32LE(3,19);b.set([valid?101:0,0,97,20,valid?131:0,1,98,21,valid?151:0,2,99,22],23);return b.toString('base64');}
async function native(status,payload){await db.prepare('INSERT INTO workout_native_cache(record_ref,status,evidence_json,payload_base64,checked_at) VALUES(?,?,\'{}\',?,1)').bind(ref,status,payload).run();}
async function snapshot(){const state={};for(const table of ['raw_records','raw_versions','workout_native_cache','activity_details','activity_detail_versions','sync_jobs','sync_history','sync_logs'])state[table]=(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;return state;}
test.before(async()=>{
 mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{throw Error('OUTBOUND_FORBIDDEN');}});db=await mf.getD1Database('DB');
 for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
 const raw={time:at,value:{start_time:at,end_time:at+120,duration:120}};
 await db.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at) VALUES(?,'sport',?,'2026-10-20','synthetic',?,'parsed',1)").bind(ref,at,JSON.stringify(raw)).run();
 for(const offset of [0,60])await db.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,clean_json,parse_status,synced_at) VALUES(?,'heart_rate',?,'2026-10-20','synthetic',?,?, 'parsed',1)").bind('synthetic-minute-'+offset,at+offset,JSON.stringify({time:at+offset,value:{bpm:80}}),JSON.stringify({bpm:80})).run();
});
test.beforeEach(async()=>{await db.prepare('DELETE FROM workout_native_cache').run();});
test.after(()=>mf.dispose());

test('decoded native and minute arrays have distinct scoped sources; detail matches the native sample reader without changing either series',async()=>{
 await native('downloaded_decoder_unverified',file());const before=await snapshot(),env={DB:db};
 const detail=await toolCall(env,'get_activity_detail',{record_ref:ref,include_samples:true,sample_limit:2}),samples=await toolCall(env,'get_activity_heart_rate_samples',{record_ref:ref,limit:2});
 assert.equal(detail.series_source,minuteSource);assert.equal(detail.series_source_scope,'heart_rate_samples');assert.equal(detail.native_curve.status,'decoded');assert.equal(detail.native_curve.series_source,nativeSource);assert.equal(detail.native_curve.series_source,samples.series_source);
 assert.deepEqual(detail.heart_rate_samples,[{at,bpm:80},{at:at+60,bpm:80}]);assert.deepEqual(detail.native_heart_rate_samples,samples.samples);assert.equal(samples.samples[1].at-samples.samples[0].at,1);assert.equal(detail.native_samples_truncated,true);
 const noSamples=await toolCall(env,'get_activity_detail',{record_ref:ref});assert.equal(noSamples.native_curve.series_source,nativeSource);assert.deepEqual(noSamples.native_heart_rate_samples,[]);
 const response=await mf.dispatchFetch('https://local.invalid/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'synthetic'},body:JSON.stringify({id:1,method:'tools/call',params:{name:'get_activity_detail',arguments:{record_ref:ref}}})});assert.equal(response.status,200);const result=await response.json(),httpDetail=JSON.parse(result.result.content[0].text);assert.equal(httpDetail.series_source_scope,'heart_rate_samples');assert.equal(httpDetail.native_curve.series_source,nativeSource);
 assert.deepEqual(await snapshot(),before);
});

test('unchecked, failed and unsupported native caches have no invented native source and preserve minute fallback',async()=>{
 for(const state of ['not_checked','failed','downloaded_decoder_unverified']){
  await db.prepare('DELETE FROM workout_native_cache').run();if(state!=='not_checked')await native(state,state==='failed'?null:file(7));
  const before=await snapshot(),detail=await toolCall({DB:db},'get_activity_detail',{record_ref:ref,include_samples:true}),samples=await toolCall({DB:db},'get_activity_heart_rate_samples',{record_ref:ref});
  assert.equal(detail.native_curve.status,state);assert.equal(detail.native_curve.series_source,null);assert.equal(detail.series_source_scope,'heart_rate_samples');assert.equal(detail.series_source,minuteSource);assert.equal(samples.series_source,minuteSource);assert.deepEqual(samples.samples,detail.heart_rate_samples);assert.deepEqual(detail.native_heart_rate_samples,[]);assert.deepEqual(await snapshot(),before);
 }
});

test('recognized native format with no valid heart-rate points does not label the fallback array as native',async()=>{
 await native('downloaded_decoder_unverified',file(4,false));const detail=await toolCall({DB:db},'get_activity_detail',{record_ref:ref,include_samples:true}),samples=await toolCall({DB:db},'get_activity_heart_rate_samples',{record_ref:ref});
 assert.equal(detail.native_curve.status,'decoded');assert.equal(detail.native_curve.series_source,nativeSource);assert.equal(detail.native_curve.total_samples,0);assert.equal(detail.series_source,minuteSource);assert.equal(detail.series_source_scope,'heart_rate_samples');assert.equal(samples.series_source,minuteSource);assert.deepEqual(samples.samples,detail.heart_rate_samples);
});
