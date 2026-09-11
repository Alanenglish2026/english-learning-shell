// Public task payload is constructed from an allowlist, never from session spread.
export async function listenerTask(db,sessionId,attemptId,actions){
 const s=(await db.get('critical','session'))?.value;
 const a=s?.attempts?.find(x=>x.attempt_id===attemptId&&x.mode==='S'&&!x.result);
 if(s?.session_id!==sessionId||!a||!a.ticket||a.ticket_attempt_id!==attemptId)throw Error('请重新进入当前口语步骤。');
 const media=await db.get('media',attemptId);if(!media?.blob?.size)throw Error('请重新说一次。');
 if(!Array.isArray(actions)||!actions.length||actions.some(x=>typeof x!=='string'))throw Error('对话动作未配置。');
 return {learner_audio:media.blob,scene_rules:'根据实际听到的英语采取行动；不确定时要求重复，不猜答案。',allowed_actions:[...new Set([...actions,'repeat','no_action'])]};
}
export const LISTENER_ADAPTERS=Object.freeze({human_blind:'manual',self_check:'local_function_test',manual_external_gpt:'manual_external_experiment',future_gpt_api:'not_configured'});
