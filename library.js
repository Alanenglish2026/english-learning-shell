import {withCourseLock} from './course_lock.js';
import {updateReview,dueReview} from './learning_extensions.js';
import {validateActivities,initialDomain} from './activity_protocol.js';
import {safeCacheGC} from './cache_gc.js';
import {registry} from './registry.js';
import {runtime} from './local_runtime.js';
import {storage} from './storage.js';
import {BUILD} from './build.js';
import {reviewProbeFromActivity,legacyU01Probe} from './practice.js';
export class CourseLibrary{
 constructor(db=storage,reg=registry,rt=runtime){this.db=db;this.registry=reg;this.runtime=rt;}
 async repair(){if(await this.db.get('critical','session'))await this.runtime.request('recover',{});await updateReview(this.db);const rows=await this.registry.list();await safeCacheGC(this.db,this.registry.caches);return rows;}
 async due(){return dueReview(this.db);}
 async list(){const rows=await this.registry.list();const allDue=await this.due();for(const row of rows){const p=(await this.db.get('critical','progress:'+row.unit_id))?.value;row.due_review=allDue.filter(x=>x.unit_id===row.unit_id);row.progress=p||null;row.state=!row.offline_ready?'课件需要重新连接':p?.status==='active'||p?.status==='interrupted'?'学习中':p?.status==='completed'?'已完成':p?.started_at&&p.status!=='abandoned'?'学习中':'未开始';}return rows;}
 async continuation(){const rows=await this.list(),current=(await this.db.get('critical','session'))?.value;const active=rows.filter(r=>['active','interrupted'].includes(r.progress?.status));const preferred=active.find(r=>r.unit_id===current?.unit_id&&current?.session_kind!=='review'&&['active','interrupted'].includes(current.status));return preferred||active.sort((a,b)=>(a.progress.status==='active'?0:1)-(b.progress.status==='active'?0:1)||(b.progress.updated_at||0)-(a.progress.updated_at||0))[0]||rows.find(r=>r.state==='未开始'&&r.offline_ready)||rows.find(r=>r.state==='已完成')||rows[0]||null;}
 openUnit(...args){return withCourseLock(()=>this._openUnit(...args));}
 async _openUnit(id,intent='resume',{online=globalThis.navigator?.onLine!==false,shellReady=false,review_item_id=null}={}){
  if(!['start','resume','restart','replay','review','repair'].includes(intent))throw Error('请从课程目录进入。');const unit=await this.registry.get(id);if(!unit?.offline_ready)throw Error('这节课需要重新连接；请导入原课件，学习进度会保留。');if(!online&&!shellReady)throw Error('离线准备还未完成，请先联网打开。');
  if(intent==='review'){
   const due=await this.due(),item=review_item_id?due.find(x=>x.id===review_item_id):due.find(x=>x.unit_id===id);if(!item)throw Error('当前没有到期巩固。');let probe;if(unit.lesson_engine==='activity-v1'){const cfg=await(await this.registry.response(id,'unit_config.json')).json(),source=validateActivities(cfg.activities).find(x=>x.activity_id===item.source_activity_id||x.activity_id===item.activity_id);if(!source)throw Error('巩固需要重新连接原活动。');probe=reviewProbeFromActivity(source,item);}else if(id==='U01'){const audio=await(await this.registry.response(id,'audio_manifest.json')).json();probe=legacyU01Probe(item,audio);}else throw Error('当前课件还没有巩固适配器。');
   const current=(await this.db.get('critical','session'))?.value;const rp=(await this.db.get('critical','review_progress:'+id))?.value;const prior=rp?.session_id?(await this.db.get('critical','session:'+rp.session_id))?.value:null;const resumeReview=prior&&prior.review_item_id===item.id&&['new','active','interrupted'].includes(prior.status);
   const session=await this.runtime.request('open-unit',{unit_id:id,intent:resumeReview?'resume':'review',session_kind:'review',review_item_id:item.id,source_activity_id:item.source_activity_id||item.activity_id,review_generation:item.generation,return_session_id:resumeReview?prior.return_session_id:(current?.session_kind==='lesson'?current.session_id:null),validated_probe_snapshot:probe,lesson_engine:'activity-v1',first_activity_id:probe.activity_id,first_domain_state:initialDomain(probe),asset_cache:unit.asset_cache,course_version:unit.version,_core_build:BUILD});return {session,url:'./activity.html?unit='+encodeURIComponent(id)+'&session='+session.session_id};
  }
  const engines={'u01-frozen-v1':'lesson.html','activity-v1':'activity.html'};if(!engines[unit.lesson_engine])throw Error('这节课需要更新学习程序后打开。');let activityArgs={};if(unit.lesson_engine==='activity-v1'){const cfg=await(await this.registry.response(id,'unit_config.json')).json();const first=validateActivities(cfg.activities)[0];activityArgs={lesson_engine:'activity-v1',first_activity_id:first.activity_id,first_domain_state:initialDomain(first)};}const session=await this.runtime.request('open-unit',{...activityArgs,unit_id:id,intent,session_kind:'lesson',asset_cache:unit.asset_cache,course_version:unit.version,_core_build:BUILD});return {session,url:'./'+engines[unit.lesson_engine]+'?unit='+encodeURIComponent(id)+'&session='+session.session_id};
 }
}
export const library=new CourseLibrary();export const openUnit=(...args)=>library.openUnit(...args);
