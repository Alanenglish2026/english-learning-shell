// One capture instance; microphone requested only by start() called from a gesture.
export class Recorder {
 constructor(emit=()=>{},env=globalThis){this.emit=emit;this.env=env;this.state='idle';this.generation=0;this.stream=null;}
 setAudioSession(type){try{const a=this.env?.navigator?.audioSession;if(a&&'type' in a){a.type=type;this.emit('audio_session_type',{type});return true;}}catch(e){this.emit('audio_session_type_failed',{type,reason:e?.message||String(e)});}return false;}
 closeStream(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.setAudioSession('playback');}
 async start(){
  if(this.state!=='idle')throw Error('record_busy');this.state='requesting';const generation=++this.generation,e=this.env;
  try{
   if(!e.isSecureContext)throw Error('insecure_context');
   if(!e.navigator.mediaDevices?.getUserMedia)throw Error('media_devices_unavailable');
   if(!e.MediaRecorder)throw Error('recorder_unsupported');
   this.setAudioSession('play-and-record');
   this.emit('mic_request');
   // Permission query is diagnostic only; never blocks the gesture request.
   e.navigator.permissions?.query?.({name:'microphone'}).then(p=>this.emit('mic_permission',{state:p.state})).catch(()=>this.emit('mic_permission',{state:'unavailable'}));
   const live=this.stream?.getAudioTracks().some(t=>t.readyState==='live'&&!t.muted);
   const pending=live?Promise.resolve(this.stream):e.navigator.mediaDevices.getUserMedia({audio:true});
   pending.then(s=>{if(generation!==this.generation)s.getTracks().forEach(t=>t.stop());},()=>{});
   let timer;const stream=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('permission_unavailable')),20000);})]).finally(()=>clearTimeout(timer));
   if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw Error('recording_interrupted');}
   this.stream=stream;const tracks=stream.getAudioTracks();if(!tracks.length||!tracks.some(t=>t.readyState==='live'))throw Error('no_audio_track');
   if(e.document?.hidden)throw Error('recording_interrupted');
   this.emit('mic_granted');
   const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(m=>e.MediaRecorder.isTypeSupported?.(m));
   const r=new e.MediaRecorder(stream,mime?{mimeType:mime}:undefined);this.rec=r;this.parts=[];this.bad=false;
   r.ondataavailable=x=>{if(x.data?.size)this.parts.push(x.data);};
   r.onerror=()=>{this.bad=true;this.cancel();this.onUnexpected?.(Error('recorder_error'));};
   r.onstop=()=>{if(this.rec===r)this.finalize();};
   for(const t of tracks)t.onended=()=>{if(this.state==='recording'){this.cancel();this.onUnexpected?.(Error('microphone_track_ended'));}};
   r.start(250);this.started=Date.now();this.state='recording';this.emit('recording_started');
  }catch(error){if(generation===this.generation){this.state='idle';this.generation++;this.closeStream();}
   // A permission prompt may resolve after timeout/cancellation: release that late stream.
   this.emit(error.name==='NotAllowedError'?'mic_denied':'mic_error',{reason:error.message,name:error.name});throw error;}
 }
 stop(){
  if(this.state==='stopping')return this.finished;
  if(this.state!=='recording')return Promise.reject(Error('not_recording'));
  this.state='stopping';this.stopped=Date.now();
  this.finished=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;this.stopTimer=setTimeout(()=>{this.cancel();},10000);});
  try{this.rec.stop();this.emit('recording_stopped');}catch(e){this.reject(e);this.reset();}return this.finished;
 }
 finalize(){
  if(this.state!=='stopping'){this.cancel();this.onUnexpected?.(Error('recording_interrupted'));return;}
  const duration=(this.stopped-this.started)/1000,blob=new Blob(this.parts,{type:this.rec.mimeType||this.parts[0]?.type||'audio/mp4'});
  const resolve=this.resolve,reject=this.reject;this.reset();
  if(blob.size<256||duration<.3){reject(Error('empty_recording'));return;}
  this.emit('recording_blob_ready',{bytes:blob.size,duration});resolve({blob,duration});
 }
 reset(){clearTimeout(this.stopTimer);if(this.rec)this.rec.onstop=this.rec.onerror=this.rec.ondataavailable=null;this.rec=null;this.parts=[];this.state='idle';}
 cancel(){this.generation++;const reject=this.reject;if(this.rec){this.rec.onstop=this.rec.onerror=this.rec.ondataavailable=null;if(this.rec.state==='recording')try{this.rec.stop();}catch{}}
  this.reset();this.closeStream();reject?.(Error('recording_interrupted'));this.reject=null;}
}
