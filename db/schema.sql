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

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- USERS
-- The six canonical roles (05_CRM_DATA_MODEL.md S12 / gtm doc 15 S1) plus CSM, which
-- the canon says splits off the AE and Eng at ~20-30 schools.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- USR-0001
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL
                CHECK (role IN ('founder','ae','ba','ra','designer','eng','csm')),
  -- Trust Engine hats worn on top of the role, comma-separated: producer, host.
  -- At this size one person wears several, exactly as the canon describes.
  hats          TEXT NOT NULL DEFAULT '',
  -- The functional group work is routed to. Distinct from the role, which is about
  -- permissions, and from the owner, who is the individual accountable.
  team          TEXT,
  title         TEXT,
  phone         TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','invited','disabled')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

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
  context_note       TEXT,                  -- account strategy, written by a human (§77)
  next_move          TEXT,                  -- the rep's own one-line plan (§77)
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
  -- THE SCHOOL IS THE PIPELINE OBJECT. Two campuses under one trust may legitimately
  -- sit at completely different points, so the acquisition stage lives here and
  -- nowhere else. Vocabulary: src/lib/rules/acquisition.ts ACQUISITION_STAGES.
  state_key               TEXT NOT NULL DEFAULT 'new_lead',
  stage_entered_at        TEXT,               -- when it arrived at that stage
  owner_id                TEXT REFERENCES users(id),
  context_note            TEXT,               -- why this school matters, written by a human
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
  -- How the relationship stands, as observed. Not a score, not a prediction.
  relationship_status    TEXT NOT NULL DEFAULT 'unknown',
  notes                  TEXT,
  -- THE DPDP WALL. A student is not a Contact, and the schema will not allow one.
  is_minor               INTEGER NOT NULL DEFAULT 0 CHECK (is_minor = 0),
  source_ref             TEXT,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_account ON people(account_id);

-- One person may sit across several schools in the same account. Never duplicate them.
-- THE ASSOCIATION. A person is identified by name + ROLE + SCHOOL + ACCOUNT, never by
-- name alone (§3). One row per person-per-school, so the same person can sit across
-- several schools in a group without being duplicated (§5).
--
-- school_role  = what they ARE at the school ("Principal")
-- relationship_types = how they relate to MINTRIX ("decision_maker,primary_poc")
-- These are different things (§12) and are never mixed.
CREATE TABLE IF NOT EXISTS person_roles (
  id                    TEXT PRIMARY KEY,
  person_id             TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  school_id             TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role                  TEXT,                 -- free text as first recorded
  school_role           TEXT,                 -- key from rules/entities SCHOOL_ROLES
  custom_role           TEXT,                 -- when the list does not have their title
  relationship_types    TEXT NOT NULL DEFAULT '',
  -- People move schools. The old association is ended, never deleted (§41).
  started_on            TEXT,
  ended_on              TEXT,
  discovered_how        TEXT,                 -- rules/entities DISCOVERY_ROUTES
  introduced_by_person_id TEXT REFERENCES people(id),
  notes                 TEXT,
  created_by            TEXT REFERENCES users(id),
  created_at            TEXT NOT NULL
);
-- One ACTIVE association per person per school; ended ones may accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_school_active
  ON person_roles(person_id, school_id) WHERE ended_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_person_roles_school ON person_roles(school_id, ended_on);

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
  -- "Admission automation for ABC International School", not "OPP-18372" (§17).
  description        TEXT,
  primary_person_id  TEXT REFERENCES people(id),
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
  -- Only 'resolved' counts as completed. 'cancelled' is a different outcome and the
  -- history must preserve the difference (§62).
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','waiting','blocked',
                                    'resolved','cancelled')),
  waiting_on      TEXT,                       -- blocker type while status = waiting/blocked
  follow_up_on    TEXT,                       -- when a waiting task returns to the queue
  blocked_reason  TEXT,
  depends_on_task_id TEXT REFERENCES tasks(id),
  resolution_note TEXT,
  priority        TEXT NOT NULL DEFAULT 'normal',
  owner_id        TEXT REFERENCES users(id),
  -- ---- THE OPERATIONAL WORK LAYER ---------------------------------------
  -- One work object, not two competing ones. A 'task' is a lightweight action
  -- ("Call Priya"); a 'ticket' is operational work with a team, an external party
  -- and a definition of done ("Prepare the recording setup").
  work_type       TEXT NOT NULL DEFAULT 'task'
                  CHECK (work_type IN ('task','ticket')),
  team            TEXT,                       -- rules/acquisition.ts TEAMS
  workstream      TEXT,                       -- rules/acquisition.ts WORKSTREAMS
  stage_key       TEXT,                       -- the school stage that required this work
  template_key    TEXT,                       -- stage work template, for idempotency
  -- Only BLOCKING work can hold a stage shut. Production editing must never stop the
  -- sales pipeline, and a social clip must never stop a recording.
  blocking        INTEGER NOT NULL DEFAULT 0,
  requester_id    TEXT REFERENCES users(id),  -- who asked for it
  external_person_id TEXT REFERENCES people(id),  -- who at the school we need
  required_outcome TEXT,                      -- what "done" means for this item
  started_at      TEXT,
  resolved_by     TEXT REFERENCES users(id),
  resolution_kind TEXT,                       -- completed / with_issue / follow_up / …
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
  opportunity_id TEXT REFERENCES opportunities(id),
  person_id      TEXT REFERENCES people(id),
  item           TEXT NOT NULL,
  blocker_type   TEXT,                        -- rules/entities BLOCKER_TYPES
  expected_resolution TEXT,
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
  reason         TEXT,                        -- why it moved, in the mover's words
  moved_by       TEXT REFERENCES users(id),
  moved_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transitions_account ON stage_transitions(account_id, moved_at);

-- ------------------------------------------------- OPPORTUNITY STAKEHOLDERS
-- An opportunity is worked with several people, in different capacities (§72, §73).
CREATE TABLE IF NOT EXISTS opportunity_stakeholders (
  id             TEXT PRIMARY KEY,            -- OST-0001
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  person_id      TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  capacity       TEXT NOT NULL,               -- rules/entities RELATIONSHIP_TYPES
  note           TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (opportunity_id, person_id, capacity)
);

-- ------------------------------------------------------------- STAGE CLOCK
-- One open clock per subject. Moving stage closes the old one and opens the new,
-- so there is never more than one live stage SLA (§31).
CREATE TABLE IF NOT EXISTS stage_slas (
  id             TEXT PRIMARY KEY,            -- SLA-0001
  subject_type   TEXT NOT NULL,               -- opportunity / podcast / delivery
  subject_id     TEXT NOT NULL,
  account_id     TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  stage_key      TEXT NOT NULL,
  sla_hours      INTEGER,
  entered_at     TEXT NOT NULL,
  due_at         TEXT,
  closed_at      TEXT,
  closed_reason  TEXT,                        -- moved_on / terminal / reopened
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_slas_open
  ON stage_slas(subject_type, subject_id, closed_at);

-- ---------------------------------------------------------- STAGE HANDOFFS
-- A deterministic, structured summary written on every stage move, so the next person
-- never has to ask what happened before (§27, §28). Assembled from existing data —
-- no AI, no free-text generation.
CREATE TABLE IF NOT EXISTS stage_handoffs (
  id              TEXT PRIMARY KEY,           -- HOF-0001
  transition_id   TEXT REFERENCES stage_transitions(id) ON DELETE CASCADE,
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  account_id      TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  entered_at      TEXT,
  exited_at       TEXT NOT NULL,
  from_owner      TEXT REFERENCES users(id),
  to_owner        TEXT REFERENCES users(id),
  payload_json    TEXT NOT NULL,              -- the structured summary
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handoffs_subject
  ON stage_handoffs(subject_type, subject_id, exited_at);

-- --------------------------------------------------------------- SETTINGS
-- Founder-editable overrides for the rule files. A missing key means "use the code
-- default", so the rules stay readable and settings stay small (§65-§69).
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL
);

-- --------------------------------------------------------------- TICKETS
-- 05_CRM_DATA_MODEL.md S9.1. The company-side support record. Owned by the AI Workflow
-- Engineer; at pilot size the founder or the engineer wears that hat.
CREATE TABLE IF NOT EXISTS tickets (
  id               TEXT PRIMARY KEY,        -- TKT-0001
  account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  school_id        TEXT REFERENCES schools(id),
  project_id       TEXT REFERENCES delivery_projects(id),
  -- Who raised it. An ADULT staff contact only: the S13 child-data wall means a
  -- student can never be a person row, so a student can never raise a ticket either.
  raised_by_person_id TEXT REFERENCES people(id),
  raised_by_name   TEXT,                    -- when the caller is not yet on file
  subject          TEXT NOT NULL,
  detail           TEXT,
  type             TEXT NOT NULL DEFAULT 'question'
                   CHECK (type IN ('question','bug','incident','feature_request','data_access')),
  severity         TEXT NOT NULL DEFAULT 'S3' CHECK (severity IN ('S1','S2','S3','S4')),
  priority         TEXT NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3','P4')),
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','in_progress','waiting_on_school','escalated',
                                     'resolved','closed')),
  sla_due          TEXT,
  owner_id         TEXT REFERENCES users(id),
  resolution       TEXT,
  resolved_at      TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_open ON tickets(status, sla_due);
CREATE INDEX IF NOT EXISTS idx_tickets_account ON tickets(account_id);
CREATE INDEX IF NOT EXISTS idx_tickets_owner ON tickets(owner_id, status);

-- Append-only, like the activity log: a ticket's history is evidence.
CREATE TABLE IF NOT EXISTS ticket_events (
  id          TEXT PRIMARY KEY,             -- TEV-0001
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                -- created / status / owner / note / resolved
  detail      TEXT NOT NULL,
  by_user     TEXT REFERENCES users(id),
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_events ON ticket_events(ticket_id, at);

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
