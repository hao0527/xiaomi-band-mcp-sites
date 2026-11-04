import {MiFitnessAdapter} from './collector/adapter.js';
import {nativeFetcher,CollectorError,type Fetcher} from './collector/http.js';
import {dateCN,addDays,value} from './collector/parser.js';
export interface Env {[key:string]:unknown;MI_USER_ID?:string;MI_PASS_TOKEN?:string;VERIFICATION_SERVICE_KEY?:string;MI_LIVE_VALIDATION_ENABLED?:string;}
export function preflight(env:Env){return {mode:'private-account-verification',credentials:{MI_USER_ID:typeof env.MI_USER_ID==='string'&&env.MI_USER_ID.length>0,MI_PASS_TOKEN:typeof env.MI_PASS_TOKEN==='string'&&env.MI_PASS_TOKEN.length>0},liveValidationEnabled:env.MI_LIVE_VALIDATION_ENABLED==='true',timezone:'Asia/Shanghai',healthDataPersistence:false,automaticLogin:false,secretValuesReturned:false};}
export function previousDay(now:number){return addDays(dateCN(Math.floor(now/1000)),-1);}
// One invocation: one login attempt, then steps only. No background tasks or storage.
// The operator must invoke at most once after explicit user consent; no durable
// exactly-once claim is possible without a persistent coordination resource.
export async function validateOnce(env:Env,transport:Fetcher=nativeFetcher(true),now=Date.now()){
  if(env.MI_LIVE_VALIDATION_ENABLED!=='true')throw new CollectorError('USER_AUTHORIZATION_REQUIRED');
  if(!env.MI_USER_ID||!env.MI_PASS_TOKEN)throw new CollectorError('SECRETS_NOT_CONFIGURED');
  const date=previousDay(now);let accountCalls=0,healthCalls=0;
  const limited:Fetcher=async(url,init)=>{if(new URL(url).hostname==='account.xiaomi.com'&&++accountCalls>1)throw new CollectorError('LOGIN_ATTEMPT_LIMIT');if(new URL(url).hostname==='hlth.io.mi.com'&&++healthCalls>6)throw new CollectorError('STEPS_REQUEST_LIMIT');return transport(url,init);};
  const adapter=new MiFitnessAdapter(limited,undefined,undefined,{totalWaitMs:1500,maxWaitMs:1000});
  await adapter.login(env.MI_USER_ID,env.MI_PASS_TOKEN);
  const samples:Array<{at:string;steps:number}>=[],seen=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null;
  for(let i=0;i<4;i++){
    const page=await adapter.page('steps',date,date,cursor);
    for(const record of page.records){const p=value(record),steps=p.steps;if(typeof steps!=='number'||!Number.isSafeInteger(steps)||steps<0)throw new CollectorError('UNVERIFIED_STEPS_SCHEMA');const id=JSON.stringify([record.sid??'',record.time,steps]);if(!seen.has(id)){seen.add(id);samples.push({at:new Date(record.time*1000).toISOString(),steps});}if(samples.length>1000)throw new CollectorError('STEPS_RESULT_LIMIT');}
    if(!page.hasMore)return {authentication:'pass',metric:'steps',date,timezone:'Asia/Shanghai',source:'xiaomi_cloud',samples,recordCount:samples.length,dailyTotal:null,totalStatus:samples.length?'AGGREGATION_SEMANTICS_NOT_YET_VERIFIED':'NO_RECORDS_RETURNED',complete:true,persisted:false};
    if(!page.nextKey||cursors.has(page.nextKey))throw new CollectorError('CURSOR_LOOP');cursors.add(page.nextKey);cursor=page.nextKey;
  }
  throw new CollectorError('PAGE_LIMIT_REACHED');
}
