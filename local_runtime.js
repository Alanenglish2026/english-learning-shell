import {normalizeEvidence} from './evidence.js';
import {BUILD,SCHEMA,checkBuild} from './build.js';
import {stamp,recoverDomain,sessionOps} from './resume.js';
import {enterLegacyActivity} from './u01_adapter.js';
import {storage,sha256} from './storage.js';
export const RUNTIME_BUILD=BUILD;
export function source(r){return r.test_only||r.adapter==='self_check'?'listener_function_test':r.adapter==='manual_external_gpt'?'manual_external_gpt_listener':r.blind_attested===true?'human_blind_plan_b':'unverified_listener';}
export function classify(a){const r=a.result;if(r.test_only||r.adapter==='self_check')return 'test_only';if(r.blind_attested!==true||!a.active_generation||r.adapter==='manual_external_gpt')return 'uncertain';if(!r.action_matches_intent)return 'unsuccessful';return a.support_state==='independent'?'independent_success':'supported_success';}
const uid=()=>crypto.randomUUID(),now=()=>Date.now()/1000;
const freshSession=(unit='U01',extra={})=>({status:'new',current_activity_id:'course_intro',current_domain_state:'meaning_ready',last_safe_checkpoint:'course_intro',schema_version:SCHEMA,runtime_version:BUILD,session_id:uid(),unit_id:unit,screen:0,session_created_at:now(),pilot_started_at:null,learner_private_state:{},trials:[],attempts:[],support:'independent',repairs:[],ended:false,meaning_cue_visible:false,review_queue:[],recording_active:false,final_evidence_settled:false,listener_closed:false,listener_pending:false,speaking_pending:false,session_kind:'lesson',...extra});
export function reconcile(s){
 if(s.lesson_engine==='activity-v1')return s;
 for(const a of s.attempts||[])if(a.mode==='S'&&a.result){a.result.evidence_source=source(a.result);a.evidence_status=classify(a);}
 if(s.status==='completed'&&s.final_outcome?.endsWith('_success')){const last=s.attempts?.filter(a=>a.mode==='S'&&a.result).at(-1);if(!last?.evidence_status?.endsWith('_success'))s.final_outcome='unresolved';}
 if(s.status==='completed'){s.listener_pending=false;s.recording_active=false;s.listener_closed=true;s.ended=true;s.screen=15;return s;}
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
  checkBuild(d?._core_build);
  let s=(await this.db.get('critical','session'))?.value||freshSession();const originalSession=structuredClone(s);if(s.schema_version>SCHEMA)throw Error('学习记录来自更新版本，请先更新学习程序。');
  for(const key of ['attempts','trials','repairs','review_queue'])if(!Array.isArray(s[key])){s[key]=[];delete s.schema_version;}
  if(!s.learner_private_state||typeof s.learner_private_state!=='object'){s.learner_private_state={};delete s.schema_version;}s.session_id ||= uid();s.unit_id ||= 'U01';s.pilot_started_at ??= null;if(d?._session_id&&d._session_id!==s.session_id)throw Error('这次学习已在另一页面切换，请返回课程目录。');
  reconcile(s);const revision=s.revision||0;let answer,ops=[];
  if(['completed','abandoned'].includes(s.status)&&['record','listener-return','repair','choice','submit'].includes(path))throw Error('本次已经完成，请从课程目录进入。');
  const event=(kind,extra={})=>{let row={id:uid(),unit_id:s.unit_id,session_id:s.session_id,activity_id:s.current_activity_id,trial_id:null,timestamp:now(),node_id:null,modality:null,target:null,support_level:'none',first_attempt:null,replay_count:0,learner_action:null,learner_audio:null,listener_action:null,correct:null,latency:null,independent_support:'not_applicable',device_issue:null,notes:'',evidence_type:kind,...extra};
   if(kind==='L_ACTION')row=normalizeEvidence({...row,capability:'listening_recognition',activity_type:'listening_choice',attempt:extra.plays,support_level:extra.help_used?'clear_support':extra.replay_count?'replay':'independent'});
   if(kind==='S_RESULT'){const a=s.attempts.find(a=>a.attempt_id===extra.attempt_id);row=normalizeEvidence({...row,capability:'speaking_retrieval',activity_type:'speaking_from_meaning',attempt:s.attempts.filter(a=>a.mode==='S').length,support_level:a?.support_state,active_generation:a?.active_generation,blind_attested:a?.result?.blind_attested,adapter:a?.result?.adapter,listener_closed:!!a?.result,listener_isolated:a?.result?.blind_attested===true&&a?.result?.adapter!=='self_check',evidence_source:a?.result?.evidence_source});}
   ops.push({store:'events',value:row});};
  if(path==='open-unit'||path==='new-session'||path==='abandon'){
   const unit=d.unit_id||s.unit_id,intent=d.intent||(path==='abandon'?'abandon':'restart');
   if(d.session_kind==='review'){
    const reviewProgress=await this.db.get('critical','review_progress:'+unit);
    let prior=reviewProgress?.value?.session_id?(await this.db.get('critical','session:'+reviewProgress.value.session_id))?.value:null;
    if(intent==='resume'&&prior&&['active','interrupted','new'].includes(prior.status))s=prior;
    else{
     const returnSession=(await this.db.get('critical','session'))?.value;
     if(returnSession&&returnSession.session_kind!=='review'&&['active','new'].includes(returnSession.status)){returnSession.status='interrupted';ops.push(...sessionOps(returnSession));}
     s=freshSession(unit,{session_kind:'review',review_item_id:d.review_item_id,source_activity_id:d.source_activity_id,return_session_id:d.return_session_id||returnSession?.session_id||null,review_generation:d.review_generation||1,validated_probe_snapshot:d.validated_probe_snapshot,lesson_engine:'activity-v1',current_activity_id:d.first_activity_id,current_domain_state:d.first_domain_state,last_safe_checkpoint:d.first_activity_id,asset_cache:d.asset_cache,course_version:d.course_version});
    }
    const installed=await this.db.get('critical','registry:'+unit);s.asset_cache=s.asset_cache||d.asset_cache||installed?.asset_cache;s.course_version=s.course_version||d.course_version||installed?.version;
    const recovered=await recoverDomain(s,this.db);s=recovered.session;s.revision=revision+1;ops.push(...sessionOps(s),{store:'critical',expected_revision:revision,value:{id:'session',value:s}});await this.db.batch(ops);return s;
   }
   const progress=await this.db.get('critical','progress:'+unit);
   let target=unit===s.unit_id&&s.session_kind!=='review'?s:(await this.db.get('critical','session:'+progress?.value?.session_id))?.value;
   if(target&&intent==='restart'&&target.status==='completed')throw Error('已完成课程请使用“再学一次”。');
   if(intent==='abandon'||intent==='restart'||intent==='review'||intent==='replay'){
    if(target){target.status=target.status==='completed'?'completed':'abandoned';target.recording_active=false;stamp(target);ops.push(...sessionOps(target));for(const a of target.attempts)ops.push({store:'media',delete:true,id:a.attempt_id});event('SESSION_ARCHIVED',{archived_session_id:target.session_id,status:target.status});}
    if(intent==='abandon'){s=target||s;}else s=freshSession(unit,{session_kind:'lesson'});
   }else {if(s.session_id!==target?.session_id){if(s.status==='active')s.status='interrupted';ops.push(...sessionOps(s));}s=target&&target.status!=='abandoned'?target:freshSession(unit,{session_kind:'lesson'});}
   if(d.lesson_engine==='activity-v1'&&!s.lesson_engine){s.lesson_engine=d.lesson_engine;s.current_activity_id=d.first_activity_id;s.current_domain_state=d.first_domain_state;s.last_safe_checkpoint=d.first_activity_id;}
   const installed=await this.db.get('critical','registry:'+unit);s.asset_cache=s.asset_cache||d.asset_cache||installed?.asset_cache;s.course_version=s.course_version||d.course_version||installed?.version;
   const recovered=await recoverDomain(s,this.db);s=recovered.session;
   s.revision=revision+1;ops.push(...sessionOps(s),{store:'critical',expected_revision:revision,value:{id:'session',value:s}});await this.db.batch(ops);return s;
  }
  if(path==='recover'){
   if(s.schema_version!==SCHEMA)ops.push({store:'critical',value:{id:'migration_original:'+s.session_id,value:originalSession}});
   const recovered=await recoverDomain(s,this.db);s=recovered.session;
   for(const a of recovered.removed)ops.push({store:'media',delete:true,id:a.attempt_id});
   const keep=new Set();for(const a of s.attempts)if(!a.result&&!a.audio_deleted&&s.status!=='completed')keep.add(a.attempt_id);
   for await(const row of this.db.iterate('critical'))if(row.id.startsWith('session:')&&['active','interrupted'].includes(row.value.status)&&row.value.session_id!==s.session_id)for(const a of row.value.attempts||[])if(!a.result&&!a.audio_deleted)keep.add(a.attempt_id);
   for await(const row of this.db.iterate('media'))if(!keep.has(row.id))ops.push({store:'media',delete:true,id:row.id});
   for await(const row of this.db.iterate('temporary'))ops.push({store:'temporary',delete:true,id:row.id});
   const bad=new Set(s.attempts.filter(a=>a.mode!=='S').map(a=>a.attempt_id));
   for await(const row of this.db.iterate('events'))if(row.session_id===s.session_id&&row.evidence_type==='S_RESULT'&&bad.has(row.attempt_id))ops.push({store:'events',value:{...row,excluded_from_evidence:true,exclusion_reason:'non_speaking_attempt'}});
   if(recovered.changed)event('safe_recovery_used',{screen:s.screen,removed_attempts:recovered.removed.map(a=>a.attempt_id)});
  }
  else if(path==='state'&&d){if('ended'in d||d.screen===15)throw Error('交流结算后才能完成。');for(const k of ['screen','trial','trials','meaning_cue_visible','last_play','played','recording_active','trial_feedback','trial_repair'])if(k in d)s[k]=d[k];}
  else if(path==='start'){if(s.ended)throw Error('本次已经完成，请从课程首页选择“再学一次”。');if(s.pilot_started_at===null){s.pilot_started_at=now();s.status='active';event('PILOT_START');}if(s.screen===0)s.screen=1;}
  else if(path==='event'){if(['PILOT_START','PILOT_END','FINAL_EVIDENCE_SETTLED'].includes(d.evidence_type))throw Error('完成由系统结算。');const {evidence_type,...extra}=d;event(evidence_type,extra);}
  else if(path==='choice'){if(s.learner_private_state.locked||!['water','tea'].includes(d.choice))throw Error('选择已经锁定。');s.learner_private_state={secret_choice:d.choice,locked:true,timestamp:now()};s.meaning_cue_visible=true;event('CHOICE_LOCKED',{target:d.choice,meaning_cue_visible:true});}
  else if(path==='repair'){const current=s.attempts.filter(a=>a.mode==='S');if(s.ended||d.scope==='S'&&(s.listener_pending||current.length>=3))throw Error('请先等待对方回应。');if(d.scope==='S')d.before_attempt=current.at(-1)?.attempt_id||null;const same=s.repairs.find(r=>r.repair_type===d.repair_type&&r.before_attempt===d.before_attempt&&!r.after_attempt);if(!same){if(d.answer_help)s.support='supported';s.repairs.push({...d,timestamp:now()});event('REPAIR',d);}s.final_evidence_settled=false;}
  else if(path==='record'){
   const prior=s.attempts.find(a=>d.client_record_id&&a.client_record_id===d.client_record_id);if(prior)return prior;
   const current=s.attempts.filter(a=>a.mode==='S');if(s.ended||d.mode==='S'&&(s.listener_pending||current.length>=3||!s.learner_private_state.locked))throw Error('请先等待对方回应。');
   const blob=d.blob||new Blob([Uint8Array.from(atob(d.audio),c=>c.charCodeAt(0))],{type:d.mime});if(blob.size<100||d.duration<.25)throw Error('声音太短，请再说一次。');const id=uid();
   const a={attempt_id:id,client_record_id:d.client_record_id,timestamp:now(),audio_file:'recordings/'+id,mime:blob.type,duration:d.duration,mode:d.mode,screen:s.screen,support_state:d.mode==='S'?s.support:d.mode==='ECHO'?'echo':'device',meaning_target:d.mode==='S'?s.learner_private_state.secret_choice:null,meaning_cue_visible:d.mode==='S'&&s.meaning_cue_visible,active_generation:d.mode==='S'&&s.screen===11,sha256:await sha256(blob)};
   ops.push({store:'media',value:{id,session_id:s.session_id,unit_id:s.unit_id,blob,sha256:a.sha256,lifecycle:'RAW_CURRENT_ATTEMPTS',critical:true,exported:false,timestamp:a.timestamp}});s.attempts.push(a);s.recording_active=false;for(const repair of s.repairs)if(d.mode==='S'&&repair.scope==='S'&&!repair.after_attempt)repair.after_attempt=id;event('RECORD_SAVED',{attempt_id:id,modality:d.mode,learner_audio:a.audio_file,target:a.meaning_target,independent_support:a.support_state,meaning_cue_visible:a.meaning_cue_visible});answer=a;
  }
  else if(path==='submit'){
   const a=s.attempts.find(a=>a.attempt_id===d.attempt_id&&a.mode==='S'&&!a.result);if(!a)throw Error('这次录音不存在或已经完成。');a.ticket ||= uid();a.ticket_attempt_id=a.attempt_id;answer={manual:true,attempt_id:a.attempt_id,ticket:a.ticket};
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
   const a=s.attempts.find(a=>a.attempt_id===d.attempt_id&&a.ticket===d.ticket&&(!a.ticket_attempt_id||a.ticket_attempt_id===d.attempt_id)&&a.mode==='S'&&!a.result);if(!a)throw Error('回应已锁定或不属于这次口语录音。');const r=d.result;
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
  if(s.ended){for await(const row of this.db.iterate('media'))if(row.session_id===s.session_id||s.attempts.some(a=>a.attempt_id===row.id))ops.push({store:'media',delete:true,id:row.id});for await(const row of this.db.iterate('temporary'))ops.push({store:'temporary',delete:true,id:row.id});}
  if(cleaned.length)event('LEARNER_AUDIO_CLEANED',{attempt_ids:cleaned,notes:'temporary learner media only; course assets untouched'});
  reconcile(s);
  // Only commands at the legacy boundary may translate a UI screen into domain state.
  if((path==='state'&&'screen' in d)||['start','cancel-pending','end'].includes(path))enterLegacyActivity(s,s.screen);
  if(path==='state'&&d.recording_active)s.current_domain_state='recording_active';
  if(path==='record')s.current_domain_state='recording_complete';
  if(path==='submit'){enterLegacyActivity(s,12);s.current_domain_state='listener_pending';}
  if(path==='listener-return'){enterLegacyActivity(s,13);s.current_domain_state=s.attempts.filter(a=>a.mode==='S').at(-1)?.result?.requested_repeat?'repair_needed':'evidence_pending';}
  if(path==='repair')s.current_domain_state='repair_needed';
  if(path==='settle')s.current_domain_state='evidence_settled';
  stamp(s);s.revision=revision+1;ops.push(...sessionOps(s));ops.push({store:'critical',expected_revision:revision,value:{id:'session',value:s}});await this.db.batch(ops);return answer||s;
 }
}
export const runtime=new LocalRuntime();
