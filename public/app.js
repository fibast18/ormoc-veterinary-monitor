/* OCVMS v1.0.2 — dependency-free client. Shared data lives only in Cloudflare D1. */
const app=document.querySelector('#app');
const nowPH=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
const state={user:null,catalog:null,page:'dashboard',month:nowPH().slice(0,7),barangay:'',data:null,census:[],vaccinations:[],users:[],audit:[],search:''};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('en-PH');
const $=sel=>document.querySelector(sel);
function message(s,type='notice'){const box=$('#flash');if(!box)return;box.innerHTML=`<div class="${type}">${esc(s)}</div>`;box.scrollIntoView({behavior:'smooth',block:'nearest'});}
async function api(path,opts={}){
 const res=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',...opts,headers:{...(opts.body?{'content-type':'application/json'}:{}),...(opts.headers||{})}});
 let data;try{data=await res.json();}catch{throw Error('Server response was not valid JSON. Check Cloudflare deployment and D1 setup.');}
 if(!res.ok){if(res.status===401 && !['/login','/bootstrap'].includes(path)){state.user=null;await authPage();}throw Error(data.error||'Server request failed.');}
 return data;
}
const post=(path,data)=>api(path,{method:'POST',body:JSON.stringify(data)});
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
function reviewButtons(entity,r){return isAdmin()?`<button class="btn tiny" data-action="review" data-entity="${entity}" data-id="${esc(r.id)}" data-status="approved">Approve</button><button class="btn tiny danger" data-action="review" data-entity="${entity}" data-id="${esc(r.id)}" data-status="rejected">Reject</button>`:'';}
function censusView(){
 const rows=state.census.map(r=>`<tr><td><strong>${esc(r.barangay)}</strong><span class="user-meta">${esc(r.psgc)}</span></td><td>${esc(r.species_name)}</td><td class="number">${fmt(r.head_count)}</td><td class="number">${fmt(r.households)}</td><td>${statusBadge(r.status)}</td><td title="${esc(r.notes)}">${esc((r.notes||'').slice(0,60))}</td><td>${esc(r.updated_at||'')}</td><td>${reviewButtons('census',r)}</td></tr>`);
 return head('Animal & Livestock Census','CVO Encoders may record monthly livestock and animal counts from any barangay.')+filterToolbar('census')+
 `<div class="formsplit"><div class="panel"><h3>Save monthly inventory</h3><p class="help">One total per barangay, species, and month. Saving an existing entry replaces its count and returns it to pending review.</p>
 ${allowedWrite()?`<form id="census-form"><div class="entry-grid"><div class="field wide"><label>Barangay</label><select name="barangay_id" required>${brgyOptions(state.barangay)}</select></div>
 <div class="field wide"><label>Animal species</label><select name="species_code" required>${speciesOptions('swine')}</select></div>
 <div class="field"><label>Reporting month</label><input type="month" name="month" value="${esc(state.month)}" required></div>
 <div class="field"><label>Head count</label><input type="number" name="head_count" min="0" max="99999999" required placeholder="0"></div>
 <div class="field mobile-wide"><label>Households raising species (optional)</label><input type="number" name="households" min="0" max="9999999" value="0"></div>
 <div class="field wide"><label>Source or remarks</label><textarea name="notes" maxlength="600" placeholder="e.g., CVO collection date, source barangay report"></textarea></div></div>
 <button class="btn full" type="submit">Save inventory · Pending review</button></form>`:'<p class="help">Your account has read-only access.</p>'}</div>
 <div class="panel"><div class="panel-head"><h3>Inventory records</h3><span class="muted">${state.census.length} matching records</span></div>
 ${table(['Barangay','Species',{label:'Heads',number:true},{label:'Households',number:true},'Status','Remarks','Updated','Review'],rows)}
 <h3 style="margin-top:22px">Bulk import from Excel-compatible CSV</h3><p class="help">Download the template, fill it using Excel or Numbers, then export/save as CSV UTF-8. Maximum 30 records per server batch (the app splits larger files automatically).</p>
 ${allowedWrite()?`<div class="import-strip"><button class="btn ghost" data-action="template" data-type="census">↓ CSV template</button><input type="file" class="input-file" accept=".csv,text/csv" id="import-census"><button class="btn" data-action="import" data-type="census">Import census CSV</button></div>`:''}
 <p class="help">PSGC codes use 10 digits and are provided in the included barangay reference file. Imported or changed records require administrator approval.</p></div></div>`;
}
function vaccinationView(){
 const rows=state.vaccinations.map(r=>`<tr><td>${esc(r.date)}</td><td><strong>${esc(r.barangay)}</strong></td><td>${r.species_code==='dog'?'Dog':'Cat'}</td><td>${esc(r.vaccine)}</td><td class="number">${fmt(r.doses)}</td><td>${esc(r.site||'—')}</td><td>${statusBadge(r.status)}</td><td>${allowedWrite()?`<button class="btn tiny ghost" data-action="edit-vaccination" data-id="${esc(r.id)}">Edit</button>`:''}${reviewButtons('vaccinations',r)}</td></tr>`);
 return head('Dog & Cat Vaccination Monitoring','CVO Encoders may record vaccination activities from any barangay.')+filterToolbar('vaccinations')+
 `<div class="formsplit"><div class="panel"><h3>Record vaccination activity</h3><p class="help">Use separate records for dogs and cats. Doses may include repeat vaccinations of the same animal.</p>
 ${allowedWrite()?`<form id="vaccination-form"><input type="hidden" name="id" value=""><div class="entry-grid"><div class="field wide"><label>Barangay</label><select name="barangay_id" required>${brgyOptions(state.barangay)}</select></div>
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
 <div id="auth-error"></div><p class="help text-center" style="margin-top:25px">Cloudflare Workers + D1 · v1.0.2<br>Developed by: Engr. Rico J. Pono</p></div></div>`;
}
function shell(){
 app.innerHTML=`<header class="topbar"><div class="brand"><div class="brand-icon">✚</div><div><h1>ORMOC CITY VETERINARY</h1><small>Animal & Vaccination Monitoring System · v1.0.2</small></div></div>
 <div class="account"><div class="account-details"><strong>${esc(state.user.full_name)}</strong><small>${esc(roleText(state.user.role))}</small></div><button class="btn light" data-action="logout">Sign out</button></div></header>
 <div class="layout"><nav class="tabs" id="tabs"></nav><div id="flash"></div><main id="content"></main><footer class="footer">City Veterinary Monitoring · Ormoc City, Leyte · 85 barangays<br>Developed by: Engr. Rico J. Pono · Version 1.0.2</footer></div>`;
}
function tabs(){const defs=[['dashboard','▦ Dashboard'],['census','♧ Animal Census'],['vaccinations','✚ Vaccinations'],['barangays','◫ Barangays'],...(isAdmin()?[['users','♙ Users'],['audit','☷ Audit Trail']]:[])];$('#tabs').innerHTML=defs.map(([p,t])=>`<button data-action="nav" data-page="${p}" class="${state.page===p?'active':''}">${t}</button>`).join('');}
function draw(){tabs();const v={dashboard:dashboardView,census:censusView,vaccinations:vaccinationView,barangays:barangayView,users:userView,audit:auditView}[state.page]||dashboardView;$('#content').innerHTML=v();}
async function load(){
 if(!state.user||!state.catalog)return;
 const q=params({month:state.month,...(state.barangay?{barangay_id:state.barangay}:{})});
 if(['dashboard','barangays'].includes(state.page))state.data=await api('/dashboard?'+q);
 if(state.page==='census')state.census=(await api('/census?'+q)).rows;
 if(state.page==='vaccinations')state.vaccinations=(await api('/vaccinations?'+q)).rows;
 if(state.page==='users')state.users=(await api('/users')).rows;
 if(state.page==='audit')state.audit=(await api('/audit')).rows;
 draw();
}
async function init(){
 try{
  const x=await api('/me');state.user=x.user;
  state.catalog=await api('/catalog');
   shell();await load();
 }catch(e){if(!state.user)await authPage();else {shell();message(e.message,'error');}}
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
 const rows=parseCsv(await f.text());const columns=Object.keys(rows[0]);const wanted=templates[type].trim().split(',');
 if(wanted.some(x=>!columns.includes(x)))throw Error('CSV is missing one or more template columns: '+wanted.filter(x=>!columns.includes(x)).join(', '));
 if(!window.confirm(`Import ${rows.length} ${type==='census'?'census':'vaccination'} record(s)? ${type==='census'?'Existing monthly records will be overwritten and returned to pending review.':'Reimporting a file adds duplicate doses.'}`))return;
 let done=0;for(let i=0;i<rows.length;i+=30){const result=await post('/import/'+type,{rows:rows.slice(i,i+30)});done+=result.imported;}
 await load();message(`Imported ${done} rows successfully. Entries are pending City Veterinary review.`);
}
function fillVaccination(id){
 const r=state.vaccinations.find(x=>x.id===id),form=$('#vaccination-form');if(!r||!form)return;
 for(const [key,value] of Object.entries(r)){const f=form.elements.namedItem(key);if(f)f.value=value??'';}
 $('#cancel-edit')?.classList.remove('hidden');form.scrollIntoView({behavior:'smooth',block:'start'});message('Editing existing entry. Save to resubmit it for review.');
}
function clearVaccineForm(){const f=$('#vaccination-form');if(!f)return;f.reset();f.elements.namedItem('id').value='';$('#cancel-edit')?.classList.add('hidden');}
async function action(target){
 const what=target.dataset.action;
 if(what==='nav'){state.page=target.dataset.page;await load();return;}
 if(what==='logout'){await post('/logout',{});state.user=null;state.catalog=null;await authPage();return;}
 if(what==='refresh'){await load();message('Latest cloud data loaded.');return;}
 if(what==='export'){downloadExport(target.dataset.type);return;}
 if(what==='template'){downloadCsv('ormoc-vet-'+target.dataset.type+'-template.csv',templates[target.dataset.type]);return;}
 if(what==='import'){await doImport(target.dataset.type);return;}
 if(what==='review'){
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
   state.catalog=await api('/catalog');
   shell();await load();
  }catch(err){msg.innerHTML=`<div class="error">${esc(err.message)}</div>`;}});return;
 }
 busy(async()=>{
  if(f.id==='census-form'){await post('/census',values);await load();message('Monthly census saved and sent for review.');}
  else if(f.id==='vaccination-form'){await post('/vaccinations',values);await load();message('Vaccination entry saved and sent for review.');}
  else if(f.id==='user-form'){await post('/users',{...values,action:'create'});await load();message('New user created. Share the username and password securely.');}
 });
});
init();
