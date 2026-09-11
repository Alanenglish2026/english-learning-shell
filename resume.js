import {recoverActivitySession} from './activity_protocol.js';
import {BUILD,SCHEMA,MIGRATION_VERSION} from './build.js';
import {U01_ACTIVITIES as checkpoints,enterLegacyActivity,renderLegacyScreen,migrateLegacy,domainForActivity} from './u01_adapter.js';
import {progressPointerKey,progressRecord} from './progress_pointer.js';
export const DOMAIN_STATES=Object.freeze(['meaning_ready','listening_active','speaking_ready','recording_active','recording_complete','playback_ready','listener_pending','repair_needed','evidence_pending','evidence_settled','session_completed']);
export function stamp(s){
 s.schema_version=SCHEMA;s.core_build=BUILD;s.runtime_version=BUILD;s.migration_version=MIGRATION_VERSION;s.started_at=s.pilot_started_at??s.started_at??null;s.updated_at=Date.now();
 if(!s.current_activity_id&&s.lesson_engine!=='activity-v1')migrateLegacy(s);
 if(s.status==='completed'||s.ended&&s.final_evidence_settled){s.status='completed';s.current_domain_state='session_completed';s.current_activity_id='completed';s.last_safe_checkpoint='completed';s.completed_at ||= s.pilot_ended_at||Date.now()/1000;s.ended=true;s.recording_active=false;s.listener_pending=false;s.listener_closed=true;}
 if(!['new','active','interrupted','completed','abandoned'].includes(s.status))s.status=s.started_at?'active':'new';s.current_domain_state ||= domainForActivity(s.current_activity_id);
 s.current_capability_state=s.current_domain_state;
 return s.lesson_engine==='activity-v1'?s:renderLegacyScreen(s);
}
export async function recoverDomain(s,db){
 if(s.lesson_engine==='activity-v1'){const result=await recoverActivitySession(s,db);stamp(s);return result;}
 const hadSchema=s.schema_version===SCHEMA;s.attempts ||= [];s.repairs ||= [];s.trials ||= [];s.learner_private_state ||= {};s.review_queue ||= [];
 const wasRecording=!!s.recording_active||s.current_domain_state==='recording_active';s.recording_active=false;
 if(!hadSchema){migrateLegacy(s);if(s.ended&&s.final_evidence_settled)s.status='completed';}
 for(const a of s.attempts)if(a.mode!=='S'&&a.result){a.excluded_result=a.result;delete a.result;delete a.evidence_status;}
 if(s.status==='completed'){stamp(s);return {session:s,removed:[],changed:true};}
 if(!checkpoints.includes(s.current_activity_id))enterLegacyActivity(s,Math.max(0,checkpoints.indexOf(s.last_safe_checkpoint)));
 renderLegacyScreen(s);
 const removed=[];const tickets=new Set();
 for(const a of s.attempts){
  if(a.mode!=='S'&&a.result){a.excluded_result=a.result;delete a.result;delete a.evidence_status;}
  if(a.result)continue;
  const m=await db.get('media',a.attempt_id);
  if(a.mode==='S'&&(!m?.blob?.size||!a.ticket||tickets.has(a.ticket)||a.ticket_attempt_id&&a.ticket_attempt_id!==a.attempt_id)){removed.push(a);continue;}
  if(a.mode==='S'){tickets.add(a.ticket);a.ticket_attempt_id=a.attempt_id;}
  if(!a.audio_deleted&&!m?.blob?.size)removed.push(a);
 }
 for(const a of removed)s.interrupted_attempts=[...(s.interrupted_attempts||[]),{...a,ticket:undefined,recovery_reason:'invalid_temporary_task'}];
 s.attempts=s.attempts.filter(a=>!removed.includes(a));
 const pending=s.attempts.find(a=>a.mode==='S'&&!a.result),last=s.attempts.filter(a=>a.mode==='S'&&a.result).at(-1);
 const repeatRepair=!!(last?.result?.requested_repeat&&!s.final_evidence_settled);
 if(pending)s.screen=12;else if(removed.some(a=>a.mode==='S'))s.screen=11;
 else if(repeatRepair)s.screen=11;
 else if(s.screen===12||s.screen===13)s.screen=last?13:11;
 if(s.screen===2&&s.attempts.some(a=>a.mode==='DEVICE'&&a.audio_deleted))s.screen=3;
 s.status=wasRecording?'interrupted':s.status||'new';enterLegacyActivity(s,s.screen);if(repeatRepair&&!pending)s.current_domain_state='repair_needed';stamp(s);return {session:s,removed,changed:!hadSchema||wasRecording||removed.length>0||repeatRepair};
}
export function sessionOps(s){stamp(s);return [
 {store:'critical',value:{id:'session:'+s.session_id,value:s}},
 {store:'critical',value:{id:progressPointerKey(s),value:progressRecord(s)}}
 ];}
