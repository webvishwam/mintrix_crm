-- PostgreSQL DDL for the Mintrix Sales OS.
-- GENERATED from db/schema.sql by scripts/make-postgres.mts. Do not edit by hand.
-- The SQLite schema is written in the intersection of the two dialects, so this
-- conversion is almost a no-op.

-- MINTRIX SALES OS V0.1 — schema
--
-- Written in the intersection of SQLite and PostgreSQL so the move to Supabase is a
-- migration, not a rewrite: TEXT ids with canonical prefixes, ISO-8601 TEXT timestamps,
-- INTEGER 0/1 booleans, no engine-specific types.
--
-- Canonical ID prefixes and object names follow 05_CRM_DATA_MODEL.md. Do not rename.
--
-- THE DPDP CHILD-DATA WALL (05_CRM_DATA_MODEL.md S13) is enforced here, in the schema,
-- not in a policy document:
--   * people.is_minor is CHECK-constrained to 0. A student cannot be stored.
--   * Only aggregate counts cross the wall (schools.enrolled_student_count is a NUMBER).
--   * activities is append-only. Corrections are new rows.


-- ---------------------------------------------------------------- USERS
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- USR-0001
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('rep','founder')),
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ------------------------------------------------------------- ACCOUNTS
-- The institutional relationship. A group, a trust, or a standalone school's
-- own relationship envelope. Schools hang off it. The account survives the sale.
CREATE TABLE IF NOT EXISTS accounts (
  id                 TEXT PRIMARY KEY,      -- ACC-0001
  name               TEXT NOT NULL,
  common_name        TEXT,
  external_ref       TEXT,                  -- e.g. VNS-001 from the lead engine
  legal_entity       TEXT,
  governing_entity   TEXT,
  parent_group       TEXT,
  ownership_type     TEXT,
  city               TEXT,
  district           TEXT,
  state              TEXT,
  source             TEXT,                  -- where this account came from
  owner_id           TEXT REFERENCES users(id),
  state_key          TEXT NOT NULL DEFAULT 'prospect',
  lead_state         TEXT NOT NULL DEFAULT 'new',
  priority           TEXT,                  -- P0..P3
  bucket             TEXT,                  -- A..E
  commercial_signal  TEXT NOT NULL DEFAULT 'none',
  icp_band           TEXT,                  -- "A - first-POC candidate" — a label, not a score
  source_ref         TEXT,                  -- which import batch and row created this
  is_demo            INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_id);
CREATE INDEX IF NOT EXISTS idx_accounts_state ON accounts(state_key);
-- A research reference (VNS-001) identifies exactly one account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_external_ref
  ON accounts(external_ref) WHERE external_ref IS NOT NULL;

-- -------------------------------------------------------------- SCHOOLS
CREATE TABLE IF NOT EXISTS schools (
  id                      TEXT PRIMARY KEY,  -- SCH-0001
  account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  board                   TEXT,
  segment                 TEXT,
  address                 TEXT,
  city                    TEXT,
  affiliation_number      TEXT,
  grades                  TEXT,
  day_boarding            TEXT,
  founded                 TEXT,
  website                 TEXT,
  official_email          TEXT,
  official_email_source   TEXT,
  official_phone          TEXT,
  official_phone_source   TEXT,
  enrolled_student_count  INTEGER,           -- AGGREGATE COUNT ONLY. Never a student list.
  enrollment_note         TEXT,
  existing_erp_lms        TEXT,
  technology_maturity     TEXT,
  lifecycle_stage         TEXT NOT NULL DEFAULT 'Prospect',
  -- ---- IDENTITY (see src/lib/identity.ts) -------------------------------
  -- UDISE+ is the government's 11-digit code. Every school in India is issued one,
  -- so it is the authoritative dedup key whenever a source actually carries it.
  udise_code              TEXT,
  locality                TEXT,
  annual_fee              TEXT,
  -- Conservative fallback: normalised name + city. Enforced unique so two imports
  -- of the same list cannot produce two rows for the same school.
  identity_key            TEXT,
  source_ref              TEXT,
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schools_account ON schools(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_udise
  ON schools(udise_code) WHERE udise_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_identity
  ON schools(identity_key) WHERE identity_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_affiliation ON schools(affiliation_number);

-- --------------------------------------------------------------- PEOPLE
CREATE TABLE IF NOT EXISTS people (
  id                     TEXT PRIMARY KEY,   -- CON-0001
  account_id             TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  title                  TEXT,
  organisation           TEXT,
  dm_type                TEXT,
  role_in_deal           TEXT,               -- PRIMARY ECONOMIC BUYER / CHAMPION / GATEKEEPER ...
  economic_buyer         TEXT,               -- YES / NO / POSSIBLE
  influence              TEXT,               -- high / medium / low
  decision_authority     INTEGER,            -- 0-100, from the research pass. Evidence-backed.
  authority_evidence     TEXT,
  confidence             TEXT,               -- HIGH / MEDIUM / LOW
  current_status         TEXT,               -- CURRENT / LIKELY CURRENT / UNCERTAIN / OUTDATED
  phone                  TEXT,
  phone_confidence       TEXT,
  phone_source           TEXT,
  email                  TEXT,
  email_confidence       TEXT,
  email_source           TEXT,
  whatsapp               TEXT,
  linkedin               TEXT,
  linkedin_confidence    TEXT,
  preferred_channel      TEXT,
  location_office        TEXT,
  background             TEXT,
  do_not_contact         INTEGER NOT NULL DEFAULT 0,
  -- THE DPDP WALL. A student is not a Contact, and the schema will not allow one.
  is_minor               INTEGER NOT NULL DEFAULT 0 CHECK (is_minor = 0),
  source_ref             TEXT,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_account ON people(account_id);

-- One person may sit across several schools in the same account. Never duplicate them.
CREATE TABLE IF NOT EXISTS person_roles (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  school_id   TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role        TEXT,
  UNIQUE (person_id, school_id)
);

-- ------------------------------------------------------------- RESEARCH
CREATE TABLE IF NOT EXISTS research (
  id                    TEXT PRIMARY KEY,    -- RES-0001
  account_id            TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  verified_facts        TEXT,
  sources               TEXT,
  observations          TEXT,
  hypotheses            TEXT,                -- labelled HYPOTHESIS. Never asserted.
  leadership_signals    TEXT,
  technology_signals    TEXT,
  recent_events         TEXT,
  story_angle           TEXT,                -- why this school is interesting for the show
  why_visit             TEXT,
  what_to_say           TEXT,
  first_action          TEXT,
  primary_contact_route TEXT,
  likely_gatekeeper     TEXT,
  potential_champion    TEXT,
  likely_blocker        TEXT,
  likely_objection      TEXT,
  poc_hypothesis        TEXT,
  do_not_claim          TEXT,
  unknowns              TEXT,
  conflicts             TEXT,
  cluster_with          TEXT,
  summary               TEXT,
  updated_at            TEXT NOT NULL
);

-- ------------------------------------------------------------------ ICP
CREATE TABLE IF NOT EXISTS icp_assessments (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  strategic_value      INTEGER,
  first_poc_suitability INTEGER,
  sales_accessibility  INTEGER,
  axes_note            TEXT,
  disqualifier         TEXT,
  assessed_by          TEXT REFERENCES users(id),
  assessed_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS icp_checks (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  dimension     TEXT NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('yes','no','unknown')),
  note          TEXT,
  UNIQUE (account_id, dimension)
);

-- ------------------------------------------------- PODCAST (TRUST ENGINE)
CREATE TABLE IF NOT EXISTS podcast_relationships (
  id                TEXT PRIMARY KEY,        -- POD-0001
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  school_id         TEXT REFERENCES schools(id),
  guest_person_id   TEXT REFERENCES people(id),
  stage_key         TEXT NOT NULL DEFAULT 't0_target',
  episode_question  TEXT,
  do_not_ask        TEXT,
  recording_date    TEXT,
  recording_location TEXT,
  published_on      TEXT,
  episode_url       TEXT,
  path              TEXT CHECK (path IS NULL OR path IN ('A','B','C','D','E','F')),
  path_set_on       TEXT,
  temperature       TEXT,                    -- COLD / WARM / STRONG
  cut_requests      INTEGER NOT NULL DEFAULT 0,
  cut_requests_refused INTEGER NOT NULL DEFAULT 0,
  no_ask_contacts   INTEGER NOT NULL DEFAULT 0,
  owner_id          TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_podcast_account ON podcast_relationships(account_id);

-- One row per observed event. FACTS ONLY. A signal without a verbatim quote is inadmissible.
CREATE TABLE IF NOT EXISTS podcast_signals (
  id              TEXT PRIMARY KEY,          -- SIG-0001
  podcast_id      TEXT REFERENCES podcast_relationships(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  signal_type     TEXT NOT NULL,
  verbatim_quote  TEXT NOT NULL,
  speaker         TEXT NOT NULL,
  speaker_role    TEXT,
  timecode        TEXT,
  observed_at     TEXT NOT NULL,
  logged_by       TEXT REFERENCES users(id),
  CHECK (length(trim(verbatim_quote)) > 0),
  CHECK (length(trim(speaker)) > 0)
);

-- -------------------------------------------------------- OPPORTUNITIES
CREATE TABLE IF NOT EXISTS opportunities (
  id                 TEXT PRIMARY KEY,       -- OPP-0001
  account_id         TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  school_id          TEXT REFERENCES schools(id),
  name               TEXT NOT NULL,
  stage_key          TEXT NOT NULL DEFAULT 's1_market_gate',
  route              TEXT NOT NULL DEFAULT 'outbound' CHECK (route IN ('outbound','trust')),
  opened_from_signal_id TEXT REFERENCES podcast_signals(id),
  owner_id           TEXT REFERENCES users(id),
  pilot_fee_quoted   INTEGER,
  expected_decision_date TEXT,
  terminal_state     TEXT CHECK (terminal_state IS NULL OR terminal_state IN ('won','parked')),
  terminal_reason    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opps_account ON opportunities(account_id);

CREATE TABLE IF NOT EXISTS discoveries (
  id                TEXT PRIMARY KEY,
  opportunity_id    TEXT NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  problem           TEXT,                    -- in THEIR words
  current_workflow  TEXT,
  stakeholders      TEXT,
  current_tools     TEXT,
  impact            TEXT,
  desired_outcome   TEXT,
  urgency           TEXT,
  decision_maker    TEXT,
  decision_process  TEXT,
  timeline          TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostics (
  id                TEXT PRIMARY KEY,
  opportunity_id    TEXT NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  problem           TEXT,
  current_process   TEXT,
  evidence          TEXT,
  impact            TEXT,
  desired_state     TEXT,
  mintrix_solution  TEXT,
  expected_outcome  TEXT,
  agreed_by_school  INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilots (
  id                  TEXT PRIMARY KEY,
  opportunity_id      TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  hypothesis          TEXT,
  scope               TEXT,
  schools_included    TEXT,
  users_involved      TEXT,
  start_date          TEXT,
  end_date            TEXT,
  champion            TEXT,
  success_criteria    TEXT,
  acceptance_criteria TEXT,
  dependencies        TEXT,
  issues              TEXT,
  results             TEXT,
  conversion_decision TEXT,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id                  TEXT PRIMARY KEY,       -- PRO-0001
  opportunity_id      TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'requested',
  scope               TEXT,
  schools_covered     TEXT,
  modules             TEXT,
  pricing             TEXT,
  commercial_assumptions TEXT,
  valid_until         TEXT,
  decision_maker      TEXT,
  sent_on             TEXT,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id             TEXT PRIMARY KEY,            -- CNT-0001
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'requested',
  scope          TEXT,
  value_inr      INTEGER,
  signed_on      TEXT,
  effective_from TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,            -- PAY-0001
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  amount_inr     INTEGER,
  invoiced_on    TEXT,
  banked_on      TEXT,                        -- the ONLY thing that makes a deal Won
  reference      TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_projects (
  id                    TEXT PRIMARY KEY,     -- PRJ-0001
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  opportunity_id        TEXT REFERENCES opportunities(id),
  name                  TEXT NOT NULL,
  stage_key             TEXT NOT NULL DEFAULT 'd1_discovery_config',
  implementation_owner  TEXT,                 -- named person ON THEIR SIDE with time
  go_live_target        TEXT,
  handoff_snapshot      TEXT,                 -- the sales context, frozen at handoff
  owner_id              TEXT REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- ------------------------------------------------------------- ACTIVITY
-- Append-only. Never edited, never deleted. Corrections are new rows.
CREATE TABLE IF NOT EXISTS activities (
  id             TEXT PRIMARY KEY,            -- COM-0001
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  school_id      TEXT REFERENCES schools(id),
  person_id      TEXT REFERENCES people(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  podcast_id     TEXT REFERENCES podcast_relationships(id),
  task_id        TEXT,
  activity_type  TEXT NOT NULL,
  direction      TEXT,
  outcome_key    TEXT,
  outcome_label  TEXT,
  summary        TEXT,
  detail_json    TEXT,
  occurred_at    TEXT NOT NULL,
  logged_by      TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id, occurred_at);

-- ----------------------------------------------------------------- TASKS
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,           -- TSK-0001
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  school_id       TEXT REFERENCES schools(id),
  person_id       TEXT REFERENCES people(id),
  opportunity_id  TEXT REFERENCES opportunities(id),
  podcast_id      TEXT REFERENCES podcast_relationships(id),
  task_type       TEXT NOT NULL,
  title           TEXT NOT NULL,
  reason          TEXT NOT NULL,              -- Part D: why this is the right next action
  due_at          TEXT NOT NULL,
  sla_hours       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','done','cancelled')),
  priority        TEXT NOT NULL DEFAULT 'normal',
  owner_id        TEXT REFERENCES users(id),
  auto_generated  INTEGER NOT NULL DEFAULT 0,
  created_from    TEXT,                       -- the task whose outcome produced this one
  completed_at    TEXT,
  outcome_key     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id, status);

-- --------------------------------------------------------------- WAITING
CREATE TABLE IF NOT EXISTS waiting_items (
  id             TEXT PRIMARY KEY,            -- WAI-0001
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  school_id      TEXT REFERENCES schools(id),
  item           TEXT NOT NULL,
  party          TEXT NOT NULL,               -- waiting_school / waiting_mintrix / blocked / ...
  requested_on   TEXT NOT NULL,
  expected_on    TEXT,
  follow_up_on   TEXT NOT NULL,
  owner_id       TEXT REFERENCES users(id),
  resolved_at    TEXT,
  resolution     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waiting_open ON waiting_items(resolved_at, follow_up_on);

-- ------------------------------------------------------- GATES AND AUDIT
CREATE TABLE IF NOT EXISTS gate_evidence (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL,                -- account / podcast / opportunity
  subject_id    TEXT NOT NULL,
  gate_key      TEXT NOT NULL,
  satisfied     INTEGER NOT NULL DEFAULT 0,
  evidence      TEXT,
  confirmed_by  TEXT REFERENCES users(id),
  confirmed_at  TEXT NOT NULL,
  UNIQUE (subject_type, subject_id, gate_key)
);

CREATE TABLE IF NOT EXISTS stage_transitions (
  id             TEXT PRIMARY KEY,
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  account_id     TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  overridden     INTEGER NOT NULL DEFAULT 0,
  override_reason TEXT,
  moved_by       TEXT REFERENCES users(id),
  moved_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transitions_account ON stage_transitions(account_id, moved_at);

-- ------------------------------------------------------- BULK LEAD IMPORT
-- One row per import run, so every record can be traced back to a file and a row.
CREATE TABLE IF NOT EXISTS lead_imports (
  id             TEXT PRIMARY KEY,          -- IMP-0001
  source_file    TEXT NOT NULL,
  sheet          TEXT,
  profile        TEXT,                      -- which column mapping was used
  rows_read      INTEGER NOT NULL DEFAULT 0,
  accounts_new   INTEGER NOT NULL DEFAULT 0,
  schools_new    INTEGER NOT NULL DEFAULT 0,
  people_new     INTEGER NOT NULL DEFAULT 0,
  duplicates     INTEGER NOT NULL DEFAULT 0,
  review         INTEGER NOT NULL DEFAULT 0,
  rejected       INTEGER NOT NULL DEFAULT 0,
  dry_run        INTEGER NOT NULL DEFAULT 0,
  run_by         TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL
);

-- Pairs a human must decide on. The importer NEVER merges on a guess: if two rows
-- look alike but no authoritative key agrees, both are kept and the pair lands here.
CREATE TABLE IF NOT EXISTS duplicate_reviews (
  id             TEXT PRIMARY KEY,          -- DUP-0001
  import_id      TEXT REFERENCES lead_imports(id) ON DELETE CASCADE,
  subject_type   TEXT NOT NULL,             -- school / account
  incoming_id    TEXT,                      -- the record we just created
  incoming_name  TEXT NOT NULL,
  incoming_row   TEXT,                      -- the raw row, as JSON
  existing_id    TEXT,
  existing_name  TEXT,
  reason         TEXT NOT NULL,             -- why they look alike
  confidence     TEXT NOT NULL,             -- HIGH / MEDIUM / LOW
  status         TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','merged','kept_both','rejected')),
  resolved_by    TEXT REFERENCES users(id),
  resolved_at    TEXT,
  resolution     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dupreview_open ON duplicate_reviews(status, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);


-- Row-level security starting point (Supabase). Enable per table, then add policies
-- keyed on owner_id. The lean build relies on application-side authorisation; RLS
-- replaces it when the team grows past two people.
-- ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
