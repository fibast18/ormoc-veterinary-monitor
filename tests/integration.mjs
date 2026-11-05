import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(readFileSync(new URL('../migrations/0001_schema.sql',import.meta.url),'utf8'));
db.exec(readFileSync(new URL('../migrations/0002_barangays.sql',import.meta.url),'utf8'));
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
r=await call('/api/users',{cookie:adminCookie,data:{action:'create',username:'encoder.macabug',full_name:'Test Encoder',role:'encoder',barangay_id:mac.id,password:'EncoderPassphrase@@2026'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/login',{data:{username:'encoder.macabug',password:'EncoderPassphrase@@2026'}});assert.equal(r.status,200,r.body.error);encoderCookie=r.cookie.split(';')[0];
r=await call('/api/census',{cookie:encoderCookie,data:{barangay_id:tamb.id,species_code:'goat',month:'2026-11',head_count:33,households:9}});assert.equal(r.status,403,'encoder must be blocked outside own barangay');
r=await call('/api/dashboard?month=2026-11',{cookie:encoderCookie});assert.equal(r.body.totals.expected,1,'encoder scope should be one barangay');
r=await call('/api/census',{cookie:encoderCookie,data:{barangay_id:mac.id,species_code:'goat',month:'2026-11',head_count:33,households:''}});assert.equal(r.status,200,r.body.error);
r=await call('/api/census?month=2026-11&barangay_id='+tamb.id,{cookie:encoderCookie});assert.equal(r.status,403);
r=await call('/api/import/census',{cookie:adminCookie,data:{rows:[{month:'2026-11',barangay_psgc:mac.psgc.slice(1),species_code:'chicken',head_count:'22',households:'',notes:'CSV test'}]}});assert.equal(r.status,200,r.body.error);
r=await call('/api/census?month=2026-11',{cookie:adminCookie});assert.equal(r.body.rows.length,3);
r=await call('/api/census/review',{cookie:adminCookie,data:{id:censusId,status:'rejected'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.animals,0,'rejected formerly approved census must no longer count');
r=await call('/',{});assert.ok(r.headers.get('content-security-policy')?.includes("script-src 'self'"));
console.log('PASS: live Worker handlers (bootstrap, auth, scoped authorization, census/review, vaccines/review, CSV summary, import, server-side status logic, static security headers)');
