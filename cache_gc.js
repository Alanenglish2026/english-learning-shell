import {withCourseLock} from './course_lock.js';
import {storage} from './storage.js';
// Two-pass grace period. Registry and live-session references always win.
export function safeCacheGC(db=storage,cs=globalThis.caches,options={}){return withCourseLock(exclusive=>collect(db,cs,{...options,exclusive}),options.locks||globalThis.navigator?.locks);}
async function collect(db,cs,{now=Date.now(),grace=86400000,exclusive=false}={}){
 const protectedNames=new Set();for await(const r of db.iterate('critical')){if(r.id.startsWith('registry:')&&r.asset_cache)protectedNames.add(r.asset_cache);if((r.id==='session'||r.id.startsWith('session:'))&&['new','active','interrupted'].includes(r.value?.status)&&r.value.asset_cache)protectedNames.add(r.value.asset_cache);}
 const removed=[],deferred=[];for(const name of await cs.keys()){
  if(!/^english-unit-U\d{2,3}-/.test(name))continue;
  const id='gc:'+name;if(protectedNames.has(name)){if(await db.get('critical',id))await db.batch([{store:'critical',id,delete:true}]);continue;}
  const mark=await db.get('critical',id);if(!mark){await db.put('critical',{id,eligible_since:now});deferred.push(name);continue;}
  if(!exclusive||now-mark.eligible_since<grace){deferred.push(name);continue;}
  // Recheck after awaits: an open/import operation may have pinned it.
  let pinned=false;for await(const r of db.iterate('critical'))if(r.id.startsWith('registry:')&&r.asset_cache===name||(r.id==='session'||r.id.startsWith('session:'))&&['new','active','interrupted'].includes(r.value?.status)&&r.value.asset_cache===name)pinned=true;
  if(!pinned){await cs.delete(name);await db.batch([{store:'critical',id,delete:true}]);removed.push(name);}
 }return {removed,deferred,protected:[...protectedNames]};
}
