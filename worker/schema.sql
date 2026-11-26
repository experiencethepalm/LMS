-- The Palm Unity lead platform — Cloudflare D1 schema
-- Apply with: npx wrangler d1 execute palm-leads --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS salespeople (
  code        TEXT PRIMARY KEY,          -- used in share links: ?ref=CODE
  name        TEXT NOT NULL,
  phone       TEXT,
  pin_hash    TEXT,                      -- dashboard login PIN (hashed)
  share_id    TEXT,                      -- opaque id used in share links: ?r=share_id
  role        TEXT DEFAULT 'sales',      -- super_admin | sales | channel_partner
  company     TEXT,                      -- channel partner's firm
  created_by  TEXT,                      -- user code who added this user
  last_login  INTEGER,
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
  referred_by INTEGER,                   -- lead id of the buyer whose link they opened
  assigned_to TEXT,                      -- sales team member responsible for follow-up
  internal    INTEGER DEFAULT 0,         -- 1 = team/test entry, -1 = kept as client, 0 = auto (team numbers hidden)
  share_id    TEXT,                      -- this buyer's own share id (?r=...) for forwarding to family
  status      TEXT NOT NULL DEFAULT 'new',   -- new | contacted | visit_booked | visited | negotiating | booked | lost
  notes       TEXT,
  email       TEXT,
  crm_id      TEXT,                      -- the lead's ID in the CRM (kept in sync both ways)
  invite_id   TEXT,                      -- personal link id (?i=...) given to the CRM
  verified_at INTEGER,                   -- when they verified on WhatsApp (NULL = pushed from CRM, not verified yet)
  gclid       TEXT                       -- Google Ads click ID when they arrived from an ad (for offline conversion import)
);

CREATE TABLE IF NOT EXISTS otps (
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  ip          TEXT,
  pending     TEXT,                      -- JSON: name, profession, ref, source
  purpose     TEXT DEFAULT 'buyer'       -- buyer | staff
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

-- Every open of a shared link (before or after verification), for referral reach
CREATE TABLE IF NOT EXISTS link_opens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref           TEXT NOT NULL,           -- share id used
  sales_code    TEXT,                    -- salesperson credited
  by_lead       INTEGER,                 -- buyer who shared it (null = salesperson's own link)
  device        TEXT,                    -- random per-browser id
  ip            TEXT,
  ts            INTEGER NOT NULL,
  verified_lead INTEGER                  -- filled in once that device verifies
);
CREATE INDEX IF NOT EXISTS idx_opens_by ON link_opens(by_lead, ts);
CREATE INDEX IF NOT EXISTS idx_opens_device ON link_opens(device);

-- Follow-ups planned by the sales team (for a client or a channel partner)
CREATE TABLE IF NOT EXISTS followups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER,
  partner_code  TEXT,
  assigned_to   TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'call',   -- call | whatsapp | meeting | site_visit | other
  due_at        INTEGER NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | done | cancelled
  outcome       TEXT,
  done_at       INTEGER,
  done_by       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fu_assignee ON followups(assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS idx_fu_lead ON followups(lead_id);
CREATE INDEX IF NOT EXISTS idx_fu_partner ON followups(partner_code);

-- What staff did in the dashboard (super admin view)
CREATE TABLE IF NOT EXISTS staff_activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code    TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail       TEXT,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_user ON staff_activity(user_code, ts);
CREATE INDEX IF NOT EXISTS idx_staff_target ON staff_activity(target_type, target_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  prefix      TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  last_used   INTEGER,
  active      INTEGER NOT NULL DEFAULT 1
);
