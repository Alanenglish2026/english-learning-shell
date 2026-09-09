// Shared course and temporary-voice playback. No elapsed-time success inference.
export class MediaPlayer {
 constructor(emit=()=>{},make=()=>new Audio()){this.emit=emit;this.make=make;this.active=null;}
 play(src,{id='voice',manual=false}={}){
  this.stop();const a=this.make();this.audio=a;a.src=src;a.playsInline=true;
  this.emit('audio_play_requested',{audio_id:id});
  return new Promise((resolve,reject)=>{
   let accepted=false,ended=false,done=false,last=0,lastProgress=Date.now();
   const endPosition=()=>a.ended===true||(Number.isFinite(a.duration)&&a.duration>0&&a.currentTime>=a.duration&&a.readyState>=2);
   const finish=(error,fallback)=>{if(done)return;done=true;clearInterval(watch);a.onended=a.onpause=a.onerror=a.onabort=a.onstalled=a.onplaying=a.ontimeupdate=null;this.active=null;
    if(error){a.pause();reject(error);return;}if(fallback)this.emit('audio_fallback',{audio_id:id,reason:fallback});this.emit('audio_ended',{audio_id:id,signal:ended?'ended':'position'});resolve({duration:a.duration});};
   const check=()=>{if(accepted&&(ended||endPosition())){finish(null,ended?null:'verified_end_position');return true;}return false;};
   const watch=setInterval(()=>{if(check())return;if(a.currentTime>last){last=a.currentTime;lastProgress=Date.now();}if(Date.now()-lastProgress>20000)finish(Error('audio_timeout'));},250);
   a.onended=()=>{ended=true;check();};a.ontimeupdate=check;
   a.onplaying=()=>this.emit('audio_playing',{audio_id:id});
   a.onpause=()=>{if(!check()&&accepted&&a.paused&&!endPosition())finish(Error('audio_interrupted'));};
   a.onerror=()=>finish(Error('audio_failed'));a.onabort=()=>finish(Error('audio_aborted'));
   a.onstalled=()=>this.emit('audio_stalled',{audio_id:id});
   this.active={check,cancel:()=>finish(Error('audio_interrupted'))};
   try{Promise.resolve(a.play()).then(()=>{if(done)return;accepted=true;if(manual)this.emit('manual_audio_started',{audio_id:id});check();},finish);}catch(e){finish(e);}
  });
 }
 check(){return this.active?.check();}
 stop(){this.active?.cancel();this.audio?.pause();}
 release(){this.stop();this.audio?.removeAttribute?.('src');this.audio?.load?.();this.audio=null;}
}
