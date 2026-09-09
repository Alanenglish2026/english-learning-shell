import {storage,sha256} from './storage.js';
export const RUNTIME_BUILD='1.1.0-rc.5';
export function source(r){return r.test_only?'listener_function_test':r.adapter==='manual_external_gpt'?'manual_external_gpt_listener':r.blind_attested===true?'human_blind_plan_b':'unverified_listener';}
export function classify(a){const r=a.result;if(r.test_only)return 'test_only';if(r.blind_attested!==true||!a.active_generation||r.adapter==='manual_external_gpt')return 'uncertain';if(!r.action_matches_intent)return 'unsuccessful';return a.support_state==='independent'?'independent_success':'supported_success';}
const uid=()=>crypto.randomUUID(),now=()=>Date.now()/1000;
const freshSession=()=>({runtime_version:3,session_id:uid(),unit_id:'U01',screen:0,session_created_at:now(),pilot_started_at:null,learner_private_state:{},trials:[],attempts:[],support:'independent',repairs:[],ended:false,meaning_cue_visible:false,review_queue:[],recording_active:false,final_evidence_settled:false,listener_closed:false,listener_pending:false,speaking_pending:false});
export function reconcile(s){
 s.attempts ||= [];s.trials ||= [];s.repairs ||= [];s.learner_private_state ||= {};s.review_queue ||= [];
 const attempts=s.attempts.filter(a=>a.mode==='S');
 for(const a of attempts)if(a.result){a.result.evidence_source=source(a.result);a.evidence_status=classify(a);}
 const pending=attempts.filter(a=>!a.result);
 s.speaking_pending=!!pending.length||!!(s.learner_private_state.locked&&!attempts.length);
 s.listener_pending=!!pending.length;
 s.listener_closed=!!attempts.length&&!pending.length&&!s.recording_active;
 if(!s.listener_closed)s.final_evidence_settled=false;
 if(!(s.listener_closed&&s.final_evidence_settled))s.ended=false;
 if(s.ended)s.screen=15;
 else if(s.screen===15)s.screen=pending.length?12:attempts.some(a=>a.result)?13:0;
 return s;
}
export class LocalRuntime {
 constructor(db=storage){this.db=db;this.queue=Promise.resolve();}
 request(path,data){const work=()=>this.execute(path,data);const job=this.queue.then(work,work);this.queue=job.catch(()=>{});return job;}
 async execute(path,d={}){
  let s=(await this.db.get('critical','session'))?.value||freshSession();reconcile(s);const revision=s.revision||0;let answer,ops=[];
  const event=(kind,extra={})=>ops.push({store:'events',value:{id:uid(),session_id:s.session_id,trial_id:null,timestamp:now(),node_id:null,modality:null,target:null,support_level:'none',first_attempt:null,replay_count:0,learner_action:null,learner_audio:null,listener_action:null,correct:null,latency:null,independent_support:'not_applicable',device_issue:null,notes:'',evidence_type:kind,...extra}});
  if(path==='new-session'){
   const oldId=s.session_id,oldOutcome=s.final_outcome||null,oldEnded=!!s.ended;
   ops.push({store:'events',value:{id:uid(),session_id:oldId,trial_id:null,timestamp:now(),node_id:null,modality:null,target:null,support_level:'none',first_attempt:null,replay_count:0,learner_action:null,learner_audio:null,listener_action:null,correct:null,latency:null,independent_support:'not_applicable',device_issue:null,notes:d.reason||'learner_restart',evidence_type:'SESSION_RESET',previous_ended:oldEnded,previous_outcome:oldOutcome}});
   for await(const row of this.db.iterate('media'))ops.push({store:'media',delete:true,id:row.id});
   for await(const row of this.db.iterate('temporary'))ops.push({store:'temporary',delete:true,id:row.id});
   const ns=freshSession();ns.revision=revision+1;ops.push({store:'critical',expected_revision:revision,value:{id:'session',value:ns}});await this.db.batch(ops);return ns;
  }
  if(path==='recover'){
   const corruptNonS=[];
   for(const a of s.attempts)if(a.mode!=='S'&&a.result){corruptNonS.push(a.attempt_id);delete a.result;delete a.evidence_status;}
   const lost=[];const wasRecording=s.recording_active;s.recording_active=false;
   for(const a of s.attempts){if(a.result||a.audio_deleted)continue;const m=await this.db.get('media',a.attempt_id);if(!m?.blob?.size)lost.push(a);}
   if(lost.length){s.interrupted_attempts=[...(s.interrupted_attempts||[]),...lost.map(a=>({...a,ticket:undefined,recovery_reason:'temporary_audio_missing'}))];s.attempts=s.attempts.filter(a=>!lost.includes(a));}
   const pending=s.attempts.filter(a=>a.mode==='S'&&!a.result);
   const repairedTickets=[];for(const a of pending)if(!a.ticket){a.ticket=uid();repairedTickets.push(a.attempt_id);}
   const lastSResult=s.attempts.filter(a=>a.mode==='S'&&a.result).at(-1);
   reconcile(s);
   if(!s.ended){
    if(lost.some(a=>a.mode==='S'))s.screen=11;
    else if(pending.length)s.screen=12;
    else if(s.screen===12||s.screen===13)s.screen=lastSResult?13:11;
    if(s.screen===2&&s.attempts.some(a=>a.mode==='DEVICE'&&a.audio_deleted))s.screen=3;
    if(!Number.isInteger(s.screen)||s.screen<0||s.screen>15)s.screen=0;
   } else s.screen=15;
   if(corruptNonS.length||lost.length||wasRecording||repairedTickets.length)event('safe_recovery_used',{corrupt_non_s_results:corruptNonS,attempt_ids:lost.map(a=>a.attempt_id),repaired_tickets:repairedTickets,recording_interrupted:!!wasRecording,screen:s.screen});
  }
  else if(path==='state'&&d){if('ended'in d||d.screen===15)throw Error('交流结算后才能完成。');for(const k of ['screen','trial','trials','meaning_cue_visible','last_play','played','recording_active','trial_feedback','trial_repair'])if(k in d)s[k]=d[k];}
  else if(path==='start'){if(s.ended)throw Error('本次已经完成，请从课程首页选择“再学一次”。');if(s.pilot_started_at===null){s.pilot_started_at=now();event('PILOT_START');}if(s.screen===0)s.screen=1;}
  else if(path==='event'){if(['PILOT_START','PILOT_END','FINAL_EVIDENCE_SETTLED'].includes(d.evidence_type))throw Error('完成由系统结算。');const {evidence_type,...extra}=d;event(evidence_type,extra);}
  else if(path==='choice'){if(s.learner_private_state.locked||!['water','tea'].includes(d.choice))throw Error('选择已经锁定。');s.learner_private_state={secret_choice:d.choice,locked:true,timestamp:now()};s.meaning_cue_visible=true;event('CHOICE_LOCKED',{target:d.choice,meaning_cue_visible:true});}
  else if(path==='repair'){const current=s.attempts.filter(a=>a.mode==='S');if(s.ended||d.scope==='S'&&(s.listener_pending||current.length>=3))throw Error('请先等待对方回应。');if(d.scope==='S')d.before_attempt=current.at(-1)?.attempt_id||null;const same=s.repairs.find(r=>r.repair_type===d.repair_type&&r.before_attempt===d.before_attempt&&!r.after_attempt);if(!same){if(d.answer_help)s.support='supported';s.repairs.push({...d,timestamp:now()});event('REPAIR',d);}s.final_evidence_settled=false;}
  else if(path==='record'){
   const prior=s.attempts.find(a=>d.client_record_id&&a.client_record_id===d.client_record_id);if(prior)return prior;
   const current=s.attempts.filter(a=>a.mode==='S');if(s.ended||d.mode==='S'&&(s.listener_pending||current.length>=3||!s.learner_private_state.locked))throw Error('请先等待对方回应。');
   const blob=d.blob||new Blob([Uint8Array.from(atob(d.audio),c=>c.charCodeAt(0))],{type:d.mime});if(blob.size<100||d.duration<.25)throw Error('声音太短，请再说一次。');const id=uid();
   const a={attempt_id:id,client_record_id:d.client_record_id,timestamp:now(),audio_file:'recordings/'+id,mime:blob.type,duration:d.duration,mode:d.mode,screen:s.screen,support_state:d.mode==='S'?s.support:d.mode==='ECHO'?'echo':'device',meaning_target:d.mode==='S'?s.learner_private_state.secret_choice:null,meaning_cue_visible:d.mode==='S'&&s.meaning_cue_visible,active_generation:d.mode==='S'&&s.screen===11,sha256:await sha256(blob)};
   ops.push({store:'media',value:{id,blob,sha256:a.sha256,lifecycle:'RAW_CURRENT_ATTEMPTS',critical:true,exported:false,timestamp:a.timestamp}});s.attempts.push(a);s.recording_active=false;for(const repair of s.repairs)if(d.mode==='S'&&repair.scope==='S'&&!repair.after_attempt)repair.after_attempt=id;event('RECORD_SAVED',{attempt_id:id,modality:d.mode,learner_audio:a.audio_file,target:a.meaning_target,independent_support:a.support_state,meaning_cue_visible:a.meaning_cue_visible});answer=a;
  }
  else if(path==='submit'){
   const a=s.attempts.find(a=>a.attempt_id===d.attempt_id&&a.mode==='S'&&!a.result);if(!a)throw Error('这次录音不存在或已经完成。');a.ticket ||= uid();answer={manual:true,attempt_id:a.attempt_id,ticket:a.ticket};
  }
  else if(path==='cancel-pending'){
   const a=s.attempts.find(a=>a.attempt_id===d.attempt_id&&a.mode==='S'&&!a.result);if(!a)throw Error('这次等待已经结束。');
   s.interrupted_attempts=[...(s.interrupted_attempts||[]),{...a,ticket:undefined,recovery_reason:d.reason||'learner_retake'}];
   s.attempts=s.attempts.filter(x=>x!==a);ops.push({store:'media',delete:true,id:a.attempt_id});s.recording_active=false;s.final_evidence_settled=false;s.ended=false;s.screen=11;
   event('PENDING_ATTEMPT_CANCELLED',{attempt_id:a.attempt_id,notes:d.reason||'learner_retake'});answer=s;
  }
  else if(path.startsWith('result/')){answer=s.attempts.find(a=>a.attempt_id===path.split('/')[1]&&a.mode==='S');if(!answer)throw Error('这次口语录音不存在。');}
  else if(path==='listener-return'){
   if(!d.attempt_id||!d.ticket)throw Error('这次回应缺少对应录音，请重新进入当前步骤。');
   const a=s.attempts.find(a=>a.attempt_id===d.attempt_id&&a.ticket===d.ticket&&a.mode==='S'&&!a.result);if(!a)throw Error('回应已锁定或不属于这次口语录音。');const r=d.result;
   if(Object.keys(r).some(k=>!['listener_heard','listener_confidence','listener_action','requested_repeat','blind_attested','audio_listened','adapter','test_only'].includes(k)))throw Error('回应格式无效。');
   if(!r.audio_listened||!['water','tea','repeat','no_action'].includes(r.listener_action)||r.requested_repeat&&r.listener_action!=='repeat')throw Error('请先听清本次声音，再记录行动。');
   if(r.adapter==='self_check'&&r.blind_attested!==false)throw Error('单人自测不能记为独立听者证据。');
   a.result={...r,locked_at:now(),evidence_source:source(r),action_matches_intent:r.listener_action===a.meaning_target};a.evidence_status=classify(a);const media=await this.db.get('media',a.attempt_id);if(media)ops.push({store:'media',value:{...media,lifecycle:'ACTIVE_EVIDENCE_RECORDING',critical:true}});event('S_RESULT',{attempt_id:a.attempt_id,modality:'S',target:a.meaning_target,learner_audio:a.audio_file,listener_action:r.listener_action,correct:a.result.action_matches_intent,result:a.result,notes:a.evidence_status,independent_support:a.support_state});
  }
  else if(path==='settle'){if(!s.listener_closed)throw Error('对方还没回应。');const a=s.attempts.filter(a=>a.mode==='S'&&a.result).at(-1);if(!a)throw Error('还没有可结算的口语结果。');if(!a.result.action_matches_intent&&s.attempts.filter(a=>a.mode==='S').length<3)throw Error('请再说一次。');if(!s.final_evidence_settled){s.final_outcome=a.evidence_status.endsWith('_success')?a.evidence_status:a.evidence_status==='unsuccessful'?'not_yet':'unresolved';s.final_evidence_settled=true;event('FINAL_EVIDENCE_SETTLED',{notes:s.final_outcome});}}
  else if(path==='end'){if(!s.listener_closed||!s.final_evidence_settled||s.pilot_started_at===null)throw Error('交流还没结束。');if(!s.ended){s.ended=true;s.screen=15;s.pilot_ended_at=now();s.elapsed_seconds=s.pilot_ended_at-s.pilot_started_at;event('PILOT_END',{elapsed_seconds:s.elapsed_seconds,pilot_started_at:s.pilot_started_at,notes:s.final_outcome});}}
  else if(path!=='state')throw Error('不支持的本地操作。');
  const cleaned=[];
  for(const a of s.attempts){
   const usedDevice=path==='event'&&d.evidence_type==='SELF_PLAYBACK'&&d.attempt_id===a.attempt_id&&a.mode==='DEVICE';
   const usedEcho=path==='event'&&d.evidence_type==='AUTO_ADVANCE'&&['echo_word_saved','echo_request_saved'].includes(d.step)&&a.mode==='ECHO';
   const judged=a.mode==='S'&&!!a.result;
   if(!a.audio_deleted&&(usedDevice||usedEcho||judged||s.final_evidence_settled||s.ended)){ops.push({store:'media',delete:true,id:a.attempt_id});a.audio_deleted=true;a.audio_deleted_at=now();cleaned.push(a.attempt_id);}
  }
  if(s.ended){for await(const row of this.db.iterate('media'))ops.push({store:'media',delete:true,id:row.id});for await(const row of this.db.iterate('temporary'))ops.push({store:'temporary',delete:true,id:row.id});}
  if(cleaned.length)event('LEARNER_AUDIO_CLEANED',{attempt_ids:cleaned,notes:'temporary learner media only; course assets untouched'});
  reconcile(s);s.revision=revision+1;ops.push({store:'critical',expected_revision:revision,value:{id:'session',value:s}});await this.db.batch(ops);return answer||s;
 }
}
export const runtime=new LocalRuntime();
