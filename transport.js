import {registry} from './registry.js';
import {BUILD} from './build.js';
import {runtime,RUNTIME_BUILD} from './local_runtime.js';import {storage} from './storage.js';import {courseResponse} from './packages.js';import {here} from './base.js';
export const LOCAL=true;
let boundSession;try{boundSession=new URL(location.href).searchParams.get('session');}catch{}
export async function lessonFetch(url,options={}){
 const path=String(url);try{if(RUNTIME_BUILD!==BUILD)throw Error('版本更新未完成，请关闭其他学习页面后重新打开。');
  if(path.startsWith('./units/')){const bits=path.slice(8).split('/');return registry.response(bits[0],bits.slice(bits[1]==='s'?3:1).join('/'),bits[1]==='s'?bits[2]:null);}
  if(!path.startsWith('./api/'))return path.startsWith('./course/')?courseResponse(path.slice(9)):fetch(here(path));
  const action=path.slice(6);if(action.startsWith('recording/')){const row=await storage.get('media',action.split('/')[1]);if(!row)throw Error('这段临时声音已清理。');return new Response(row.blob);}
  const data=options.body?JSON.parse(options.body):{};const value=await runtime.request(action,{...data,_core_build:BUILD,...(boundSession?{_session_id:boundSession}:{})});if(value?.session_id){boundSession=value.session_id;try{const u=new URL(location.href);u.searchParams.set('session',boundSession);u.searchParams.set('unit',value.unit_id);history.replaceState(null,'',u);}catch{}}return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 }catch(e){return new Response(JSON.stringify({error:e.name==='QuotaExceededError'?'空间不足，请导出学习进度。':e.message}),{status:400});}
}
export const saveRecording=data=>runtime.request('record',{...data,_core_build:BUILD,_session_id:boundSession});
