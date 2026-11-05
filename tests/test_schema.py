import sqlite3
from pathlib import Path
base=Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON')
db.executescript((base/'migrations/0001_schema.sql').read_text())
db.executescript((base/'migrations/0002_barangays.sql').read_text())
assert db.execute('select count(*) from barangays').fetchone()[0]==85
assert db.execute('select count(*) from species').fetchone()[0]==14
assert db.execute('select count(distinct psgc) from barangays').fetchone()[0]==85
assert db.execute("select name from barangays where psgc='0803738062'").fetchone()[0]=='Macabug'
assert db.execute("select name from barangays where psgc='0803738117'").fetchone()[0]=='Barangay West'
# Reporting snapshots: sum single month only, review excludes pending
b=db.execute("SELECT id FROM barangays WHERE name='Macabug'").fetchone()['id']
db.execute("INSERT INTO users(id,username,full_name,role,barangay_id,salt,password_hash) VALUES('u1','admin','Test Admin','admin',NULL,'a','b')")
db.execute("INSERT INTO census(id,barangay_id,species_code,month,head_count,status,created_by,updated_by) VALUES('c1',?,'swine','2026-11',100,'approved','u1','u1')",(b,))
db.execute("INSERT INTO census(id,barangay_id,species_code,month,head_count,status,created_by,updated_by) VALUES('c2',?,'swine','2026-10',200,'approved','u1','u1')",(b,))
db.execute("INSERT INTO census(id,barangay_id,species_code,month,head_count,status,created_by,updated_by) VALUES('c3',?,'dog','2026-11',40,'pending','u1','u1')",(b,))
assert db.execute("select sum(head_count) from census where month='2026-11' and status='approved'").fetchone()[0]==100
db.execute("INSERT INTO vaccinations(id,barangay_id,date,species_code,vaccine,doses,status,created_by,updated_by) VALUES('v1',?,'2026-11-05','dog','Anti-rabies',20,'approved','u1','u1')",(b,))
db.execute("INSERT INTO vaccinations(id,barangay_id,date,species_code,vaccine,doses,status,created_by,updated_by) VALUES('v2',?,'2026-11-05','dog','Anti-rabies',30,'pending','u1','u1')",(b,))
assert db.execute("select sum(doses) from vaccinations where substr(date,1,7)='2026-11' and status='approved'").fetchone()[0]==20
try:
 db.execute("INSERT INTO census(id,barangay_id,species_code,month,head_count,status) VALUES('c4',?,'swine','2026-11',300,'approved')",(b,))
 raise AssertionError('Unique index missing')
except sqlite3.IntegrityError: pass
print('PASS: 85 PSGC barangays, species, SQL constraints, month-specific census and approved vaccination totals')
