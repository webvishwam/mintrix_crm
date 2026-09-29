# DECISIONS — what is canon, what I chose, what is still open

Required by the build prompt (§58 Step 3): requirements are separated into
**source-defined**, **proposed**, and **unresolved**, so no assumption becomes a
business rule by accident.

---

## A. SOURCE-DEFINED — taken verbatim from your own documents

These were not designed here. They were read out of the repositories and encoded.

| What | Source |
|---|---|
| Trust Engine **T0–T6** with entry, owner, actions, exit, evidence, SLA and fail condition per stage | `mintrix-partnership-os/02_PIPELINE_INTEGRATION.md` Part B |
| The **14-stage opportunity cycle**, verbatim, numbered 1–14, plus Won / Parked-Lost | `mintrix-operating-system/05_CRM_DATA_MODEL.md` §3.B = `gtm/14_SALES_OPERATING_SYSTEM.md` |
| Trust-route accounts enter the commercial pipeline at **Stage 7 Discovery** | `02_PIPELINE_INTEGRATION.md` Part A |
| The **six post-podcast paths A–F** and their healthy distribution (25/25/20/15/10/5) | `mintrix-btc-show/06-COMMERCIAL/24_handoff_and_crm.md` Part A |
| The **handoff quality gate** — all seven, before Path E or F | same, Part E |
| **Partnership readiness** — all seven, before a proposal exists | `02_PIPELINE_INTEGRATION.md` Part F |
| **"No next step = not active"** — four conditions or the record flips to stalled; "follow up" rejected by validation | same, Part D |
| **Trust-Engine SLAs** (debrief 1 hour, thank-you 1 day, cuts 2 working days, permission→AE 5 days, 14 days then stop) | same, Part C |
| **Trust Test ≥5 of 7** to advance past T5; a refused cut is a governance incident | `02_PIPELINE_INTEGRATION.md` Part B (T3, T4) |
| A signal row is inadmissible **without a verbatim quote**; the nine permitted signal types | `24_handoff_and_crm.md` Part C |
| **What must never be stored**: student data, cut content, off-record material, inferred financials, a likelihood-to-buy score | same, Part D |
| The **DPDP §9(3) child-data wall**: no minor as a Contact, aggregates only, append-only communication log | `05_CRM_DATA_MODEL.md` §13 |
| Lead lifecycle, delivery lifecycle, object names and **ID prefixes** (`SCH-` `CON-` `OPP-` `TSK-` `COM-` …) | `05_CRM_DATA_MODEL.md` §3.A, §3.C, §1 |
| The **three ICP axes** that must never be averaged; rank on first-POC suitability; tech maturity sweet spot is the middle | `mintrix-varanasi-lead-engine/research/xray/_SCORING_MODEL.md` |
| The **4-touch invitation rhythm then stop**; post-call summary in 24h; proposal follow-up in 48h; avoid Mar–Apr | `mintrix-commercial-os/11_Playbooks/Follow_up_Playbook.md` |
| A **Principal is not the default buyer**; never guess a contact; NOT FOUND is a value | `varanasi-lead-engine/research/RESEARCH_RULES_AND_SCHEMA.md` |
| The **six roles** and their mandates, and the hire order (AE #1, BA #2, RA #3) | `gtm/15_ROLES_RACI_AND_KRAS.md` §1 |
| The **object × role permission matrix**, verbatim, including "delete is rare — most delete is a status change" | `05_CRM_DATA_MODEL.md` §12 |
| The **Ticket** object: type, S1–S4 severity, P1–P4 priority, the six statuses, owner = AI Workflow Engineer | `05_CRM_DATA_MODEL.md` §9.1 |

---

## B. PROPOSED — decisions this build made. Change any of them.

### B1. The stack: Next.js 16 + TypeScript + SQLite via `node:sqlite`

**V0.1 shipped first as a Python standard-library app, because this machine had no Node.**
Homebrew had no bottle for macOS 12 on Intel and fell back to compiling Node from source.
On the founder's instruction, Node 22.23.3 LTS was installed from the official nodejs.org
build (checksum verified against `SHASUMS256.txt`, unpacked to `~/.local/node`, added to
`~/.zshrc`) and the application was ported.

**The database is SQLite, not Postgres/Supabase**, because there is no Postgres server on
this machine and Supabase needs network credentials this build does not have. It runs on
Node 22's **built-in `node:sqlite`** — no native module to compile, no `better-sqlite3`
build step, nothing in `node_modules` that can break on an OS upgrade.

`db/schema.sql` is written in the SQLite∩PostgreSQL intersection and
`scripts/make-postgres.mts` generates the Postgres DDL. All driver-specific code is in
`src/lib/db.ts`; `docs/POSTGRES.md` lists the three queries that change. The port to
Supabase is that one file plus Supabase Auth replacing `src/lib/auth.ts`.

**How the port was verified.** The rule data was *generated* from the Python structures
rather than retyped, so the 14 stage cards, 75 outcome mappings and 34 gates could not
drift. Then both engines were run against the same database and their decisions diffed:
My Day, CRM health, pipeline, path distribution, and — for all 38 accounts — next action,
activity check, firewall verdict, suggested action and timeline length, plus readiness for
all 15 stage-bearing records and SLA state for every task. **The output was identical.**
`python/` is kept as that frozen reference implementation and still runs
(`python3 python/run.py`), and its own 100 tests still pass.

**The seeder was Python at first, and is not any more.** The Varanasi importer began as
a Python script because its parsers had been debugged against the real research files.
When the founder added the two school-universe workbooks, that reason disappeared: the
first load now goes through the same TypeScript bulk importer as every future import, so
there is exactly one ingestion path and it is the one that gets exercised. `npm run seed`
is TypeScript, `src/lib/xlsx.ts` reads the workbooks with no dependency, and **nothing in
the application or its build needs Python**. `python/` remains only as the frozen V0.1
reference implementation.

### B2. Account-centric, with School beneath it

The canon makes `School` the spine (`05_CRM_DATA_MODEL.md` §4.1); the prompt requires an
account-centric model (§5). Reconciled: **Account** is the institutional relationship —
the group, trust or society, or a standalone school's own relationship envelope — and
**School** hangs off it, keeping the canonical `SCH-` record intact. The account survives
the sale, so Prospect → Customer → Expansion is one continuous record (§40, §41).

### B3a. Everything arrives as a fresh lead, and `prospect` stops demanding work

On the founder's instruction the database holds no scenarios at all: no tasks, no
podcasts, no activities, no opportunities, and no demo accounts. All 502 accounts are
`Fresh lead` / `new`.

That forced a model correction. `prospect` used to require a next action, so 500 untouched
leads would have shown as 500 stalled accounts and made the CRM health view useless. A
lead nobody has started is not stalled — **it becomes "active", and starts demanding a
next action, the moment someone picks it up.** The same reasoning scoped the
"no people recorded" check to accounts somebody is actually working: on a fresh lead,
*finding* the contact is the work, not a defect.

The five demo accounts moved to `tests/fixtures.mts`. Scenarios belong in tests, not in
the system a salesperson opens on a Monday.

### B3. Two account states the real data demanded

The Varanasi import produced 33 researched accounts of which nine are being worked. If
every other account flagged as unhealthy, the health view would be useless, and they are
not "nurture" — nobody has spoken to them. Added:

- **Researched backlog** — researched, not being worked, no next action required.
- **Protected for later** — the x-ray deliberately reclassifies the most valuable
  accounts as later-stage ("the most valuable account in the market and the wrong one to
  start with"). Sunbeam, DALIMSS, DPS and JPS sit here, held on purpose.

### B4. Outcome ordering is contextual; the outcome list is not

All outcomes for a task type stay available. On a task attached to a podcast, the
podcast-shaped outcome is listed **first**. Ordering, not filtering — the rep can still
pick anything, and determinism is untouched.

### B5. The ICP seed records only what the research established

Seven of nine dimensions were derivable from the research files with evidence. The rest
are seeded **"Not established"** with a note saying so. The ICP screen is more useful
showing what is missing than showing a guess, and the research rules forbid presenting
inference as fact.

### B6. Scenarios live in the test suite, not in the database

Five fictional accounts carry the acceptance tests and the full journey. They are built by
`tests/fixtures.mts` in a throwaway database and **are not seeded into the working one**.
No podcast recording, meeting, quote or commercial signal is ever fabricated against a
real school: that would corrupt the one dataset the company cannot rebuild.

### B7. Contact fields honour "NOT FOUND"

30 of 54 imported decision-makers have no published phone number. The importer treats
`NOT FOUND` / `NOT PUBLICLY VERIFIED` / `UNCERTAIN` as absent and the UI shows
**"No verified contact"** rather than a dead tap target. Confidence travels with every
contact field so nobody re-guesses.

### B8. Restrained SaaS interface, not the Handcrafted brand system

The Mintrix Handcrafted system (marker type, sketch aesthetic) is a marketing voice. The
prompt asks for calm, fast and operational, and explicitly not experimental (§37, §68).
This uses the brand's plum `#714b67` as the accent on a neutral, quiet surface. Mobile is
a first-class target — `tel:` and `wa.me` links, a bottom tab bar, and stacked rows —
because Shrey will use this standing outside a school.

### B9. No Trigger.dev, no queue, no background worker

Per §43. Everything is timestamp arithmetic evaluated on read. SLA state is computed, not
stored, so it is never stale.

### B10a. School identity: three keys, and near-misses are never merged

The founder asked for duplicate prevention on more than a name. Schools are identified by,
in order of authority:

1. **UDISE code** — the government's 11-digit code. 326 of the 557 universe rows carry one,
   all eleven digits, all distinct. It is the only identifier that cannot collide.
2. **Affiliation number** — CBSE/CISCE, when both sides carry a clean numeric value. The
   parser rejects `Multiple - per campus` and `UDISE 09670910911`, both of which appear in
   the affiliation column where a real number was never established.
3. **Normalised name + city** — case, punctuation and parentheticals only. Every word kept.

All three are enforced by unique indexes, so a duplicate cannot be created by a bug or by
hand, not only by the importer.

**The founder's premise needed one correction, stated plainly: every school in India is
issued a UDISE code, but only 326 of the 557 rows in this dataset actually carry one.**
That is why there are three keys rather than one.

**Aggressive name-matching was tried and rejected.** Stripping generic words to compare the
"core" of a name merged *Glorious Academy*, *Glorious Convent School* and *Glorious Public
School* into one record — three different schools. A wrong merge destroys data that a
duplicate does not. So anything that merely looks alike is imported and filed at
`/imports`, and merging is a human action.

The flagging rules also compare published phone numbers and emails, which is what caught
**UPPS** as the same institution as **Udai Pratap Public School** and **IHS Varanasi** as
**International Hindu School** — acronym-versus-full-name pairs no name rule would find.

### B10b. The Excel reader has no dependency

`src/lib/xlsx.ts` unpacks the ZIP and parses the sheet XML in about 200 lines, so
importing a workbook needs nothing installed. It was verified against openpyxl across
32,720 cells of the two real Varanasi workbooks: identical. Two bugs it caught in itself
along the way — an entirely empty row is absent from the XML (so `--header-row` numbers
shifted by one), and Excel writes `79.90000000000001` for what a human typed as `79.9`.

### B10c. One ICP number is an axis, not a score

The universe workbook publishes a single "ICP" column. Storing it as `accounts.icp_score`
would have recreated exactly the combined score the scoring model forbids — and the
acceptance suite caught it. It is the **first-POC suitability** axis, so it is stored as
that axis in `icp_assessments`, with the other two left unestablished and a note saying so.

### B10d. Roles are canon; the three hats are this build's addition

The six roles and the matrix are copied from the canon, not designed here. Two additions
are marked as such everywhere they appear:

- **Objects the canon's §12 does not list** — research record, ICP assessment, show
  record, imports, team — carry a `canonical: false` flag, are labelled "added by this
  build" in the UI, and a test asserts the list of them never grows silently.
- **Hats.** The T0–T6 stage cards assign work to a *Producer* and a *Host*, who are not
  among the six roles, and §9.1 notes that at pilot size "the AI Workflow Eng / founder
  wear the hat" for tickets. Rather than widening the matrix — which would have quietly
  given the founder ticket CRUD the canon gives the engineer — those three are grants
  held **on top of** a role and removable the day the real person is hired. The founder
  seeds with all three because at two people somebody has to.

The alternative was to give the founder a role of `eng`, which would have been a lie about
what the founder is.

### B10e. `prospect` exempt, but a team makes ownership matter more, not less

Adding people did not soften the "no next step = not active" rule. An action still needs a
named owner, and clearing an owner puts the account straight back into stalled. What
changed is that the owner can now be somebody other than the person writing it, and the
action appears in *their* day.

Only two roles see everyone's work: the founder and the BA, whose whole mandate is CRM
hygiene and follow-up logistics. Everybody else sees their own, so a bigger team does not
mean a longer list.

### B10. Server Components and Server Actions, no client-side state

Pages are React Server Components that read the database directly; every mutation is a
Server Action in `src/app/actions.ts`. There is no API layer, no client store, and almost
no client JavaScript — the app works the way the Python one did, which is what a rep on a
weak connection outside a school actually needs. It also means React escapes every value
by construction, so the class of bug where research text leaked markup into a notice
cannot recur.

---

## C. UNRESOLVED — eight questions only you can answer

These are **not** encoded as rules. Nothing in the build depends on a guess about them.

| # | Question | Why it matters | Where it would land |
|---|---|---|---|
| **U1** | **The Airtable Partnership CRM (`appbgyUO89Ow3mpRM`, 15 tables) already exists.** Does this supersede it, import from it, or run alongside it? | Two systems of record is the fastest way to lose the pipeline. I could not reach the base — the Airtable connector needs authorising in an interactive session. | An importer in `seed/`, or a decision to retire the base |
| **U2** | Who should wear the **Producer** and **Host** hats? They exist now and the founder holds both, which is a placeholder, not a decision. | The Trust Engine's stage cards assign work by hat. If Shrey is really the producer, the hat should move to him today. | `/team`, one checkbox |
| **U3** | Should the **same person hold an AE role and a show hat**? The system now allows it. | If one person runs both the show and the sale, the firewall becomes a personal discipline rather than a separation of duties, and probably needs to be tighter, not looser. | `HAT_GRANTS` in `src/lib/rules/roles.ts`, or a rule that refuses the combination |
| **U11** | **Who is the AI Workflow Engineer?** Tickets, delivery projects and activation scorecards are all theirs in the canon, and nobody holds the role. The founder wears the Support hat meanwhile. | The moment a pilot goes live, somebody owns an SLA clock. A missed first-pilot SLA poisons the reference well. | `/team`, and then take the Support hat off the founder |
| **U4** | The **pilot fee band**. `14_SALES_OPERATING_SYSTEM.md` §9A flags it as unreconciled; `_QA_NOTES.md` marks it a gap. | `opportunities.pilot_fee_quoted` is a free number today. Nothing validates it. | `src/lib/rules/` — a band with a warning, once the number is settled |
| **U5** | **When does a stalled account become closed?** Part D says stalled is not closed-lost, but nothing says when to give up. | Stalled accounts accumulate on the health view forever. | `src/lib/rules/slas.ts` — a stall-to-close window |
| **U6** | **Who may override a readiness gate?** I restricted it to the founder. The canon does not say. | It is the only way to bend the process, and every use is permanently logged. | `src/lib/engine.ts` `transition()`, one line |
| **U7** | **Multi-city**: the geography rule is traction-gated at ~3 relationships. Should the CRM enforce that, or only report it? | Enforcing it would block account creation outside Varanasi. I chose to report, not block. | `src/lib/rules/icp.ts` |
| **U9** | **The 131 flagged duplicate pairs need deciding.** About 30 look like genuine duplicates (`Bal Vidyalaya` / `Bal Vidhyalaya`, `G.D. Goenka School, Varanasi` / `GD Goenka Varanasi`); others are real campus siblings that should stay separate. | Every one is a real school record either way; the list only shrinks when a human decides. | `/imports`, Merge or Different schools |
| **U10** | **134 of 559 schools carry neither a UDISE code nor an affiliation number** (326 have UDISE, 144 have an affiliation number, 425 have at least one). Those 134 are deduped on name + city alone — safe within one city and one list, weaker across future sources. | Adding a UDISE code for those rows would make them permanently un-duplicatable. | Research, then a re-import — it fills blanks without creating rows |
| **U8** | Should the **research record be editable by the rep**, or read-only from the research pass? | Today Shrey can edit it. That risks overwriting sourced research with field impressions — but forbidding it loses what he learns at the gate. | `src/app/accounts/[id]/research/page.tsx` |

---

## C2. Open after V0.2

| # | Question | Why it is still open | Where |
|---|---|---|---|
| **U11** | **Stage skipping is now refused without a founder override.** A record can only enter the stage that follows its own. If the real process turns out to jump (a school that asks for a proposal in the first meeting), this will be felt as friction on purpose. | The alternative is that the gates of the stages jumped over are never evaluated, which is the blind movement the hardening brief forbids. Ten meetings will say whether the sequence is right. | `engine.transition()` |
| **U12** | **A blocker and a "waiting" task overlap.** A task parked as `waiting` and a `waiting_items` blocker can describe the same fact in two places. | Both are useful — one is a piece of work, one is a reason nothing moves — but a rep may well record both for one situation. Watch whether that happens. | `setTaskStatus`, `addBlocker` |
| **U13** | **40 people are still at group level** — recorded against an account whose research never said which campus they belong to. They appear on every school page of that account, labelled as such. | Guessing a campus would be inventing data. Shrey resolves them as he meets people. | `/schools/[id]`, "Group level" |
| **U14** | **`documents` in §51 means the discovery and diagnostic worksheets.** There is no file store. | Nothing in this build produces or receives a file. Adding one before there is a document to keep would be storage with no content. | — |

---

## C3. Open after V0.3

| # | Question | Why it is still open | Where |
|---|---|---|---|
| **U15** | **The thirteen acquisition stages are a first guess.** They came from the brief, not from a source document, and they are the only part of this CRM not copied from the operating canon. | Ten real meetings will say whether Contacted and Engaged are two stages or one, and whether Diagnostic belongs on the school ladder at all when the opportunity already has one. The SLAs are editable in Settings; the sequence is not, deliberately. | `src/lib/rules/acquisition.ts` |
| **U16** | **A school stage and an opportunity stage can drift apart** — a school at Pilot whose opportunity is still at Stage 7. | That is legitimate (the relationship and the commercial process are different things), but past a certain gap it probably means somebody forgot to move one. No rule enforces consistency, on purpose. | — |
| **U17** | **Stage work templates are editable but not inventable.** The founder can rename, re-team, re-time, unblock or switch off a template; they cannot add a new one from a form. | Adding templates from the UI is the first step towards a workflow builder, which §65 forbids. If a stage genuinely needs a fourth thing, it belongs in the rules file where it is reviewable. | `/settings`, `stage_work.*` |
| **U18** | **The founder can move a school but cannot edit a school record.** | This is the canon's matrix, kept intact. It will read as strange the first time the founder tries to correct a UDISE code and cannot. The honest options are: ask the AE, or change the matrix in the source document first. | `requirePipeline()` |

---

## D. Deliberately NOT built

Named here so their absence reads as a decision, not an oversight.

- **Every form of AI** — no scoring, no suggestions, no summaries, no semantic search, no
  LLM call, no vector store. Not a single model is invoked anywhere in this codebase.
- **A purchase-probability field.** Explicitly forbidden by `24_handoff_and_crm.md`
  Part D, and the tests assert no such column exists.
- **A workflow builder.** The rules are editable by the founder in one directory; they
  are not configurable by every user (§47).
- **Notifications.** V0.1 shows today, overdue, and waiting. Nothing pushes (§53).
- **Proposal, contract and payment editing screens.** The tables exist and the handoff
  reads them; there is no UI to create one yet, because nothing has reached Stage 9.
- **An upload form for imports.** Importing is a founder task done a few times a year from
  a file on disk, and a CLI with a dry-run report is a better instrument for it than a
  browser upload. `/imports` shows the batches and the decisions; it does not take files.
- **Automatic merging of anything.** See B10a.
- **Subscription, BillableUnit, Add-On, Invoice, Ticket, ActivationScorecard.** In the
  canon, empty at 1–10 schools. They would be tables with no reason to exist yet (§49).

---

# V0.4 — additions

## Source-defined, honoured here

| What | Where it came from |
|---|---|
| Trust-route accounts enter the commercial pipeline at **Discovery** | `02_PIPELINE_INTEGRATION.md` Part A — now enforced as: a deal cannot open before Discovery |
| **Won / Parked-Lost** as the opportunity's terminal states | `05_CRM_DATA_MODEL.md` §3.B — split: the *deal* is won or parked; *lost* is the school's holding state |
| A signal is inadmissible without a **verbatim quote** | `24_handoff_and_crm.md` Part C — the opportunity carries the quote it came from |

## Proposed in V0.4 — change any of these

### The opportunity's stage is a mirror, not a state

`opportunities.stage` is written only by the transition engine. The alternative was
to drop the column and derive the commercial state from the school every time. The
column was kept because it is already indexed and queried by the board's batched
pass, and dropping it would have cost a join on every card. The risk of a
denormalised copy is drift; that is handled by writing it in the same transaction
and by showing a warning if it is ever found out of step.

### A deal is won or parked, never lost

The database constraint already said `won | parked`. It would have been easy to widen
it to include `lost` and `abandoned`. That was refused: the school's ladder already
has `lost`, and two places that can both record a loss will eventually record
different ones.

### Capacity is separate from school role

A fifth separate vocabulary (after stage, school role, Mintrix relationship, team and
workstream). Justified because "who can say yes to this deal" is genuinely not
derivable from "what is their job at the school" — and the whole reason the previous
model failed was collapsing things that only looked the same.

## Unresolved — your call

1. **Should a deal be openable before Discovery for inbound?** When a school comes to
   us first, the sequence is inverted and the current rule forces a stage move before
   the deal can be recorded. The `inbound` route exists but the gate still applies.
2. **One open opportunity per school** is currently enforced. A group deal covering
   four schools is modelled as four opportunities on the `group` route, not one
   spanning them. That may be wrong for trusts.
3. **Nothing creates proposals, contracts, payments or pilots yet.** The opportunity
   page reads all four. Whether they deserve screens or should be attachments on the
   deal is open.

---

# V0.5 — additions

## Source-defined, now actually encoded

Taken from `mintrix-btc-show/06-COMMERCIAL/24_handoff_and_crm.md`, which had been
cited in this file since V0.1 but never implemented:

| What | Where |
|---|---|
| The **six post-podcast paths A–F** and their distribution 25/25/20/15/10/5 | Part A |
| The **T+0 → T+90 handoff sequence** — debrief in an hour, thank-you at T+1, guest package at T+17, path message at T+21, register line at T+35, one useful thing at T+60, review at T+90 | Part B |
| The **nine permitted signal types**, and that a signal is inadmissible without a verbatim quote | Part C |
| The **seven-point handoff quality gate** before Path E or F | Part E |
| **The first three contacts after a recording contain no ask whatsoever** | Part B |
| **Every cut request is honoured**; a refused cut is a governance incident | Part D / E |
| The **four-touch invitation rhythm, then stop** | `commercial-os/11_Playbooks/Follow_up_Playbook.md` |

## Proposed in V0.5 — change any of these

### The show gets its own transition function, not a second copy of `stage.move()`

`show.move()` is a separate function operating on a separate object. It reuses the
same work, audit and activity mechanisms, and it has no code path that can write
`schools.stage`. The alternative — generalising `stage.move()` over both — would have
made one function responsible for two vocabularies, which is how the four-pipeline
problem started.

### "Three contacts with no ask" is counted from work, not self-reported

The gate counts resolved no-ask tasks that actually exist — the thank-you, the
package, the live notification, the useful thing — rather than trusting a number
somebody typed. The manual counter on the record is still honoured if it is higher.

### Two gate checks are human confirmations and are not inferred

The Invisibility Test and the no-deck check are stored with the confirming user's id
and a timestamp. A tick that the system fabricates is worse than a box left empty,
because somebody will rely on it.

## Unresolved — your call

1. **Should Nurture and Declined be reachable from Recorded onwards?** Today a
   school can only go to nurture or declined before the recording. After an episode
   exists, the show has to run to published. That may be wrong if a guest withdraws.
2. **The Transformation Profile** (16 dimensions with an evidence quote each) is in
   the canon as its own entity and is not built. Today the debrief task stands in for
   it. If that profile is how paths get chosen, it needs a real home.
3. **Delivery is still only a status.** It is now the last workstream without an
   operation, and it has exactly the problem the show had.
