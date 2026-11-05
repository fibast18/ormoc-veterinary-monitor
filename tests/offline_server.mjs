import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for(const name of ['0001_schema.sql','0002_barangays.sql','0003_offline_sync.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
class Statement{
 constructor(sql){this.sql=sql;this.args=[];}bind(...args){this.args=args;return this;}
 first(){return db.prepare(this.sql).get(...this.args)||null;}
 all(){return {results:db.prepare(this.sql).all(...this.args)};}
 run(){const r=db.prepare(this.sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}
}
const env={DB:{prepare(sql){return new Statement(sql);},batch(ops){db.exec('BEGIN');try{const r=ops.map(x=>x.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},BOOTSTRAP_TOKEN:'test-offline-bootstrap-long-secret-2026',ASSETS:{fetch(){return new Response('static site',{status:200});}}};
async function call(path,{data,cookie}={}){
 const res=await worker.fetch(new Request('https://localhost'+path,{method:data?'POST':'GET',headers:{...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),origin:'https://localhost'},...(data?{body:JSON.stringify(data)}:{})}),env);
 return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
let r=await call('/api/bootstrap',{data:{setup_token:env.BOOTSTRAP_TOKEN,username:'admin',full_name:'CVO Admin',password:'SecurePassphrase##2026'}});assert.equal(r.status,200,r.body.error);const adminCookie=r.cookie;
const cat=(await call('/api/catalog',{cookie:adminCookie})).body;
assert.equal(cat.barangays.length,85);const b=cat.barangays[0];
r=await call('/api/users',{cookie:adminCookie,data:{action:'create',username:'encoder',full_name:'CVO Encoder',role:'encoder',password:'EncoderPassphrase##2026'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/login',{data:{username:'encoder',password:'EncoderPassphrase##2026'}});assert.equal(r.status,200,r.body.error);const encoderCookie=r.cookie;
const uuid=()=>crypto.randomUUID();
const census={barangay_id:b.id,species_code:'dog',month:'2026-11',head_count:40,households:23,notes:'offline draft',expected_revision:0,mutation_id:uuid()};
r=await call('/api/census',{cookie:encoderCookie,data:census});assert.equal(r.status,200,r.body.error);
r=await call('/api/census',{cookie:encoderCookie,data:census});assert.equal(r.status,200,'replayed queued census must succeed');assert.equal(r.body.already_applied,true);
let rows=(await call('/api/census?month=2026-11',{cookie:adminCookie})).body.rows;assert.equal(rows.length,1);assert.equal(rows[0].revision,1);let cid=rows[0].id;
r=await call('/api/census/review',{cookie:adminCookie,data:{id:cid,status:'approved'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.dogs,40);
r=await call('/api/census',{cookie:encoderCookie,data:{...census,head_count:55,expected_revision:1,mutation_id:uuid()}});assert.equal(r.status,409,'stale offline change should be a conflict');
rows=(await call('/api/census?month=2026-11',{cookie:encoderCookie})).body.rows;
r=await call('/api/census',{cookie:encoderCookie,data:{...census,head_count:55,expected_revision:rows[0].revision,mutation_id:uuid()}});assert.equal(r.status,200,r.body.error);
rows=(await call('/api/census?month=2026-11',{cookie:encoderCookie})).body.rows;
r=await call('/api/census/delete',{cookie:encoderCookie,data:{id:cid,expected_revision:rows[0].revision,mutation_id:uuid()}});
assert.equal(r.status,200);assert.equal(r.body.deletion_pending,true);
rows=(await call('/api/census?month=2026-11',{cookie:adminCookie})).body.rows;assert.equal(rows[0].deletion_requested,1);
r=await call('/api/census/deletion-review',{cookie:encoderCookie,data:{id:cid,decision:'approve'}});assert.equal(r.status,403);
r=await call('/api/census/deletion-review',{cookie:adminCookie,data:{id:cid,decision:'approve'}});assert.equal(r.status,200,r.body.error);
rows=(await call('/api/census?month=2026-11',{cookie:adminCookie})).body.rows;assert.equal(rows.length,0);
r=await call('/api/dashboard?month=2026-11',{cookie:adminCookie});assert.equal(r.body.totals.dogs,0);
const vId=uuid(),vMut=uuid(),vax={client_id:vId,mutation_id:vMut,expected_revision:0,barangay_id:b.id,date:'2026-11-05',species_code:'dog',vaccine:'Anti-rabies',doses:20,site:'City vet',notes:'queued vaccination'};
r=await call('/api/vaccinations',{cookie:encoderCookie,data:vax});assert.equal(r.status,200,r.body.error);
r=await call('/api/vaccinations',{cookie:encoderCookie,data:vax});assert.equal(r.status,200);assert.equal(r.body.already_applied,true,'replayed queued vaccination must not duplicate');
rows=(await call('/api/vaccinations?month=2026-11',{cookie:adminCookie})).body.rows;assert.equal(rows.length,1);assert.equal(rows[0].id,vId);
r=await call('/api/vaccinations/review',{cookie:adminCookie,data:{id:vId,status:'approved'}});assert.equal(r.status,200,r.body.error);
r=await call('/api/vaccinations/delete',{cookie:encoderCookie,data:{id:vId,expected_revision:1,mutation_id:uuid()}});assert.equal(r.status,409,'stale vaccine deletion should conflict');
r=await call('/api/vaccinations/delete',{cookie:encoderCookie,data:{id:vId,expected_revision:2,mutation_id:uuid()}});assert.equal(r.status,200);assert.equal(r.body.deletion_pending,true);
r=await call('/api/vaccinations/deletion-review',{cookie:adminCookie,data:{id:vId,decision:'reject'}});assert.equal(r.status,200);
rows=(await call('/api/vaccinations?month=2026-11',{cookie:adminCookie})).body.rows;assert.equal(rows[0].deleted_at,null);assert.equal(rows[0].deletion_requested,0);
const headers=(await worker.fetch(new Request('https://localhost/sw.js'),env)).headers;assert.ok(headers.get('cache-control')?.includes('no-store'));
console.log('PASS: v1.0.3 migration, 85 barangays, idempotent offline retry, stale revision conflicts, encoder deletion approval/rejection, approved dashboard consistency, worker cache policy');
