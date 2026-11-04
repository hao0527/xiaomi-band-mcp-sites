import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {toolCall,rpc} from '../worker/index.js';

let mf,db,outbound=0;
const date='2026-10-20',next='2026-10-21',at=Date.parse(date+'T12:00:00+08:00')/1000;
const range={start_date:date,end_date:date},env=()=>({DB:db});
const advertised=['trigger_sync','get_sync_progress','get_sync_status','list_available_metrics','get_metric_records','get_raw_record','get_daily_summary','get_hrv_trend','get_activity_detail','get_activity_heart_rate_samples'];
const hidden=['get_sleep_records','get_heart_rate','get_activity_records','get_steps_records','get_spo2_records','get_stress_records','get_body_measurements','get_weekly_report','get_steps_audit','get_activity_heart_rate_analysis'];
const tables=['raw_records','raw_versions','daily_summary','sync_jobs','sync_history','sync_logs','activity_details','activity_detail_versions','ingestion_quarantine','metric_capabilities','step_references','aggregation_policies','workout_native_cache','hrv_probe_cache','collection_window_audits'];
async function snapshot(){const out={};for(const t of tables)out[t]=(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results;return out;}
function insert(id,metric,time,day,value,clean=null){return db.prepare("INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,clean_json,parse_status,synced_at) VALUES(?,?,?,?,'synthetic-source',?,?,'parsed',1)").bind(id,metric,time,day,JSON.stringify({time,sid:'synthetic-device',value}),clean?JSON.stringify(clean):null);}
test.before(async()=>{
 mf=new Miniflare({modules:true,scriptPath:new URL('../worker/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:()=>{outbound++;throw Error('LIVE_OUTBOUND_FORBIDDEN');}});
 db=await mf.getD1Database('DB');for(const q of (await readFile(new URL('../db/schema.sql',import.meta.url),'utf8')).split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
 const rows=Array.from({length:201},(_,i)=>insert('synthetic-heart-'+String(i).padStart(3,'0'),'heart_rate',at+i,date,{bpm:60+i%10},{bpm:60+i%10}));
 rows.push(insert('synthetic-resting','resting_heart_rate',at+300,date,{bpm:55}));
 const sleep={bedtime:at-7200,wake_up_time:at,duration:110,sleep_deep_duration:30,sleep_light_duration:50,sleep_rem_duration:30,sleep_awake_duration:10,avg_hrv:40,max_hrv:70,min_hrv:20,hrv_base_min:30,hrv_base_max:60,items:[{start_time:at-7200,end_time:at-5400,state:2},{start_time:at-5400,end_time:at-2400,state:3},{start_time:at-2400,end_time:at-600,state:4},{start_time:at-600,end_time:at,state:5}]};
 rows.push(insert('synthetic-sleep-valid','sleep',at,date,sleep),insert('synthetic-sleep-partial','sleep',at+1,date,{...sleep,items:[{start_time:at-7200,end_time:at,state:99}]}));
 rows.push(insert('synthetic-sport','sport',at,date,{start_time:at,end_time:at+1200,duration:1200,train_load:12,recover_time:9,calories:20,total_cal:30}));
 for(const [metric,value] of [['steps',{steps:7}],['spo2',{spo2:97}],['stress',{stress:0}],['weight',{weight:6500}],['steps_daily_aggregate',{steps:123}],['intensity',{unknown_text:'keep unknown source text',zero:0}]])rows.push(insert('synthetic-'+metric,metric,at,date,value));
 rows.push(insert('synthetic-next-report','steps_daily_aggregate',at+86400,next,{steps:234}));
 for(let i=0;i<rows.length;i+=40)await db.batch(rows.slice(i,i+40));
 await db.prepare("INSERT INTO aggregation_policies VALUES('steps',?,1)").bind(JSON.stringify({strategy:'cloud_daily_aggregate',verified_dates:[date]})).run();
 await db.prepare('INSERT INTO step_references VALUES(?,123,1)').bind(date).run();
 await db.prepare('INSERT INTO aggregation_policies VALUES(?,?,1)').bind('hrv_app_reference:'+date,JSON.stringify({date,fields:{avg_hrv:40,max_hrv:70,min_hrv:20,hrv_base_min:30,hrv_base_max:60},matched_record_refs:['synthetic-sleep-valid'],saved_at:1,method:'owner_reported_app_reconciliation'})).run();
 await db.prepare("INSERT INTO activity_details(record_ref,status,clean_json,fetched_at) VALUES('synthetic-sport','fetched','{\"existing\":1}',1)").run();
 await db.prepare('INSERT INTO daily_summary(date_cn,steps,synced_at) VALUES(?,999,1)').bind(date).run();
 await db.prepare("INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,?,?,3,?,'synthetic-live-cursor',1)").bind(date,next,next).run();
 await db.prepare("INSERT INTO sync_history(id,start_date,end_date,metric_index,current_date,cursor,updated_at) VALUES(1,'2025-01-01','2026-09-30',5,'2026-09-01','synthetic-history-cursor',2)").run();
});
test.after(()=>mf.dispose());

test('discovery exposes exactly ten source/read tools, only sync writes, while schemas express new selectors',async()=>{
 const before=await snapshot(),list=(await rpc(env(),{id:1,method:'tools/list'})).result.tools;
 assert.deepEqual(list.map(x=>x.name).sort(),[...advertised].sort());assert(list.every(x=>!hidden.includes(x.name)));
 assert.deepEqual(list.filter(x=>!x.annotations.readOnlyHint).map(x=>x.name),['trigger_sync']);
 assert.deepEqual(list.find(x=>x.name==='get_metric_records').inputSchema.required,['start_date','end_date']);
 assert.equal(list.find(x=>x.name==='get_metric_records').inputSchema.oneOf.length,2);assert.deepEqual(list.find(x=>x.name==='get_daily_summary').inputSchema.required,[]);
 assert.deepEqual(await snapshot(),before);assert.equal(outbound,0);
});
test('all seven hidden detail names retain their original full response, including the two-metric heart reader',async()=>{
 for(const [name,metrics] of [['get_sleep_records',['sleep']],['get_heart_rate',['heart_rate','resting_heart_rate']],['get_activity_records',['sport']],['get_steps_records',['steps']],['get_spo2_records',['spo2']],['get_stress_records',['stress']],['get_body_measurements',['weight']]]){
  const old=await toolCall(env(),name,range),replacement=await toolCall(env(),'get_metric_records',{...range,metrics,compact:false,limit:2000});
  assert.deepEqual(replacement,old);assert(old.records.every(r=>'field_metadata' in r));
 }
 const heart=await toolCall(env(),'get_heart_rate',range);assert.equal(heart.records.length,202);assert.deepEqual([...new Set(heart.records.map(r=>r.metric))].sort(),['heart_rate','resting_heart_rate']);
});
test('hidden report, audit and analysis remain callable through the original dispatcher without writes',async()=>{
 const before=await snapshot(),week=await toolCall(env(),'get_weekly_report',{date});assert.equal(week.days[0].steps,999);
 const audit=await toolCall(env(),'get_steps_audit',range);assert(audit);
 const analysis=await toolCall(env(),'get_activity_heart_rate_analysis',{record_ref:'synthetic-sport'});assert.equal(analysis.record_ref,'synthetic-sport');assert.equal(analysis.training_load.value,12);
 assert.deepEqual(await snapshot(),before);assert.equal(outbound,0);
});
test('new multi-metric default is compact and bounded to 200; all timestamps/ties paginate once without omissions',async()=>{
 const before=await snapshot(),refs=[],seenMetrics=new Set();let cursor;
 do{
  const page=await toolCall(env(),'get_metric_records',{...range,metrics:['heart_rate','resting_heart_rate'],...(cursor?{cursor}:{})});
  assert.equal(page.compact,true);assert.equal(page.limit,200);assert.equal(page.metadata_scope,'current_page');
  assert(page.records.every(r=>!('field_metadata' in r)&&page.metadata_sets.some(m=>m.metadata_ref===r.metadata_ref)));
  refs.push(...page.records.map(r=>r.record_ref));page.records.forEach(r=>seenMetrics.add(r.metric));cursor=page.next_cursor;
 }while(cursor);
 assert.equal(refs.length,202);assert.equal(new Set(refs).size,202);assert.equal(seenMetrics.size,2);assert.deepEqual(await snapshot(),before);assert.equal(outbound,0);
});
test('compact metadata reconstructs every original record, preserves per-record confidence and actually reduces repeated payload',async()=>{
 const metrics=['heart_rate','resting_heart_rate','sleep','sport','stress','weight'],full=await toolCall(env(),'get_metric_records',{...range,metrics,limit:2000,compact:false}),compact=await toolCall(env(),'get_metric_records',{...range,metrics,limit:2000});
 const restored=compact.records.map(r=>{const {metadata_ref,...record}=r,meta=compact.metadata_sets.find(m=>m.metadata_ref===metadata_ref);return {...record,field_metadata:meta.field_metadata,...(meta.source_field_metadata?{source_field_metadata:meta.source_field_metadata}:{}),raw_record_tool:compact.raw_record_tool};});
 assert.deepEqual(restored,full.records);assert(compact.metadata_sets.filter(m=>m.metric==='sleep').length>1);
 assert(JSON.stringify(compact).length<JSON.stringify(full).length*0.7);
 const sleep=compact.records.find(r=>r.record_ref==='synthetic-sleep-valid');assert.equal(sleep.hrv.field_metadata.avg_hrv.unit,'ms');assert.equal(sleep.hrv.app_reconciliation.record_app_reconciled,true);
 const sport=compact.records.find(r=>r.metric==='sport'),meta=compact.metadata_sets.find(m=>m.metadata_ref===sport.metadata_ref);assert.equal(meta.source_field_metadata.recover_time.unit,null);assert.equal(sport.source_numeric_fields.train_load,12);
});
test('legacy metric calls preserve 2000 default, original metadata and optional explicit compact mode',async()=>{
 const old=await toolCall(env(),'get_metric_records',{...range,metric:'heart_rate'});assert.equal(old.limit,2000);assert.equal(old.records.length,201);assert.equal(old.compact,undefined);assert(old.records.every(r=>'field_metadata' in r));
 const c=await toolCall(env(),'get_metric_records',{...range,metric:'heart_rate',compact:true});assert.equal(c.compact,true);assert.equal(c.limit,2000);
});
test('invalid selectors, metrics, compact types, pagination and new heart windows are rejected',async()=>{
 for(const args of [{},{metrics:[]},{metric:'sleep',metrics:['sleep']},{metrics:['sleep','sleep']},{metrics:['unknown']},{metrics:[1]},{metrics:null},{metric:1},{metrics:['sleep'],compact:'true'},{metrics:['sleep'],limit:'1'},{metrics:['sleep'],cursor:1}])await assert.rejects(toolCall(env(),'get_metric_records',{...range,...args}));
 await assert.rejects(toolCall(env(),'get_metric_records',{start_date:'2026-10-01',end_date:'2026-11-01',metrics:['sleep','heart_rate']}),e=>e.code==='QUERY_RANGE_TOO_LONG');
 assert((await toolCall(env(),'get_metric_records',{start_date:'2026-10-01',end_date:'2026-11-01',metrics:['sleep']})).records);
 assert((await toolCall(env(),'get_metric_records',{start_date:'2026-10-01',end_date:'2026-11-01',metric:'heart_rate'})).records);
 const error=await rpc(env(),{id:1,method:'tools/call',params:{name:'get_metric_records',arguments:{...range}}});assert.equal(error.result.isError,true);assert.equal(JSON.parse(error.result.content[0].text).error,'INVALID_METRIC_SELECTION');
});
test('daily range uses current cache and preserves P0 steps, source confidence, HRV and all old single-day fields',async()=>{
 const before=await snapshot(),page=await toolCall(env(),'get_daily_summary',{start_date:date,end_date:next});assert.equal(page.days.length,2);assert.equal(page.network_requests_performed,false);
 for(const day of page.days){const one=await toolCall(env(),'get_daily_summary',{date:day.date});for(const field of ['summary','field_metadata','quality','hrv'])assert.deepEqual(day[field],one[field]);assert.deepEqual(day.steps,one.metrics.steps);}
 assert.equal(page.days[0].summary.steps,123);assert.equal(page.days[0].steps.app_reconciled_for_date,true);assert.equal(page.days[1].summary.steps,234);assert.equal(page.days[1].steps.app_reconciled_for_date,false);assert.equal(page.days[1].field_metadata.steps.confidence,'source_reported');
 const old=await toolCall(env(),'get_daily_summary',{date});assert(old.metrics&&old.counts&&old.latest_observations);assert.equal(old.days,undefined);assert.deepEqual(await snapshot(),before);
});
test('daily range is at most seven days, rejects mixed/partial modes and keeps empty data distinct from zero',async()=>{
 for(const args of [{},{date,start_date:date,end_date:next},{date,start_date:date},{start_date:date},{end_date:date},{date:1}])await assert.rejects(toolCall(env(),'get_daily_summary',args));
 await assert.rejects(toolCall(env(),'get_daily_summary',{start_date:date,end_date:'2026-10-27'}),e=>e.code==='QUERY_RANGE_TOO_LONG');
 const seven=await toolCall(env(),'get_daily_summary',{start_date:'2026-10-14',end_date:date});assert.equal(seven.days.length,7);assert.equal(seven.days[0].summary.steps,null);assert.equal(seven.days[0].quality.status,'no_data');assert.equal(outbound,0);
});
test('unknown source fields remain obtainable via the same raw reference after compact reads',async()=>{
 const page=await toolCall(env(),'get_metric_records',{...range,metrics:['intensity']});const raw=await toolCall(env(),'get_raw_record',{record_ref:page.records[0].record_ref});assert.equal(JSON.parse(raw.raw_json_chunk).value.unknown_text,'keep unknown source text');assert.equal(JSON.parse(raw.raw_json_chunk).value.zero,0);assert.equal(raw.network_requests_performed,false);
});
test('actual Worker discovery is compact, old RPC names remain accepted, and platform identity is still required for data',async()=>{
 const call=async(body,identity=false)=>mf.dispatchFetch('https://local.invalid/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(identity?{'oai-authenticated-user-id':'synthetic-owner'}:{})},body:JSON.stringify(body)});
 const listed=await call({id:1,method:'tools/list'});assert.equal((await listed.json()).result.tools.length,10);
 const body={id:2,method:'tools/call',params:{name:'get_sleep_records',arguments:range}};assert.equal((await call(body)).status,401);
 const before=await snapshot(),r=await call(body,true);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).result.structuredContent.records.length,2);
 const fresh=await call({id:3,method:'tools/call',params:{name:'get_metric_records',arguments:{...range,metrics:['heart_rate','resting_heart_rate']}}},true);assert.equal((await fresh.json()).result.structuredContent.compact,true);
 assert.deepEqual(await snapshot(),before);assert.equal(outbound,0);
});
