import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(readFileSync(new URL('../migrations/0001_schema.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../migrations/0002_barangays.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../migrations/0003_offline_sync.sql',import.meta.url),'utf8'));
class Statement {
 constructor(sql){this.sql=sql;this.args=[];}
 bind(...args){this.args=args;return this;}
 first(){return db.prepare(this.sql).get(...this.args)||null;}
 all(){return {results:db.prepare(this.sql).all(...this.args)};}
 run(){const r=db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};}
}
const env={DB:{prepare(sql){return new Statement(sql);},batch(statements){db.exec('BEGIN');try{const r=statements.map(s=>s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},BOOTSTRAP_TOKEN:'test-long-bootstrap-token-1234567890-abcdef',ASSETS:{fetch(){return new Response('<html></html>',{headers:{'content-type':'text/html'}});}}};
let adminCookie='',encoderCookie='';
async function call(path,{data,cookie='',method=data?'POST':'GET'}={}){
 const res=await worker.fetch(new Request('https://ormoc-test.workers.dev'+path,{method,headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),'origin':'https://ormoc-test.workers.dev'},...(data?{body:JSON.stringify(data)}:{})}),env);
 const text=await res.text();let body;try{body=JSON.parse(text)}catch{body=text}
 return {status:res.status,body,cookie:res.headers.get('set-cookie'),headers:res.headers};
}
let r=await call('/api/bootstrap/status');assert.equal(r.body.needs_setup,true);
r=await call('/api/bootstrap',{data:{setup_token:env.BOOTSTRAP_TOKEN,username:'vetadmin',full_name:'Test City Admin',password:'StrongPassphrase##2026'}});assert.equal(r.status,200,r.body.error);adminCookie=r.cookie.split(';')[0];
r=await call('/api/bootstrap/status');assert.equal(r.body.needs_setup,false);
r=await call('/api/catalog',{cookie:adminCookie});assert.equal(r.body.barangays.length,85);assert.equal(r.body.species.length,14);
const mac=r.body.barangays.find(x=>x.name==='Macabug'),tamb=r.body.barangays.find(x=>x.name==='Tambulilid');
assert.ok(mac);assert.ok(tamb);
r=await call('/api/census',{cookie:adminCookie,data:{barangay_id:mac.id,species_code:'dog',month:'2026-11',head_count:120,households:80,notes:'Test only'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.animals,0,'pending census should not count');
r=await call('/api/census?month=2026-11',{cookie:adminCookie});assert.equal(r.body.rows.length,1);const censusId=r.body.rows[0].id;
r=await call('/api/census/review',{cookie:adminCookie,data:{id:censusId,status:'approved'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.animals,120);assert.equal(r.body.totals.dogs,120);assert.equal(r.body.totals.reporting,1);
r=await call('/api/vaccinations',{cookie:adminCookie,data:{barangay_id:mac.id,date:'2026-11-05',species_code:'dog',vaccine:'Anti-rabies',doses:35,site:'Macabug hall',notes:''}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.vaccinated_dogs,0);
r=await call('/api/vaccinations?month=2026-11',{cookie:adminCookie});assert.equal(r.body.rows.length,1);const vId=r.body.rows[0].id;
r=await call('/api/vaccinations/review',{cookie:adminCookie,data:{id:vId,status:'approved'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.vaccinated_dogs,35);
r=await call('/api/export?type=summary&month=2026-11',{cookie:adminCookie});assert.equal(r.status,200);assert.ok(r.body.includes('Macabug'));assert.ok(r.body.includes('dog_anti_rabies_doses'));
// City Admin appoints Encoder without a barangay selection. Older encoder rows remain valid.
r=await call('/api/users',{cookie:adminCookie,data:{action:'create',username:'encoder.cvo',full_name:'CVO Citywide Encoder',role:'encoder',password:'EncoderPassphrase@@2026'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/users',{cookie:adminCookie});assert.equal(r.status,200);assert.equal(r.body.rows.find(x=>x.username==='encoder.cvo').barangay_id,null,'no assigned barangay exposed');
r=await call('/api/login',{data:{username:'encoder.cvo',password:'EncoderPassphrase@@2026'}});assert.equal(r.status,200,r.body.error);assert.equal(r.body.user.role,'encoder');assert.equal(r.body.user.barangay_id,null);encoderCookie=r.cookie.split(';')[0];
r=await call('/api/me',{cookie:encoderCookie});assert.equal(r.body.user.barangay_id,null);
r=await call('/api/dashboard?month=2026-11',{cookie:encoderCookie});assert.equal(r.body.totals.expected,85,'encoder has full citywide dashboard scope');
r=await call('/api/census',{cookie:encoderCookie,data:{barangay_id:tamb.id,species_code:'goat',month:'2026-11',head_count:33,households:9}});assert.equal(r.status,200,r.body.error);
r=await call('/api/census',{cookie:encoderCookie,data:{barangay_id:mac.id,species_code:'goat',month:'2026-11',head_count:33,households:''}});assert.equal(r.status,200,r.body.error);
r=await call('/api/census?month=2026-11&barangay_id='+tamb.id,{cookie:encoderCookie});assert.equal(r.status,200);assert.equal(r.body.rows.length,1);
r=await call('/api/census?month=2026-11',{cookie:encoderCookie});assert.equal(r.body.rows.length,3);
r=await call('/api/import/census',{cookie:encoderCookie,data:{rows:[{month:'2026-11',barangay_psgc:mac.psgc.slice(1),species_code:'chicken',head_count:'22',households:'',notes:'CSV test'},{month:'2026-11',barangay_psgc:tamb.psgc,species_code:'chicken',head_count:'17',households:'',notes:'CVO CSV test'}]}});assert.equal(r.status,200,r.body.error);assert.equal(r.body.imported,2);
r=await call('/api/census?month=2026-11',{cookie:adminCookie});assert.equal(r.body.rows.length,5);
r=await call('/api/import/vaccinations',{cookie:encoderCookie,data:{rows:[{date:'2026-11-05',barangay_psgc:tamb.psgc,species_code:'cat',vaccine:'Anti-rabies',doses:'14',site:'Tambulilid hall',notes:'CVO reports'},{date:'2026-11-05',barangay_psgc:mac.psgc,species_code:'dog',vaccine:'Anti-rabies',doses:'5',site:'Macabug hall',notes:'CVO reports'}]}});assert.equal(r.status,200,r.body.error);
r=await call('/api/vaccinations?month=2026-11&barangay_id='+tamb.id,{cookie:encoderCookie});assert.equal(r.status,200);assert.equal(r.body.rows.length,1);
// Existing vaccination in another barangay can be corrected by a citywide encoder.
r=await call('/api/vaccinations',{cookie:encoderCookie,data:{id:vId,barangay_id:tamb.id,date:'2026-11-05',species_code:'dog',vaccine:'Anti-rabies',doses:35,site:'Tambulilid hall',notes:'Corrected barangay'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/vaccinations?month=2026-11&barangay_id='+tamb.id,{cookie:adminCookie});assert.equal(r.body.rows.length,2);
assert.equal(r.body.rows.find(x=>x.id===vId).status,'pending','corrected vaccination requires re-approval');
r=await call('/api/census/review',{cookie:encoderCookie,data:{id:censusId,status:'approved'}});assert.equal(r.status,403,'Encoders cannot approve');
r=await call('/api/users',{cookie:encoderCookie});assert.equal(r.status,403,'Encoders cannot manage accounts');
// Legacy encoder with a stored barangay_id is also citywide after the upgrade.
r=await call('/api/users',{cookie:adminCookie,data:{action:'create',username:'encoder.legacy',full_name:'Older Encoder Account',role:'encoder',barangay_id:mac.id,password:'LegacyPassword##2026'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/login',{data:{username:'encoder.legacy',password:'LegacyPassword##2026'}});assert.equal(r.status,200,r.body.error);
assert.equal(r.body.user.barangay_id,null,'legacy anchor never appears as a scope');
r=await call('/api/dashboard?month=2026-11',{cookie:r.cookie.split(';')[0]});assert.equal(r.body.totals.expected,85,'existing encoders gain citywide scope');
r=await call('/api/census/review',{cookie:adminCookie,data:{id:censusId,status:'rejected'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.animals,0,'rejected formerly approved census must no longer count');
r=await call('/',{});assert.ok(r.headers.get('content-security-policy')?.includes("script-src 'self'"));
console.log('PASS: citywide CVO Encoder roles, new/legacy accounts, 85-barangay dashboard, cross-barangay census/vaccination CRUD & CSV imports, admin-only approvals, export, auth and secure Worker headers');
