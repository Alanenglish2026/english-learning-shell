import {storage} from './storage.js';
import {registry} from './registry.js';
import {sessionOps} from './resume.js';
import {validateActivities,initialDomain} from './activity_protocol.js';
import {normalizeEvidence} from './evidence.js';
import {AudioProfile} from './audio_profile.js';
import {evaluateWriting} from './writing_evaluation.js';
import {createTransition,presentFeedback,visibilityCheckpoint,consumeTransition} from './transition_policy.js';
const uid=()=>crypto.randomUUID();
const now=()=>Date.now();
const speakingPolicy=a=>({active_generation:a.evidence_policy.active_generation,listener_required:a.evidence_policy.listener_required,blind_listener_required:a.evidence_policy.blind_listener_required,self_check_allowed:a.evidence_policy.self_check_allowed});
const currentTurn=(a,run)=>a.type==='interaction'?(a.interaction?.turns||a.task.turns)[run.turn_index||0]:null;
const allowedActions=(a,run)=>a.type==='interaction'?a.task.allowed_actions:(a.task.options||[]).map(x=>x.value);
const privateIntent=(a,run)=>a.type==='interaction'?run.turn_intent:run.private_choice;
function safeEventBase(s,a,id,at){return {id:uid(),unit_id:s.unit_id,session_id:s.session_id,activity_id:id,timestamp:at,evidence_type:null};}
export class ActivityEngine{
 constructor(db=storage,reg=registry){this.db=db;this.registry=reg;this.queue=Promise.resolve();}
 request(session_id,command,data={}){const f=()=>this.execute(session_id,command,data);const p=this.queue.then(f,f);this.queue=p.catch(()=>{});return p;}
 async model(sid){const s=(await this.db.get('critical','session'))?.value;if(!s||s.session_id!==sid||s.lesson_engine!=='activity-v1')throw Error('请从课程目录重新进入。');let cfg=await(await this.registry.response(s.unit_id,'unit_config.json',sid)).json();let list;if(s.session_kind==='review'&&s.validated_probe_snapshot){list=validateActivities([structuredClone(s.validated_probe_snapshot)]);cfg={...cfg,activities:list};}else{list=validateActivities(cfg.activities);}const a=list.find(x=>x.activity_id===s.current_activity_id);return {s,cfg,list,a};}
 async execute(sid,command,d={}){
  const {s,list,a}=await this.model(sid);if(command==='state'){if(!a&&s.status==='completed')return {session:s,activity:null,run:null};if(!a)throw Error('这节课需要重新连接。');const run=s.activity_runs?.[a.activity_id]||{};return {session:s,activity:a,run,turn:currentTurn(a,run)};}
  // Consumed transition tokens remain queryable across turn/activity boundaries so auto/manual races are idempotent.
  if(command==='advance'&&d.token&&s.consumed_transitions?.[d.token])return {...s.consumed_transitions[d.token],idempotent:true};
  // terminal idempotent transition query must precede generic terminal rejection
  if(s.status==='completed'&&command==='advance'&&s.transition?.completed&&d.token===s.transition.token)return {completed:true,idempotent:true};
  if(['completed','abandoned'].includes(s.status))throw Error('本次已结束，请返回课程目录。');if(!a)throw Error('这节课需要重新连接。');
  const revision=s.revision||0,ops=[],at=now(),id=a.activity_id;s.activity_runs ||= {};s.attempts ||= [];const run=s.activity_runs[id] ||= {attempt_index:0,turn_index:0,support_level:'independent',started_at:at,type:a.type,status:initialDomain(a),language_item_id:a.extensions?.target_key||null};
  const turn=currentTurn(a,run),turnId=turn?.turn_id||null;
  const log=(type,extra={})=>ops.push({store:'events',value:{...safeEventBase(s,a,id,at),evidence_type:type,turn_id:turnId,...extra}});
  const audioManifest=async()=>await(await this.registry.response(s.unit_id,'audio_manifest.json',sid)).json();
  const audioAsset=async audioId=>{const m=await audioManifest(),x=m.find(v=>v.audio_id===audioId);if(!x)throw Error('这段声音需要重新连接。');return x;};
  const desiredAudio=()=>run.audio_id||turn?.input?.audio_id||a.input.audio_id;
  const finishActivity=()=>{if(a.next){s.current_activity_id=a.next;const next=list.find(x=>x.activity_id===a.next);s.current_domain_state=initialDomain(next);s.last_safe_checkpoint=a.next;}else{s.status='completed';s.current_activity_id='completed';s.current_domain_state='session_completed';s.last_safe_checkpoint='completed';s.completed_at=Date.now()/1000;s.ended=true;}};
  const createEvidence=(correct,extra={})=>{const evidence=normalizeEvidence({unit_id:s.unit_id,session_id:sid,activity_id:id,source_activity_id:s.source_activity_id||id,language_item_id:extra.language_item_id||run.language_item_id||null,target_action:extra.target_action||privateIntent(a,run)||null,capability:a.capability,modality:a.capability,activity_type:a.type,attempt_index:extra.attempt_index??run.attempt_index,turn_id:turnId,correct,support_level:run.support_level,latency:Math.max(0,at-run.started_at),audio_profile:run.audio_profile,evidence_policy_snapshot:a.capability==='S'?speakingPolicy(a):null,review_generation:s.review_generation||null,...extra});run.last_evidence=evidence;run.status='evidence_settled';s.current_domain_state='evidence_settled';s.final_evidence_settled=true;log('ACTIVITY_RESULT',evidence);const result_id=uid();run.result_id=result_id;s.transition=createTransition(a.transition_policy,{session_id:sid,activity_id:id,turn_id:turnId,result_id});return evidence;};
  const persist=async answer=>{s.updated_at=Date.now();s.revision=revision+1;ops.push(...sessionOps(s),{store:'critical',expected_revision:revision,value:{id:'session',value:s}});await this.db.batch(ops);return answer??s;};
  if(command==='start'){s.status='active';s.started_at ||= at/1000;log('PILOT_START');return persist(s);}
  if(command==='audio_played'){const asset=await audioAsset(desiredAudio());run.audio_profile ||= new AudioProfile(asset).condition();if(run.plays)run.audio_profile.replay_count++;const count=a.type==='continuous_listening'&&[1,3,5].includes(d.play_count)?d.play_count:1;run.plays=(run.plays||0)+count;run.audio_completed=true;run.status='listening_active';log('ACTIVITY_AUDIO',{audio_id:asset.audio_id,play_count:count,audio_profile:run.audio_profile});return persist(s);}
  if(command==='support'){if(!a.support_policy.allowed.includes(d.kind))throw Error('此步骤没有这项帮助。');run.support_history ||= [];run.answer_exposure_history ||= [];if(['replay','clear_support','slow_support','text_support'].includes(d.kind)){const asset=await audioAsset(desiredAudio()),p=new AudioProfile(asset);if(run.audio_profile)p.value={...p.value,...run.audio_profile};let supportAsset;if(d.kind==='clear_support'){supportAsset=a.support_policy.clear_audio_id?await audioAsset(a.support_policy.clear_audio_id):asset;if(supportAsset.variant!=='clear_natural')throw Error('本课还没有这段参考声音。');run.audio_id=supportAsset.audio_id;}p.support(d.kind,supportAsset);run.audio_profile=p.condition();run.support_level=p.value.support_level;run.support_history.push({kind:d.kind,audio_id:(supportAsset||asset)?.audio_id||null,at});if(d.kind==='text_support')run.answer_exposure_history.push({kind:'text_support',at});}else{run.support_level='answer_help';run.answer_help=true;run.support_history.push({kind:d.kind,at});run.answer_exposure_history.push({kind:d.kind,at});}run.status='repair_needed';s.current_domain_state='repair_needed';log('REPAIR',{kind:d.kind});return persist(s);}
  if(command==='natural_retest'){run.audio_id=a.input.natural_audio_id||a.input.audio_id;const asset=await audioAsset(run.audio_id),p=new AudioProfile(asset);if(run.audio_profile)p.value={...p.value,...run.audio_profile};run.audio_profile=p.naturalRetest(asset);run.support_level='independent';run.audio_completed=false;run.plays=0;run.answer_help=false;run.status=initialDomain(a);s.current_domain_state=run.status;log('NATURAL_RETEST',{support_history_count:(run.support_history||[]).length,answer_exposure_count:(run.answer_exposure_history||[]).length});return persist(s);}
  if(command==='intent'){
   if(a.capability!=='S')throw Error('当前活动没有私有意图。');const options=a.type==='interaction'?turn?.intent_policy?.options:a.task.options;if(!Array.isArray(options)||!options.some(x=>x.value===d.value))throw Error('请选择当前可用意思。');if(a.type==='interaction'){if(run.turn_intent!==undefined)throw Error('本轮选择已经锁定。');run.turn_intent=d.value;}else{if(run.private_choice!==undefined)throw Error('选择已经锁定。');run.private_choice=d.value;}log('CHOICE_LOCKED',{turn_id:turnId,meaning_cue_visible:true});return persist(s);
  }
  if(command==='recording_start'){if(s.listener_pending)throw Error('请等待对方回应。');s.recording_active=true;s.current_domain_state='recording_active';run.status='recording_active';return persist(s);}
  if(command==='record'){
   if(!['S','ECHO'].includes(a.capability)||s.listener_pending)throw Error('请先完成当前步骤。');
   const clientId=typeof d.client_record_id==='string'&&d.client_record_id.trim()?d.client_record_id.trim():null;
   if(clientId){if(clientId.length>120)throw Error('录音提交标识无效。');const existing=s.attempts.find(x=>x.activity_id===id&&x.turn_id===turnId&&x.client_record_id===clientId);if(existing)return existing;}
   const max=a.completion_policy.max_attempts||3;const inTurn=s.attempts.filter(x=>x.activity_id===id&&x.turn_id===turnId);if(inTurn.length>=max)throw Error('本轮尝试已达到上限。');if(!(d.blob instanceof Blob)||d.blob.size<100||Number(d.duration)<.25)throw Error('声音太短，请再试一次。');if(a.capability==='S'&&privateIntent(a,run)===undefined)throw Error('请先从自己的意思开始。');
   const attempt={attempt_id:uid(),client_record_id:clientId,activity_id:id,turn_id:turnId,attempt_index:inTurn.length+1,mode:a.capability,duration:Number(d.duration),support_state:run.support_level,active_generation:a.capability==='S'&&a.evidence_policy.active_generation===true,meaning_cue_visible:true,timestamp:at};run.attempt_index=attempt.attempt_index;s.attempts.push(attempt);s.pending_attempt_id=attempt.attempt_id;s.recording_active=false;s.current_domain_state='recording_complete';run.status='recording_complete';ops.push({store:'media',value:{id:attempt.attempt_id,session_id:sid,unit_id:s.unit_id,blob:d.blob,lifecycle:'RAW_CURRENT_ATTEMPTS'}});log('RECORD_SAVED',{attempt_id:attempt.attempt_id,attempt_index:attempt.attempt_index,modality:a.capability});return persist(attempt);
  }
  if(command==='self_playback'){
   const attempt=s.attempts.find(x=>x.attempt_id===s.pending_attempt_id&&!x.result);if(!attempt||!await this.db.get('media',attempt.attempt_id))throw Error('请重新说一次。');attempt.playback_completed=true;
   if(a.capability==='ECHO'){attempt.result={echo_completed:true};createEvidence(true,{attempt_index:attempt.attempt_index,active_generation:false});ops.push({store:'media',id:attempt.attempt_id,delete:true});attempt.audio_deleted=true;s.pending_attempt_id=null;return persist(s);}
   attempt.ticket ||= uid();attempt.ticket_attempt_id=attempt.attempt_id;s.listener_pending=true;s.current_domain_state='listener_pending';run.status='listener_pending';return persist({attempt_id:attempt.attempt_id,ticket:attempt.ticket});
  }
  if(command==='listener_open'){
   const attempt=s.attempts.find(x=>x.attempt_id===s.pending_attempt_id&&!x.result);if(!attempt||attempt.mode!=='S'||!attempt.ticket||attempt.ticket_attempt_id!==attempt.attempt_id||!await this.db.get('media',attempt.attempt_id))throw Error('当前录音不能交给听者。');attempt.receipt=uid();attempt.receipt_issued_at=at;return persist({attempt_id:attempt.attempt_id,ticket:attempt.ticket,receipt:attempt.receipt,allowed_actions:[...new Set([...allowedActions(a,run),'repeat','no_action'])]});
  }
  if(command==='listener_cancel'){const attempt=s.attempts.find(x=>x.attempt_id===d.attempt_id&&!x.result);if(attempt?.receipt===d.receipt){delete attempt.receipt;delete attempt.receipt_issued_at;}return persist({cancelled:true});}
  if(command==='listener_result'||command==='self_result'){
   const isSelf=command==='self_result';const attempt=s.attempts.find(x=>x.attempt_id===d.attempt_id&&!x.result);if(!attempt||attempt.mode!=='S'||attempt.ticket!==d.ticket||attempt.ticket_attempt_id!==d.attempt_id)throw Error('这次回应不属于当前录音。');if(!isSelf&&(!d.receipt||attempt.receipt!==d.receipt))throw Error('听者凭证已失效。');
   const action=d.action||d.listener_action,allowed=[...new Set([...allowedActions(a,run),'repeat','no_action'])];if(!allowed.includes(action))throw Error('听者动作无效。');if(!isSelf&&(!d.audio_listened||d.blind_attested!==true||d.non_learner_attested!==true))throw Error('盲听声明不完整。');if(isSelf&&!a.evidence_policy.self_check_allowed)throw Error('本活动不允许单人核对。');
   const match=action===privateIntent(a,run),repeat=action==='repeat'||action==='no_action';attempt.result={adapter:isSelf?'self_check':'human_blind',listener_action:action,audio_listened:isSelf?true:true,blind_attested:isSelf?false:true,non_learner_attested:isSelf?false:true,listener_isolated:isSelf?false:true,action_matches_intent:match,locked_at:at};delete attempt.receipt;s.listener_pending=false;
   const max=a.completion_policy.max_attempts||3,inTurn=s.attempts.filter(x=>x.activity_id===id&&x.turn_id===turnId);
   if(repeat&&!isSelf&&inTurn.length<max){s.current_domain_state='repair_needed';run.status='repair_needed';s.pending_attempt_id=null;ops.push({store:'media',id:attempt.attempt_id,delete:true});attempt.audio_deleted=true;log('REPAIR',{kind:'listener_repeat',attempt_id:attempt.attempt_id});return persist({repeat:true});}
   s.listener_handoff_pending=!isSelf;const evidence=createEvidence(match&&!repeat,{attempt_index:attempt.attempt_index,active_generation:attempt.active_generation,adapter:isSelf?'self_check':'human_blind',blind_attested:!isSelf,non_learner_attested:!isSelf,audio_listened:true,listener_closed:true,listener_isolated:!isSelf,evidence_source:isSelf?'listener_function_test':'human_blind_plan_b'});ops.push({store:'media',id:attempt.attempt_id,delete:true});attempt.audio_deleted=true;s.pending_attempt_id=null;return persist({evidence,repeat:false});
  }
  if(command==='answer'){
   if(a.capability==='S'||a.capability==='ECHO')throw Error('请说出来。');if((a.capability==='L'||a.type==='writing_dictation')&&!run.audio_completed)throw Error('请先听一下。');let extra={},correct=false;if(a.capability==='W'){const w=evaluateWriting(a,d.value);correct=w.correct;extra={...w,active_generation:a.type!=='writing_sentence_build',provided_tokens:a.type==='writing_sentence_build',generation_mode:a.type==='writing_sentence_build'?'constrained':'free',copied:run.answer_help===true};}else{const value=String(d.value??'');correct=value===String(a.task.answer);extra={learner_action:value,active_generation:true,copied:run.answer_help===true};}const e=createEvidence(correct,extra);return persist(e);
  }
  if(command==='exposure_complete'){if(a.type!=='continuous_listening'||!run.audio_completed)throw Error('请先完整听一次。');const e=createEvidence(null,{comprehension_tested:false,active_generation:false});return persist(e);}
  if(command==='listener_handoff_complete'){s.listener_handoff_pending=false;return persist({ok:true});}
  if(command==='feedback_presented'){if(s.listener_handoff_pending)throw Error('请先把设备交还学习者。');if(!s.transition||s.transition.activity_id!==id)throw Error('没有待显示反馈。');presentFeedback(s.transition,d.monotonic_now);return persist(s.transition);}
  if(command==='feedback_visibility'){if(!s.transition)throw Error('没有待显示反馈。');visibilityCheckpoint(s.transition,{visible:!!d.visible,now:d.monotonic_now});return persist(s.transition);}
  if(command==='advance'){
   if(!s.transition)throw Error('还没有可推进结果。');const consumed=consumeTransition(s.transition,d.token,d.trigger||'manual',d.monotonic_now);if(consumed.idempotent)return persist({completed:s.status==='completed',idempotent:true});
   if(a.type==='interaction'){
    const turns=a.interaction?.turns||a.task.turns;if((run.turn_index||0)<turns.length-1){run.turn_index=(run.turn_index||0)+1;run.turn_intent=undefined;run.support_level='independent';run.answer_help=false;run.started_at=at;run.status='speaking_ready';s.current_domain_state='speaking_ready';s.final_evidence_settled=false;s.consumed_transitions ||= {};s.consumed_transitions[d.token]={completed:false,next_turn:run.turn_index,activity_id:id};s.transition=null;return persist({next_turn:run.turn_index});}
   }
   const consumedTransition=s.transition;finishActivity();s.consumed_transitions ||= {};s.consumed_transitions[d.token]={completed:s.status==='completed',activity_id:s.current_activity_id};const keys=Object.keys(s.consumed_transitions);for(const k of keys.slice(0,Math.max(0,keys.length-20)))delete s.consumed_transitions[k];s.transition=s.status==='completed'?consumedTransition:null;return persist({completed:s.status==='completed',activity_id:s.current_activity_id});
  }
  throw Error('不支持的Activity操作。');
 }
}
export const activityEngine=new ActivityEngine();
