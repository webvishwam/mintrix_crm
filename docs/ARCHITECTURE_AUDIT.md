# ARCHITECTURE AUDIT — before the V0.4 refactor

Written before any code changed, as the brief requires.

---

## A. What exists today

**Stack, stated plainly:** Next.js 16 · React 19 · TypeScript · **`node:sqlite`**.
There is **no Supabase and no Postgres** in this build. Authentication is the
application's own `sessions` table; authorisation is enforced server-side in every page
and every action through `src/lib/permissions.ts`. Where the brief refers to Supabase
Auth, RLS and service-role keys, the equivalent controls here are: the session table,
the permission functions called at the top of every route and action, and the fact that
nothing reaches the browser except rendered HTML — there is no client-side data client
to secure. `docs/POSTGRES.md` holds the Postgres port if that changes.

**32 tables.** The ones that matter to this audit:

```
accounts · schools · people · person_roles
podcast_relationships · podcast_signals
opportunities · discoveries · diagnostics · pilots · proposals · contracts · payments
delivery_projects
tasks · activities · waiting_items · stage_transitions · stage_handoffs · stage_slas
users · sessions · app_settings · tickets
```

---

## B. The conflict — SEVEN state vocabularies for one journey

This is the finding. One school's journey is currently described by seven different
sets of values, in four different tables, all at the same time:

| # | Where | Vocabulary | Values |
|---|---|---|---|
| 1 | `accounts.state_key` | ACCOUNT_STATES | prospect · researching · relationship · opportunity · customer · backlog · protected · waiting · nurture · paused · closed |
| 2 | `accounts.lead_state` | LEAD_STATES | new · researching · qualified · disqualified · parked · converted |
| 3 | `accounts.commercial_signal` | COMMERCIAL_SIGNAL_STATES | none · … · permission |
| 4 | `schools.lifecycle_stage` | free text | "Prospect" |
| 5 | `schools.state_key` | ACQUISITION_STAGES (V0.3) | 13 + 3 |
| 6 | `podcast_relationships.stage_key` | PODCAST_STAGES | t0 … t6 · nurture |
| 7 | `opportunities.stage_key` | OPPORTUNITY_STAGES | s1 … s14 |
| 8 | `delivery_projects.stage_key` | DELIVERY_STAGES | d1 … d6 · on_hold |

**The same real-world fact appears up to four times.** A school being researched is
`accounts.state_key = researching` **and** `accounts.lead_state = researching` **and**
`schools.state_key = research` **and** `opportunities.stage_key = s3_dossier` **and**
`podcast_relationships.stage_key = t1_research`. Nothing keeps them consistent, and the
pipeline screen showed three of them side by side as if they were three funnels.

**V0.3 made this worse, not better.** Adding a school acquisition ladder was the right
object (the school) with the wrong consequence: a fourth pipeline rather than the
replacement of the other three.

---

## C. Decomposing the canonical 14

Not every step is a stage. Classified individually, as the brief requires:

| Canonical stage | What it actually is | Becomes |
|---|---|---|
| s1 Market Selection / ICP Gate | **Gate** — eligibility | Entry check on Target |
| s2 School Selection | **Decision** | The Target stage itself |
| s3 30-Minute Dossier | **Work** | Research work item |
| s4 Asset Creation | **Work** | Work item (largely superseded by the show) |
| s5 Physical Delivery | **Activity** | Activity + work item |
| s6 Follow-Up Cadence | **Work pattern** | Work items |
| s7 Discovery | **Relationship stage** | **Discovery** |
| s8 Problem → Mintrix Mapping | **Relationship/commercial stage** | **Mapping** |
| s9 Proposal | **Commercial stage** | **Proposal** |
| s10 Close | **Commercial stage** | **Negotiation** |
| s11 Purchase Order | **Commercial state** | **Contract** |
| s12 Payment | **Commercial state** | **Payment** |
| s13 SLA / Onboarding Handoff | **Milestone** | The boundary into Delivery |
| s14 Expansion | **Post-customer state** | **Expansion** |

**Six of the fourteen were never relationship stages.** They were gates, work and
activities that had been promoted to stages because the document called them stages.

### T0–T6

| T-stage | What it actually is | Becomes |
|---|---|---|
| T0 Target | duplicates the school's Target | *removed* |
| T1 Research | duplicates the school's Research | podcast work item |
| T2 Invite | **Work** | podcast work item |
| T3 Record | **Milestone** | podcast status `recorded` |
| T4 Deliver | **Work** (production) | production work item |
| T5 Debrief | **Work** | podcast work item |
| T6 Permission | **Signal / gate** | the commercial signal that may open an opportunity |

**Beyond the Classroom is a workstream, not a pipeline.** Its seven operational steps
are work and one milestone. Their SLAs — 3 days to brief, 1 hour to debrief, 2 working
days to honour a cut — are preserved as *work* SLAs, which is what they always were.

### Delivery d1–d6

Genuinely its own operational lifecycle, beginning after the handoff. **Kept**, as a
delivery state on `delivery_projects` — but it is not a sales stage and never appears on
the school pipeline.

---

## D. The canonical model

```
ACCOUNT ─────────── the institution. NO stage of its own. Aggregates its schools.
   │
   └── SCHOOL ───── ONE relationship state. The pipeline object.
         ├── PEOPLE            name + school role + Mintrix relationship
         ├── WORK              one object; team · workstream · blocking
         ├── ACTIVITIES        what happened
         ├── PODCAST           a workstream with a status, not a funnel
         ├── OPPORTUNITIES     the commercial unit, its own commercial state
         └── DELIVERY          post-sale operational state
```

### The one school journey

```
LEAD → TARGET → RESEARCH → ENGAGEMENT → DISCOVERY → MAPPING
     → PROPOSAL → NEGOTIATION → CONTRACT → PAYMENT → CUSTOMER → EXPANSION
                                          (+ NURTURE · DISQUALIFIED · LOST)
```

Twelve, down from V0.3's thirteen and from the four parallel ladders. **Outreach,
Contacted, Engaged and Meeting/Podcast collapse into ENGAGEMENT** — they were four
names for "we are building the relationship", and the work underneath them is what
actually differs. **Pilot and Diagnostic leave the school ladder**: a pilot is a
commercial motion inside an opportunity, and the diagnostic is the Mapping stage.

### Three states, three questions

| State | Lives on | Answers |
|---|---|---|
| **Relationship** | `schools.state_key` | Where are we with this school? |
| **Commercial** | `opportunities.stage_key` | Where is this specific deal? |
| **Delivery** | `delivery_projects.stage_key` | Where is implementation? |

Plus **work status** (`tasks.status`) — what is being done right now — and **podcast
status** (`podcast_relationships.stage_key`) — where the show is with them.

These coexist. ABC School may be at **Discovery**, its podcast **recorded**, production
**editing**, its opportunity at **Proposal**, delivery **not started**. That is five
true facts, not five contradictory pipelines.

---

## E. Removed and merged

| Removed | Why | Replaced by |
|---|---|---|
| `accounts.state_key` | An account has no relationship stage; its schools do | Derived from the schools |
| `accounts.lead_state` | Duplicates the first six stages of the school journey | `schools.state_key` |
| `schools.lifecycle_stage` | Free text, never read, always "Prospect" | `schools.state_key` |
| Opportunity stages s1–s6 | Gates, work and activities, not commercial stages | Entry checks and work items |
| Podcast stages T0–T6 | Operational steps of a workstream | Podcast status + work items |
| V0.3 stages outreach/contacted/meeting_podcast | Four names for one thing | `engagement` |
| V0.3 stage `pilot` | A commercial motion, not a relationship stage | Opportunity |
| V0.3 stage `diagnostic` | Same thing as Mapping | `mapping` |
| `/board` (the V0.2 deal board) | A second pipeline screen | One pipeline screen with views |

`accounts.commercial_signal` is **kept** — it is not a stage, it is the record of whether
a human has observed a commercial signal, which is exactly the firewall the show needs.

---

## F. What is NOT changing

Working parts stay working. No rewrite of: people and `person_roles`, duplicate
detection and merge, the importer and its three identity keys, work items and the
workstream model, stage clocks, deterministic handoffs, blockers, search, settings, the
DPDP child-data wall, the podcast-to-commercial firewall, or the object × role matrix.

---

## G. Migration

Nothing is deleted. `schools.state_key` is translated V0.3 → canonical; account state is
derived and the column left in place but unread; opportunity stages s1–s6 are mapped
forward to `discovery` with the work they implied created as work items; podcast T-stages
map onto the new status. Every mapping is a table in code, not a line buried in a script.

---

## H. Security model, as it actually is

```
session cookie → users row → role (canon matrix) → team (work routing) → scope
```

`can()` / `require_()` are called server-side in every page and every action. There is no
client data access to secure. The gap the brief names is **scope**: today an authenticated
user can read any account by URL. That is the next security change, and external
collaborators depend on it.

---

## I. Identity

`users.email` is currently both the login and the displayed identity, editable only by
the founder through team administration. There is no self-service. The founder account
carries the wrong address. The fix is a proper split — authentication identity, profile,
authorisation — with a self-service My Account that can change the first two and never
the third.

---

## J. Test plan

Every existing test must keep passing (365). New tests must prove: one school state, the
decomposition (a gate is not a stage), the podcast not creating an opportunity, parallel
states coexisting, the email change preserving the stable user id, audit events, and undo.
