/* Ormoc City Veterinary Monitoring System v1.0.0 — Cloudflare Workers + D1 */
const VERSION = '1.0.0';
const SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 100000;
const SPECIES = new Set(['carabao','cattle','swine','goat','sheep','horse','chicken','duck','turkey','quail','dog','cat','rabbit','other']);
const BAD_REQUEST = (message, status=400) => Object.assign(new Error(message), {status});
const enc = new TextEncoder();
const out = obj => JSON.stringify(obj);
function response(obj, status=200, headers={}) {
  return new Response(out(obj), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
}
function failure(message,status=400) {return response({ok:false,error:message},status);}
function isoSql(d=new Date()) {return d.toISOString().slice(0,19).replace('T',' ');}
function plusHours(h) {return isoSql(new Date(Date.now()+h*60*60*1000));}
function base64(bytes) {return btoa(String.fromCharCode(...bytes));}
function unbase64(value) {return Uint8Array.from(atob(value),ch=>ch.charCodeAt(0));}
async function sha(text) {const d=await crypto.subtle.digest('SHA-256',enc.encode(text));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function passwordHash(password,salt) {
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unbase64(salt),iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},key,256);
  return base64(new Uint8Array(bits));
}
function constTimeEqual(a,b) {
  if (a.length!==b.length) return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function checkPassword(p) {if(typeof p!=='string'||p.length<12||p.length>128)throw BAD_REQUEST('Password must be 12–128 characters.');return p;}
function checkUsername(s) {s=String(s??'').trim().toLowerCase();if(!/^[a-z0-9._-]{3,32}$/.test(s))throw BAD_REQUEST('Username requires 3–32 letters, digits, dots, underscores or dashes.');return s;}
function clean(s,max=300) {s=String(s??'').trim();if(s.length>max)throw BAD_REQUEST('Text exceeds allowed length.');return s;}
function int(v,label,max=99999999,min=0) {const n=Number(v);if(v===undefined||v===null||v===''||!Number.isSafeInteger(n)||n<min||n>max)throw BAD_REQUEST(`${label} must be a whole number from ${min} to ${max}.`);return n;}
function month(s) {s=String(s??'');if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(s))throw BAD_REQUEST('Month must be YYYY-MM (2000–2099).');return s;}
function date(s) {s=String(s??'');if(!/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s))throw BAD_REQUEST('Date must be YYYY-MM-DD.');const dt=new Date(s+'T00:00:00Z');if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==s)throw BAD_REQUEST('Invalid calendar date.');return s;}
async function body(req) {
  if(!String(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw BAD_REQUEST('Use application/json.');
  const str=await req.text();if(str.length>110000)throw BAD_REQUEST('Request exceeds 110 KB.',413);
  try {const v=JSON.parse(str);if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch {throw BAD_REQUEST('Invalid JSON request.');}
}
function cookies(req) {const raw=req.headers.get('cookie')||'';return Object.fromEntries(raw.split(';').map(k=>k.trim()).filter(Boolean).map(k=>{const i=k.indexOf('=');return [k.slice(0,i),k.slice(i+1)];}));}
function cookie(token,req,clear=false) {const sec=new URL(req.url).protocol==='https:'?'; Secure':'';return `vet_session=${clear?'':token}; Path=/; HttpOnly; SameSite=Strict${sec}${clear?'; Max-Age=0':`; Max-Age=${SESSION_HOURS*3600}`}`;}
async function identity(req,db) {
  const token=cookies(req).vet_session;
  if(!token||!/^[-_A-Za-z0-9]{40,}$/.test(token))return null;
  const hash=await sha(token);
  return await db.prepare(`SELECT u.id,u.username,u.full_name,u.role,u.barangay_id,u.active
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now') AND u.active=1`).bind(hash).first();
}
async function log(db,user,action,entity,entity_id='',detail='') {
  await db.prepare(`INSERT INTO audit_logs(id,actor_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),user?.id||null,action,entity,String(entity_id),clean(detail,250)).run();
}
function writable(u) {if(u.role==='viewer')throw BAD_REQUEST('View-only users cannot modify records.',403);}
function admin(u) {if(u.role!=='admin')throw BAD_REQUEST('City administrator access required.',403);}
function scopeId(u,raw) {
  if(u.role==='encoder'){
    if(raw!==undefined&&raw!==null&&raw!==''&&Number(raw)!==u.barangay_id)throw BAD_REQUEST('Not allowed to access another barangay.',403);
    return u.barangay_id;
  }
  if(raw===undefined||raw===null||raw==='')return null;
  return int(raw,'Barangay ID',999999,1);
}
async function knownBarangay(db,id) {const b=await db.prepare('SELECT id FROM barangays WHERE id=?').bind(id).first();if(!b)throw BAD_REQUEST('Unknown barangay.');return id;}
function censusInput(x,u) {
  const barangay_id=scopeId(u,x.barangay_id);
  if(!barangay_id)throw BAD_REQUEST('Select a barangay.');
  const species_code=clean(x.species_code,20).toLowerCase();if(!SPECIES.has(species_code))throw BAD_REQUEST('Unknown animal species.');
  return {barangay_id,species_code,month:month(x.month),head_count:int(x.head_count,'Animal count'),households:int(x.households===''||x.households==null?0:x.households,'Households',9999999),notes:clean(x.notes,600)};
}
function vaccineInput(x,u) {
  const barangay_id=scopeId(u,x.barangay_id);
  if(!barangay_id)throw BAD_REQUEST('Select a barangay.');
  const species_code=clean(x.species_code,10).toLowerCase();if(!['cat','dog'].includes(species_code))throw BAD_REQUEST('Vaccination species must be dog or cat.');
  const vaccine=clean(x.vaccine,30);if(!['Anti-rabies','Other'].includes(vaccine))throw BAD_REQUEST('Vaccine must be Anti-rabies or Other.');
  return {barangay_id,date:date(x.date),species_code,vaccine,doses:int(x.doses,'Doses',9999999,1),site:clean(x.site,120),notes:clean(x.notes,600)};
}
async function createSession(db,u,req) {
  const token=base64(crypto.getRandomValues(new Uint8Array(36))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token),u.id,plusHours(SESSION_HOURS)).run();
  return response({ok:true,user:{id:u.id,username:u.username,full_name:u.full_name,role:u.role,barangay_id:u.barangay_id}},200,{'set-cookie':cookie(token,req)});
}
async function api(req,env) {
  if(!env.DB)return failure('D1 database binding DB is missing. Check Cloudflare Worker settings.',503);
  const db=env.DB;
  const url=new URL(req.url), path=url.pathname, method=req.method;
  if(!['GET','POST'].includes(method))return failure('Method not allowed.',405);
  if(method==='POST'){
    const origin=req.headers.get('origin');
    if(origin && origin!==url.origin)return failure('Cross-origin write rejected.',403);
  }
  if(path==='/api/health'&&method==='GET')return response({ok:true,version:VERSION});
  if(path==='/api/bootstrap/status'&&method==='GET'){
    const count=await db.prepare('SELECT COUNT(*) AS total FROM users').first();
    return response({ok:true,needs_setup:!count.total,bootstrap_available:!!env.BOOTSTRAP_TOKEN});
  }
  if(path==='/api/bootstrap'&&method==='POST'){
    if(!env.BOOTSTRAP_TOKEN)return failure('Set BOOTSTRAP_TOKEN as a Cloudflare Worker secret before setup.',503);
    const data=await body(req),a=await db.prepare('SELECT COUNT(*) AS total FROM users').first();
    if(a.total)return failure('Setup has already been completed.',409);
    if(typeof data.setup_token!=='string'||!constTimeEqual(data.setup_token,env.BOOTSTRAP_TOKEN))return failure('Invalid setup token.',403);
    const username=checkUsername(data.username),password=checkPassword(data.password),full_name=clean(data.full_name,90);
    if(full_name.length<2)throw BAD_REQUEST('Enter the full name.');
    const salt=base64(crypto.getRandomValues(new Uint8Array(16))),hashed=await passwordHash(password,salt),id=crypto.randomUUID();
    // A conditional insert prevents two simultaneous first-admin creations.
    const r=await db.prepare(`INSERT INTO users(id,username,full_name,role,barangay_id,salt,password_hash)
      SELECT ?,?,?,'admin',NULL,?,? WHERE NOT EXISTS(SELECT 1 FROM users)`).bind(id,username,full_name,salt,hashed).run();
    if(!r.meta.changes)return failure('Setup was already completed.',409);
    await log(db,{id},'bootstrap','user',id,'Created first city administrator');
    return createSession(db,{id,username,full_name,role:'admin',barangay_id:null},req);
  }
  if(path==='/api/login'&&method==='POST'){
    const x=await body(req),username=checkUsername(x.username),password=String(x.password||'');
    if(password.length>128)return failure('Invalid login.',401);
    const lock=await db.prepare('SELECT attempts,locked_until FROM login_attempts WHERE username=?').bind(username).first();
    if(lock?.locked_until&&lock.locked_until>isoSql())return failure('Too many attempts. Try again after 15 minutes.',429);
    const row=await db.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(username).first();
    let success=false;
    if(row && password)success=constTimeEqual(await passwordHash(password,row.salt),row.password_hash);
    if(!success){
      const attempts=(lock?.attempts||0)+1;
      await db.prepare(`INSERT INTO login_attempts(username,attempts,locked_until) VALUES(?,?,?)
        ON CONFLICT(username) DO UPDATE SET attempts=excluded.attempts,locked_until=excluded.locked_until`).bind(username,attempts>=5?0:attempts,attempts>=5?plusHours(0.25):null).run();
      return failure('Invalid username or password.',401);
    }
    await db.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
    return createSession(db,row,req);
  }
  const u=await identity(req,db);if(!u)return failure('Session expired or not authenticated. Please sign in.',401);
  if(path==='/api/me'&&method==='GET')return response({ok:true,user:u});
  if(path==='/api/logout'&&method==='POST'){
    const token=cookies(req).vet_session;if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();
    return response({ok:true},200,{'set-cookie':cookie('',req,true)});
  }
  if(path==='/api/catalog'&&method==='GET'){
    const [b,s]=await Promise.all([db.prepare('SELECT id,psgc,name,classification FROM barangays ORDER BY name COLLATE NOCASE').all(),db.prepare('SELECT code,name,category FROM species ORDER BY sort_order').all()]);
    return response({ok:true,barangays:b.results,species:s.results});
  }
  if(path==='/api/dashboard'&&method==='GET'){
    const m=month(url.searchParams.get('month')),bid=scopeId(u,url.searchParams.get('barangay_id'));
    const condition=bid?' AND barangay_id=?':'';const params=bid?[m,bid]:[m];
    const [bySpecies, byBrgy, vaccines, brgys]=await Promise.all([
      db.prepare(`SELECT species_code,SUM(head_count) AS total,COUNT(DISTINCT barangay_id) AS reporting FROM census WHERE month=? AND status='approved'${condition} GROUP BY species_code`).bind(...params).all(),
      db.prepare(`SELECT barangay_id,SUM(head_count) AS animals,SUM(CASE WHEN species_code='dog' THEN head_count ELSE 0 END) AS dogs,
        SUM(CASE WHEN species_code='cat' THEN head_count ELSE 0 END) AS cats,
        SUM(CASE WHEN species_code IN ('carabao','cattle','swine','goat','sheep','horse') THEN head_count ELSE 0 END) AS livestock,
        SUM(CASE WHEN species_code IN ('chicken','duck','turkey','quail') THEN head_count ELSE 0 END) AS poultry,
        COUNT(*) AS species_reported FROM census WHERE month=? AND status='approved'${condition} GROUP BY barangay_id`).bind(...params).all(),
      db.prepare(`SELECT barangay_id,species_code,SUM(doses) AS doses FROM vaccinations
        WHERE substr(date,1,7)=? AND vaccine='Anti-rabies' AND status='approved'${condition} GROUP BY barangay_id,species_code`).bind(...params).all(),
      db.prepare(`SELECT id,name,classification FROM barangays ${bid?'WHERE id=?':''} ORDER BY name COLLATE NOCASE`).bind(...(bid?[bid]:[])).all()
    ]);
    const rows=brgys.results.map(b=>{
      const c=byBrgy.results.find(v=>v.barangay_id===b.id)||{};
      const v=vaccines.results.filter(x=>x.barangay_id===b.id);
      return {...b,animals:c.animals||0,dogs:c.dogs||0,cats:c.cats||0,livestock:c.livestock||0,poultry:c.poultry||0,species_reported:c.species_reported||0,
        vaccinated_dogs:v.find(x=>x.species_code==='dog')?.doses||0,vaccinated_cats:v.find(x=>x.species_code==='cat')?.doses||0};
    });
    const sum=k=>rows.reduce((s,b)=>s+(b[k]||0),0);
    return response({ok:true,month:m,barangays:rows,species:bySpecies.results,
      totals:{animals:sum('animals'),dogs:sum('dogs'),cats:sum('cats'),livestock:sum('livestock'),poultry:sum('poultry'),vaccinated_dogs:sum('vaccinated_dogs'),vaccinated_cats:sum('vaccinated_cats'),reporting:rows.filter(b=>b.species_reported>0).length,expected:rows.length}});
  }
  if(path==='/api/census'&&method==='GET'){
    const m=month(url.searchParams.get('month')),bid=scopeId(u,url.searchParams.get('barangay_id'));
    const status=url.searchParams.get('status')||'';
    if(status&&!['pending','approved','rejected'].includes(status))throw BAD_REQUEST('Invalid status.');
    const sql=`SELECT c.*,b.name AS barangay,b.psgc,s.name AS species_name,u.full_name AS updated_by_name
      FROM census c JOIN barangays b ON b.id=c.barangay_id JOIN species s ON s.code=c.species_code
      LEFT JOIN users u ON u.id=c.updated_by WHERE c.month=? ${bid?'AND c.barangay_id=?':''} ${status?'AND c.status=?':''}
      ORDER BY b.name,s.sort_order LIMIT 3000`;
    return response({ok:true,rows:(await db.prepare(sql).bind(m,...(bid?[bid]:[]),...(status?[status]:[])).all()).results});
  }
  if(path==='/api/census'&&method==='POST'){
    writable(u);const x=censusInput(await body(req),u);await knownBarangay(db,x.barangay_id);
    const id=crypto.randomUUID();
    await db.prepare(`INSERT INTO census(id,barangay_id,species_code,month,head_count,households,notes,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(barangay_id,species_code,month) DO UPDATE SET
      head_count=excluded.head_count,households=excluded.households,notes=excluded.notes,status='pending',
      updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,approved_by=NULL,approved_at=NULL`).bind(id,x.barangay_id,x.species_code,x.month,x.head_count,x.households,x.notes,u.id,u.id).run();
    await log(db,u,'save','census',`${x.barangay_id}:${x.species_code}:${x.month}`,`Head count ${x.head_count}; review pending`);
    return response({ok:true,message:'Census saved for City Veterinary review.'});
  }
  if(path==='/api/census/review'&&method==='POST'){
    admin(u);const x=await body(req),status=clean(x.status,20),id=clean(x.id,60);
    if(!['approved','rejected'].includes(status))throw BAD_REQUEST('Status must be approved or rejected.');
    const existing=await db.prepare('SELECT id FROM census WHERE id=?').bind(id).first();if(!existing)throw BAD_REQUEST('Census record not found.',404);
    await db.prepare(`UPDATE census SET status=?,approved_by=?,approved_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,status==='approved'?u.id:null,status==='approved'?isoSql():null,id).run();
    await log(db,u,status,'census',id);
    return response({ok:true});
  }
  if(path==='/api/vaccinations'&&method==='GET'){
    const m=month(url.searchParams.get('month')),bid=scopeId(u,url.searchParams.get('barangay_id'));
    const status=url.searchParams.get('status')||'';if(status&&!['pending','approved','rejected'].includes(status))throw BAD_REQUEST('Invalid status.');
    const sql=`SELECT v.*,b.name AS barangay,b.psgc,u.full_name AS updated_by_name FROM vaccinations v
      JOIN barangays b ON b.id=v.barangay_id LEFT JOIN users u ON u.id=v.updated_by
      WHERE substr(v.date,1,7)=? ${bid?'AND v.barangay_id=?':''} ${status?'AND v.status=?':''}
      ORDER BY v.date DESC,b.name LIMIT 3000`;
    return response({ok:true,rows:(await db.prepare(sql).bind(m,...(bid?[bid]:[]),...(status?[status]:[])).all()).results});
  }
  if(path==='/api/vaccinations'&&method==='POST'){
    writable(u);const payload=await body(req),x=vaccineInput(payload,u);await knownBarangay(db,x.barangay_id);
    const id=payload.id?clean(payload.id,60):crypto.randomUUID();
    if(payload.id){
      const existing=await db.prepare('SELECT barangay_id FROM vaccinations WHERE id=?').bind(id).first();
      if(!existing)throw BAD_REQUEST('Vaccination record not found.',404);
      if(u.role==='encoder'&&existing.barangay_id!==u.barangay_id)throw BAD_REQUEST('Not permitted.',403);
      await db.prepare(`UPDATE vaccinations SET barangay_id=?,date=?,species_code=?,vaccine=?,doses=?,site=?,notes=?,
        status='pending',updated_by=?,updated_at=CURRENT_TIMESTAMP,approved_by=NULL,approved_at=NULL WHERE id=?`).bind(x.barangay_id,x.date,x.species_code,x.vaccine,x.doses,x.site,x.notes,u.id,id).run();
    } else {
      await db.prepare(`INSERT INTO vaccinations(id,barangay_id,date,species_code,vaccine,doses,site,notes,created_by,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,x.barangay_id,x.date,x.species_code,x.vaccine,x.doses,x.site,x.notes,u.id,u.id).run();
    }
    await log(db,u,payload.id?'update':'create','vaccination',id,`${x.date} ${x.species_code} ${x.doses} doses; pending`);
    return response({ok:true,message:'Vaccination record saved for review.'});
  }
  if(path==='/api/vaccinations/review'&&method==='POST'){
    admin(u);const x=await body(req),status=clean(x.status,20),id=clean(x.id,60);
    if(!['approved','rejected'].includes(status))throw BAD_REQUEST('Status must be approved or rejected.');
    const existing=await db.prepare('SELECT id FROM vaccinations WHERE id=?').bind(id).first();if(!existing)throw BAD_REQUEST('Vaccination record not found.',404);
    await db.prepare(`UPDATE vaccinations SET status=?,approved_by=?,approved_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,status==='approved'?u.id:null,status==='approved'?isoSql():null,id).run();
    await log(db,u,status,'vaccination',id);
    return response({ok:true});
  }
  if(path==='/api/users'&&method==='GET'){
    admin(u);return response({ok:true,rows:(await db.prepare(`SELECT u.id,u.username,u.full_name,u.role,u.barangay_id,u.active,u.created_at,b.name AS barangay
      FROM users u LEFT JOIN barangays b ON b.id=u.barangay_id ORDER BY u.created_at DESC`).all()).results});
  }
  if(path==='/api/users'&&method==='POST'){
    admin(u);const x=await body(req),action=clean(x.action||'create',20);
    if(action==='create'){
      const username=checkUsername(x.username),full_name=clean(x.full_name,90),role=clean(x.role,20),password=checkPassword(x.password);
      if(full_name.length<2)throw BAD_REQUEST('Enter full name.');
      if(!['admin','encoder','viewer'].includes(role))throw BAD_REQUEST('Invalid user role.');
      const barangay_id=role==='encoder'?int(x.barangay_id,'Barangay ID',999999,1):null;
      if(barangay_id)await knownBarangay(db,barangay_id);
      const salt=base64(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(password,salt),id=crypto.randomUUID();
      await db.prepare(`INSERT INTO users(id,username,full_name,role,barangay_id,salt,password_hash,created_by)
        VALUES(?,?,?,?,?,?,?,?)`).bind(id,username,full_name,role,barangay_id,salt,hash,u.id).run();
      await log(db,u,'create','user',id,username+' — '+role);return response({ok:true});
    }
    const id=clean(x.id,60),target=await db.prepare('SELECT id,username,active,role FROM users WHERE id=?').bind(id).first();
    if(!target)throw BAD_REQUEST('User not found.',404);
    if(action==='toggle'){
      if(id===u.id)throw BAD_REQUEST('Cannot disable your own account.');
      await db.prepare('UPDATE users SET active=? WHERE id=?').bind(target.active?0:1,id).run();
      if(target.active)await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
      await log(db,u,target.active?'disable':'enable','user',id,target.username);return response({ok:true});
    }
    if(action==='reset'){
      const password=checkPassword(x.password),salt=base64(crypto.getRandomValues(new Uint8Array(16))),hash=await passwordHash(password,salt);
      await db.batch([db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').bind(salt,hash,id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)]);
      await log(db,u,'reset_password','user',id,target.username);return response({ok:true});
    }
    throw BAD_REQUEST('Unknown user action.');
  }
  if(path==='/api/audit'&&method==='GET'){
    admin(u);return response({ok:true,rows:(await db.prepare(`SELECT a.*,u.full_name AS actor FROM audit_logs a
      LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.created_at DESC LIMIT 150`).all()).results});
  }
  if(path==='/api/import/census'&&method==='POST'){
    writable(u);const payload=await body(req),rows=payload.rows;
    if(!Array.isArray(rows)||rows.length<1||rows.length>30)throw BAD_REQUEST('Import 1 to 30 records per batch.');
    const roster=(await db.prepare('SELECT id,psgc FROM barangays').all()).results;
    const vals=rows.map((r,i)=>{
      const b=roster.find(x=>x.psgc===String(r.barangay_psgc??'').trim().padStart(10,'0'));
      if(!b)throw BAD_REQUEST(`Row ${i+1}: unknown 10-digit PSGC.`);
      return censusInput({...r,barangay_id:b.id,month:r.month,head_count:r.head_count,households:r.households},u);
    });
    if(new Set(vals.map(x=>`${x.barangay_id}/${x.species_code}/${x.month}`)).size!==vals.length)throw BAD_REQUEST('Duplicate barangay/species/month combination in this batch.');
    const statements=vals.map(x=>db.prepare(`INSERT INTO census(id,barangay_id,species_code,month,head_count,households,notes,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(barangay_id,species_code,month) DO UPDATE SET
      head_count=excluded.head_count,households=excluded.households,notes=excluded.notes,status='pending',updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP,approved_at=NULL,approved_by=NULL`).bind(crypto.randomUUID(),x.barangay_id,x.species_code,x.month,x.head_count,x.households,x.notes,u.id,u.id));
    await db.batch(statements);await log(db,u,'import','census','batch',`${vals.length} records, review pending`);return response({ok:true,imported:vals.length});
  }
  if(path==='/api/import/vaccinations'&&method==='POST'){
    writable(u);const payload=await body(req),rows=payload.rows;
    if(!Array.isArray(rows)||rows.length<1||rows.length>30)throw BAD_REQUEST('Import 1 to 30 records per batch.');
    const roster=(await db.prepare('SELECT id,psgc FROM barangays').all()).results;
    const vals=rows.map((r,i)=>{
      const b=roster.find(x=>x.psgc===String(r.barangay_psgc??'').trim().padStart(10,'0'));
      if(!b)throw BAD_REQUEST(`Row ${i+1}: unknown 10-digit PSGC.`);
      return vaccineInput({...r,barangay_id:b.id},u);
    });
    const statements=vals.map(x=>db.prepare(`INSERT INTO vaccinations(id,barangay_id,date,species_code,vaccine,doses,site,notes,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),x.barangay_id,x.date,x.species_code,x.vaccine,x.doses,x.site,x.notes,u.id,u.id));
    await db.batch(statements);await log(db,u,'import','vaccination','batch',`${vals.length} entries, review pending`);return response({ok:true,imported:vals.length});
  }
  if(path==='/api/export'&&method==='GET'){
    const type=String(url.searchParams.get('type')||''),m=month(url.searchParams.get('month')),bid=scopeId(u,url.searchParams.get('barangay_id'));
    let headers,rows;
    if(type==='census'){
      headers=['month','barangay_psgc','barangay','species_code','species','head_count','households','status','notes','updated_at'];
      rows=(await db.prepare(`SELECT c.month,b.psgc AS barangay_psgc,b.name AS barangay,c.species_code,s.name AS species,
        c.head_count,c.households,c.status,c.notes,c.updated_at FROM census c JOIN barangays b ON b.id=c.barangay_id
        JOIN species s ON s.code=c.species_code WHERE c.month=? ${bid?'AND c.barangay_id=?':''} ORDER BY b.name,s.sort_order LIMIT 10000`).bind(m,...(bid?[bid]:[])).all()).results;
    }else if(type==='vaccinations'){
      headers=['date','barangay_psgc','barangay','species_code','vaccine','doses','site','status','notes','updated_at'];
      rows=(await db.prepare(`SELECT v.date,b.psgc AS barangay_psgc,b.name AS barangay,v.species_code,v.vaccine,v.doses,v.site,v.status,v.notes,v.updated_at
        FROM vaccinations v JOIN barangays b ON b.id=v.barangay_id WHERE substr(v.date,1,7)=? ${bid?'AND v.barangay_id=?':''}
        ORDER BY v.date,b.name LIMIT 10000`).bind(m,...(bid?[bid]:[])).all()).results;
    }else if(type==='summary'){
      headers=['month','barangay_psgc','barangay','classification','total_animals','livestock','poultry','dogs','cats','dog_anti_rabies_doses','cat_anti_rabies_doses','species_reported'];
      rows=(await db.prepare(`WITH cs AS (
        SELECT barangay_id, SUM(head_count) AS total_animals,
          SUM(CASE WHEN species_code IN ('carabao','cattle','swine','goat','sheep','horse') THEN head_count ELSE 0 END) AS livestock,
          SUM(CASE WHEN species_code IN ('chicken','duck','turkey','quail') THEN head_count ELSE 0 END) AS poultry,
          SUM(CASE WHEN species_code='dog' THEN head_count ELSE 0 END) AS dogs,
          SUM(CASE WHEN species_code='cat' THEN head_count ELSE 0 END) AS cats,
          COUNT(*) AS species_reported FROM census WHERE month=? AND status='approved' GROUP BY barangay_id
        ), vs AS (
          SELECT barangay_id,
          SUM(CASE WHEN species_code='dog' THEN doses ELSE 0 END) AS dog_anti_rabies_doses,
          SUM(CASE WHEN species_code='cat' THEN doses ELSE 0 END) AS cat_anti_rabies_doses
          FROM vaccinations WHERE substr(date,1,7)=? AND vaccine='Anti-rabies' AND status='approved'
          GROUP BY barangay_id
        ) SELECT ? AS month,b.psgc AS barangay_psgc,b.name AS barangay,b.classification,
          COALESCE(cs.total_animals,0) AS total_animals,COALESCE(cs.livestock,0) AS livestock,
          COALESCE(cs.poultry,0) AS poultry,COALESCE(cs.dogs,0) AS dogs,COALESCE(cs.cats,0) AS cats,
          COALESCE(vs.dog_anti_rabies_doses,0) AS dog_anti_rabies_doses,
          COALESCE(vs.cat_anti_rabies_doses,0) AS cat_anti_rabies_doses,
          COALESCE(cs.species_reported,0) AS species_reported
          FROM barangays b LEFT JOIN cs ON cs.barangay_id=b.id LEFT JOIN vs ON vs.barangay_id=b.id
          ${bid?'WHERE b.id=?':''} ORDER BY b.name`).bind(m,m,m,...(bid?[bid]:[])).all()).results;
    }else throw BAD_REQUEST('Export type must be summary, census or vaccinations.');
    const csv=v=>{let s=String(v??'');if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    const text='\ufeff'+headers.join(',')+'\r\n'+rows.map(r=>headers.map(h=>csv(r[h])).join(',')).join('\r\n');
    return new Response(text,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="ormoc-vet-${type}-${m}.csv"`,'cache-control':'no-store'}});
  }
  return failure('API endpoint not found.',404);
}
export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url);
      const r=url.pathname.startsWith('/api/')?await api(request,env):await env.ASSETS.fetch(request);
      const h=new Headers(r.headers);
      h.set('x-content-type-options','nosniff');h.set('referrer-policy','no-referrer');h.set('x-frame-options','DENY');
      h.set('permissions-policy','camera=(), microphone=(), geolocation=()');
      if(!url.pathname.startsWith('/api/')){
        h.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'");
        if(url.pathname==='/'||url.pathname.endsWith('.html'))h.set('cache-control','no-store');
      }
      return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});
    } catch(e) {
      if(e.status)return failure(e.message,e.status);
      console.error('OCVMS server error:',e);
      if(String(e.message||'').includes('UNIQUE constraint failed'))return failure('This record already exists. Use a different username or record.',409);
      return failure('Unexpected server or database error. Check migrations, bindings, and Worker logs.',500);
    }
  }
};
