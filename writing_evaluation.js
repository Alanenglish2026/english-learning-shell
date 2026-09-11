const TERMINAL_RE=/[.!?。！？]$/u;
export const DEFAULT_WRITING_POLICY=Object.freeze({
 trim_whitespace:true,
 collapse_spaces:false,
 case_sensitive:true,
 terminal_punctuation_required:true,
 meaning_equivalent_policy:'none'
});
function hasOwn(o,k){return Object.prototype.hasOwnProperty.call(o||{},k);}
export function writingPolicy(activity={}){
 const p={...DEFAULT_WRITING_POLICY,...(activity.evaluation_policy||activity.task?.evaluation_policy||{})};
 for(const k of ['trim_whitespace','collapse_spaces','case_sensitive','terminal_punctuation_required'])if(typeof p[k]!=='boolean')throw Error('Writing evaluation policy 无效。');
 if(!['none','accepted_answers'].includes(p.meaning_equivalent_policy))throw Error('Writing meaning policy 无效。');
 const sources=[];
 if(hasOwn(p,'accepted_answers'))sources.push(p.accepted_answers);
 if(hasOwn(activity.task,'accepted'))sources.push(activity.task.accepted);
 if(hasOwn(activity.task,'answer'))sources.push([activity.task.answer]);
 const normalizedSources=sources.map(x=>Array.isArray(x)?x.map(String):[]).filter(x=>x.length);
 if(!normalizedSources.length||normalizedSources.some(x=>!x.length||x.some(v=>!v.trim())))throw Error('Writing accepted answers 无效。');
 const canonical=JSON.stringify(normalizedSources[0]);
 if(normalizedSources.some(x=>JSON.stringify(x)!==canonical))throw Error('Writing accepted answers 冲突。');
 p.accepted_answers=normalizedSources[0];
 if(p.terminal_punctuation_required&&p.accepted_answers.some(x=>!TERMINAL_RE.test(x.trim())))throw Error('严格Writing答案必须有句末标点。');
 return p;
}
export function normalizeWriting(value,policy){let s=String(value??'');if(policy.trim_whitespace)s=s.trim();if(policy.collapse_spaces)s=s.replace(/\s+/gu,' ');if(!policy.terminal_punctuation_required)s=s.replace(/[.!?。！？]+$/u,'');if(!policy.case_sensitive)s=s.toLocaleLowerCase('en-US');return s;}
export function evaluateWriting(activity,raw){const p=writingPolicy(activity),learner_raw_answer=String(raw??''),normalized_answer=normalizeWriting(learner_raw_answer,p),accepted_normalized=p.accepted_answers.map(x=>normalizeWriting(x,p));const terminal_ok=!p.terminal_punctuation_required||TERMINAL_RE.test(learner_raw_answer.trim());return {correct:terminal_ok&&accepted_normalized.includes(normalized_answer),learner_raw_answer,normalized_answer,accepted_normalized,policy_snapshot:{trim_whitespace:p.trim_whitespace,collapse_spaces:p.collapse_spaces,case_sensitive:p.case_sensitive,terminal_punctuation_required:p.terminal_punctuation_required,meaning_equivalent_policy:p.meaning_equivalent_policy}};}
