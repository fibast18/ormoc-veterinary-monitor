-- D1 enforces foreign keys automatically; do not toggle foreign_keys in D1 migrations.
CREATE TABLE IF NOT EXISTS barangays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psgc TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  classification TEXT NOT NULL CHECK(classification IN ('Urban','Rural'))
);
CREATE TABLE IF NOT EXISTS species (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('Livestock','Poultry','Companion','Other')),
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO species(code,name,category,sort_order) VALUES
('carabao','Carabao','Livestock',10),('cattle','Cattle','Livestock',20),('swine','Swine / Pigs','Livestock',30),
('goat','Goats','Livestock',40),('sheep','Sheep','Livestock',50),('horse','Horses','Livestock',60),
('chicken','Chickens','Poultry',70),('duck','Ducks','Poultry',80),('turkey','Turkeys','Poultry',90),
('quail','Quails','Poultry',100),('dog','Dogs','Companion',110),('cat','Cats','Companion',120),
('rabbit','Rabbits','Other',130),('other','Other Animals','Other',140);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','encoder','viewer')),
  barangay_id INTEGER REFERENCES barangays(id),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id),
  CHECK ((role='encoder' AND barangay_id IS NOT NULL) OR (role <> 'encoder' AND barangay_id IS NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT COLLATE NOCASE PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS census (
  id TEXT PRIMARY KEY,
  barangay_id INTEGER NOT NULL REFERENCES barangays(id),
  species_code TEXT NOT NULL REFERENCES species(code),
  month TEXT NOT NULL CHECK(month GLOB '[12][0-9][0-9][0-9]-[01][0-9]'),
  head_count INTEGER NOT NULL CHECK(head_count BETWEEN 0 AND 99999999),
  households INTEGER NOT NULL DEFAULT 0 CHECK(households BETWEEN 0 AND 9999999),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  UNIQUE(barangay_id,species_code,month)
);
CREATE INDEX IF NOT EXISTS idx_census_month_status ON census(month,status,barangay_id);
CREATE TABLE IF NOT EXISTS vaccinations (
  id TEXT PRIMARY KEY,
  barangay_id INTEGER NOT NULL REFERENCES barangays(id),
  date TEXT NOT NULL CHECK(date GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
  species_code TEXT NOT NULL CHECK(species_code IN ('dog','cat')),
  vaccine TEXT NOT NULL CHECK(vaccine IN ('Anti-rabies','Other')),
  doses INTEGER NOT NULL CHECK(doses BETWEEN 1 AND 9999999),
  site TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_vacc_date_status ON vaccinations(date,status,barangay_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
