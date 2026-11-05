/* OCVMS v1.0.3 — Cloudflare D1 is authoritative. Offline drafts stay on this device until synced. */
import {kvDelete,saveSession,readSession,cacheRead,cacheWrite,listOutbox,enqueue,deleteOutbox,markOutbox,clearUserDeviceData,installServiceWorker,isConnectivityError} from './offline.js';
const app=document.querySelector('#app');
const nowPH=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
const state={user:null,catalog:null,page:'dashboard',month:nowPH().slice(0,7),barangay:'',data:null,census:[],vaccinations:[],users:[],audit:[],search:'',offline:false,offlineAt:0,queue:[],syncing:false};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-PH');
const $=sel=>document.querySelector(sel);
function message(s,type='notice'){const box=$('#flash');if(!box)return;box.innerHTML=`<div class="${type}">${esc(s)}</div>`;box.scrollIntoView({behavior:'smooth',block:'nearest'});}
const cacheable=path=>/^\/(catalog|dashboard\?|census\?|vaccinations\?)/.test(path);
async function api(path,opts={}){
 const useCache=(!opts.method||opts.method==='GET')&&cacheable(path)&&state.user;
 const getOffline=async()=>{
   let cached=await cacheRead(state.user.id,path);
   const scope=path.match(/&barangay_id=(\d+)/);
   if(!cached&&scope&&/^\/(census|vaccinations)\?/.test(path)){
    cached=await cacheRead(state.user.id,path.replace(/&barangay_id=\d+/,''));
    if(cached)return {...cached,data:{...cached.data,rows:cached.data.rows.filter(r=>String(r.barangay_id)===scope[1])}};
   }
   if(!cached&&scope&&path.startsWith('/dashboard?')){
    cached=await cacheRead(state.user.id,path.replace(/&barangay_id=\d+/,''));
    if(cached){const rows=cached.data.barangays.filter(r=>String(r.id)===scope[1]);
      const sum=k=>rows.reduce((a,b)=>a+Number(b[k]||0),0);
      return {...cached,data:{...cached.data,barangays:rows,species:[],totals:{animals:sum('animals'),dogs:sum('dogs'),cats:sum('cats'),livestock:sum('livestock'),poultry:sum('poultry'),vaccinated_dogs:sum('vaccinated_dogs'),vaccinated_cats:sum('vaccinated_cats'),reporting:rows.filter(r=>r.species_reported>0).length,expected:rows.length}}};
    }
   }
   return cached;
 };
 if(navigator.onLine===false && useCache){
  const auth=await readSession();if(!auth||auth.user.id!==state.user.id)throw Error('Offline session expired. Reconnect and sign in again.');
  state.offline=true;const cached=await getOffline();
  if(cached)return cached.data;
  throw Error('No offline copy for this month. Open the month while online first.');
 }
 let res;
 try{res=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',...opts,headers:{...(opts.body?{'content-type':'application/json'}:{}),...(opts.headers||{})}});}
 catch(error){const e=Error('Cloudflare cannot be reached.');e.isNetworkError=true;
  if(useCache){const cached=await getOffline();if(cached){state.offline=true;state.offlineAt=cached.time;return cached.data;}}
  throw e;
 }
 let data;try{data=await res.json();}catch{throw Error('Server response was not valid JSON. Check Cloudflare deployment and D1 setup.');}
 if(!res.ok){const e=Error(data.error||'Server request failed.');e.status=res.status;
  if(res.status===401 && !['/login','/bootstrap','/me'].includes(path)){state.user=null;await kvDelete('offline-session');await authPage();}
  throw e;
 }
 state.offline=false;
 if(useCache)await cacheWrite(state.user.id,path,data);
 return data;
}
const canQueue=path=>['/census','/vaccinations','/census/delete','/vaccinations/delete'].includes(path);
async function post(path,data){
 if(canQueue(path)){
  data={...data,mutation_id:data.mutation_id||crypto.randomUUID()};
  if(path==='/vaccinations'&&!data.id)data.client_id=data.client_id||crypto.randomUUID();
  if(navigator.onLine===false){const sess=await readSession();if(!sess||sess.user.id!==state.user?.id)throw Error('Offline session expired. Reconnect and sign in again.');await enqueue(state.user?.id,path,data);state.offline=true;await updateOfflineStatus();return {queued:true};}
  try{return await api(path,{method:'POST',body:JSON.stringify(data)});}
  catch(e){if(!isConnectivityError(e))throw e;
   await enqueue(state.user?.id,path,data);state.offline=true;await updateOfflineStatus();return {queued:true};}
 }
 if(navigator.onLine===false)throw Error('This action needs internet access and an active City Veterinary Office session.');
 return api(path,{method:'POST',body:JSON.stringify(data)});
}
const params=x=>new URLSearchParams(x).toString();
const roleText=r=>({admin:'City Admin',encoder:'Encoder',viewer:'City Viewer'}[r]||r);
const allowedWrite=()=>state.user?.role!=='viewer';
const isAdmin=()=>state.user?.role==='admin';
function brgyOptions(selected='',all=false){
 const rows=state.catalog?.barangays||[];
 return `${all?'<option value="">All 85 barangays</option>':''}`+rows.map(b=>`<option value="${b.id}" ${String(b.id)===String(selected)?'selected':''}>${esc(b.name)}</option>`).join('');
}
function speciesOptions(selected='',petOnly=false){return (state.catalog?.species||[]).filter(x=>!petOnly||['cat','dog'].includes(x.code)).map(x=>`<option value="${esc(x.code)}" ${x.code===selected?'selected':''}>${esc(x.name)}</option>`).join('');}
const stat=(label,value,foot,featured=false)=>`<div class="stat ${featured?'featured':''}"><small>${esc(label)}</small><strong>${fmt(value)}</strong><em>${esc(foot)}</em></div>`;
const statusBadge=s=>`<span class="status ${esc(s)}">${esc((s||'').toUpperCase())}</span>`;
const head=(title,sub)=>`<div class="page-title"><div><p class="eyebrow">City Veterinary Office · Ormoc City</p><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div>`;
function table(headers,rows,empty='No records found for the selected period.'){
 return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th class="${h.number?'number':''}">${esc(h.label||h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}" class="no-data">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}
function filterToolbar(exportType=''){
 return `<div class="toolbar"><div class="field"><label>Reporting month</label><input type="month" id="period" value="${esc(state.month)}"></div>
 <div class="field"><label>Barangay</label><select id="scope">${brgyOptions(state.barangay,true)}</select></div>
 <div class="button-area"><button class="btn ghost" data-action="refresh">↻ Refresh</button>${exportType?`<button class="btn" data-action="export" data-type="${exportType}">↓ Export CSV</button>`:''}</div></div>`;
}
function dashboardView(){
 const d=state.data||{totals:{},barangays:[],species:[]},t=d.totals,max=Math.max(1,...d.species.map(x=>x.total));
 const category=Object.fromEntries((state.catalog?.species||[]).map(x=>[x.code,x]));
 const bars=d.species.slice().sort((a,b)=>b.total-a.total).map(x=>`<div class="species-row"><span>${esc(category[x.species_code]?.name||x.species_code)}</span><div class="bar"><span style="width:${Math.max(.5,100*x.total/max)}%"></span></div><strong>${fmt(x.total)}</strong></div>`).join('');
 const brgyRows=d.barangays.filter(x=>x.name.toLowerCase().includes(state.search.toLowerCase())).map(b=>`<tr><td><strong>${esc(b.name)}</strong><span class="user-meta">${esc(b.classification)}</span></td><td class="number">${fmt(b.animals)}</td><td class="number">${fmt(b.livestock)}</td><td class="number">${fmt(b.poultry)}</td><td class="number">${fmt(b.dogs)}</td><td class="number">${fmt(b.cats)}</td><td class="number">${fmt(b.vaccinated_dogs)}</td><td class="number">${fmt(b.vaccinated_cats)}</td><td>${b.species_reported?'<span class="status approved">REPORTED</span>':'<span class="flag">Not reported</span>'}</td></tr>`);
 return head('Citywide Monitoring Dashboard','Approved livestock inventories and anti-rabies vaccinations by barangay.')+
 `<div class="panel" style="margin-bottom:18px"><strong>CVO reporting workflow:</strong> CVO assigns an Encoder → collects barangay survey and vaccination reports → Encoder selects any of the 85 barangays and enters records or imports CSV → City Admin reviews and approves → approved results appear in citywide reports.</div>`+filterToolbar('summary')+
 `<div class="grid-stats">${stat('Animal population',t.animals||0,'Approved census snapshot · '+state.month,true)}${stat('Livestock',t.livestock||0,'Carabao, cattle, swine, goats, sheep & horses')}${stat('Poultry',t.poultry||0,'Chickens, ducks, turkeys & quails')}${stat('Barangays reporting',t.reporting||0,`of ${t.expected||0} in selected view`)}
 ${stat('Dogs inventoried',t.dogs||0,'Approved census')}${stat('Cats inventoried',t.cats||0,'Approved census')}${stat('Dog anti-rabies doses',t.vaccinated_dogs||0,'Approved administrations in month')}${stat('Cat anti-rabies doses',t.vaccinated_cats||0,'Approved administrations in month')}</div>
 <div class="grid-two"><div class="panel"><div class="panel-head"><h3>Monthly reporting completeness</h3><span class="flag">${t.reporting||0} / ${t.expected||0}</span></div>
 <div class="progress-label"><span>Barangays with approved census entries</span><strong>${t.expected?Math.round(100*t.reporting/t.expected):0}%</strong></div><div class="progress-shell"><div class="progress-fill" style="width:${t.expected?Math.round(100*t.reporting/t.expected):0}%"></div></div><p class="help" style="margin:13px 0 0">A barangay is counted as reporting once it has at least one approved species record. This does not mean its census is complete.</p></div>
 <div class="panel"><div class="panel-head"><h3>Population by species</h3><span class="muted">Approved head counts</span></div>${bars||'<div class="no-data">No approved census records yet.</div>'}</div></div>
 <div class="panel"><div class="panel-head"><h3>Barangay summary</h3><span class="muted">Vaccinations shown as doses, not unique animals</span></div>
 <div class="field" style="max-width:340px;margin:0 0 13px"><input id="search-brgy" placeholder="Search barangay…" value="${esc(state.search)}"></div>
 ${table(['Barangay',{label:'Total animals',number:true},{label:'Livestock',number:true},{label:'Poultry',number:true},{label:'Dogs',number:true},{label:'Cats',number:true},{label:'Dog rabies doses',number:true},{label:'Cat rabies doses',number:true},'Census status'],brgyRows)}</div>
 <div class="warning">Vaccination totals are administered doses, not necessarily the number of unique pets vaccinated. They should not be presented as vaccination coverage percentages without individual-animal deduplication.</div>`;
}
function reviewButtons(entity,r){return r.__pending?'<span class="flag">Local draft</span>':r.deletion_requested?isAdmin()?`<button class="btn tiny" data-action="review-delete" data-entity="${entity}" data-id="${esc(r.id)}" data-decision="approve">Approve delete</button><button class="btn tiny ghost" data-action="review-delete" data-entity="${entity}" data-id="${esc(r.id)}" data-decision="reject">Keep</button>`:'<span class="flag">Deletion awaiting CVO</span>':isAdmin()?`<button class="btn tiny" data-action="review" data-entity="${entity}" data-id="${esc(r.id)}" data-status="approved">Approve</button><button class="btn tiny danger" data-action="review" data-entity="${entity}" data-id="${esc(r.id)}" data-status="rejected">Reject</button>`:'';}
function censusView(){
 const rows=state.census.map(r=>`<tr><td><strong>${esc(r.barangay)}</strong><span class="user-meta">${esc(r.psgc)}</span></td><td>${esc(r.species_name)}</td><td class="number">${fmt(r.head_count)}</td><td class="number">${fmt(r.households)}</td><td>${r.__deletePending?'<span class="flag">DELETE QUEUED</span>':r.__pending?'<span class="flag">UNSYNCED</span>':r.deletion_requested?'<span class="flag">DELETE REQUEST</span>':statusBadge(r.status)}</td><td title="${esc(r.notes)}">${esc((r.notes||'').slice(0,60))}</td><td>${esc(r.updated_at||'')}</td><td>${allowedWrite()?`<button class="btn tiny ghost" data-action="edit-census" data-id="${esc(r.id)}">Edit</button><button class="btn tiny danger" data-action="delete-record" data-entity="census" data-id="${esc(r.id)}">Delete</button>`:''}${reviewButtons('census',r)}</td></tr>`);
 return head('Animal & Livestock Census','CVO Encoders may record monthly livestock and animal counts from any barangay.')+filterToolbar('census')+
 `<div class="formsplit"><div class="panel"><h3>Save monthly inventory</h3><p class="help">One total per barangay, species, and month. Saving an existing entry replaces its count and returns it to pending review.</p>
 ${allowedWrite()?`<form id="census-form"><input type="hidden" name="expected_revision" value=""><div class="entry-grid"><div class="field wide"><label>Barangay</label><select name="barangay_id" required>${brgyOptions(state.barangay)}</select></div>
 <div class="field wide"><label>Animal species</label><select name="species_code" required>${speciesOptions('swine')}</select></div>
 <div class="field"><label>Reporting month</label><input type="month" name="month" value="${esc(state.month)}" required></div>
 <div class="field"><label>Head count</label><input type="number" name="head_count" min="0" max="99999999" required placeholder="0"></div>
 <div class="field mobile-wide"><label>Households raising species (optional)</label><input type="number" name="households" min="0" max="9999999" value="0"></div>
 <div class="field wide"><label>Source or remarks</label><textarea name="notes" maxlength="600" placeholder="e.g., CVO collection date, source barangay report"></textarea></div></div>
 <button class="btn full" type="submit">Save inventory · Pending review</button></form>`:'<p class="help">Your account has read-only access.</p>'}</div>
 <div class="panel"><div class="panel-head"><h3>Inventory records</h3><span class="muted">${state.census.length} matching records</span></div>
 ${table(['Barangay','Species',{label:'Heads',number:true},{label:'Households',number:true},'Status','Remarks','Updated','Actions'],rows)}
 <h3 style="margin-top:22px">Bulk import from Excel-compatible CSV</h3><p class="help">Download the template, fill it using Excel or Numbers, then export/save as CSV UTF-8. Maximum 30 records per server batch (the app splits larger files automatically).</p>
 ${allowedWrite()?`<div class="import-strip"><button class="btn ghost" data-action="template" data-type="census">↓ CSV template</button><input type="file" class="input-file" accept=".csv,text/csv" id="import-census"><button class="btn" data-action="import" data-type="census">Import census CSV</button></div>`:''}
 <p class="help">PSGC codes use 10 digits and are provided in the included barangay reference file. Imported or changed records require administrator approval.</p></div></div>`;
}
function vaccinationView(){
 const rows=state.vaccinations.map(r=>`<tr><td>${esc(r.date)}</td><td><strong>${esc(r.barangay)}</strong></td><td>${r.species_code==='dog'?'Dog':'Cat'}</td><td>${esc(r.vaccine)}</td><td class="number">${fmt(r.doses)}</td><td>${esc(r.site||'—')}</td><td>${r.__deletePending?'<span class="flag">DELETE QUEUED</span>':r.__pending?'<span class="flag">UNSYNCED</span>':r.deletion_requested?'<span class="flag">DELETE REQUEST</span>':statusBadge(r.status)}</td><td>${allowedWrite()?`<button class="btn tiny ghost" data-action="edit-vaccination" data-id="${esc(r.id)}">Edit</button><button class="btn tiny danger" data-action="delete-record" data-entity="vaccinations" data-id="${esc(r.id)}">Delete</button>`:''}${reviewButtons('vaccinations',r)}</td></tr>`);
 return head('Dog & Cat Vaccination Monitoring','CVO Encoders may record vaccination activities from any barangay.')+filterToolbar('vaccinations')+
 `<div class="formsplit"><div class="panel"><h3>Record vaccination activity</h3><p class="help">Use separate records for dogs and cats. Doses may include repeat vaccinations of the same animal.</p>
 ${allowedWrite()?`<form id="vaccination-form"><input type="hidden" name="id" value=""><input type="hidden" name="expected_revision" value=""><div class="entry-grid"><div class="field wide"><label>Barangay</label><select name="barangay_id" required>${brgyOptions(state.barangay)}</select></div>
 <div class="field"><label>Date</label><input type="date" name="date" value="${nowPH()}" required></div><div class="field"><label>Species</label><select name="species_code">${speciesOptions('dog',true)}</select></div>
 <div class="field wide"><label>Vaccine</label><select name="vaccine"><option>Anti-rabies</option><option>Other</option></select></div>
 <div class="field"><label>Doses given</label><input type="number" min="1" max="9999999" name="doses" required></div>
 <div class="field mobile-wide"><label>Vaccination site</label><input name="site" maxlength="120" placeholder="Barangay hall, purok…"></div>
 <div class="field wide"><label>Campaign / notes</label><textarea maxlength="600" name="notes" placeholder="Campaign identifier, vaccine brand, etc."></textarea></div></div>
 <button class="btn full" type="submit">Save vaccination · Pending review</button><button class="btn ghost full hidden" type="button" data-action="clear-vaccination" id="cancel-edit" style="margin-top:8px">Cancel edit</button></form>`:'<p class="help">Your account has read-only access.</p>'}</div>
 <div class="panel"><div class="panel-head"><h3>Vaccination records</h3><span class="muted">${state.vaccinations.length} entries</span></div>
 ${table(['Date','Barangay','Species','Vaccine',{label:'Doses',number:true},'Site','Status','Actions'],rows)}
 <h3 style="margin-top:22px">Import vaccination CSV</h3><p class="help">For each event, enter date, 10-digit barangay PSGC, dog or cat, vaccine type, number of doses, site, and notes.</p>
 ${allowedWrite()?`<div class="import-strip"><button class="btn ghost" data-action="template" data-type="vaccinations">↓ CSV template</button><input type="file" class="input-file" accept=".csv,text/csv" id="import-vaccinations"><button class="btn" data-action="import" data-type="vaccinations">Import vaccination CSV</button></div>`:''}
 <p class="help">Unlike monthly inventory data, vaccination imports add new event records. Reimporting the same file will duplicate reported doses.</p></div></div>`;
}
function barangayView(){
 const d=state.data||{barangays:[]},rs=d.barangays.map(b=>`<tr><td><strong>${esc(b.name)}</strong></td><td>${esc(b.classification)}</td><td class="number">${fmt(b.animals)}</td><td class="number">${fmt(b.dogs+b.cats)}</td><td class="number">${fmt(b.vaccinated_dogs+b.vaccinated_cats)}</td><td>${b.species_reported?statusBadge('approved'):'<span class="flag">No approved census</span>'}</td></tr>`);
 return head('85 Barangays','Report status and dog/cat vaccination accomplishment by barangay.')+filterToolbar('summary')+
 `<div class="panel"><div class="panel-head"><h3>City veterinary coverage register</h3><span class="muted">PSA barangay roster · Approved data only</span></div>${table(['Barangay','Classification',{label:'Animal heads',number:true},{label:'Dogs + cats',number:true},{label:'Anti-rabies doses',number:true},'Reporting'],rs)}</div>`;
}
function userView(){
 const rows=state.users.map(x=>`<tr><td><strong>${esc(x.full_name)}</strong><span class="user-meta">${esc(x.username)}</span></td><td>${esc(roleText(x.role))}</td><td>${esc(x.barangay||'All barangays')}</td><td><span class="status ${x.active?'approved':'rejected'}">${x.active?'ACTIVE':'DISABLED'}</span></td><td>${esc(x.created_at||'')}</td><td><button class="btn tiny ghost" data-action="reset-password" data-id="${esc(x.id)}" data-name="${esc(x.username)}">Reset password</button>${x.id!==state.user.id?`<button class="btn tiny ${x.active?'danger':'ghost'}" data-action="toggle-user" data-id="${esc(x.id)}" data-name="${esc(x.username)}">${x.active?'Disable':'Enable'}</button>`:''}</td></tr>`);
 return head('User & Access Management','Assign CVO Encoders with access to all 85 barangays, administrators, and read-only viewers.')+
 `<div class="formsplit"><div class="panel"><h3>Create user</h3><p class="help">CVO-appointed Encoders collect reports from any barangay and may enter or import census and vaccination data for all 85 barangays. Submissions require City Admin approval. No Cloudflare account is needed.</p>
 <form id="user-form"><div class="entry-grid"><div class="field wide"><label>Full name</label><input name="full_name" required minlength="2" maxlength="90"></div>
 <div class="field wide"><label>Username</label><input name="username" required minlength="3" maxlength="32" placeholder="e.g. cvo.encoder1"></div>
 <div class="field wide"><label>Temporary password (minimum 12 characters)</label><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>
 <div class="field wide"><label>Access level</label><select name="role" id="role-select"><option value="encoder">Encoder</option><option value="viewer">City Viewer</option><option value="admin">City Admin</option></select></div></div>
 <button type="submit" class="btn full">Create account</button></form><p class="help" style="margin-top:12px">Share the account password privately; do not post it in public documents or GitHub.</p></div>
 <div class="panel"><div class="panel-head"><h3>Accounts</h3><span class="muted">${state.users.length} users</span></div>${table(['Name / Username','Role','Access scope','Status','Created','Manage'],rows)}</div></div>`;
}
function auditView(){
 const rows=state.audit.map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.actor||'Unknown')}</td><td>${esc(x.action)}</td><td>${esc(x.entity)}</td><td>${esc(x.entity_id||'—')}</td><td>${esc(x.detail||'')}</td></tr>`);
 return head('Audit Trail','Recent changes made to census, vaccination, and user records.')+`<div class="panel">${table(['Timestamp (UTC)','By','Action','Type','Reference','Details'],rows)}</div>`;
}
async function authPage(){
 let info;
 try{info=await api('/bootstrap/status');}catch(e){app.innerHTML=`<div class="auth-wrap"><div class="auth-card"><div class="auth-icon">✚</div><h1>Connection or database error</h1><div class="error">${esc(e.message)}</div><p class="help">Verify that the Worker has a D1 binding named DB and both migrations have been applied.</p><button class="btn" id="retry-auth">Try again</button></div></div>`;$('#retry-auth')?.addEventListener('click',init);return;}
 const setup=info.needs_setup;
 app.innerHTML=`<div class="auth-wrap"><div class="auth-card"><div class="auth-icon">✚</div><p class="eyebrow">Ormoc City · Veterinary Office</p><h1>${setup?'Initial administrator setup':'Welcome back'}</h1><p class="muted">Animal & Livestock Census + Dog & Cat Vaccination Monitoring</p>
 ${setup?`<div class="warning">First-time setup requires a secure BOOTSTRAP_TOKEN configured in Cloudflare Worker secrets. ${info.bootstrap_available?'The setup secret is configured.':'The secret has not been configured yet.'}</div>
 <form id="setup-form"><div class="field"><label>Setup token (private Cloudflare secret)</label><input type="password" name="setup_token" required></div>
 <div class="field"><label>Administrator full name</label><input name="full_name" required maxlength="90"></div><div class="field"><label>Admin username</label><input name="username" required minlength="3" maxlength="32"></div>
 <div class="field"><label>Admin password (minimum 12 characters)</label><input type="password" name="password" minlength="12" maxlength="128" required></div><button class="btn full" type="submit">Create first administrator</button></form>`:
 `<form id="login-form"><div class="field"><label>Username</label><input name="username" autocomplete="username" required></div>
 <div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div><button class="btn full" type="submit">Sign in</button></form>`}
 <div id="auth-error"></div><p class="help text-center" style="margin-top:25px">Cloudflare Workers + D1 · v1.0.3<br>Developed by: Engr. Rico J. Pono</p></div></div>`;
}
function shell(){
 app.innerHTML=`<header class="topbar"><div class="brand"><div class="brand-icon">✚</div><div><h1>ORMOC CITY VETERINARY</h1><small>Animal & Vaccination Monitoring System · v1.0.3</small></div></div>
 <div class="account"><div class="account-details"><strong>${esc(state.user.full_name)}</strong><small>${esc(roleText(state.user.role))}</small></div><button class="btn light" data-action="logout">Sign out</button></div></header>
 <div class="layout"><nav class="tabs" id="tabs"></nav><div id="offline-status" aria-live="polite"></div><div id="flash"></div><main id="content"></main><footer class="footer">City Veterinary Monitoring · Ormoc City, Leyte · 85 barangays<br>Developed by: Engr. Rico J. Pono · Version 1.0.3</footer></div>`;
}
function tabs(){const defs=[['dashboard','▦ Dashboard'],['census','♧ Animal Census'],['vaccinations','✚ Vaccinations'],['barangays','◫ Barangays'],...(isAdmin()?[['users','♙ Users'],['audit','☷ Audit Trail']]:[])];$('#tabs').innerHTML=defs.map(([p,t])=>`<button data-action="nav" data-page="${p}" class="${state.page===p?'active':''}">${t}</button>`).join('');}
function draw(){tabs();const v={dashboard:dashboardView,census:censusView,vaccinations:vaccinationView,barangays:barangayView,users:userView,audit:auditView}[state.page]||dashboardView;$('#content').innerHTML=v();}
function matchingRow(row,kind){
 if(kind==='census')return row.month===state.month&&(!state.barangay||String(row.barangay_id)===String(state.barangay));
 return row.date?.slice(0,7)===state.month&&(!state.barangay||String(row.barangay_id)===String(state.barangay));
}
async function applyOfflineDrafts(){
 if(!state.user)return;
 state.queue=await listOutbox(state.user.id);
 const brgs=new Map((state.catalog?.barangays||[]).map(x=>[String(x.id),x]));
 const species=new Map((state.catalog?.species||[]).map(x=>[x.code,x]));
 for(const op of state.queue){
  if(op.status!=='pending')continue;
  const x=op.payload,type=op.path;
  if(type==='/census'&&matchingRow(x,'census')&&state.page==='census'){
   const i=state.census.findIndex(r=>String(r.barangay_id)===String(x.barangay_id)&&r.species_code===x.species_code&&r.month===x.month);
   const old=i<0?{}:state.census[i];
   const row={...old,...x,id:old.id||`local-${op.id}`,head_count:Number(x.head_count),households:Number(x.households||0),barangay_id:Number(x.barangay_id),barangay:brgs.get(String(x.barangay_id))?.name||'',psgc:brgs.get(String(x.barangay_id))?.psgc||'',species_name:species.get(x.species_code)?.name||x.species_code,status:'pending',revision:x.expected_revision||0,__pending:true};
   if(i>=0)state.census[i]=row;else state.census.unshift(row);
  }
  if(type==='/vaccinations'&&matchingRow(x,'vaccinations')&&state.page==='vaccinations'){
   const id=x.id||x.client_id,i=state.vaccinations.findIndex(r=>r.id===id),old=i<0?{}:state.vaccinations[i];
   const row={...old,...x,id,date:x.date,doses:Number(x.doses),barangay_id:Number(x.barangay_id),barangay:brgs.get(String(x.barangay_id))?.name||'',status:'pending',revision:x.expected_revision||0,__pending:true};
   if(i>=0)state.vaccinations[i]=row;else state.vaccinations.unshift(row);
  }
  if(type.endsWith('/delete')){
   const collection=type.startsWith('/census')?state.census:state.vaccinations;
   const row=collection.find(r=>r.id===x.id);if(row)row.__deletePending=true;
  }
 }
}
async function updateOfflineStatus(){
 const el=$('#offline-status');if(!el||!state.user)return;
 state.queue=await listOutbox(state.user.id);
 const pending=state.queue.filter(x=>x.status==='pending'),errors=state.queue.filter(x=>x.status==='failed'||x.status==='conflict');
 const offline=state.offline||navigator.onLine===false;
 el.innerHTML=`<div class="offline-banner ${offline?'is-offline':''}"><span><strong>${offline?'◉ Offline mode · saved on this device':'● Cloud connection available'}</strong> · ${pending.length} pending sync${pending.length===1?'':'s'}${errors.length?` · ${errors.length} need attention`:''}</span>
 <span class="offline-actions"><button class="btn tiny ghost" data-action="sync-now" ${offline||state.syncing?'disabled':''}>${state.syncing?'Syncing…':'↻ Sync now'}</button><button class="btn tiny ghost" data-action="queue-details">Outbox</button></span></div>`;
}
async function load(){
 if(!state.user||!state.catalog)return;
 const q=params({month:state.month,...(state.barangay?{barangay_id:state.barangay}:{})});
 if(['dashboard','barangays'].includes(state.page))state.data=await api('/dashboard?'+q);
 if(state.page==='census')state.census=(await api('/census?'+q)).rows;
 if(state.page==='vaccinations')state.vaccinations=(await api('/vaccinations?'+q)).rows;
 if(state.page==='users'){if(state.offline)throw Error('User administration needs an internet connection.');state.users=(await api('/users')).rows;}
 if(state.page==='audit'){if(state.offline)throw Error('Audit Trail requires an internet connection.');state.audit=(await api('/audit')).rows;}
 await applyOfflineDrafts();draw();await updateOfflineStatus();
}
async function loadOfflineSession(){
 const saved=await readSession();if(!saved)return false;
 state.user=saved.user;state.offline=true;
 const cat=await cacheRead(state.user.id,'/catalog');if(!cat){state.user=null;return false;}
 state.catalog=cat.data;shell();await load();
 message('Offline session: edits remain on this device until they synchronize. Approved dashboard figures are from the last online download.');return true;
}
async function warmCache(){
 if(state.offline||!state.user)return;
 const month=state.month;
 for(const path of [`/census?month=${month}`,`/vaccinations?month=${month}`]){
  try{await api(path);}catch(e){console.warn('Offline prefetch failed',path,e);}
 }
}
async function init(){
 await installServiceWorker();
 try{
  const x=await api('/me');state.user=x.user;await saveSession(x.user);
  state.catalog=await api('/catalog');shell();await load();warmCache();
 }catch(e){
  if(isConnectivityError(e)||navigator.onLine===false){
   try{if(await loadOfflineSession())return;}catch(err){console.warn('Offline cache unavailable',err);}
   app.innerHTML='<div class="auth-wrap"><div class="auth-card"><h1>Internet required for first sign-in</h1><p>Sign in online once, open your reporting data, then this device can work offline for up to 12 hours before verification is required.</p><button class="btn" id="retry-auth">Retry connection</button></div></div>';
   $('#retry-auth')?.addEventListener('click',init);return;
  }
  if(!state.user)await authPage();else {shell();message(e.message,'error');}
 }
}
async function syncQueue(){
 if(!state.user||state.syncing||navigator.onLine===false)return;
 state.syncing=true;await updateOfflineStatus();let completed=0;
 try{
  // The server must authenticate CURRENTLY; cached roles never authorize a cloud write.
  const verified=await api('/me');if(verified.user.id!==state.user.id)throw Error('Account changed. Sign in as the original encoder to sync these drafts.');
  for(const op of await listOutbox(state.user.id)){
   if(op.status!=='pending')continue;
   try{await api(op.path,{method:'POST',body:JSON.stringify(op.payload)});await deleteOutbox(op.id);completed++;}
   catch(e){
    if(isConnectivityError(e)){state.offline=true;break;}
    if(e.status===401||e.status===403){await markOutbox(op,e.message,'failed');break;}
    await markOutbox(op,e.message,e.status===409?'conflict':'failed');
    // Keep the outbox item for manual review; never auto-overwrite server changes.
   }
  }
  if(completed){await load();message(`${completed} local change(s) synchronized. CVO approval may still be required.`);}
 }catch(e){message('Sync stopped: '+e.message,'error');}
 finally{state.syncing=false;await updateOfflineStatus();}
}
function showOutbox(){
 const pending=state.queue.map(x=>`<tr><td>${esc(new Date(x.createdAt).toLocaleString('en-PH'))}</td><td>${esc(x.path)}</td><td>${esc(x.payload.month||x.payload.date||x.payload.id||'')}</td><td>${esc(x.status)}</td><td>${esc(x.error||'')}</td><td><button class="btn tiny danger" data-action="discard-op" data-id="${esc(x.id)}">Discard</button></td></tr>`);
 state.page='outbox';tabs();$('#content').innerHTML=head('Device outbox','Entries here are stored ONLY on this device, not yet confirmed in Cloudflare. Do not clear browser storage or uninstall before syncing.')+
 `<div class="panel"><p class="help">Conflicts are retained, not overwritten. Discard only after you have checked the server record and copied any corrections you still need.</p><button class="btn" data-action="sync-now">↻ Sync pending changes</button>${table(['Created','Operation','Reference','State','Details','Action'],pending,'No unsynced changes on this device.')}</div>`;
}
async function busy(fn){try{await fn();}catch(e){message(e.message,'error');}}
function downloadCsv(name,content){const blob=new Blob(['\ufeff'+content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
const templates={census:'month,barangay_psgc,species_code,head_count,households,notes\r\n',vaccinations:'date,barangay_psgc,species_code,vaccine,doses,site,notes\r\n'};
function parseCsv(text){
 text=text.replace(/^\ufeff/,'');const records=[];let record=[],value='',inQuotes=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(inQuotes){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')inQuotes=false;else value+=c;}
  else if(c==='"'){if(value)throw Error('Malformed CSV quotes.');inQuotes=true;}
  else if(c===','){record.push(value);value='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;record.push(value);value='';if(record.some(x=>x!==''))records.push(record);record=[];}
  else value+=c;
 }
 if(inQuotes)throw Error('Unclosed quote in CSV.');record.push(value);if(record.some(x=>x!==''))records.push(record);
 if(records.length<2)throw Error('The CSV file has no data rows.');
 const header=records.shift().map(x=>x.trim());if(new Set(header).size!==header.length)throw Error('Duplicate CSV column headers.');
 return records.map((cols,i)=>{if(cols.length!==header.length)throw Error(`CSV row ${i+2} has the wrong number of columns.`);return Object.fromEntries(header.map((h,j)=>[h,cols[j].trim()]));});
}
function downloadExport(type){const q=params({type,month:state.month,...(state.barangay?{barangay_id:state.barangay}:{})});window.location.href='/api/export?'+q;}
async function doImport(type){
 const f=$(`#import-${type}`)?.files?.[0];if(!f)throw Error('Choose a .csv file first.');if(f.size>1500000)throw Error('CSV file is too large (1.5 MB maximum).');
 const rows=parseCsv(await f.text());if(rows.length>1000)throw Error('Import is limited to 1,000 rows per file. Split larger CSV files.');const columns=Object.keys(rows[0]);const wanted=templates[type].trim().split(',');
 if(wanted.some(x=>!columns.includes(x)))throw Error('CSV is missing one or more template columns: '+wanted.filter(x=>!columns.includes(x)).join(', '));
 if(!window.confirm(`Import ${rows.length} ${type==='census'?'census':'vaccination'} record(s)? ${type==='census'?'Existing monthly records will be overwritten and returned to pending review.':'Reimporting a file adds duplicate doses.'}`))return;
 if(state.offline||navigator.onLine===false){
  const byPsgc=new Map((state.catalog?.barangays||[]).map(b=>[b.psgc,b]));
  const converted=rows.map((r,i)=>{
   const b=byPsgc.get(String(r.barangay_psgc||'').padStart(10,'0'));
   if(!b)throw Error(`CSV row ${i+2}: unknown barangay PSGC.`);
   if(type==='census'){
    const old=state.census.find(x=>x.month===r.month&&String(x.barangay_id)===String(b.id)&&x.species_code===r.species_code);
    return {path:'/census',values:{barangay_id:b.id,month:r.month,species_code:r.species_code,head_count:r.head_count,households:r.households||0,notes:r.notes,expected_revision:old?.revision||0,mutation_id:crypto.randomUUID()}};
   }
   return {path:'/vaccinations',values:{barangay_id:b.id,date:r.date,species_code:r.species_code,vaccine:r.vaccine,doses:r.doses,site:r.site,notes:r.notes,client_id:crypto.randomUUID(),expected_revision:0,mutation_id:crypto.randomUUID()}};
  });
  // Validate ALL rows before enqueueing any, so malformed CSVs cannot partially enter the outbox.
  for(const {path,values} of converted){
   const isCensus=path==='/census';
   if((isCensus&&!/^20\d\d-(0[1-9]|1[0-2])$/.test(values.month))||(!isCensus&&!/^20\d\d-\d\d-\d\d$/.test(values.date)))throw Error('Invalid reporting month or vaccination date.');
   if(!state.catalog.species.some(x=>x.code===values.species_code)||(isCensus?(!Number.isSafeInteger(Number(values.head_count))||Number(values.head_count)<0):(!['dog','cat'].includes(values.species_code)||!['Anti-rabies','Other'].includes(values.vaccine)||!Number.isSafeInteger(Number(values.doses))||Number(values.doses)<1)))throw Error('CSV contains invalid species or quantity.');
  }
  for(const {path,values} of converted)await enqueue(state.user.id,path,values);
  await load();message(`Saved ${converted.length} CSV row(s) in this device outbox. No cloud data changed yet. Sync when online.`);return;
 }
 let done=0;for(let i=0;i<rows.length;i+=30){const result=await post('/import/'+type,{rows:rows.slice(i,i+30)});done+=result.imported;}
 await load();message(`Imported ${done} rows successfully. Entries are pending City Veterinary review.`);
}
function fillVaccination(id){
 const r=state.vaccinations.find(x=>x.id===id),form=$('#vaccination-form');if(!r||!form)return;
 for(const [key,value] of Object.entries(r)){const f=form.elements.namedItem(key);if(f)f.value=value??'';}
 form.elements.namedItem('expected_revision').value=r.revision||0;$('#cancel-edit')?.classList.remove('hidden');form.scrollIntoView({behavior:'smooth',block:'start'});message('Editing existing entry. Save to resubmit it for review.');
}
function clearVaccineForm(){const f=$('#vaccination-form');if(!f)return;f.reset();f.elements.namedItem('id').value='';f.elements.namedItem('expected_revision').value='';$('#cancel-edit')?.classList.add('hidden');}
async function action(target){
 const what=target.dataset.action;
 if(what==='nav'){state.page=target.dataset.page;await load();return;}
 if(what==='queue-details'){await updateOfflineStatus();showOutbox();return;}
 if(what==='sync-now'){await syncQueue();if(state.page==='outbox'){await updateOfflineStatus();showOutbox();}return;}
 if(what==='discard-op'){if(!confirm('Discard this unsynced change permanently from this device?'))return;await deleteOutbox(target.dataset.id);await updateOfflineStatus();if(state.page==='outbox')showOutbox();else await load();return;}
 if(what==='logout'){if((await listOutbox(state.user.id)).length&&!confirm('Signing out will DELETE unsynced drafts on this device. Continue?'))return;
  if(navigator.onLine!==false){try{await post('/logout',{});}catch(e){if(!isConnectivityError(e))throw e;}}
  await clearUserDeviceData(state.user.id);state.user=null;state.catalog=null;if(navigator.onLine===false){app.innerHTML='<div class="auth-wrap"><div class="auth-card"><h1>Signed out locally</h1><p>Reconnect to the internet to sign in again.</p></div></div>';}else await authPage();return;}
 if(what==='refresh'){if(navigator.onLine!==false)await syncQueue();await load();message(state.offline?'Showing available offline data.':'Latest available cloud data loaded.');return;}
 if(what==='export'){if(state.offline||navigator.onLine===false)throw Error('Cloud CSV export requires an online connection. Your cached records remain viewable offline.');downloadExport(target.dataset.type);return;}
 if(what==='template'){downloadCsv('ormoc-vet-'+target.dataset.type+'-template.csv',templates[target.dataset.type]);return;}
 if(what==='import'){await doImport(target.dataset.type);return;}
 if(what==='delete-record'){
  const kind=target.dataset.entity,rows=kind==='census'?state.census:state.vaccinations,r=rows.find(x=>x.id===target.dataset.id);
  if(!r)return;
  if(r.deletion_requested||r.__deletePending)throw Error('Deletion is already requested or queued for this record.');
  if(!confirm(`Request deletion of this ${kind==='census'?'census':'vaccination'} record? Encoder requests require City Admin approval.`))return;
  if(r.id.startsWith('local-')){
   const op=state.queue.find(x=>`local-${x.id}`===r.id);if(op){await deleteOutbox(op.id);await load();message('Unsynced draft discarded.');}return;
  }
  const result=await post(`/${kind}/delete`,{id:r.id,expected_revision:r.revision||1,key:`census:${r.barangay_id}:${r.species_code}:${r.month}`});
  await load();message(result.queued?'Deletion request saved offline. It has NOT yet changed the cloud database.':result.message);return;
 }
 if(what==='review-delete'){
  if(state.offline||navigator.onLine===false)throw Error('CVO approval needs an internet connection.');
  if(!confirm(`${target.dataset.decision==='approve'?'Approve deletion':'Reject deletion and keep record'}?`))return;
  await post(`/${target.dataset.entity}/deletion-review`,{id:target.dataset.id,decision:target.dataset.decision});await load();message('Deletion decision recorded.');return;
 }
 if(what==='edit-census'){
  const r=state.census.find(x=>x.id===target.dataset.id),f=$('#census-form');if(!r||!f)return;
  for(const key of ['barangay_id','species_code','month','head_count','households','notes']){const el=f.elements.namedItem(key);if(el)el.value=r[key]??'';}
  f.elements.namedItem('expected_revision').value=r.revision||0;f.scrollIntoView({behavior:'smooth',block:'start'});message('Editing census entry. Save to resubmit for review.');return;
 }
 if(what==='review'){
  if(state.offline||navigator.onLine===false)throw Error('Review approval needs an internet connection.');
  if(!window.confirm(`${target.dataset.status.toUpperCase()} this record?`))return;
  const end=target.dataset.entity==='census'?'/census/review':'/vaccinations/review';
  await post(end,{id:target.dataset.id,status:target.dataset.status});await load();message('Review decision saved. Dashboard totals reflect approved records.');return;
 }
 if(what==='edit-vaccination'){fillVaccination(target.dataset.id);return;}
 if(what==='clear-vaccination'){clearVaccineForm();return;}
 if(what==='toggle-user'){
  if(!window.confirm(`Change activation status for ${target.dataset.name}?`))return;
  await post('/users',{action:'toggle',id:target.dataset.id});await load();message('Account status updated.');return;
 }
 if(what==='reset-password'){
  const password=window.prompt(`New password for ${target.dataset.name} (at least 12 characters). This will sign out that user:`);
  if(password===null)return;
  await post('/users',{action:'reset',id:target.dataset.id,password});message('Password reset. Share it privately with the account owner.');return;
 }
}
app.addEventListener('click',e=>{const t=e.target.closest('[data-action]');if(t)busy(()=>action(t));});
app.addEventListener('change',e=>{
 if(e.target.id==='period'){state.month=e.target.value;busy(load);}
 if(e.target.id==='scope'){state.barangay=e.target.value;busy(load);}
});
app.addEventListener('input',e=>{if(e.target.id==='search-brgy'){state.search=e.target.value;const d=state.data?.barangays||[];$('#content').innerHTML=dashboardView();const f=$('#search-brgy');if(f){f.focus();f.setSelectionRange(f.value.length,f.value.length);}}});
app.addEventListener('submit',e=>{
 e.preventDefault();const f=e.target;const values=Object.fromEntries(new FormData(f).entries());
 if(f.id==='login-form'||f.id==='setup-form'){
  const msg=$('#auth-error');msg.innerHTML='';
  busy(async()=>{try{
   const r=await post(f.id==='setup-form'?'/bootstrap':'/login',values);state.user=r.user;
   state.catalog=await api('/catalog');await saveSession(r.user);
   shell();await load();warmCache();
  }catch(err){msg.innerHTML=`<div class="error">${esc(err.message)}</div>`;}});return;
 }
 busy(async()=>{
  if(f.id==='census-form'){const old=state.census.find(r=>String(r.barangay_id)===String(values.barangay_id)&&r.species_code===values.species_code&&r.month===values.month);
   values.expected_revision=values.expected_revision!==''?Number(values.expected_revision):old?Number(old.revision||0):0;const result=await post('/census',values);await load();message(result.queued?'Census saved on this device; pending cloud sync and CVO review.':'Monthly census saved and sent for review.');}
  else if(f.id==='vaccination-form'){values.expected_revision=values.expected_revision!==''?Number(values.expected_revision):0;const result=await post('/vaccinations',values);await load();message(result.queued?'Vaccination saved on this device; awaiting sync.':'Vaccination entry saved and sent for review.');}
  else if(f.id==='user-form'){await post('/users',{...values,action:'create'});await load();message('New user created. Share the username and password securely.');}
 });
});
window.addEventListener('online',()=>{state.offline=false;updateOfflineStatus();syncQueue();});
window.addEventListener('offline',()=>{state.offline=true;updateOfflineStatus();});
window.addEventListener('pageshow',()=>{if(state.user&&navigator.onLine!==false)syncQueue();});
init();
