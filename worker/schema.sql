-- The Palm Unity lead platform — Cloudflare D1 schema
-- Apply with: npx wrangler d1 execute palm-leads --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS salespeople (
  code        TEXT PRIMARY KEY,          -- used in share links: ?ref=CODE
  name        TEXT NOT NULL,
  phone       TEXT,
  pin_hash    TEXT,                      -- dashboard login PIN (hashed)
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL UNIQUE,      -- 10-digit Indian mobile
  name        TEXT NOT NULL,
  profession  TEXT,
  first_ref   TEXT,                      -- salesperson credited at first verification
  last_ref    TEXT,                      -- salesperson link used most recently
  source      TEXT,                      -- utm_source / campaign, if present
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  sessions    INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'new',   -- new | contacted | visit_booked | visited | negotiating | booked | lost
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS otps (
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  ip          TEXT,
  pending     TEXT                       -- JSON: name, profession, ref, source
);
CREATE INDEX IF NOT EXISTS idx_otps_phone ON otps(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_otps_ip ON otps(ip, created_at);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL,
  type        TEXT NOT NULL,             -- dwell | floorplan_open | brochure_open | gallery_open | walkthrough_play | cta | session_start
  target      TEXT,                      -- section id, plan id, cta name
  value       REAL,                      -- seconds for dwell
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_lead ON events(lead_id, ts);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL,
  role        TEXT NOT NULL,             -- user | assistant
  content     TEXT NOT NULL,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_lead ON chats(lead_id, ts);

CREATE TABLE IF NOT EXISTS requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER NOT NULL,
  kind            TEXT NOT NULL,         -- site_visit | callback
  preferred_date  TEXT,
  slot            TEXT,
  message         TEXT,
  created_at      INTEGER NOT NULL,
  handled         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_requests_lead ON requests(lead_id);
