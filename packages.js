import {withCourseLock} from './course_lock.js';
import {validateActivities,validateResourceGraph} from './activity_protocol.js';
import {CourseRegistry,validId,validPath,unitKey} from './registry.js';
import {storage,sha256} from './storage.js';
import {here} from './base.js';
export const INSTALLED='installed:U01';
export const MIME={json:'application/json',png:'image/png',webp:'image/webp',jpeg:'image/jpeg',jpg:'image/jpeg',wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',txt:'text/plain'};
const legacyRequired=['unit_config.json','interaction.json','evidence_rules.json','audio_manifest.json','assets/p01.png','assets/p02.png',...['A01','A02','A03','A04','A05','TEST'].map(x=>'assets/'+x+'.wav')];
const compare=(a,b)=>{const x=String(a||'0').split('.').map(Number),y=String(b||'0').split('.').map(Number);for(let i=0;i<3;i++){const d=(x[i]||0)-(y[i]||0);if(d)return Math.sign(d);}return 0;};

export async function recoverInstalledFromCache(db=storage,cacheStore=globalThis.caches,id='U01'){const r=await new CourseRegistry(db,cacheStore).get(id);return r?.offline_ready?{...r,cacheName:r.asset_cache,digest:r.manifest_hash}:null;}

export class UnitInstaller {
 constructor(db=storage,cacheStore=globalThis.caches,Zip=globalThis.JSZip){Object.assign(this,{db,cacheStore,Zip});}
 install(bytes){return withCourseLock(()=>this._install(bytes));}
 async _install(bytes){
  if(!this.Zip||!this.cacheStore)throw Error('此浏览器不能安装离线课件。');
  if((bytes.size||bytes.byteLength)>32e6)throw Error('课件包超过本版大小限制。');
  let zip;try{zip=await this.Zip.loadAsync(bytes instanceof Blob?await bytes.arrayBuffer():bytes);}catch{throw Error('课件ZIP无效，原课件未改变。');}
  const entries=Object.values(zip.files).filter(x=>!x.dir);if(entries.length>40||entries.reduce((n,e)=>n+(e._data?.uncompressedSize||0),0)>24e6)throw Error('课件文件过多或解压体积过大。');
  for(const e of entries){const name=e.unsafeOriginalName||e.name;if(name!==e.name||name.includes('..')||name.startsWith('/')||name.includes('\\'))throw Error('课件路径无效。');}
  if(!zip.file('manifest.json'))throw Error('找不到课件清单。');const raw=await zip.file('manifest.json').async('string');if(raw.length>50000)throw Error('清单过大。');let m;try{m=JSON.parse(raw)}catch{throw Error('清单格式错误。');}
  if(m.format!=='ENGLISH_UNIT_PACKAGE'||!validId(m.unit_id)||!/^\d+\.\d+(\.\d+)?$/.test(m.version)||!Array.isArray(m.files)||!m.files.length)throw Error('不支持的课件。');
  const required=m.unit_id==='U01'?legacyRequired:m.files.map(f=>f.path);
  if(!required.includes('unit_config.json')||!required.includes('audio_manifest.json'))throw Error('课件不完整。');
  if(new Set(m.files.map(f=>f.path)).size!==required.length||required.some(p=>!m.files.some(f=>f.path===p))||entries.length!==required.length+1)throw Error('课件不完整。');
  const blobs=[];let total=0;
  for(const f of m.files){if(!MIME[f.path.split('.').at(-1)]||!validPath(f.path)||!required.includes(f.path)||!Number.isSafeInteger(f.size)||f.size<1||f.size>8e6||!zip.file(f.path))throw Error('课件资源无效。');const b=new Blob([await zip.file(f.path).async('uint8array')],{type:MIME[f.path.split('.').at(-1)]});total+=b.size;if(total>24e6||b.size!==f.size||await sha256(b)!==f.sha256)throw Error('课件校验失败，原课件未改变。');blobs.push([f.path,b]);}
  const config=JSON.parse(await blobs.find(([p])=>p==='unit_config.json')[1].text());if(config.unit_id!==m.unit_id||typeof config.lesson_engine!=='string')throw Error('课件配置不兼容。');
  if(config.lesson_engine==='activity-v1')validateActivities(config.activities);
  const audio=JSON.parse(await blobs.find(([p])=>p==='audio_manifest.json')[1].text());if(!Array.isArray(audio)||audio.some(a=>!required.includes(a.file_name)))throw Error('音频清单无效。');
  // Generic Activities are rejected before staging unless every typed resource resolves through audio manifest -> unit manifest -> real ZIP bytes/checksum.
  if(config.lesson_engine==='activity-v1')validateResourceGraph(config,audio,m.files);
  const previous=await recoverInstalledFromCache(this.db,this.cacheStore,m.unit_id);const digest=await sha256(new Blob([JSON.stringify(m)]));
  if(previous&&compare(m.version,previous.version)<0)throw Error('已安装更新版本。');
  if(previous&&compare(m.version,previous.version)===0&&previous.digest&&previous.digest!==digest)throw Error('同版本内容不同，请使用正式升级包。');
  const cacheName='english-unit-'+m.unit_id+'-'+crypto.randomUUID();
  try{
   const cache=await this.cacheStore.open(cacheName);
   await cache.put(here('course/_unit_record.json'),new Response(JSON.stringify({staged:true}))); 
   for(const [path,blob] of blobs)await cache.put(here('course/'+path),new Response(blob,{headers:{'Content-Type':blob.type}}));
   await cache.put(here('course/manifest.json'),new Response(raw,{headers:{'Content-Type':'application/json'}}));
   const registry=new CourseRegistry(this.db,this.cacheStore),verified=await registry.validate(cacheName,null,true);
   if(!verified)throw Error('安装校验未完成。');
   verified.installed_at=previous?.installed_at||Date.now();verified.updated_at=Date.now();
   await cache.put(here('course/_unit_record.json'),new Response(JSON.stringify(verified),{headers:{'Content-Type':'application/json'}}));
   await this.db.batch([{store:'critical',expected_asset_cache:previous?.asset_cache||null,value:verified}]);

  }catch(e){await this.cacheStore.delete(cacheName);throw Error(e.name==='QuotaExceededError'?'空间不足，旧课件与进度保留。':'安装未完成，旧课件与进度保留。');}
  return {unit_id:m.unit_id,version:m.version,updated:!!previous};
 }
}

export async function courseResponse(path,db=storage,cacheStore=globalThis.caches,id){id ||= (await db.get('critical','session'))?.value?.unit_id||'U01';return new CourseRegistry(db,cacheStore).response(id,path);}
