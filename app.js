import {MediaPlayer} from './media.js';
import {Recorder} from './recorder.js';
import {newTrial,completeTrial} from './core.js';
import {bindHold} from './hold.js';
import {AUTO_STEPS} from './ux_policy.js';
import {lessonFetch as fetch,LOCAL,saveRecording} from './transport.js';
import {exportState} from './transfer.js';
const el=document.querySelector('#app'),notice=document.querySelector('#notice');
const token='';
history.replaceState(null,'',location.pathname);
let s,manifest,rec,stream,chunks=[],recordStarted,pendingBlob,playing=false,poll,timer,epoch=0,uiBusy=false,recordBusy=false;
let audio=new Audio();let actions,secondary,body,pendingTransition;
const player=new MediaPlayer(diagnostic),capture=new Recorder(diagnostic);
let restoring=false,retryVoiceURL=null;const standalone=()=>navigator.standalone===true||globalThis.matchMedia?.('(display-mode: standalone)').matches===true;
function diagnostic(type,extra={}){log(type,{...extra,diagnostic:true,observed_at:Date.now()}).catch(()=>{});}
function cancelTransition(){clearTimeout(timer);pendingTransition=null;}
function drainTransition(fallback=false){const job=pendingTransition;if(!job||job.running||document.hidden||job.at!==epoch)return;if(fallback&&Date.now()<job.due)return;job.running=true;pendingTransition=null;clearTimeout(timer);if(fallback)diagnostic('fallback_used',{reason:'transition_watchdog'});diagnostic('transition_requested',{transition_id:job.id});Promise.resolve().then(job.fn).then(()=>diagnostic('transition_completed',{transition_id:job.id})).catch(async e=>{await fail(e);action('再试一次',job.fn,'recovery')});}
setInterval(()=>drainTransition(true),300);
async function api(path,data){const r=await fetch('./api/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'暂时没有连接好');return v;}
async function log(type,extra={}){return api('event',{evidence_type:type,node_id:'S'+String(s.screen).padStart(2,'0'),...extra});}
async function persist(patch={}){s=await api('state',patch);return s;}
async function fail(e){notice.textContent='这一步还没完成，可以再试一次。';try{await log('DEVICE_ISSUE',{device_issue:String(e.message||e)})}catch{} }
function safe(task){return async()=>{if(uiBusy||recordBusy)return;uiBusy=true;notice.textContent='';try{await task()}catch(e){await fail(e)}finally{uiBusy=false}};}
function text(tag,value,parent=body){const x=document.createElement(tag);x.textContent=value;parent.append(x);return x;}
function layout(title){clearInterval(poll);cancelTransition();if(retryVoiceURL){URL.revokeObjectURL(retryVoiceURL);retryVoiceURL=null;}epoch++;diagnostic('screen_enter',{screen:s?.screen});el.replaceChildren();body=document.createElement('section');body.className='scene';el.append(body);text('h1',title);actions=document.createElement('div');actions.className='actions';secondary=document.createElement('div');secondary.className='secondary-slot';el.append(actions,secondary);}
function action(label,fn,kind='learning'){actions.replaceChildren();const b=document.createElement('button');b.className='primary';b.textContent=label;b.onclick=safe(async()=>{await log('CLICK',{click_type:kind,action:label});await fn()});actions.append(b);return b;}
function second(label,fn){secondary.replaceChildren();const b=document.createElement('button');b.className='quiet';b.textContent=label;b.onclick=safe(async()=>{if(playing)return;cancelTransition();await log('CLICK',{click_type:'learning',action:label});await fn()});secondary.append(b);return b;}
function picture(w,cls=''){const im=document.createElement('img');im.src='./course/assets/'+(w==='water'?'p01.png':'p02.png');im.alt='饮品图片';im.className='picture '+cls;im.onerror=()=>fail(Error('image_failed'));body.append(im);return im;}
function pairs(callback,ready=true){const box=document.createElement('fieldset');box.className='choices primary-choice';box.setAttribute('aria-label','选一杯');for(const w of (Math.random()<.5?['water','tea']:['tea','water'])){const b=document.createElement('button');b.className='choice';b.disabled=!ready;b.setAttribute('aria-label','选择这杯');const im=document.createElement('img');im.src='./course/assets/'+(w==='water'?'p01.png':'p02.png');im.alt='饮品';b.append(im);b.onclick=safe(async()=>{box.querySelectorAll('button').forEach(x=>x.disabled=true);await log('CLICK',{click_type:'learning',action:'choose_picture'});try{await callback(w)}catch(e){box.querySelectorAll('button').forEach(x=>x.disabled=false);throw e}});box.append(b)}body.append(box);return box;}
function later(fn,ms=1400){cancelTransition();pendingTransition={fn,at:epoch,due:Date.now()+ms,id:crypto.randomUUID(),running:false};timer=setTimeout(()=>drainTransition(),ms);}
async function go(n,autoId){if(playing)return;clearInterval(poll);clearTimeout(timer);if(autoId){if(!AUTO_STEPS.includes(autoId))throw Error('invalid auto step');await log('AUTO_ADVANCE',{step:autoId});}await persist({screen:n,played:false});await render();}
async function playRaw(id,manual=false){
 if(playing)throw Error('audio_busy');playing=true;
 try{const src=id==='TEST'?'./course/assets/TEST.wav':'./course/'+manifest.find(x=>x.audio_id===id).file_name;
 const result=await player.play(src,{id,manual});await log('AUDIO_PLAY',{audio_id:id,audio_quality:manifest.find(x=>x.audio_id===id)?.status||'device',duration:Number.isFinite(result.duration)?result.duration:null});await persist({last_play:{audio_id:id,at:Date.now()},played:true});}finally{playing=false;}
}
async function playThen(id,next,manual=false){const at=epoch;try{await playRaw(id,manual);if(at===epoch){diagnostic('transition_requested',{audio_id:id,transition_id:'audio:'+at});await next();diagnostic('transition_completed',{audio_id:id,transition_id:'audio:'+at});}}catch(e){if(at!==epoch)return;await log(e.name==='NotAllowedError'?'AUTOPLAY_BLOCKED':'DEVICE_ISSUE',{device_issue:e.name==='NotAllowedError'?null:e.message,audio_id:id});const b=action('听',()=>{});b.onclick=safe(()=>{const task=playThen(id,next,true);diagnostic('CLICK',{click_type:'learning',action:'听'});return task;});}}
async function ownPlayback(a,next,manual=false,preparedURL=null){
 let url=preparedURL,keepURL=false;if(preparedURL)retryVoiceURL=null;const at=epoch;let completed=false;
 const advance=async()=>{if(completed||at!==epoch)return;completed=true;diagnostic('transition_requested',{attempt_id:a.attempt_id});if(next)await next();diagnostic('transition_completed',{attempt_id:a.attempt_id});};
 const retry=()=>{keepURL=!!url;retryVoiceURL=url;const b=action('再试一次',()=>{});b.onclick=safe(()=>ownPlayback(a,next,true,url));};
 try{if(!url){const r=await fetch('./api/recording/'+a.attempt_id);if(!r.ok)throw Error('recording_missing');const blob=await r.blob();if(blob.size<256)throw Error('recording_missing');url=URL.createObjectURL(blob);}
 playing=true;diagnostic('recording_playback_started',{attempt_id:a.attempt_id});await player.play(url,{id:'own_voice',manual});playing=false;
 diagnostic('recording_playback_ended',{attempt_id:a.attempt_id});await log('SELF_PLAYBACK',{attempt_id:a.attempt_id});
 if(next){action('继续',advance,'recovery');later(advance,650);}
 }catch(e){playing=false;await log('DEVICE_ISSUE',{device_issue:e.message});if(at===epoch){notice.textContent=e.message==='recording_missing'?'这次声音没有保存完整，请重新说一次。':'没能完整播放，请再试一次。';if(e.message==='recording_missing')action('再试一次',recoverAndRender,'recovery');else retry();}}
 finally{playing=false;player.release();if(url&&!keepURL)URL.revokeObjectURL(url);}
}
function micFailure(e,mode){
 recordBusy=false;diagnostic(e.name==='NotAllowedError'?'mic_denied':'mic_error',{reason:e.message,name:e.name});
 const messages={media_devices_unavailable:'这里暂时不能使用麦克风，请用Safari打开。',recorder_unsupported:'这里暂时不能录音，请用Safari打开。',no_audio_track:'没有取得麦克风，请关闭其他录音应用后再试。',permission_unavailable:'还没有收到麦克风许可，请留意权限提示，再试一次。',empty_recording:'没有录到完整声音，请重新说一次。',recording_interrupted:'刚才的录音中断了，请重新说一次。'};
 notice.textContent=e.name==='NotAllowedError'?'麦克风被拒绝。请在Safari此网站的设置中允许麦克风，再重试。':messages[e.message]||'麦克风暂时没准备好，请关闭其他录音应用后再试。';
 recordControl(mode,'点一下开始');if(standalone())second('用Safari完成本次声音测试',safariFallback);
}
async function safariFallback(){capture.cancel();layout('用Safari继续');text('p','点下方网址，用Safari打开。若仍在此应用，请复制网址到Safari。');const a=text('a','打开Safari');a.href=new URL('./',location.href).href;a.target='_blank';a.rel='noopener';text('p',a.href);text('p','若Safari中没有课件，请导入原课件ZIP。两处进度可能分开，可先保存进度，再在Safari首页恢复。');action('保存进度',exportResults,'recovery');second('返回学习',recoverAndRender);}
function recordControl(mode,label){
 const at=epoch,b=action('点一下开始',()=>{});b.classList.add('hold');b.onclick=null;
 const start=async()=>{if(playing||recordBusy)return;recordBusy=true;
  try{await capture.start();if(at!==epoch)return;await persist({recording_active:true});}catch(e){if(at===epoch){capture.cancel();recordBusy=false;}throw e;}};
 const stop=async()=>{try{const p=await capture.stop();pendingBlob={...p,mode,client_record_id:crypto.randomUUID()};await storePending();}catch(e){recordBusy=false;await persist({recording_active:false});throw e;}};
 capture.onUnexpected=e=>{recordBusy=false;persist({recording_active:false}).then(()=>micFailure(e,mode)).catch(fail);};
 bindHold(b,{start,stop,onError:e=>{if(at===epoch)micFailure(e,mode);},mode:'tap',onAction:()=>diagnostic('CLICK',{click_type:'learning',action:'tap_'+mode})});
}
async function storePending(){try{const p=pendingBlob;if(!p)return;
 if(!p.saved&&LOCAL)p.saved=await saveRecording({client_record_id:p.client_record_id,blob:p.blob,mime:p.blob.type,mode:p.mode,duration:p.duration});
 if(!p.saved){const b64=await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result.split(',')[1]);f.onerror=reject;f.readAsDataURL(p.blob)});p.saved=await api('record',{client_record_id:p.client_record_id,audio:b64,mime:p.blob.type,mode:p.mode,duration:p.duration});}
 s=await api('state');recordBusy=false;pendingBlob=null;chunks=[];rec=null;stream=null;await afterRecord(p.saved);
 }catch(e){recordBusy=false;notice.textContent='暂时没存好，请不要关闭页面。';action('再试一次',storePending,'recovery');await log('DEVICE_ISSUE',{device_issue:e.message}).catch(()=>{});}}
async function afterRecord(a){
 if(a.mode==='S'){await log('AUTO_ADVANCE',{step:'speaking_saved_submitted'});return send(a);}
 if(a.mode==='DEVICE'){layout('听听刚才的声音');return ownPlayback(a,()=>go(3,'device_replay'));}
 if(a.screen===7)return go(8,'echo_word_saved');
 layout('对方递来了饮品');picture('water');await playThen('A04',()=>go(9,'echo_request_saved'));
}
async function listen(){const t=s.trial;const id=t.target==='water'?'A01':'A02';await playThen(id,async()=>{t.plays++;t.first_play=true;t.replay_count=Math.max(0,t.plays-1);t.audio_id=id;t.heard_at=Date.now();await persist({trial:t});await log('L_PLAY',{modality:'L',trial_id:t.trial_id,target:t.target,audio_id:id,first_attempt:t.plays===1,replay_count:t.replay_count});showListeningChoices();});}
function showListeningChoices(){layout('听到了什么？');pairs(answer);second('再听一次',async()=>{layout('听');await listen()});}
async function answer(w){const done=completeTrial(s.trial,w,Date.now());await log('L_ACTION',{modality:'L',...done,independent_support:done.help_used?'supported':'independent'});await persist({trials:[...s.trials,done],trial:done,trial_feedback:true});layout(done.correct?'递对了':'再听一次');picture(w);if(done.correct)later(nextTrial,1800);else if((s.trial_repair||0)<2)later(listenRepair,1800);else later(nextTrial,1900);}
async function nextTrial(){const count=new Set(s.trials.map(t=>t.trial_id)).size;await log('AUTO_ADVANCE',{step:count>=2?'listening_2_feedback':'listening_1_feedback'});if(count>=2)return go(7);await persist({trial:newTrial(),trial_feedback:false,trial_repair:0});layout('听');await listen();}
async function listenRepair(){const t=s.trial;const count=(s.trial_repair||0)+1;await persist({trial_feedback:false,trial_repair:count});if(count===1){layout('再听一次');return listen();}t.help_used=true;s=await api('repair',{repair_type:'L_meaning_sound',scope:'L',support_level:'answer_audio_image',before_attempt:t.trial_id,after_attempt:t.trial_id,answer_help:false});await persist({trial:t});layout('看一眼，听一次');picture(t.target);text('p',t.target==='water'?'这是水。':'这是茶。');await playThen(t.target==='water'?'A01':'A02',async()=>{later(async()=>{layout('听');await listen()},1200)});}
async function helpSpeaking(){s=await api('repair',{repair_type:'S_retrieval',answer_help:true,scope:'S',support_level:'answer_audio',after_attempt:null});layout('听一次，再试着说');picture(s.learner_private_state.secret_choice);await playThen(s.learner_private_state.secret_choice==='water'?'A01':'A02',()=>go(11));}
async function send(a){await api('submit',{attempt_id:a.attempt_id});await persist({screen:12});await renderWait(a);}
async function renderWait(a){diagnostic('listener_pending',{attempt_id:a.attempt_id});layout('对方正在听');text('p',LOCAL?'有协助者时，让对方只听这次声音；如果现在只有你自己，可以做单人自测。':'稍等一下。');if(LOCAL){action('让协助者听',()=>{location.href='./pilot.html?mode=helper'},'navigation');second('没有协助者：单人自测',()=>{location.href='./pilot.html?mode=self'});}else second('听听自己',()=>ownPlayback(a));let checking=true;poll=setInterval(async()=>{if(checking||playing)return;checking=true;try{await check(a)}catch(e){notice.textContent='还在等待，进度已保存。';}finally{checking=false}},1800);try{await check(a)}finally{checking=false;}}
async function check(a){const r=await api('result/'+a.attempt_id);if(r.result){diagnostic('listener_closed',{attempt_id:a.attempt_id});clearInterval(poll);await log('AUTO_ADVANCE',{step:'listener_result'});s=await api('state');await persist({screen:13});await renderResult(r);}}
async function renderResult(a){const r=a.result;const served=['water','tea'].includes(r.listener_action);layout(served?'对方拿来了这杯':'对方没听清');if(served)picture(r.listener_action);else picture(s.learner_private_state.secret_choice,'cue');const last=s.attempts.filter(x=>x.mode==='S').length>=3;const success=r.action_matches_intent===true&&!r.requested_repeat;if(success||last){const finish=async()=>{s=await api('settle',{});diagnostic('evidence_settled');await log('AUTO_ADVANCE',{step:'evidence_settled'});s=await api('end',{});diagnostic('pilot_end');await log('AUTO_ADVANCE',{step:'pilot_ended'});await render()};if(served)await playThen('A04',()=>{later(finish,1400)});else later(finish,1800);return;}
 layout(served?'再说一次你想要的':'对方没听清');picture(s.learner_private_state.secret_choice,'cue');await log('AUTO_ADVANCE',{step:'listener_repeat_prepared'});s=await api('repair',{repair_type:'listener_repeat',scope:'S',answer_help:false,support_level:'none',after_attempt:null});await persist({screen:11});recordControl('S','再说一次');second('听一次提示',helpSpeaking);
}
async function finish(){capture.cancel();player.release();const lastS=s.attempts.filter(a=>a.mode==='S'&&a.result).at(-1),selfCheck=lastS?.result?.adapter==='self_check';layout(s.final_outcome?.endsWith('_success')?'完成':selfCheck?'单人自测完成':'今天先到这里');text('p',s.final_outcome==='independent_success'?'这次，你自己说出了想要的饮品。':s.final_outcome==='supported_success'?'这次，你借助提示说出了想要的饮品。':selfCheck?'这次只完成了单人自测，不计独立口语证据；以后有真实听者时再验证。':'已保存尝试，下次再试。');second('下载本次记录',exportResults);}
async function exportResults(){return exportState();}
async function render(){
 const n=s.screen;const library=document.querySelector('#library-link');if(library)library.hidden=!(LOCAL&&(n===0||s.ended));
 if(n===0){layout('你的第一杯饮品');text('p','听，选，再试着说。');const b=action('开始Day1',async()=>{},'navigation');b.onclick=safe(async()=>{audio.src='./course/assets/TEST.wav';const priming=audio.play().then(()=>audio.pause()).catch(()=>{});s=await api('start',{});await priming;await log('CLICK',{click_type:'navigation',action:'start_day1'});await render()});return;}
 if(n===1){layout('听听声音');second('没听到',async()=>{await log('DEVICE_ISSUE',{device_issue:'output_not_heard'});layout('检查一下音量，再听');action('听',()=>playThen('TEST',()=>{later(()=>go(2,'sound_check'),1600)}))});await playThen('TEST',()=>{later(()=>go(2,'sound_check'),1600)});return;}
 if(n===2){layout('试一下声音');text('p','说“准备好了”。');const old=s.attempts.filter(a=>a.mode==='DEVICE').at(-1);if(old){if(old.audio_deleted)return go(3,'device_replay');await ownPlayback(old,()=>go(3,'device_replay'));}else recordControl('DEVICE','按住说话');return;}
 if(n===3||n===4){const id=n===3?'A01':'A02';layout(n===3?'这是水':'这是茶');picture(n===3?'water':'tea');const advance=()=>later(()=>go(n+1,n===3?'meaning_water':'meaning_tea'),3000);second('再听一次',()=>playThen(id,advance));await playThen(id,advance);return;}
 if(n===5){await persist({trial:newTrial(),trial_feedback:false,trial_repair:0});return go(6,'listening_intro');}
 if(n===6){if(s.trial_feedback){layout(s.trial.correct?'递对了':'再听一次');picture(s.trial.learner_action);later(s.trial.correct||(s.trial_repair||0)>=2?nextTrial:listenRepair,1600);}else{layout('听');await listen();}return;}
 if(n===7||n===8){layout('听完，跟着说一次');picture('water');const old=s.attempts.filter(a=>a.mode==='ECHO'&&a.screen===n).at(-1);if(old)return afterRecord(old);await playThen(n===7?'A01':'A03',async()=>{recordControl('ECHO','按住跟着说一次');});return;}
 if(n===9){layout('现在，选你真正想要的');later(()=>go(10,'model_withdrawn'),2400);return;}
 if(n===10){if(s.learner_private_state.locked)return go(11,'choice_locked');layout('选你真正想要的');pairs(async w=>{s=await api('choice',{choice:w});await go(11,'choice_locked')});return;}
 if(n===11){const pending=s.attempts.filter(a=>a.mode==='S'&&!a.result).at(-1);if(pending)return send(pending);layout('说给对方听');picture(s.learner_private_state.secret_choice,'cue');await log('MEANING_CUE',{meaning_cue_visible:true});recordControl('S','按住说给对方听');second('听一次提示',helpSpeaking);return;}
 if(n===12){const a=s.attempts.filter(a=>a.mode==='S').at(-1);if(a)return a.ticket?renderWait(a):send(a);}
 if(n===13){const a=s.attempts.filter(a=>a.result).at(-1);if(a)return renderResult(a);}
 if(n===15&&s.ended&&s.final_evidence_settled&&s.listener_closed)return finish();
}
 const pauseButton=document.querySelector('#exit');if(pauseButton)pauseButton.onclick=safe(async()=>{if(playing){notice.textContent='听完这段声音后，可以暂停。';return}if(recordBusy){notice.textContent='先点一下结束录音。';return}clearTimeout(timer);clearInterval(poll);epoch++;player.stop();capture.closeStream();audio.pause();playing=false;await log('PILOT_PAUSE');layout('进度已保存');action('继续学习',async()=>{s=await api('state');await log('PILOT_RESUME');await render()},'navigation');});
 async function recoverAndRender(){if(restoring)return;restoring=true;try{capture.cancel();player.release();playing=false;recordBusy=false;cancelTransition();s=await api('recover',{});await render();}finally{restoring=false;}}
 async function boot(){manifest=await (await fetch('./course/audio_manifest.json')).json();s=await api('recover',{});diagnostic('app_started',{shell_version:'1.1.0-rc.3'});diagnostic('pwa_mode',{standalone:standalone()});diagnostic(navigator.onLine===false?'offline':'online');await render();}
 safe(async()=>{try{if(LOCAL&&!globalThis.isSecureContext)throw Error('请使用HTTPS测试入口。');await boot();}catch(e){layout('暂时不能开始');notice.textContent='请回到课程首页，联网完成准备后再试。';action('返回课程',()=>{location.href='./index.html'},'recovery');}})();
 // Media cannot survive a closed document. Live interruption never becomes success.
 function suspend(){clearTimeout(timer);player.stop();capture.cancel();if(recordBusy){recordBusy=false;persist({recording_active:false}).catch(()=>{});}diagnostic('app_suspended');}
 async function resume(){player.check();if(pendingTransition){drainTransition(true);return;}if(!restoring&&!recordBusy&&!playing&&s)await recoverAndRender();}
 document.addEventListener?.('visibilitychange',()=>{if(document.hidden)suspend();else resume().catch(fail);});
 window.addEventListener?.('pagehide',suspend);
 window.addEventListener?.('pageshow',e=>{if(e.persisted)resume().catch(fail);});
 window.addEventListener?.('online',()=>diagnostic('online'));window.addEventListener?.('offline',()=>diagnostic('offline'));
 if(LOCAL&&navigator.serviceWorker)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
