import {storage,sha256} from './storage.js';import {here} from './base.js';import {legacyManifest} from './legacy_u01.js';import {BUILD} from './build.js';
export const INSTALL_STATES=Object.freeze(['installed','updating','repair_needed','missing_assets']);
export const unitKey=id=>'registry:'+id;
export const validId=id=>/^U\d{2,3}$/.test(id);
export const validPath=p=>typeof p==='string'&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&!p.includes('..');
export const compare=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
export class CourseRegistry{
 constructor(db=storage,cacheStore=globalThis.caches){this.db=db;this.caches=cacheStore;}
 async validate(name,fallback,allowStaged=false){
  try{const c=await this.caches.open(name),descriptor=await c.match(here('course/_unit_record.json'));const saved=descriptor?await descriptor.json():null;
   if(saved?.staged&&!allowStaged)return null;
   const r=await c.match(here('course/manifest.json'));let m=r?await r.json():fallback?.manifest||legacyManifest;
   if(!name.startsWith('english-unit-'+m.unit_id+'-')||!validId(m.unit_id)||!Array.isArray(m.files)||!m.files.length)return null;
   for(const f of m.files){if(!validPath(f.path))return null;const res=await c.match(here('course/'+f.path));if(!res)return null;const b=await res.blob();if(b.size!==f.size||await sha256(b)!==f.sha256)return null;}
   const cfg=await(await c.match(here('course/unit_config.json'))).json();if(cfg.unit_id!==m.unit_id)return null;
   const stamp=Date.now();return {id:unitKey(m.unit_id),unit_id:m.unit_id,version:m.version,title:cfg.title||m.unit_id+' Day1',order:cfg.order||Number(m.unit_id.slice(1)),stage:cfg.stage??null,unit_type:cfg.unit_type||'lesson',installed_at:fallback?.installed_at||saved?.installed_at||stamp,updated_at:saved?.updated_at||stamp,asset_cache:name,manifest_hash:await sha256(new Blob([JSON.stringify(m)])),offline_ready:true,install_state:'installed',manifest:m,lesson_engine:cfg.lesson_engine,build:BUILD};
  }catch{return null;}
 }
 async get(id,{repair=true,deep=true}={}){
  let current=await this.db.get('critical',unitKey(id));
  if(!current){const old=await this.db.get('critical','installed:'+id);if(old){const v=await this.validate(old.cacheName,old);if(v){await this.db.put('critical',v);current=v;}}}
  if(current&&!deep&&current.offline_ready&&(await this.caches.keys()).includes(current.asset_cache))return current;
  if(current){const valid=await this.validate(current.asset_cache,current);if(valid){if(!current.offline_ready||current.install_state!=='installed'||!('stage'in current)||!current.unit_type||current.build!==BUILD)await this.db.put('critical',valid);return {...current,...valid};}}
  if(repair){const candidates=[];for(const name of await this.caches.keys()){if(!name.startsWith('english-unit-'+id+'-'))continue;const row=await this.validate(name,current);if(row)candidates.push(row);}candidates.sort((a,b)=>compare(b.version,a.version));if(candidates[0]){await this.db.put('critical',candidates[0]);return candidates[0];}}
  if(current){current={...current,offline_ready:false,install_state:'missing_assets'};await this.db.put('critical',current);return current;}return null;
 }
 async list(){const ids=new Set();for await(const r of this.db.iterate('critical')){if(r.id.startsWith('registry:')||r.id.startsWith('installed:'))ids.add(r.id.split(':')[1]);if(r.id.startsWith('progress:'))ids.add(r.id.split(':')[1]);}
  const s=(await this.db.get('critical','session'))?.value;if(s?.unit_id)ids.add(s.unit_id);
  for(const n of await this.caches.keys()){const match=/^english-unit-(U\d{2,3})-/.exec(n);if(match)ids.add(match[1]);}
  const rows=[];for(const id of ids){const row=await this.get(id,{deep:false});rows.push(row||{unit_id:id,title:id+' Day1',order:Number(id.slice(1)),offline_ready:false,install_state:'missing_assets'});}return rows.sort((a,b)=>a.order-b.order);
 }
 async response(id,path,sessionId){if(!validId(id)||!validPath(path))throw Error('课件路径无效。');let unit=await this.db.get('critical',unitKey(id))||await this.get(id);if(sessionId){const s=(await this.db.get('critical','session:'+sessionId))?.value;if(!s||s.unit_id!==id)throw Error('请返回课程目录重新进入。');if(s.asset_cache)unit={...unit,asset_cache:s.asset_cache,offline_ready:true};}if(!unit?.offline_ready)throw Error('这节课需要重新连接，学习进度仍保留。');const r=await(await this.caches.open(unit.asset_cache)).match(here('course/'+path));if(!r)throw Error('这节课需要重新连接。');return r;}
}
export const registry=new CourseRegistry();
