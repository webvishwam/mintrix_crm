# V0.2 — HARDENING

V0.1 could run a sales process. It could not always tell you *which* thing you were
looking at. V0.2 does not rebuild it; it closes that gap and the gaps that turned out to
sit next to it.

The whole of V0.2 answers ten questions the rep must never have to ask a colleague:

```
WHO → WHERE → WHAT → WHY → WHAT HAPPENED → WHAT IS PENDING
    → WHO OWNS IT → WHEN IS IT DUE → WHAT MUST BE COMPLETED → WHAT HAPPENS NEXT
```

Nothing here uses AI. Every line of a handoff, every clock, every gate is copied or
computed from a row that already exists.

---

## 1. The entity problem

> FGM Education Group / FGM International School / Janta Public School — and two people
> called Priya Sharma, one a Principal, one a Coordinator.

A name identifies nothing. V0.2 makes the identity of a person
**name + role + school + account**, and it is rendered that way everywhere:

```
Priya Sharma — Principal — ABC International School (ABC Education Group)
```

`identityLine()` in `src/lib/people.ts` produces it; search results, duplicate warnings,
opportunity stakeholder lists and the handoff all use it. Where a person has no school on
file, the line says so out loud — `ABC Education Group (no school recorded)` — rather than
leaving a blank a reader would fill in with a guess.

### person_roles — the association is the record

The role is not a column on the person. It is a row joining a person to a school:

```sql
person_roles(person_id, school_id, school_role, custom_role,
             relationship_types, started_on, ended_on,
             discovered_how, introduced_by_person_id)
UNIQUE INDEX uq_person_school_active ON (person_id, school_id) WHERE ended_on IS NULL
```

This is what makes a Director of three campuses **one person with three associations**
instead of three people, and it is what makes leaving a school a dated fact rather than a
deletion.

### School role is not relationship type (§12)

| | What it answers | Vocabulary |
|---|---|---|
| **School role** | What are they *at their school*? | Principal, Academic Coordinator, Finance… (19, grouped, plus free text) |
| **Relationship type** | How do they relate to *Mintrix*? | Decision Maker, Primary POC, Academic POC, Champion, Blocker… (13, several at once) |

`src/lib/rules/entities.ts` holds both lists and a self-check that fails the build if a
key ever appears in both. A person is one role and any number of relationship types.
`primary_poc` and `implementation_owner` are marked `exclusivePerSchool`, so setting a new
one removes the old — a school has exactly one front door.

---

## 2. Duplicates: flagged, shown, never merged

Creating a person whose name, phone or email resembles an existing record does not fail
and does not silently merge. It routes to `/people/resolve`, which shows every lookalike
**with its full identity line** and two honest choices:

- **Same person** → the existing record gains this school as a new association, and any
  blank contact fields are filled from what you just typed. Nothing is duplicated.
- **These are different people** → both records are kept, and the role and school on each
  are what distinguish them from that moment on.

`/people/merge` (founder only) is the deliberate merge: a field-by-field comparison,
counts of the activities and actions that will move, a required written reason, and a
warning that a Principal at one school and a Coordinator at another are two people. The
merge moves history — activities, tasks, associations, opportunity roles — and writes
itself into the surviving record's timeline. It never deletes an activity.

---

## 3. Stage work: the clock and the handoff

### The clock (§30, §31)

V0.1 had SLAs on tasks but not on stages, so *"the diagnostic must begin within 24 hours"*
had nowhere to live. `stage_slas` gives every stage entry a row with `entered_at`,
`due_at` and `closed_at`. A move closes the old clock and opens exactly one new one —
`moveClock()` closes **all** open clocks first, so two live stage SLAs cannot exist. The
state is one of four honest values: on track, at risk, overdue, no clock.

### The handoff (§27, §28)

Before anything moves, `buildHandoff()` assembles a structured record of the stage being
left:

```
previous stage · entered · exited · days in stage · previous owner · SLA met or missed
the problem in the school's words · verbatim quotes · who was involved
tasks completed (with outcome, date, owner) · tasks cancelled (with the reason)
key activities · what is still outstanding
new stage · new owner · new SLA · the actions now required
```

Every field is a row: the discovery worksheet, `activities`, `tasks`, `person_roles`,
`podcast_signals`, `waiting_items`, the stage card. Nothing is generated, summarised or
inferred. It is stored as JSON on `stage_handoffs` against the transition, shown on the
opportunity as **"What happened before this"**, shown per move in the stage history, and
previewed on the gate page *before* you commit — you can read exactly what the next person
will read.

### The gate (§23, §24, §25, §57)

`/stage/[kind]/[id]/advance` shows, in this order: what is about to change (current stage,
new stage, this clock, the new SLA, the owner after the move, the actions that will be
created), then every requirement with **Fix this** linking straight to where that
particular check is closed, then the exit criteria, then the handoff preview.

- Not ready → the move is refused, and the refusal names what is open.
- Founder → may override, with a required written reason. The override is written to
  `stage_transitions`, shown on the stage history, and listed in CRM health.
- **Stages cannot be skipped.** A target that is not the current stage's `next` is refused
  unless the founder overrides, because the gates of the stages jumped over would never be
  evaluated. This is enforced in `engine.transition()`, not only in the UI.

After a successful move the confirmation states the new stage, the owner, the new SLA, the
next action and how many actions were created — not "Stage moved."

---

## 4. Tasks, blockers and the difference between them

| | What it is | Where it lives |
|---|---|---|
| **Task** | Something a named person must do | `tasks` |
| **Activity** | Something that already happened | `activities` (append-only) |
| **Blocker** | The reason neither is moving | `waiting_items` |
| **Stage** | Where the record is in the process | `stage_key` + `stage_slas` |

Task statuses are `open · in_progress · waiting · blocked · resolved · cancelled`.

- Only **resolved** counts as completed.
- **Cancelled is not resolved.** A call that was made and a meeting the school refused are
  different facts and the history keeps them apart.
- Parking an action as waiting or blocked **requires** a reason and a follow-up date — a
  parked action with no reason is a forgotten one. It leaves the working queue, stays
  active, and returns to attention on its follow-up date.
- A task with an unresolved `depends_on_task_id` cannot be completed.
- `createTask` is idempotent per subject and title, so revisiting a stage never stacks up
  duplicate actions.

A blocker records what is blocked, what kind, who it sits with, since when, what would
resolve it and when to chase. It appears on the account, the school and the opportunity.

---

## 5. What each screen now answers

| Screen | Added in V0.2 |
|---|---|
| **School** `/schools/[id]` | The page did not exist. Breadcrumb, school-specific state, stage/owner/SLA/next together, blockers, people grouped into Primary POC / Decision makers / Operational / Other / Group level, per-opportunity clocks, open actions, completed history, timeline |
| **Person** `/people/[id]` | Identity chain, associations with add/change/end, relationship types with their meanings, data quality, opportunities they are on, podcast role, "What now?" actions, contact panel |
| **Opportunity** | Restructured to §51: header → what happens now → SLA → blockers → stage checklist → previous context → timeline → documents → stage history → people. Plain-language name and description, primary contact, stakeholders by capacity |
| **Account** | Per-school rows with their own state and POC, people carrying role + school, blockers, account context panel, timeline filters, completed-action history |
| **Board** `/board` | New. Cards carrying school, account, opportunity, owner, stage, POC, next action, due, SLA, blockers; quick actions; filters; drag-and-drop that routes through the gate |
| **Search** `/search` | New. People, schools, accounts, opportunities and tickets by name, phone, email, UDISE or affiliation number — every result with its context, and shared names flagged as ambiguous |
| **Settings** `/settings` | New, founder only. Stage SLAs, stage on/off, task-type SLAs, stale threshold, school roles; everything shows its built-in default and blank restores it |
| **Duplicate resolution** `/people/resolve` | New. Same person / different people, with the evidence for each |
| **Merge** `/people/merge` | New, founder only. Field-by-field, reasoned, history-preserving |

---

## 6. Drag and drop, honestly

A drop never writes. Dragging a card marks each column: **Ready**, **N requirements
missing**, **Not the next stage**, or **Already here**. Dropping on the next stage
navigates to the gate, where the requirements, the SLA and the handoff preview are shown
and the move is confirmed. Dropping anywhere else does nothing. This is the only client-
side JavaScript component in the application.

---

## 7. What was deliberately not done

- **No AI.** Unchanged and non-negotiable.
- **No workflow builder.** Settings change durations, names and on/off. The stage
  sequence comes from the operating documents and is not editable from a form.
- **The permission matrix was not widened.** Roles and the object × role matrix are
  copied verbatim from `05_CRM_DATA_MODEL.md` §12.
- **No automatic merging of anything**, for people or schools.
- **No notifications.** Still nothing pushes.
- **Documents** in §51 means the discovery and diagnostic worksheets. There is no file
  store, because nothing in this build produces a file.
