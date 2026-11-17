import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../worker/index.js';

const id='00000000-0000-4000-8000-000000000001';
async function page(initialStatus,recoveryStatus='partial'){
 const response=await worker.fetch(new Request('https://local.invalid/',{headers:{'oai-authenticated-user-id':'synthetic'}}),{});
 const html=await response.text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const elements=new Map(),writes=[],alerts=[];let status=initialStatus;
 const element=selector=>{if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);};
 const fetch=async(path,options)=>{
  if(options?.method==='POST'){
   writes.push({path,options});status=recoveryStatus;
   return Response.json({status,error_code:status==='failed'?'NETWORK_FAILURE':null});
  }
  if(path==='/api/sync-status')return Response.json({job:{start_date:'2026-11-10',end_date:'2026-11-11',complete:false},history:null,counts:[],logs:[]});
  if(path==='/api/mcp-sync-progress')return Response.json({status,sync_id:id,error_code:status==='failed'?'NETWORK_FAILURE':null});
  throw Error('UNEXPECTED_PAGE_REQUEST');
 };
 await vm.runInNewContext(script,{document:{querySelector:element},location:{hash:'#sync'},window:{},fetch,Response,alert:message=>alerts.push(message)});
 return {elements,writes,alerts,click:()=>element('#sync-now').onclick({target:element('#sync-now')})};
}

test('dashboard explicitly recovers one failed run through the existing same-ID endpoint and then returns to normal sync',async()=>{
 const p=await page('failed');assert.match(p.elements.get('#content').innerHTML,/恢复失败同步/);assert.match(p.elements.get('#content').innerHTML,/同步失败 · NETWORK_FAILURE/);assert.equal(p.writes.length,0);
 await p.click();assert.equal(p.writes.length,1);const request=p.writes[0];assert.equal(request.path,'/api/mcp-trigger-sync');assert.deepEqual(JSON.parse(request.options.body),{sync_id:id,retry_failed:true});assert.equal(request.options.headers['X-Site-Sync-Intent'],'refresh');assert.equal(p.alerts.length,0);assert.match(p.elements.get('#content').innerHTML,/手动增量同步/);
});

test('dashboard reports a failed recovery even on HTTP 200 and never loops its write',async()=>{
 const p=await page('failed','failed');await p.click();assert.equal(p.writes.length,1);assert.deepEqual(p.alerts,['同步未完成：NETWORK_FAILURE']);assert.match(p.elements.get('#content').innerHTML,/恢复失败同步/);
});

test('ordinary partial sync retains the original web endpoint and sends no recovery flag',async()=>{
 const p=await page('partial');await p.click();assert.equal(p.writes.length,1);assert.equal(p.writes[0].path,'/api/sync');assert.equal(p.writes[0].options.body,undefined);assert.equal(p.alerts.length,0);
});
