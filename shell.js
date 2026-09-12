import {exportDiagnostic} from './diagnostic.js';
import {storage} from './storage.js';import {UnitInstaller} from './packages.js';import {exportState,restoreProgress} from './transfer.js';import {runtime} from './local_runtime.js';import {library} from './library.js';import {BUILD} from './build.js';
const $=id=>document.getElementById(id),installer=new UnitInstaller();let ready=false,currentInstalled=null,currentSession=null,registration=null;
const diag=(type,extra={})=>runtime.request('event',{evidence_type:type,...extra,_core_build:BUILD}).catch(()=>{});
async function guard(fn){try{await fn()}catch(e){$('status').textContent=e.message;}}
async function enter(row,intent){const out=await library.openUnit(row.unit_id,intent,{online:navigator.onLine!==false,shellReady:ready});location.href=out.url;}
function button(label,fn,parent){const b=document.createElement('button');b.textContent=label;b.className='quiet';b.onclick=()=>guard(fn);parent.append(b);return b;}
async function directory(filter){const box=$('directory');box.hidden=false;box.replaceChildren();const h=document.createElement('h2');h.textContent='课程目录';box.append(h);
 for(const row of (await library.list()).filter(r=>typeof filter!=='string'||r.unit_type===filter)){button(row.title+' · '+row.state,async()=>{box.replaceChildren();const title=document.createElement('h2');title.textContent=row.title;box.append(title);const label=row.state==='课件需要重新连接'?'重新连接课件':row.state==='已完成'?'再学一次':row.state==='未开始'?'开始学习':'继续学习';const b=button(label,()=>label==='重新连接课件'?$('package').click():enter(row,label==='再学一次'?'replay':label==='开始学习'?'start':'resume'),box);b.className='primary';if(row.state==='学习中')button('重新开始本课',async()=>{if(confirm('重新开始本课？已保存的历史记录会保留。'))await enter(row,'restart');},box);button('返回目录',directory,box);},box);}}
async function refresh(){const rows=await library.list(),due=await library.due();if($('practice')){$('practice').hidden=due.length===0;$('practice').textContent=due.length?'巩固练习 · 今日 '+due.length+' 项':'巩固练习';$('practice').onclick=()=>guard(async()=>{const current=(await storage.get('critical','session'))?.value;if(current?.session_kind==='review'&&['new','active','interrupted'].includes(current.status)){location.href='./activity.html?unit='+encodeURIComponent(current.unit_id)+'&session='+current.session_id;return;}const item=due[0];if(!item)return;const out=await library.openUnit(item.unit_id,'review',{online:navigator.onLine!==false,shellReady:ready,review_item_id:item.id});location.href=out.url;});}if($('continuous')){$('continuous').hidden=!rows.some(r=>r.unit_type==='continuous_listening');$('continuous').onclick=()=>guard(()=>directory('continuous_listening'));}const row=await library.continuation();currentInstalled=row?.offline_ready?row:null;currentSession=row?.progress;$('course').textContent=row?row.title+' · '+row.state:'还没有导入课件';$('start').hidden=!row;if(row){$('start').textContent=row.state==='课件需要重新连接'?'重新连接课件':row.state==='已完成'?'再学一次':row.state==='未开始'?'开始学习':'继续学习';$('start').onclick=()=>guard(()=>row.state==='课件需要重新连接'?$('package').click():enter(row,row.state==='已完成'?'replay':row.state==='未开始'?'start':'resume'));}return row;}
if($('diagnostic'))$('diagnostic').onclick=()=>guard(exportDiagnostic);
$('catalog').onclick=()=>guard(directory);
$('import').onclick=()=>$('package').click();$('package').onchange=()=>guard(async()=>{const f=$('package').files[0];if(!f)return;$('import').disabled=true;try{$('status').textContent='正在检查并安装，请稍等。';await installer.install(f);await refresh();await checkReady();}finally{$('import').disabled=false;$('package').value='';}});
$('backup').onclick=()=>guard(exportState);$('restore').onchange=()=>guard(async()=>{const f=$('restore').files[0];if(f){await restoreProgress(f);await refresh();$('status').textContent='进度已恢复。';}});
async function askReady(worker){
 if(!worker)return {ready:false};
 return new Promise(resolve=>{const c=new MessageChannel(),timeout=setTimeout(()=>{c.port1.close();resolve({ready:false});},5000);c.port1.onmessage=e=>{clearTimeout(timeout);c.port1.close();resolve(e.data||{ready:false});};try{worker.postMessage({type:'CHECK_READY'},[c.port2]);}catch{clearTimeout(timeout);resolve({ready:false});}});
}
async function checkReady(reg=registration){
 const worker=navigator.serviceWorker.controller||reg?.active;
 const reply=await askReady(worker);
 ready=reply.ready===true&&reply.version===BUILD;
 const installed=!!currentInstalled;
 $('start').disabled=installed&&(navigator.onLine===false&&!ready);
 if($('restart'))$('restart').disabled=!installed||(navigator.onLine===false&&!ready);
 if(ready)$('status').textContent='已准备好';
 else if(navigator.onLine===false)$('status').textContent='离线准备尚未完成，请联网打开一次。';
 else $('status').textContent='在线可学习，正在准备离线使用…';
 if(ready)diag('sw_ready',{version:reply.version});
 return ready;
}
let prepareSeq=0;
const timeout=(ms,label)=>new Promise((_,reject)=>setTimeout(()=>reject(Error(label)),ms));
async function prepare(){
 const seq=++prepareSeq,offline=navigator.onLine===false;
 $('status').textContent=offline?'正在读取本机课程…':'正在准备离线使用…';
 // Render device-local course/progress first. Maintenance must never blank the home screen.
 try{await Promise.race([refresh(),timeout(4000,'local_refresh_timeout')]);}catch(e){diag('HOME_LOCAL_REFRESH_DEFERRED',{reason:e?.message||'refresh'}).catch(()=>{});}
 if(seq!==prepareSeq)return;
 if(!globalThis.isSecureContext||!navigator.serviceWorker)throw Error('请从原来的HTTPS网址打开。');
 if(!offline){
  const v=await fetch('./version.json',{cache:'reload'}).then(r=>r.json());if(v.shell_version!==BUILD)throw Error('版本更新还没完成，请关闭所有英语学习页面后重新打开。');
  registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',type:'module',updateViaCache:'none'});
 }else{
  registration=await navigator.serviceWorker.getRegistration('./');
  if(!registration){ready=false;$('status').textContent='离线准备尚未完成，请联网打开一次。';return;}
 }
 const updateNotice=()=>{if(registration?.waiting)$('status').textContent='更新已下载。请关闭英语学习和此网站的Safari页面，再重新打开。';};
 registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){updateNotice();checkReady(registration).catch(()=>{});}if(worker.state==='redundant')$('status').textContent='准备未完成，请联网后重试。';});});
 navigator.serviceWorker.addEventListener('controllerchange',()=>checkReady(registration).catch(()=>{}),{once:true});
 // Existing offline controller/cache should be usable immediately; do not wait on repair/GC.
 await checkReady(registration);
 if(!offline){
  try{await Promise.race([navigator.serviceWorker.ready,timeout(15000,'sw_wait_timeout')]);}catch{}
  try{await library.repair();await refresh();}catch(e){diag('HOME_REPAIR_DEFERRED',{reason:e?.message||'repair'}).catch(()=>{});}
  await checkReady(registration);updateNotice();
 }else{
  // Recovery/GC is maintenance. Run it in the background so Return-to-Course works offline.
  Promise.race([library.repair().then(()=>refresh()),timeout(5000,'offline_repair_timeout')])
   .then(()=>checkReady(registration))
   .catch(e=>diag('OFFLINE_HOME_REPAIR_DEFERRED',{reason:e?.message||'repair'}).catch(()=>{}));
 }
}
window.addEventListener('online',()=>guard(prepare));window.addEventListener('offline',()=>{diag('offline');checkReady(registration).catch(()=>{});});
window.addEventListener('pageshow',()=>{refresh().then(()=>checkReady(registration)).catch(()=>{});});
if($('build-label'))$('build-label').textContent=BUILD;
guard(prepare);
