export {ACTIVITY_TYPES,validateActivities,validateActivity,validateResourceGraph,initialDomain} from './activity_validation.js';
import {initialDomain} from './activity_validation.js';
export async function recoverActivitySession(s,db){s.attempts ||= [];s.repairs ||= [];s.trials ||= [];s.activity_runs ||= {};const removed=[];let changed=false;if(s.status==='completed'){s.current_domain_state='session_completed';s.current_activity_id='completed';s.listener_pending=false;s.ended=true;s.recording_active=false;return {session:s,removed,changed:false};}
 if(s.recording_active||s.current_domain_state==='recording_active'){s.recording_active=false;s.current_domain_state='speaking_ready';s.status='interrupted';changed=true;}
 const pending=s.attempts.find(x=>x.attempt_id===s.pending_attempt_id&&!x.result),media=pending&&await db.get('media',pending.attempt_id);
 if(['recording_complete','playback_ready','listener_pending'].includes(s.current_domain_state)){
  if(!pending||!media?.blob?.size||s.current_domain_state==='listener_pending'&&(!pending.ticket||pending.ticket_attempt_id!==pending.attempt_id)){
   if(pending){removed.push(pending);s.interrupted_attempts=[...(s.interrupted_attempts||[]),{attempt_id:pending.attempt_id,activity_id:pending.activity_id,turn_index:pending.turn_index,attempt_index:pending.attempt_index,recovery_reason:'missing_temporary_task'}];s.attempts=s.attempts.filter(x=>x!==pending);}
   s.current_domain_state='speaking_ready';s.pending_attempt_id=null;s.listener_pending=false;changed=true;
  }else if(s.current_domain_state==='listener_pending'){
   // DOM/frame receipts never survive reload. Keep Blob/ticket, revoke only receipt.
   if(pending.receipt){delete pending.receipt;delete pending.receipt_issued_at;changed=true;}
   s.listener_pending=true;
  }
 }
 if(s.transition&&!s.transition.completed){s.transition.visible_since=null;changed=true;}
 if(!s.current_activity_id||s.current_activity_id==='completed'){s.current_activity_id=s.last_safe_checkpoint;s.current_domain_state='meaning_ready';changed=true;}
 return {session:s,removed,changed};}
