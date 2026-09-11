// Capability-isolated human listener bridge. The frame never receives learner intent/answer.
export class HumanListenerBridge{
 constructor({documentRef=globalThis.document,windowRef=globalThis.window,handshakeTimeoutMs=8000}={}){this.document=documentRef;this.window=windowRef;this.handshakeTimeoutMs=handshakeTimeoutMs;this.active=null;}
 close(reason='cancelled'){const a=this.active;if(!a)return;if(a.timer)clearTimeout(a.timer);if(a.onReady)this.window?.removeEventListener?.('message',a.onReady);if(a.port){try{a.port.postMessage({type:'close'});a.port.close();}catch{}}if(a.frame?.remove)a.frame.remove();if(a.url)try{URL.revokeObjectURL(a.url);}catch{}if(a.reject)a.reject(Error(reason));this.active=null;}
 async open({audioBlob,receipt,allowed_actions}){
  if(!(audioBlob instanceof Blob)||!audioBlob.size||!receipt||!Array.isArray(allowed_actions))throw Error('Listener任务无效。');
  this.close('replaced');
  const frame=this.document.createElement('iframe');frame.src='./generic_listener.html';frame.sandbox='allow-scripts';frame.className='listener-frame';
  const channel=new MessageChannel(),url=URL.createObjectURL(audioBlob),actions=[...new Set([...allowed_actions,'repeat','no_action'])];
  const promise=new Promise((resolve,reject)=>{
   const active={frame,port:channel.port1,resolve,reject,url,receipt,ready:false,sent:false,onReady:null,timer:null};this.active=active;
   const cleanupReady=()=>{if(active.onReady)this.window?.removeEventListener?.('message',active.onReady);active.onReady=null;if(active.timer){clearTimeout(active.timer);active.timer=null;}};
   const sendTask=()=>{if(this.active!==active||active.sent)return;active.sent=true;cleanupReady();try{frame.contentWindow.postMessage({type:'listener_task',receipt,audio_url:url,allowed_actions:actions},'*',[channel.port2]);}catch(err){reject(err);this.finish();}};
   active.onReady=e=>{if(this.active!==active||e.source!==frame.contentWindow||e.origin!=='null'||e.data?.type!=='listener_ready')return;active.ready=true;sendTask();};
   this.window?.addEventListener?.('message',active.onReady);
   channel.port1.onmessage=e=>{const d=e.data||{};if(d.type!=='listener_result'||d.receipt!==receipt)return;if(!actions.includes(d.action))return;resolve({receipt,action:d.action,audio_listened:d.audio_listened===true,blind_attested:d.blind_attested===true,non_learner_attested:d.non_learner_attested===true});this.finish();};
   channel.port1.start?.();
   frame.onload=()=>{try{frame.contentWindow.postMessage({type:'request_ready'},'*');}catch{};};
   active.timer=setTimeout(()=>{if(this.active===active&&!active.sent){reject(Error('听者页面未准备好，请重新打开。'));this.finish();}},this.handshakeTimeoutMs);
  });
  this.document.body.append(frame);return promise;
 }
 finish(){const a=this.active;if(!a)return;if(a.timer)clearTimeout(a.timer);if(a.onReady)this.window?.removeEventListener?.('message',a.onReady);try{URL.revokeObjectURL(a.url);a.port?.close();a.frame?.remove();}catch{}a.reject=null;this.active=null;}
}
