import {unb64} from './crypto.js';
import {CollectorError,CookieJar,allowedURL,boundedText,cookieValue,type Fetcher} from './http.js';
// Fixed compatibility metadata from the user-supplied Windows verifier; no credentials.
export const ACCOUNT_USER_AGENT="Dalvik/2.1.0 (Linux; U; Android 12; V2284A Build/ab8c0d1.1) APP/mi.health APPV/353001 MK/VjIyODRB SDKV/5.3.0.release.68 CPN/com.mi.health PassportSDK/";
export const ACCOUNT_SDK_VERSION='3.9';
export interface LoginDiagnostics {
  stage:'service_login'|'sts';httpStatus:number;
  accountCode:number|null;accountCodeType:'number'|'string'|'missing'|'other';
  hasSecurity:boolean;hasLocation:boolean;hasReturnedPassToken:boolean;
  hasCaptcha:boolean;hasNotification:boolean;
}
export class LoginDiagnosticError extends CollectorError {
  constructor(code:string,public readonly diagnostics:LoginDiagnostics){super(code);}
}
function loginDiagnostics(p:Record<string,unknown>,httpStatus:number,stage:LoginDiagnostics['stage']):LoginDiagnostics {
  return {stage,httpStatus,accountCode:typeof p.code==='number'&&Number.isSafeInteger(p.code)&&Math.abs(p.code)<=1000000?p.code:null,
    accountCodeType:p.code===undefined?'missing':typeof p.code==='number'?'number':typeof p.code==='string'?'string':'other',
    hasSecurity:typeof p.ssecurity==='string'&&p.ssecurity.length>0,hasLocation:typeof p.location==='string'&&p.location.length>0,
    hasReturnedPassToken:typeof p.passToken==='string'&&p.passToken.length>0,hasCaptcha:!!p.captchaUrl,hasNotification:!!p.notificationUrl};
}
export interface Session {security:Uint8Array;cookies:string;userId:string;passToken:string;}
export function loginPayload(raw:string):Record<string,unknown>{if(!raw.startsWith('&&&START&&&'))throw new CollectorError('INVALID_LOGIN_PREFIX');try{const o:unknown=JSON.parse(raw.slice(11));if(!o||typeof o!=='object'||Array.isArray(o))throw 0;return o as Record<string,unknown>;}catch{throw new CollectorError('INVALID_LOGIN_JSON');}}
export async function loginWithToken(fetcher:Fetcher,userId:string,passToken:string):Promise<Session>{
  const url='https://account.xiaomi.com/pass/serviceLogin?_json=true&sid=miothealth';const jar=new CookieJar();
  const r=await fetcher(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':ACCOUNT_USER_AGENT,Cookie:`sdkVersion=${ACCOUNT_SDK_VERSION}; userId=${cookieValue(userId)}; passToken=${cookieValue(passToken)}`}});
  if(!r.ok)throw new LoginDiagnosticError('LOGIN_HTTP_ERROR',loginDiagnostics({},r.status,'service_login'));jar.absorb(url,r.headers);let p:Record<string,unknown>;try{p=loginPayload(await boundedText(r));}catch(e){throw new LoginDiagnosticError(e instanceof CollectorError?e.code:'INVALID_LOGIN_RESPONSE',loginDiagnostics({},r.status,'service_login'));}
  const reject=(code:string)=>new LoginDiagnosticError(code,loginDiagnostics(p,r.status,'service_login'));
  if(p.captchaUrl||p.notificationUrl)throw reject('INTERACTIVE_AUTH_REQUIRED');
  if(p.code!==undefined&&p.code!==0)throw reject('LOGIN_REJECTED');
  if(typeof p.ssecurity!=='string'||typeof p.location!=='string'||typeof p.passToken!=='string'||(typeof p.userId!=='string'&&typeof p.userId!=='number'))throw reject('LOGIN_FIELDS_MISSING');
  const security=unb64(p.ssecurity);if(!security.length)throw reject('LOGIN_SECURITY_EMPTY');
  let target=allowedURL(p.location);if(target.hostname!=='sts-hlth.io.mi.com')throw new CollectorError('BLOCKED_STS_HOST');
  for(let hop=0;hop<5;hop++){
    // Reconstruct scoped cookies at every hop. Never forward account passToken to STS.
    const sts=await fetcher(target.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':ACCOUNT_USER_AGENT,Cookie:jar.header(target.href)}});
    if(!sts.ok&&![301,302,303,307,308].includes(sts.status))throw new LoginDiagnosticError('STS_HTTP_ERROR',loginDiagnostics(p,sts.status,'sts'));
    jar.absorb(target.href,sts.headers);
    // STS host and API host are siblings. Transfer only named service cookies explicitly.
    const healthCookies=jar.header(target.href);
    if(healthCookies.split('; ').some(v=>v.startsWith('serviceToken='))){const selected=healthCookies.split('; ').filter(v=>/^(serviceToken|cUserId|locale)=/.test(v));if(typeof p.cUserId==='string'&&!selected.some(v=>v.startsWith('cUserId=')))selected.push('cUserId='+cookieValue(p.cUserId));return {security,cookies:selected.join('; '),userId:String(p.userId),passToken:cookieValue(p.passToken)};}
    const location=sts.headers.get('Location');if(sts.status>=300&&sts.status<400&&location){const next=allowedURL(new URL(location,target).href);if(next.hostname!=='sts-hlth.io.mi.com')throw new CollectorError('BLOCKED_REDIRECT');target=next;continue;}
    throw new LoginDiagnosticError('SERVICE_TOKEN_MISSING',loginDiagnostics(p,sts.status,'sts'));
  }throw new CollectorError('REDIRECT_LIMIT');
}
