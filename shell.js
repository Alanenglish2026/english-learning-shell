import {storage} from './storage.js';import {UnitInstaller,INSTALLED} from './packages.js';import {exportState,restoreProgress} from './transfer.js';
const $=id=>document.getElementById(id),installer=new UnitInstaller();let ready=false;
const diag=(type,extra={})=>import('./local_runtime.js').then(({runtime})=>runtime.request('event',{evidence_type:type,...extra})).catch(()=>{});
async function refresh(){const installed=await storage.get('critical',INSTALLED);$('course').textContent=installed?'已安装课程：U01 Day1':'还没有导入课件';$('start').hidden=!installed;}
async function guard(fn){try{await fn()}catch(e){$('status').textContent=e.message;}}
$('import').onclick=()=>$('package').click();$('package').onchange=()=>guard(async()=>{const f=$('package').files[0];if(!f)return;$('import').disabled=true;try{$('status').textContent='正在检查并安装，请稍等。';await installer.install(f);await refresh();$('status').textContent=ready?'课件已安装，已准备好。':'课件已安装，正在准备离线使用…';}finally{$('import').disabled=false;$('package').value='';}});
$('start').onclick=()=>guard(async()=>{if(!ready||!navigator.serviceWorker.controller)throw Error('离线准备尚未完成，请联网重新打开一次。');location.href='./lesson.html';});
$('backup').onclick=()=>guard(exportState);$('restore').onchange=()=>guard(async()=>{const f=$('restore').files[0];if(f){const r=await restoreProgress(f);$('status').textContent=r.interrupted_audio?'进度已恢复；中断且无原音的那次说话需要重试。':'进度已恢复。';}});
async function checkReady(){
 if(!navigator.serviceWorker.controller)return false;
 const reply=await new Promise(resolve=>{const c=new MessageChannel(),timeout=setTimeout(()=>{c.port1.close();resolve({ready:false});},5000);c.port1.onmessage=e=>{clearTimeout(timeout);c.port1.close();resolve(e.data);};navigator.serviceWorker.controller.postMessage({type:'CHECK_READY'},[c.port2]);});
 ready=reply.ready===true&&reply.version==='1.1.0-rc.4';$('start').disabled=!ready;
 $('status').textContent=ready?'已准备好':navigator.onLine===false?'请先联网完成离线准备，再开始学习。':'正在准备离线使用…';if(ready)diag('sw_ready',{version:reply.version});return ready;
}
async function prepare(){
 $('status').textContent='正在准备离线使用…';$('start').disabled=true;await refresh();
 if(!globalThis.isSecureContext||!navigator.serviceWorker)throw Error('请从原来的HTTPS网址打开。');
 const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
 const updateNotice=()=>{if(reg.waiting)$('status').textContent='更新已下载。请关闭英语学习和此网站的Safari页面，再重新打开。';};
 reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')updateNotice();if(worker.state==='redundant')$('status').textContent='准备未完成，请联网后重试。';});});
 navigator.serviceWorker.addEventListener('controllerchange',()=>checkReady().catch(()=>{}));
 await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('准备还未完成，请保持联网，重新打开一次。')),15000))]);
 await checkReady();updateNotice();
}
window.addEventListener('online',()=>guard(prepare));window.addEventListener('offline',()=>{diag('offline');if(!ready)$('status').textContent='请先联网完成离线准备，再开始学习。';});
window.addEventListener('pageshow',()=>{if(navigator.serviceWorker?.controller)checkReady().catch(()=>{});});
guard(prepare);
