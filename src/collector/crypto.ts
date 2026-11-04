/* Protocol port: Copyright (c) 2026 Aleksej Kubulashvili. MIT; see licenses/. */
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const text = (b: Uint8Array) => new TextDecoder('utf-8', {fatal:true}).decode(b);
export function b64(b: Uint8Array): string { let s=''; for(const v of b)s+=String.fromCharCode(v); return btoa(s); }
export function unb64(s: string): Uint8Array {
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw new Error('INVALID_BASE64');
  return Uint8Array.from(atob(s),c=>c.charCodeAt(0));
}
export async function digest(algorithm:'SHA-1'|'SHA-256',data:Uint8Array):Promise<Uint8Array>{return new Uint8Array(await crypto.subtle.digest(algorithm,new Uint8Array(data)));}
export function nonce(nowMs=Date.now(),random8=crypto.getRandomValues(new Uint8Array(8))):Uint8Array {
  const minutes=Math.floor(nowMs/60000);if(random8.length!==8||!Number.isSafeInteger(minutes)||minutes<0||minutes>0xffffffff)throw new Error('INVALID_NONCE_INPUT');
  const out=new Uint8Array(12);out.set(random8);new DataView(out.buffer).setUint32(8,minutes,false);return out;
}
export async function signedNonce(security:Uint8Array,n:Uint8Array){const v=new Uint8Array(security.length+n.length);v.set(security);v.set(n,security.length);return digest('SHA-256',v);}
export class RC4 {
  private s=Uint8Array.from({length:256},(_,i)=>i); private i=0;private j=0;
  constructor(key:Uint8Array,drop=1024){if(!key.length||key.length>256||!Number.isInteger(drop)||drop<0)throw new Error('INVALID_RC4_INPUT');let j=0;for(let i=0;i<256;i++){j=(j+this.s[i]+key[i%key.length])&255;[this.s[i],this.s[j]]=[this.s[j],this.s[i]];}for(let n=0;n<drop;n++)this.next();}
  private next(){this.i=(this.i+1)&255;this.j=(this.j+this.s[this.i])&255;[this.s[this.i],this.s[this.j]]=[this.s[this.j],this.s[this.i]];return this.s[(this.s[this.i]+this.s[this.j])&255];}
  crypt(data:Uint8Array){return Uint8Array.from(data,v=>v^this.next());}
}
export const rc4=(key:Uint8Array,data:Uint8Array)=>new RC4(key).crypt(data);
export async function signature(method:string,path:string,values:Record<string,string>,key:Uint8Array){
  let s=method+'&'+path+'&data='+values.data;if('rc4_hash__' in values)s+='&rc4_hash__='+values.rc4_hash__;return b64(await digest('SHA-1',utf8(s+'&'+b64(key))));
}
// json.dumps(..., separators=(',', ':')) uses ensure_ascii=True in the primary source.
export function pythonJSON(value:unknown):string {const s=JSON.stringify(value);if(s===undefined)throw new Error('INVALID_JSON');return s.replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
export async function encryptRequest(payload:unknown,path:string,security:Uint8Array,n=nonce()){
  const key=await signedNonce(security,n),plain={data:pythonJSON(payload),rc4_hash__:''};plain.rc4_hash__=await signature('POST',path,{data:plain.data},key);
  const form={data:b64(rc4(key,utf8(plain.data))),rc4_hash__:b64(rc4(key,utf8(plain.rc4_hash__))),signature:'',_nonce:b64(n)};
  form.signature=await signature('POST',path,form,key);return {form,key};
}
// Auxiliary project's continuous stream must never be silently substituted for primary.
export async function auxiliaryEncrypted(method:string,path:string,params:Record<string,string>,security:Uint8Array,n:Uint8Array){
  const key=await signedNonce(security,n),sk=b64(key),p=path.startsWith('https://')?new URL(path).pathname:path;
  const plain=Object.fromEntries(Object.entries(params).filter(([k,v])=>k&&v!==''));
  const sha=async(v:string[])=>b64(await digest('SHA-1',utf8(v.join('&'))));
  plain.rc4_hash__=await sha([method.toUpperCase(),p,...Object.keys(plain).sort().map(k=>k+'='+plain[k]),sk]);
  const stream=new RC4(key),enc:Record<string,string>={};for(const k of Object.keys(plain).sort())enc[k]=b64(stream.crypt(utf8(plain[k])));
  return {...enc,signature:await sha([method.toUpperCase(),p,...Object.keys(enc).map(k=>k+'='+enc[k]),sk]),_nonce:b64(n)};
}
