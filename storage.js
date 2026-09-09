// Explicitly device-local. No silent volatile fallback for critical evidence.
export const STORES=['critical','events','media','assets','review','temporary'];
export class StorageAdapter {
  constructor(factory=globalThis.indexedDB){this.factory=factory;}
  async open(){if(this.db)return this;if(!this.factory)throw Error('此浏览器不能保存学习记录，请不要开始。');this.db=await new Promise((resolve,reject)=>{const q=this.factory.open('english-course-shell:'+new URL('./',import.meta.url).pathname,1);q.onupgradeneeded=()=>{for(const name of STORES)if(!q.result.objectStoreNames.contains(name))q.result.createObjectStore(name,{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);q.onblocked=()=>reject(Error('请关闭另一个学习页面后再试。'));});this.db.onversionchange=()=>this.db.close();return this;}
  async get(store,id){await this.open();return new Promise((resolve,reject)=>{const q=this.db.transaction(store).objectStore(store).get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});}
  async batch(ops){await this.open();return new Promise((resolve,reject)=>{const tx=this.db.transaction([...new Set(ops.map(o=>o.store))],'readwrite');let conflict=false;tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict?Error('另一页面刚保存了进度，请再试一次。'):tx.error||Error('保存被中断'));const write=()=>{for(const o of ops){const st=tx.objectStore(o.store);if(o.delete)st.delete(o.id);else st.put(o.value);}};const guard=ops.find(o=>o.store==='critical'&&o.value?.id==='session'&&o.expected_revision!==undefined);if(guard){const q=tx.objectStore('critical').get('session');q.onsuccess=()=>{if((q.result?.value?.revision||0)!==guard.expected_revision){conflict=true;tx.abort();}else write();};}else write();});}
  put(store,value){return this.batch([{store,value}]);}
  // Bounded cursor page: large course libraries never enter one giant array.
  async page(store,after=null,limit=100){await this.open();return new Promise((resolve,reject)=>{const rows=[];const range=after===null?null:IDBKeyRange.lowerBound(after,true);const q=this.db.transaction(store).objectStore(store).openCursor(range);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const c=q.result;if(!c||rows.length>=limit)return resolve(rows);rows.push(c.value);c.continue();};});}
  async *iterate(store){let after=null;while(true){const rows=await this.page(store,after);if(!rows.length)return;for(const row of rows)yield row;after=rows.at(-1).id;}}
}
export const storage=new StorageAdapter();
export async function sha256(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');}
