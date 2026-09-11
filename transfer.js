import {LocalRuntime} from './local_runtime.js';
import {recoverDomain,sessionOps} from './resume.js';
import {BUILD,SCHEMA} from './build.js';
import {storage} from './storage.js';
import {progressPointerKey} from './progress_pointer.js';
export async function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
export async function progressZip(db=storage,Zip=globalThis.JSZip){const zip=new Zip(),session=(await db.get('critical','session'))?.value;const critical=[];for await(const row of db.iterate('critical'))if(!row.id.startsWith('installed:')&&!row.id.startsWith('unit:')&&!row.id.startsWith('registry:'))critical.push(row);const events=[],review=[];for await(const r of db.iterate('events')){if(events.length>=10000)throw Error('本次记录超过备份上限。');events.push(r);}for await(const r of db.iterate('review'))review.push(r);const data={format:'LEARNER_STATE_BACKUP',version:1,core_build:BUILD,schema_version:SCHEMA,session,critical,events,review,media_included:false};zip.file('progress.json',JSON.stringify(data,(key,value)=>['asset_cache','cacheName'].includes(key)?undefined:value));zip.file('version.json',JSON.stringify({format:'LEARNER_STATE_BACKUP',version:1}));return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});}
export async function exportState(){const bytes=await progressZip();return downloadBlob(new Blob([bytes],{type:'application/zip'}),'LEARNER_STATE_BACKUP.zip');}
export async function restoreProgress(bytes,db=storage,Zip=globalThis.JSZip){if((bytes.size||bytes.byteLength)>8e6)throw Error('备份过大。');const zip=await Zip.loadAsync(bytes instanceof Blob?await bytes.arrayBuffer():bytes,{checkCRC32:true});if(Object.keys(zip.files).some(p=>!['progress.json','version.json'].includes(p)))throw Error('请选择学习进度备份。');const p=JSON.parse(await zip.file('progress.json').async('string'));if(p.format!=='LEARNER_STATE_BACKUP'||p.version!==1||!p.session?.session_id||!Array.isArray(p.events)||p.events.length>10000)throw Error('备份无效。');const existing=(await db.get('critical','session'))?.value;
 const ops=[],sessions=new Map();
 // Explicit policy: backup current wins, local history is retained. No media imported.
 for(const row of p.critical||[])if(row.id?.startsWith('session:')&&row.value?.session_id)sessions.set(row.value.session_id,row.value);
 sessions.set(p.session.session_id,p.session);
 if(existing){ops.push({store:'critical',value:{id:'restore_previous:'+crypto.randomUUID(),value:existing}});if(!sessions.has(existing.session_id))ops.push({store:'critical',value:{id:'session:'+existing.session_id,value:{...existing,status:existing.status==='active'?'interrupted':existing.status}}});}
 for(const value of sessions.values()){
  if(value.schema_version>SCHEMA)throw Error('备份来自更新版本，请先更新学习程序。');
  const saved=await db.get('critical','session:'+value.session_id);
  if(saved)ops.push({store:'critical',value:{id:'restore_history:'+crypto.randomUUID(),value:saved.value}});
  // A backup never carries usable temporary audio or listener credentials.
  delete value.asset_cache;for(const a of value.attempts||[])if(!a.result){delete a.ticket;delete a.ticket_attempt_id;}
  await recoverDomain(value,{get:async()=>undefined});
  ops.push({store:'critical',value:{id:'session:'+value.session_id,value}});
 }
 const selected=sessions.get(p.session.session_id);selected.revision=(existing?.revision||0)+1;
 for(const row of p.critical||[])if(typeof row.id==='string'&&!/^(session|progress|registry|installed|unit|migration_original|restore_history|restore_previous)(:|$)/.test(row.id)&&!await db.get('critical',row.id))ops.push({store:'critical',value:row});
 for(const row of p.critical||[])if((row.id?.startsWith('progress:')||row.id?.startsWith('review_progress:'))&&!(row.id===progressPointerKey(selected)))ops.push({store:'critical',value:row});
 for(const row of p.events)if(typeof row.id==='string'&&!await db.get('events',row.id))ops.push({store:'events',value:row});
 for(const row of p.review||[])if(typeof row.id==='string'&&!await db.get('review',row.id))ops.push({store:'review',value:row});
 ops.push(...sessionOps(selected),{store:'critical',expected_revision:existing?.revision||0,value:{id:'session',value:selected}});
 await db.batch(ops);await new LocalRuntime(db).request('recover',{});
 const current=(await db.get('critical','session'))?.value,progress=(await db.get('critical',progressPointerKey(selected)))?.value;
 if(current?.session_id!==selected.session_id||progress?.session_id!==selected.session_id||current.current_activity_id!==selected.current_activity_id)throw Error('恢复未完成，请重新导入备份。');
 return {restored:true,interrupted_audio:true,merged:!!existing,current_session_id:current.session_id,current_policy:'backup_current_wins',resume_state:current.current_domain_state};
}
