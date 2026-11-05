/* OCVMS v1.0.3. Local, device-only record cache and per-account outbox.
   No passwords/cookies/API responses are stored by the service worker. */
const NAME='ocvms-device-store-v1', VERSION=1;
let handle;
function openDB(){
 if(!('indexedDB' in window))return Promise.reject(Error('Offline storage is unavailable in this browser.'));
 if(!handle)handle=new Promise((resolve,reject)=>{
  const r=indexedDB.open(NAME,VERSION);
  r.onupgradeneeded=()=>{
   const db=r.result;
   if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv');
   if(!db.objectStoreNames.contains('outbox'))db.createObjectStore('outbox',{keyPath:'id'});
  };
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
 return handle;
}
async function txn(store,mode,action){
 const db=await openDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,mode),os=tx.objectStore(store),request=action(os);
  let val;request.onsuccess=()=>{val=request.result};request.onerror=()=>reject(request.error);
  tx.oncomplete=()=>resolve(val);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });
}
export async function kvGet(key){return txn('kv','readonly',os=>os.get(key));}
export async function kvPut(key,value){return txn('kv','readwrite',os=>os.put(value,key));}
export async function kvDelete(key){return txn('kv','readwrite',os=>os.delete(key));}
export async function saveSession(user){await kvPut('offline-session',{user:{id:user.id,username:user.username,full_name:user.full_name,role:user.role},confirmedAt:Date.now()});}
export async function readSession(){const s=await kvGet('offline-session');if(!s||!s.user||Date.now()-s.confirmedAt>12*60*60*1000)return null;return s;}
export async function cacheRead(userId,path){return kvGet(`response:${userId}:${path}`);}
export async function cacheWrite(userId,path,data){return kvPut(`response:${userId}:${path}`,{data,time:Date.now()});}
export async function listOutbox(userId){const rows=await txn('outbox','readonly',os=>os.getAll());return rows.filter(x=>x.userId===userId).sort((a,b)=>a.createdAt-b.createdAt);}
export async function deleteOutbox(id){return txn('outbox','readwrite',os=>os.delete(id));}
export async function putOutbox(op){return txn('outbox','readwrite',os=>os.put(op));}
export async function enqueue(userId,path,payload){
 if(!userId)throw Error('Sign in online once before encoding offline.');
 const rows=await listOutbox(userId);
 const key=path==='/census'?`census:${payload.barangay_id}:${payload.species_code}:${payload.month}`:
   path==='/vaccinations'?`vaccinations:${payload.id||payload.client_id}`:
   path.endsWith('/delete')?`${path.split('/')[1]}:${payload.id}`:'';
 if(key){
  const existing=rows.find(x=>x.key===key && x.status==='pending');
  if(existing && !path.endsWith('/delete')){
   // Last edit supersedes an unsynced earlier edit, retaining its original revision and idempotency token.
   const original=existing.payload;
   if(path==='/vaccinations' && original.client_id){delete payload.id;payload.client_id=original.client_id;}
   payload.expected_revision=original.expected_revision;
   payload.mutation_id=original.mutation_id;
   existing.payload=payload;await putOutbox(existing);return existing;
  }
  if(existing && path.endsWith('/delete'))return existing;
 }
 if(path.endsWith('/delete')){
  const type=path.split('/')[1];
  const earlier=rows.find(x=>x.path===`/${type}` && x.status==='pending' &&
    (type==='census'?payload.key===x.key:`${x.payload.id||x.payload.client_id}`===`${payload.id}`));
  if(earlier){
   await deleteOutbox(earlier.id);
   if(Number(earlier.payload.expected_revision)===0)return {cancelledDraft:true};
   payload.expected_revision=earlier.payload.expected_revision;
  }
 }
 const op={id:crypto.randomUUID(),userId,path,payload,key,status:'pending',error:'',createdAt:Date.now()};
 await putOutbox(op);return op;
}
export async function markOutbox(op,error,status='failed'){await putOutbox({...op,status,error:String(error||'Sync failed.').slice(0,280)});}
export async function clearUserDeviceData(userId){
 if(!userId)return;
 const db=await openDB();const rows=await listOutbox(userId);
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(['kv','outbox'],'readwrite'),kv=tx.objectStore('kv'),ob=tx.objectStore('outbox');
  const r=kv.getAllKeys();r.onsuccess=()=>{for(const key of r.result)if(key.startsWith(`response:${userId}:`))kv.delete(key);};
  for(const row of rows)ob.delete(row.id);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 await kvDelete('offline-session');
}
export function isConnectivityError(e){return !!e?.isNetworkError;}
export async function installServiceWorker(){
 if('serviceWorker' in navigator && window.isSecureContext){try{return await navigator.serviceWorker.register('/sw.js',{scope:'/'});}catch(e){console.warn('Offline shell could not be installed',e);}}
 return null;
}
