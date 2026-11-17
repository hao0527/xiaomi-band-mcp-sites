import {keys} from './models.js';
import {networkFailure,type RequestFailureDetails,type RequestTransferDetails} from './http.js';

// This observer receives byte counts only. It never inspects source contents,
// request parameters, headers, URLs or exception messages.
export class RequestTrace {
 private readonly started:number;
 private readonly id=crypto.randomUUID();
 private headersAt:number|null=null;
 private firstAt:number|null=null;
 private lastAt:number|null=null;
 private bytes=0;
 private chunks=0;
 private complete=false;
 private status:number|null=null;
 private readonly metric:string|null;
 constructor(private operation:RequestFailureDetails['operation'],private signal:AbortSignal,private cap=20000,metric:unknown=null,private clock=()=>Date.now()){
  this.started=this.clock();this.metric=typeof metric==='string'&&keys.some(k=>k===metric)?metric:null;this.emit('started');
 }
 private elapsed(at:number){return Math.min(3600000,Math.max(0,at-this.started));}
 snapshot():RequestTransferDetails{
  const at=this.clock();
  return {diagnostic_version:2,request_id:this.id,headers_elapsed_ms:this.headersAt===null?null:this.elapsed(this.headersAt),body_elapsed_ms:this.headersAt===null?null:Math.max(0,this.elapsed(at)-this.elapsed(this.headersAt)),first_byte_elapsed_ms:this.firstAt===null?null:this.elapsed(this.firstAt),last_chunk_elapsed_ms:this.lastAt===null?null:this.elapsed(this.lastAt),body_idle_ms:this.headersAt===null?null:Math.max(0,this.elapsed(at)-this.elapsed(this.lastAt??this.headersAt)),body_bytes_received:this.bytes,body_chunks_received:this.chunks,body_complete:this.complete};
 }
 headers(status:number){this.status=status;this.headersAt=this.clock();this.emit('headers_received');}
 readonly reader={chunk:(size:number)=>{const at=this.clock();this.firstAt??=at;this.lastAt=at;this.bytes+=size;this.chunks++;},complete:()=>{this.complete=true;}};
 received(){this.emit('body_received');}
 httpError(){this.emit('http_error');}
 bodyError(){this.emit('body_error');}
 failure(stage:RequestFailureDetails['stage']){
  const error=networkFailure(this.signal,this.started,this.operation,stage,this.status,this.cap,this.snapshot());
  // Emit the identical immutable evidence saved with the failed run.
  this.emit('network_failure',error.request_failure);return error;
 }
 private emit(phase:'started'|'headers_received'|'body_received'|'http_error'|'body_error'|'network_failure',failure?:RequestFailureDetails){
  try{const write=phase==='network_failure'||phase==='http_error'||phase==='body_error'?console.error:console.info;write(JSON.stringify({event:'xiaomi_cloud_request',phase,metric:this.metric,...(failure??{operation:this.operation,elapsed_ms:this.elapsed(this.clock()),timeout_cap_ms:this.cap,http_status:this.status,...this.snapshot()})}));}catch{/* Diagnostics must never change request or retry behavior. */}
 }
}
