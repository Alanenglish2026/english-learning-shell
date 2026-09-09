import {runtime} from './local_runtime.js';import {storage} from './storage.js';import {courseResponse} from './packages.js';import {here} from './base.js';
export const LOCAL=true;
export async function lessonFetch(url,options={}){
 const path=String(url);try{
  if(!path.startsWith('./api/'))return path.startsWith('./course/')?courseResponse(path.slice(9)):fetch(here(path));
  const action=path.slice(6);if(action.startsWith('recording/')){const row=await storage.get('media',action.split('/')[1]);if(!row)throw Error('这段临时声音已清理。');return new Response(row.blob);}
  return new Response(JSON.stringify(await runtime.request(action,options.body?JSON.parse(options.body):undefined)),{headers:{'Content-Type':'application/json'}});
 }catch(e){return new Response(JSON.stringify({error:e.name==='QuotaExceededError'?'空间不足，请导出学习进度。':e.message}),{status:400});}
}
export const saveRecording=data=>runtime.request('record',data);
