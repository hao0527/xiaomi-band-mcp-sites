export type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export class CollectorError extends Error { constructor(public code:string){super(code);this.name='CollectorError';} }
const allowedHosts=new Set(['account.xiaomi.com','sts-hlth.io.mi.com','hlth.io.mi.com']);
export function allowedURL(input:string):URL {let u:URL;try{u=new URL(input);}catch{throw new CollectorError('BLOCKED_URL');}if(u.protocol!=='https:'||!allowedHosts.has(u.hostname)||u.username||u.password||(u.port&&u.port!=='443')||u.hash)throw new CollectorError('BLOCKED_URL');return u;}
// Explicit opt-in only. No caller in this prototype enables it.
export function nativeFetcher(enabled=false):Fetcher{return async(url,init)=>{if(!enabled)throw new CollectorError('LIVE_NETWORK_DISABLED');allowedURL(url);return fetch(url,{...init,redirect:'manual'});};}
type Cookie={name:string;value:string;domain:string;hostOnly:boolean;path:string;secure:boolean;expires:number|null};
const token=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export function cookieValue(s:string){if(!s||/[\s;,\x00-\x1f\x7f]/.test(s))throw new CollectorError('INVALID_COOKIE');return s;}
export class CookieJar {
  private entries:Cookie[]=[];
  absorb(url:string,headers:Headers,now=Date.now()){
    const h=headers as Headers&{getAll?:(name:string)=>string[]};
    const lines=typeof h.getSetCookie==='function'?h.getSetCookie():h.getAll?.('Set-Cookie');
    if(!lines){if(headers.has('Set-Cookie'))throw new CollectorError('MULTI_COOKIE_API_UNAVAILABLE');return;}
    const u=allowedURL(url);for(const line of lines){const parts=line.split(';').map(s=>s.trim()),eq=parts[0].indexOf('=');if(eq<1)throw new CollectorError('INVALID_COOKIE');
      const c:Cookie={name:parts[0].slice(0,eq),value:parts[0].slice(eq+1),domain:u.hostname,hostOnly:true,path:u.pathname.slice(0,u.pathname.lastIndexOf('/')+1)||'/',secure:false,expires:null};
      if(!token.test(c.name)||/[\x00-\x20\x7f;,]/.test(c.value))throw new CollectorError('INVALID_COOKIE');let maxAge:number|null=null;
      for(const attr of parts.slice(1)){const i=attr.indexOf('='),k=(i<0?attr:attr.slice(0,i)).toLowerCase(),v=i<0?'':attr.slice(i+1);
        if(k==='domain'){const dom=v.toLowerCase().replace(/^\./,'');if(!['xiaomi.com','account.xiaomi.com','mi.com','io.mi.com','hlth.io.mi.com','sts-hlth.io.mi.com'].includes(dom)||!(u.hostname===dom||u.hostname.endsWith('.'+dom)))throw new CollectorError('INVALID_COOKIE_DOMAIN');c.domain=dom;c.hostOnly=false;}
        if(k==='path'&&v.startsWith('/'))c.path=v;if(k==='secure')c.secure=true;if(k==='expires'){const t=Date.parse(v);if(Number.isFinite(t))c.expires=t;}if(k==='max-age'&&/^-?\d+$/.test(v))maxAge=Number(v);
      }
      if(maxAge!==null)c.expires=now+maxAge*1000;this.entries=this.entries.filter(e=>!(e.name===c.name&&e.domain===c.domain&&e.path===c.path));if(c.expires===null||c.expires>now)this.entries.push(c);
    }
  }
  header(url:string,now=Date.now()){const u=allowedURL(url);return this.entries.filter(c=>(c.expires===null||c.expires>now)&&(c.hostOnly?u.hostname===c.domain:u.hostname===c.domain||u.hostname.endsWith('.'+c.domain))&&(u.pathname===c.path||u.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))&&(!c.secure||u.protocol==='https:')).sort((a,b)=>b.path.length-a.path.length).map(c=>c.name+'='+c.value).join('; ');}
}
export async function boundedText(r:Response,max=2*1024*1024){const reader=r.body?.getReader();if(!reader)return '';let size=0;const chunks:Uint8Array[]=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new CollectorError('RESPONSE_TOO_LARGE');}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new CollectorError('INVALID_UTF8');}}
