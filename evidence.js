// Capability + evidence policy + runtime facts determine evidence. Activity names never grant independence.
export function normalizeEvidence(e){
 const out={unit_id:null,session_id:null,activity_id:null,capability:null,modality:null,attempt_index:null,result:null,support_level:'unknown',latency:null,transfer_context:null,delayed_test:false,timestamp:Date.now(),...e};
 const correct=out.correct===true||out.result==='success',audio=out.audio_profile||{};
 Object.assign(out,{audio_variant:out.audio_variant??audio.variant??null,speaker_id:out.speaker_id??audio.speaker_id??null,playback_rate:out.playback_rate??audio.playback_rate??null,replay_count:out.replay_count??audio.replay_count??0,text_visible:out.text_visible??audio.text_visible??false});
 const supported=out.support_level!=='independent'||out.answer_help===true||out.text_visible||out.playback_rate!==null&&out.playback_rate!==1;
 const speaking=out.modality==='S',writing=out.modality==='W',listening=out.modality==='L',echo=out.modality==='ECHO'||out.capability==='ECHO';
 const policy=out.evidence_policy_snapshot||{};
 const blind=speaking&&policy.active_generation===true&&policy.listener_required===true&&policy.blind_listener_required===true&&out.active_generation===true&&out.blind_attested===true&&out.non_learner_attested===true&&out.listener_closed===true&&out.listener_isolated===true&&out.audio_listened===true;
 const writingIndependent=writing&&out.copied!==true&&out.provided_tokens!==true&&out.active_generation===true;
 out.independent=!echo&&correct&&!supported&&(!speaking||blind)&&(!writing||writingIndependent)&&(!listening||out.playback_rate===1&&!!out.audio_variant);
 const ix=out.attempt_index??out.attempt;
 out.first_pass_success=out.independent&&(ix===1||out.first_attempt===true)&&out.replay_count===0;
 out.natural_listening_mastery=listening&&out.first_pass_success&&out.audio_variant==='natural_conversation';
 out.evidence_class=echo?'echo':out.adapter==='self_check'?'self_check':!['R','L','S','W','A'].includes(out.modality)?'not_applicable':correct?out.independent?'independent':'supported':out.correct===false?'not_yet':'not_tested';
 if(out.adapter==='self_check'){out.independent=false;out.first_pass_success=false;out.blind_attested=false;out.non_learner_attested=false;out.evidence_source='listener_function_test';out.evidence_class='self_check';}
 if(out.evidence_source==='human_blind_plan_b'&&!(out.blind_attested&&out.non_learner_attested))out.evidence_source='unverified_listener';
 // Never retain engine binding secrets inside Evidence.
 for(const k of ['ticket','receipt','client_record_id','blob','learner_audio','meaning_target','secret_choice','private_choice','intended_answer'])delete out[k];
 return out;
}
