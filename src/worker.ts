import {rawRecord,rawReadErrors} from './raw-record-reader.js';
import {auditCollectionWindows,readWindowAudit} from './collection-window-audit.js';
import {repairActivityRaw,readActivityRawRepair} from './activity-raw-repair.js';
import {dataCoverage} from './data-coverage.js';
import {probeHRVCloud} from './hrv-cloud-probe.js';
import {saveHRVEvidence} from './hrv-evidence.js';
import {cachedHRVInspection} from './hrv-source-inspection.js';
import {probeNativeWorkout} from './workout-native.js';
import {activityHeartRateAnalysis,activityHeartRateSamples} from './workout-analysis.js';
import {triggerSync,getSyncProgress} from './mcp-sync.js';
import {qualityEvidence} from './quality-evidence.js';
import {stepsAudit,saveStepReferences,verifySteps} from './step-audit.js';
import {activityDetail} from './activity-details.js';
import {keys} from './collector/models.js';
import {dashboard} from './dashboard.js';
import {rebuildQuality,runPersistentSync,daily,queryRecords,hrvRecords,availableMetrics,syncStatus,rpc,safeError,validRange,type PersistentEnv} from './persistence.js';
import {preflight,validateOnce,previousDay,type Env} from './verification.js';
import {CollectorError} from './collector/http.js';
import {LoginDiagnosticError} from './collector/auth.js';
const ui=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小米云 · 私有账号验证</title><style>body{background:#0c1420;color:#e8eef6;font:16px system-ui;max-width:800px;margin:60px auto;padding:0 22px;line-height:1.8}article{border:1px solid #293c50;background:#121f2d;border-radius:16px;padding:24px;margin:24px 0}h1{font-size:28px}a{color:#8de2be}small,p{color:#b5c5d7}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:12px 20px;background:#8de2be;border:0;border-radius:8px;cursor:pointer}</style><h1>小米云 · 私有账号验证</h1><p>独立验证环境 · 北京时间 · 不保存健康数据</p><article><h2>先配置，后授权</h2><p>在 <a href="https://chatgpt.com/sites" target="_blank" rel="noreferrer">Sites</a> 中找到“小米云 · 私有账号验证”，选择更多操作 → Settings，在托管环境配置中分别新增 MI_USER_ID、MI_PASS_TOKEN，并将两项都设为 Secret。</p><p>这里没有凭据输入框。不要把凭据发到聊天、上传文件或存入普通环境变量。保存后回到对话，只告诉我“已配置”。配置变更需要重新部署才能生效。</p></article><article><h2>当前配置检查</h2><p>只检查是否配置，不显示任何凭据值，也不调用小米。</p><button id="check">检查配置状态</button><pre id="result">尚未检查</pre></article><article><h2>真实测试尚未授权</h2><p>页面不提供真实测试按钮。你明确授权后，由后端执行一次 miothealth 登录及最近一个完整自然日的步数查询。不会全量同步，不连接数据库。账号认证凭据仅用于该后端请求。</p><p>步数返回结构未经验证时不擅自合计，不把缺失记录当作零。</p></article><script>document.querySelector('#check').onclick=async()=>{const out=document.querySelector('#result');try{const r=await fetch('/api/preflight',{cache:'no-store'});out.textContent=JSON.stringify(await r.json(),null,2);}catch{out.textContent='配置检查未完成';}};</script></html>`;
const safeHeaders={'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; form-action 'none'; base-uri 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
async function serviceAuthorized(request:Request,env:Env){const actual=request.headers.get('X-Verification-Service-Key'),expected=env.VERIFICATION_SERVICE_KEY;if(!actual||typeof expected!=='string'||!expected)return false;const enc=new TextEncoder(),a=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(actual))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(expected)));let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
export default {async fetch(request:Request,env:PersistentEnv):Promise<Response>{
  const json=(v:unknown,status=200)=>Response.json(v,{status,headers:safeHeaders}),url=new URL(request.url);
  const visitor=!!(request.headers.get('oai-authenticated-user-id')||request.headers.get('oai-authenticated-user-email')),service=await serviceAuthorized(request,env),privateJob=request.headers.get('X-Site-Sync-Intent')==='refresh'&&!request.headers.get('Origin');
  // The platform owner-private dispatch gate authorizes all incoming requests.
  // Read-only MCP discovery contains metadata only; user data calls still need identity.
  if(url.pathname==='/mcp'&&request.method==='POST'){
    let body:Record<string,unknown>;try{if(Number(request.headers.get('Content-Length')??0)>16384)return json({error:'REQUEST_TOO_LARGE'},413);body=JSON.parse(await request.text());}catch{return json({error:'INVALID_JSON'},400);}
    if(!visitor&&!service&&!['server/discover','tools/list','initialize','ping'].includes(String(body.method)))return json({error:'SIGN_IN_REQUIRED'},401);
    return json(await rpc(env,body));
  }
  if(url.pathname==='/api/sync'&&request.method==='POST'){
    // Identity-less jobs authenticate to owner-private Sites with the platform
    // service bearer. Sites consumes it before forwarding; no secret copying.
    if(request.headers.get('X-Site-Sync-Intent')!=='refresh')return json({error:'SYNC_INTENT_REQUIRED'},403);
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'CROSS_ORIGIN_DENIED'},403);
    if(url.search||await request.text())return json({error:'NO_SYNC_PARAMETERS'},400);
    try{return json(await runPersistentSync(env));}catch(e){const code=e instanceof CollectorError&&['PERSIST_SYNC_DISABLED','DATABASE_NOT_READY','SECRETS_NOT_CONFIGURED','SYNC_BUSY','HOSTING_COST_REVIEW_REQUIRED'].includes(e.code)?e.code:safeError(e);return json({error:code},502);}
  }
  if(request.method==='GET'&&url.pathname==='/api/sync-status'&&request.headers.get('X-Site-Sync-Intent')==='refresh'){try{return json(await syncStatus(env));}catch{return json({error:'DATABASE_NOT_READY'},503);}}
  if(!visitor&&!service&&!privateJob)return json({error:'SIGN_IN_REQUIRED'},401);
  if(url.pathname==='/api/activity-raw-repair'&&request.method==='POST'){
    if(!privateJob)return json({error:'OPERATOR_AUTHORIZATION_REQUIRED'},403);
    try{const text=await request.text();if(url.search||text.length>512)return json({error:'INVALID_ARGUMENTS'},400);const b=JSON.parse(text);if(!b||Array.isArray(b)||Object.keys(b).length!==1||typeof b.record_ref!=='string')return json({error:'INVALID_ARGUMENTS'},400);return json(await repairActivityRaw(env,b.record_ref));}
    catch(e){return json({error:e instanceof CollectorError&&['INVALID_RECORD_REF','SYNC_BUSY_OR_NOT_INITIALIZED','PERSIST_SYNC_DISABLED','SECRETS_NOT_CONFIGURED','HOSTING_COST_REVIEW_REQUIRED','REPAIR_SOURCE_NOT_USABLE'].includes(e.code)?e.code:'ACTIVITY_RAW_REPAIR_FAILED'},400);}
  }
  if(url.pathname==='/api/collection-window-audit'&&request.method==='POST'){
    if(!privateJob)return json({error:'OPERATOR_AUTHORIZATION_REQUIRED'},403);
    try{const text=await request.text();if(url.search||text.length>256)return json({error:'INVALID_ARGUMENTS'},400);const b=JSON.parse(text);if(!b||Array.isArray(b)||Object.keys(b).length!==1||typeof b.date!=='string')return json({error:'INVALID_ARGUMENTS'},400);return json(await auditCollectionWindows(env,b.date));}
    catch(e){return json({error:e instanceof CollectorError&&['SYNC_BUSY_OR_NOT_INITIALIZED','SECRETS_NOT_CONFIGURED','HOSTING_COST_REVIEW_REQUIRED','AUDIT_REQUIRES_CLOSED_WINDOWS','INVALID_DATE'].includes(e.code)?e.code:'WINDOW_AUDIT_FAILED'},400);}
  }
  if(request.method==='POST'&&['/api/steps-reference','/api/steps-verify'].includes(url.pathname)){if(!service&&!privateJob)return json({error:'OPERATOR_AUTHORIZATION_REQUIRED'},403);if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'CROSS_ORIGIN_DENIED'},403);try{const body=await request.text();if(body.length>8192)return json({error:'REQUEST_TOO_LARGE'},413);const b=JSON.parse(body);if(url.pathname==='/api/steps-reference')return json(await saveStepReferences(env,b.references));const r=validRange(b.start,b.end,31);return json(await verifySteps(env,r.start,r.end));}catch{return json({error:'INVALID_REFERENCE_OR_QUERY'},400);}}
  if(url.pathname==='/api/hrv-cloud-probe'&&request.method==='POST'&&privateJob){if(request.headers.get('Origin'))return json({error:'CROSS_ORIGIN_DENIED'},403);try{const raw=await request.text();if(raw.length>256)return json({error:'REQUEST_TOO_LARGE'},413);const b=JSON.parse(raw);if(Object.keys(b).length!==1||typeof b.date!=='string')return json({error:'INVALID_ARGUMENTS'},400);return json(await probeHRVCloud(env,b.date));}catch(e){return json({error:e instanceof CollectorError&&['SYNC_BUSY','HRV_PROBE_BUSY','SECRETS_NOT_CONFIGURED','HOSTING_COST_REVIEW_REQUIRED'].includes(e.code)?e.code:'HRV_PROBE_FAILED'},400);}}
  if(url.pathname==='/api/hrv-verification'&&request.method==='POST'&&(privateJob||service)){if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'CROSS_ORIGIN_DENIED'},403);try{const raw=await request.text();if(raw.length>2048)return json({error:'REQUEST_TOO_LARGE'},413);return json(await saveHRVEvidence(env,JSON.parse(raw)));}catch(e){return json({error:e instanceof CollectorError&&['INVALID_HRV_REFERENCE','HRV_REFERENCE_MISMATCH'].includes(e.code)?e.code:'HRV_REFERENCE_FAILED'},400);}}
  if(url.pathname==='/api/quality-rebuild'&&request.method==='POST'&&privateJob){try{const b=JSON.parse(await request.text());const r=validRange(b.start,b.end,31);return json(await rebuildQuality(env,r.start,r.end));}catch{return json({error:'QUALITY_REBUILD_FAILED'},502);}}
  if(url.pathname==='/api/mcp-trigger-sync'&&request.method==='POST'){if(!privateJob&&!visitor)return json({error:'SIGN_IN_REQUIRED'},401);if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'CROSS_ORIGIN_DENIED'},403);try{const body=await request.text();if(body.length>1024)return json({error:'REQUEST_TOO_LARGE'},413);const b=body?JSON.parse(body):{};if(Object.keys(b).some(k=>!['sync_id','retry_failed'].includes(k))||(b.sync_id!==undefined&&typeof b.sync_id!=='string')||(b.retry_failed!==undefined&&typeof b.retry_failed!=='boolean'))return json({error:'INVALID_ARGUMENTS'},400);return json(await triggerSync(env,b.sync_id,undefined,undefined,b.retry_failed===true));}catch{return json({error:'INVALID_SYNC_REQUEST'},400);}}
  if(url.pathname==='/api/activity-native-probe'&&request.method==='POST'&&privateJob){try{const raw=await request.text();if(raw.length>1024)return json({error:'REQUEST_TOO_LARGE'},413);const b=JSON.parse(raw);if(Object.keys(b).some(k=>k!=='record_ref')||typeof b.record_ref!=='string')return json({error:'INVALID_ARGUMENTS'},400);return json(await probeNativeWorkout(env,b.record_ref));}catch{return json({error:'NATIVE_PROBE_FAILED'},502);}}
  if(request.method==='GET'&&url.pathname==='/')return new Response(dashboard,{headers:{...safeHeaders,'Content-Type':'text/html; charset=utf-8'}});
  if(request.method==='GET'&&url.pathname==='/settings-guide')return new Response(ui,{headers:{...safeHeaders,'Content-Type':'text/html; charset=utf-8'}});
  if(request.method==='GET'&&url.pathname==='/api/preflight'){if(url.search)return json({error:'QUERY_PARAMETERS_NOT_ALLOWED'},400);return json({...preflight(env),healthDataPersistence:!!env.DB,databaseBound:!!env.DB,persistentSyncEnabled:env.PERSIST_SYNC_ENABLED==='true'});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/')){try{
    if(url.pathname==='/api/activity-raw-repair')return json(await readActivityRawRepair(env,url.searchParams.get('ref')??''));
    if(url.pathname==='/api/collection-window-audit')return json(await readWindowAudit(env,url.searchParams.get('date')??''));
    if(url.pathname==='/api/raw-record'){try{return json(await rawRecord(env,url.searchParams.get('ref')??'',Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('limit')??8192),url.searchParams.get('snapshot_hash')??undefined,url.searchParams.get('component')??undefined));}catch(e){return json({error:e instanceof CollectorError&&rawReadErrors.has(e.code)?e.code:'RAW_READ_FAILED'},400);}}
    if(url.pathname==='/api/data-coverage'){const r=validRange(url.searchParams.get('start'),url.searchParams.get('end'),31);return json(await dataCoverage(env,r.start,r.end,url.searchParams.get('metric')??undefined));}
    if(url.pathname==='/api/steps-audit'){const r=validRange(url.searchParams.get('start'),url.searchParams.get('end'),31);return json((await stepsAudit(env,r.start,r.end)).result);}
    if(url.pathname==='/api/activity-heart-rate-samples')return json(await activityHeartRateSamples(env,url.searchParams.get('ref')??'',Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('limit')??1000)));
    if(url.pathname==='/api/activity-heart-rate-analysis')return json(await activityHeartRateAnalysis(env,url.searchParams.get('ref')??''));
    if(url.pathname==='/api/activity-detail')return json(await activityDetail(env,url.searchParams.get('ref')??'',url.searchParams.get('samples')==='true',Number(url.searchParams.get('limit')??1000)));
    if(url.pathname==='/api/hrv-source-evidence'){const r=validRange(url.searchParams.get('start'),url.searchParams.get('end'),7);return json(await cachedHRVInspection(env,r.start,r.end));}
    if(url.pathname==='/api/quality-evidence'){const r=validRange(url.searchParams.get('start'),url.searchParams.get('end'),7);return json(await qualityEvidence(env,r.start,r.end));}
    if(url.pathname==='/api/mcp-sync-progress')return json(await getSyncProgress(env,url.searchParams.get('sync_id')??undefined));
    if(url.pathname==='/api/metrics')return json(await availableMetrics(env));
    if(url.pathname==='/api/sync-status')return json(await syncStatus(env));
    if(url.pathname==='/api/trends'){const r=validRange(url.searchParams.get('start'),url.searchParams.get('end'),366);if(!env.DB)return json({error:'DATABASE_NOT_READY'},503);return json({days:(await env.DB.prepare('SELECT * FROM daily_summary WHERE date_cn>=? AND date_cn<=? ORDER BY date_cn').bind(r.start,r.end).all()).results,timezone:'Asia/Shanghai'});}
    if(url.pathname==='/api/daily')return json(await daily(env,url.searchParams.get('date')??''));
    if(url.pathname==='/api/hrv'){const range=validRange(url.searchParams.get('start'),url.searchParams.get('end'));return json(await hrvRecords(env,range.start,range.end,Number(url.searchParams.get('limit')??2000),url.searchParams.get('cursor')??undefined));}
    if(url.pathname==='/api/records'){const range=validRange(url.searchParams.get('start'),url.searchParams.get('end'));const metrics=(url.searchParams.get('metric')??'').split(',');if(!metrics.length||metrics.some(x=>!keys.includes(x as typeof keys[number])))return json({error:'INVALID_METRIC'},400);return json(await queryRecords(env,metrics,range.start,range.end,Number(url.searchParams.get('limit')??2000),url.searchParams.get('cursor')??undefined));}
    }catch{return json({error:'INVALID_QUERY_OR_DATABASE_UNAVAILABLE'},400);}}
  if(url.search)return json({error:'QUERY_PARAMETERS_NOT_ALLOWED'},400);
  if(url.pathname!=='/api/validate-once')return json({error:'NOT_FOUND'},404);
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!service)return json({error:'OPERATOR_AUTHORIZATION_REQUIRED'},403);
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'CROSS_ORIGIN_DENIED'},403);
  if(request.headers.get('X-Verification-Consent')!=='login-and-previous-day-steps')return json({error:'EXPLICIT_CONSENT_REQUIRED'},403);
  if(request.headers.get('Content-Length')&&request.headers.get('Content-Length')!=='0')return json({error:'BODY_NOT_ALLOWED'},400);
  if(await request.text())return json({error:'BODY_NOT_ALLOWED'},400);
  try{return json(await validateOnce(env));}catch(e){
    const allowed=new Set(['USER_AUTHORIZATION_REQUIRED','SECRETS_NOT_CONFIGURED','INTERACTIVE_AUTH_REQUIRED','LOGIN_REJECTED','LOGIN_HTTP_ERROR','STS_HTTP_ERROR','SERVICE_TOKEN_MISSING','AUTH_EXPIRED','UPSTREAM_RETRY_DEFERRED','UPSTREAM_RETRY_EXHAUSTED','UNVERIFIED_STEPS_SCHEMA','CURSOR_LOOP','PAGE_LIMIT_REACHED','STEPS_RESULT_LIMIT','STEPS_REQUEST_LIMIT','LOGIN_ATTEMPT_LIMIT','LOGIN_FIELDS_MISSING','LOGIN_SECURITY_EMPTY','INVALID_LOGIN_PREFIX','INVALID_LOGIN_JSON','INVALID_LOGIN_RESPONSE']);
    const code=e instanceof CollectorError&&allowed.has(e.code)?e.code:'VALIDATION_FAILED';return json({error:code,...(e instanceof LoginDiagnosticError?{diagnostics:e.diagnostics}:{})},code==='USER_AUTHORIZATION_REQUIRED'?403:502);
  }
}};
// Pure exports for injected offline tests; not additional HTTP routes.
export {validateOnce,previousDay,preflight};
export {runPersistentSync,stripCredentials,toolCall,rpc,availableMetrics,metricInfo} from './persistence.js';

export {MiFitnessAdapter} from './collector/adapter.js';
export {parseRecord} from './collector/parser.js';

export {stepsAudit,saveStepReferences,verifySteps} from './step-audit.js';
export {activityDetail,projectHealth} from './activity-details.js';

export {normalizeSleep} from './sleep-normalizer.js';
export {buildDaily} from './daily-health.js';
export {fieldSemantics,dataContract} from './semantics.js';

export {triggerSync,getSyncProgress} from './mcp-sync.js';

export {analyzeHR,activityHeartRateAnalysis} from './workout-analysis.js';
export {fdsSuffix,allowedFDS,decryptFDS,probeNativeWorkout,fetchPendingNativeWorkout,nativeSyncState} from './workout-native.js';

export {decodeStrengthV4} from './workout-decoder.js';

export {extractSleepHRV,sleepHRVFromRaw} from './hrv-source.js';

export {saveHRVEvidence,attachHRVEvidence} from './hrv-evidence.js';
export {inspectHRVTree} from './hrv-source-inspection.js';

export {probeHRVCloud} from './hrv-cloud-probe.js';

export {rawRecord,redactRawRecord} from './raw-record-reader.js';
export {dataCoverage} from './data-coverage.js';

export {fetchActivityDetails} from './activity-details.js';
export {saveRejectedRecords} from './ingestion-quarantine.js';
export {auditCollectionWindows,readWindowAudit} from './collection-window-audit.js';
export {repairActivityRaw,readActivityRawRepair} from './activity-raw-repair.js';

export {networkFailure,safeRequestFailure} from './collector/http.js';
