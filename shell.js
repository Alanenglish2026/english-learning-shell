import {exportDiagnostic} from './diagnostic.js';
import {storage} from './storage.js';import {UnitInstaller} from './packages.js';import {exportState,restoreProgress} from './transfer.js';import {runtime} from './local_runtime.js';import {library} from './library.js';import {BUILD} from './build.js';
const $=id=>document.getElementById(id),installer=new UnitInstaller();let ready=false,currentInstalled=null,currentSession=null,registration=null;
const diag=(type,extra={})=>runtime.request('event',{evidence_type:type,...extra,_core_build:BUILD}).catch(()=>{});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clearTransientHome(){if($('directory')){$('directory').hidden=true;$('directory').replaceChildren();}}
function reopenLocalDB(){try{storage.db?.close?.();}catch{}storage.db=undefined;}
async function localFirst(){for(let i=0;i<3;i++){const row=await refresh({fast:true,preserve:true});if(row)return row;await sleep(80*(i+1));}return refresh({preserve:true});}
async function guard(fn){try{await fn()}catch(e){$('status').textContent=e.message;}}
async function enter(row,intent){const out=await library.openUnit(row.unit_id,intent,{online:navigator.onLine!==false,shellReady:ready});location.href=out.url;}
function button(label,fn,parent){const b=document.createElement('button');b.textContent=label;b.className='quiet';b.onclick=()=>guard(fn);parent.append(b);return b;}
async function directory(filter){const box=$('directory');box.hidden=false;box.replaceChildren();const h=document.createElement('h2');h.textContent='课程目录';box.append(h);
 for(const row of (await library.list()).filter(r=>typeof filter!=='string'||r.unit_type===filter)){button(row.title+' · '+row.state,async()=>{box.replaceChildren();const title=document.createElement('h2');title.textContent=row.title;box.append(title);const label=row.state==='课件需要重新连接'?'重新连接课件':row.state==='已完成'?'再学一次':row.state==='未开始'?'开始学习':'继续学习';const b=button(label,()=>label==='重新连接课件'?$('package').click():enter(row,label==='再学一次'?'replay':label==='开始学习'?'start':'resume'),box);b.className='primary';if(row.state==='学习中')button('重新开始本课',async()=>{if(confirm('重新开始本课？已保存的历史记录会保留。'))await enter(row,'restart');},box);button('返回目录',directory,box);},box);}}
async function refresh({fast=false,preserve=false}={}){const rows=fast?await library.localSnapshot():await library.list(),due=await library.due();if($('practice')){$('practice').hidden=due.length===0;$('practice').textContent=due.length?'巩固练习 · 今日 '+due.length+' 项':'巩固练习';$('practice').onclick=()=>guard(async()=>{const current=(await storage.get('critical','session'))?.value;if(current?.session_kind==='review'&&['new','active','interrupted'].includes(current.status)){location.href='./activity.html?unit='+encodeURIComponent(current.unit_id)+'&session='+current.session_id;return;}const item=due[0];if(!item)return;const out=await library.openUnit(item.unit_id,'review',{online:navigator.onLine!==false,shellReady:ready,review_item_id:item.id});location.href=out.url;});}if($('continuous')){$('continuous').hidden=!rows.some(r=>r.unit_type==='continuous_listening');$('continuous').onclick=()=>guard(()=>directory('continuous_listening'));}let row=await library.continuation(rows);if(!row&&preserve)row=currentInstalled||null;if(row){currentInstalled=row.offline_ready?row:currentInstalled;currentSession=row.progress;$('course').textContent=row.title+' · '+row.state;$('start').hidden=false;$('start').textContent=row.state==='课件需要重新连接'?'重新连接课件':row.state==='已完成'?'再学一次':row.state==='未开始'?'开始学习':'继续学习';$('start').onclick=()=>guard(()=>row.state==='课件需要重新连接'?$('package').click():enter(row,row.state==='已完成'?'replay':row.state==='未开始'?'start':'resume'));}else if(!preserve){currentInstalled=null;currentSession=null;$('course').textContent='还没有导入课件';$('start').hidden=true;}return row;}
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
 else if(currentInstalled)$('status').textContent='本机课程已读取；正在检查离线外壳…';
 else if(navigator.onLine===false)$('status').textContent='离线准备尚未完成，请联网打开一次。';
 else $('status').textContent='正在准备离线使用…';
 if(ready)diag('sw_ready',{version:reply.version});
 return ready;
}
let prepareSeq=0;
const timeout=(ms,label)=>new Promise((_,reject)=>setTimeout(()=>reject(Error(label)),ms));
async function prepare(){
 const seq=++prepareSeq;
 clearTransientHome();
 $('status').textContent='正在读取本机课程…';
 // First paint is device-local only. Never let network/SW maintenance erase a known local course.
 try{await Promise.race([localFirst(),timeout(2500,'local_snapshot_timeout')]);}catch(e){diag('HOME_LOCAL_SNAPSHOT_DEFERRED',{reason:e?.message||'snapshot'}).catch(()=>{});}
 if(seq!==prepareSeq)return;
 if(!globalThis.isSecureContext||!navigator.serviceWorker)throw Error('请从原来的HTTPS网址打开。');
 registration=await navigator.serviceWorker.getRegistration('./');
 // Register/update opportunistically. navigator.onLine is not trusted as proof of connectivity on iOS.
 if(!registration){try{registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',type:'module',updateViaCache:'none'});}catch(e){diag('SW_REGISTER_DEFERRED',{reason:e?.message||'register'}).catch(()=>{});}}
 if(registration){
  const updateNotice=()=>{if(registration?.waiting)$('status').textContent='更新已下载。请关闭英语学习和此网站的Safari页面，再重新打开。';};
  registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'){updateNotice();checkReady(registration).catch(()=>{});}if(worker.state==='redundant')diag('SW_UPDATE_REDUNDANT').catch(()=>{});});});
  navigator.serviceWorker.addEventListener('controllerchange',()=>checkReady(registration).catch(()=>{}),{once:true});
 }
 await checkReady(registration);
 if(seq!==prepareSeq)return;
 // Verified local refresh may repair stale metadata, but a slow/failed verification must not blank the snapshot.
 try{await Promise.race([refresh({preserve:true}),timeout(4500,'verified_refresh_timeout')]);}catch(e){diag('HOME_VERIFIED_REFRESH_DEFERRED',{reason:e?.message||'refresh'}).catch(()=>{});}
 if(seq!==prepareSeq)return;
 await checkReady(registration);
 // Maintenance is always background-only on device. It may improve state, never gate Return-to-Course.
 Promise.race([library.repair(),timeout(6000,'home_repair_timeout')])
  .then(()=>refresh({preserve:true}))
  .then(()=>checkReady(registration))
  .catch(e=>diag('HOME_REPAIR_DEFERRED',{reason:e?.message||'repair'}).catch(()=>{}));
}
window.addEventListener('online',()=>guard(prepare));
window.addEventListener('offline',()=>{diag('offline');refresh({fast:true,preserve:true}).then(()=>checkReady(registration)).catch(()=>{});});
window.addEventListener('pageshow',e=>{if(e.persisted){reopenLocalDB();diag('HOME_BFCACHE_REOPEN').catch(()=>{});}guard(prepare);});
window.addEventListener('popstate',()=>{reopenLocalDB();guard(prepare);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)guard(prepare);});
if($('build-label'))$('build-label').textContent=BUILD;
guard(prepare);
