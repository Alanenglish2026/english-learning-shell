// Frozen U01 UI boundary only. Recovery does not read screen numbers.
export const U01_ACTIVITIES=['course_intro','sound_check','device_record','meaning_water','meaning_tea','listening_intro','listening','echo_word','echo_request','model_withdrawn','secret_choice','speaking','listener','result',null,'completed'];
export const domainForActivity=id=>id==='completed'?'session_completed':id==='listener'?'listener_pending':id==='result'?'evidence_pending':id==='listening'?'listening_active':['device_record','echo_word','echo_request','speaking'].includes(id)?'speaking_ready':'meaning_ready';
export function enterLegacyActivity(s,screen){const id=U01_ACTIVITIES[screen];if(!id)throw Error('请从课程目录重新进入。');s.current_activity_id=id;s.current_domain_state=domainForActivity(id);s.last_safe_checkpoint=id;s.screen=screen;return s;}
export function renderLegacyScreen(s){s.screen=Math.max(0,U01_ACTIVITIES.indexOf(s.current_activity_id));return s;}
export function migrateLegacy(s){const id=U01_ACTIVITIES[s.screen]||U01_ACTIVITIES.find(x=>x&&x===s.last_safe_checkpoint)||'course_intro';return enterLegacyActivity(s,U01_ACTIVITIES.indexOf(id));}
