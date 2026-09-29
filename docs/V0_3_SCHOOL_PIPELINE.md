# V0.3 — THE SCHOOL PIPELINE AND THE WORK LAYER

Two problems, one release.

**The pipeline object was wrong.** A trust with four campuses had one state between
them, so a rep could not say *"this campus is a Target, that one is untouched"*. The
school is now the pipeline object and the account is the container that adds them up.

**Work had nowhere to live.** "Call Priya" and "Production must edit the episode before
the guest sees it" were the same kind of object with the same two fields. Work now
carries a team, a workstream, an external party, a definition of done, and a flag saying
whether it can hold a stage shut.

Still no AI. Still the same architecture. Nothing was rebuilt.

---

## 1. Three state machines, deliberately not collapsed

```
SCHOOL ACQUISITION   new lead → target → research → outreach → contacted → engaged
                     → meeting/podcast → discovery → diagnostic → pilot → proposal
                     → negotiation → won      (+ nurture · disqualified · lost)

COMMERCIAL           the canonical 14 stages — unchanged
                     rules/stages.data.ts, straight from 05_CRM_DATA_MODEL §3.B

OPERATIONAL WORK     open → in progress → waiting → blocked → resolved → cancelled
```

A school can be at **Meeting / Podcast** while its opportunity is at **Stage 8** and a
production ticket is **waiting on the school**. All three are true at once, and the CRM
shows all three rather than picking one.

`src/lib/rules/acquisition.ts` holds the ladder. Each stage declares:

| | |
|---|---|
| **meaning** | one line saying what being here means |
| **entry** | deterministic checks on data, evaluated live — never a stored flag |
| **work** | the templates created on arrival, each with a team and a blocking flag |
| **exit** | what closing this stage means, in words |
| **sla_hours / next** | the clock, and the only stage that follows |

---

## 2. Blocking is the load-bearing idea

Every piece of stage work is **blocking** or **non-blocking**.

- **Blocking** must be resolved before the school leaves the stage.
- **Non-blocking** carries on afterwards, untouched, with its own owner and SLA.

This is what lets Production edit an episode for a week while Sales moves the school from
Meeting/Podcast to Discovery. Progress reads **`2 / 3`** over blocking work only; a
social clip never appears in a number that gates a pipeline.

The move reports what it carried forward, so nothing silently disappears.

---

## 3. One gate, three doors

```
drag a card  ─┐
the button   ─┼──→  /schools/[id]/advance  ──→  moveSchool()
bulk action  ─┘
```

There is no second copy of the transition logic. A drop does not write — it opens the
gate. The gate shows what is about to change, the entry checks with a link to where each
one is closed, the blocking work with a link to each open item, the non-blocking work
that will carry on, and a preview of the handoff the move will write.

- Not ready → refused, and the refusal names what is open.
- Not the next stage → refused. Skipping means the gates in between are never evaluated.
- Founder → may override, with a written reason recorded permanently and shown in CRM
  health.
- **Nurture, disqualified and lost are always reachable** and never gated — they are
  decisions about a relationship, not achievements.

A bulk move previews each school separately and tells you which ones cannot go and why.
It never half-succeeds in silence.

---

## 4. The work layer

One work object, not two competing ones. `tasks` gained `work_type` rather than a
parallel ticket system:

| | task | ticket |
|---|---|---|
| Example | "Call Priya Sharma" | "Prepare the recording setup" |
| Owner | yes | yes |
| **Team** | derived | explicit |
| **Workstream** | derived | explicit |
| **External party** | — | the named person at the school |
| **Definition of done** | — | written where it is not obvious |
| **Blocking a stage** | no | maybe |

**Team ≠ owner.** The team is the functional group responsible; the owner is the
individual accountable. Changing one does not change the other.

**Workstreams** run in parallel on one school — acquisition, Beyond the Classroom,
production, commercial, school data, pilot, implementation, contract, onboarding. The
school page groups active work by workstream, so *"what is happening here right now?"*
is one glance.

Resolution is explicit: a kind (completed / with an issue / follow-up required / no
longer required / other), a required note, and optionally the follow-up it produced. The
resolver and the timestamp are recorded. It leaves the queue and stays in history.

Dependencies are real: a ticket blocked by an unresolved prerequisite says so, and names
the prerequisite — so it never reads as its owner sitting on their hands.

---

## 5. What each screen answers now

| Screen | Question it answers |
|---|---|
| **School pipeline** `/pipeline/schools` | Where is every school, and which ones are stuck? |
| **School** `/schools/[id]` | What stage, who owns it, what is required to leave, what is everyone doing here right now? |
| **Work item** `/work/[id]` | What is this, whose move is it, what is blocking it, what does done mean? |
| **My work** `/work` | Everything I own — actions and tickets in one queue |
| **Team work** `/work?view=<team>` | What is Production actually doing? |
| **Account** `/accounts/[id]` | Four schools, four stages, four sets of work, added up |
| **CRM health** | Schools with no next action, no owner, sitting still; overrides |

---

## 6. Performance

The first cut of the board ran one set of queries per card: **32 seconds** for 559
schools. It now fetches everything in a fixed number of passes and joins in memory:
**92 ms**. A test asserts 600 schools render in under three seconds, so this cannot
regress quietly.

---

## 7. Decisions worth knowing

- **The founder can move a school but cannot edit a school record.** The canonical matrix
  (`05_CRM_DATA_MODEL` §12) gives the founder READ on `school`. Moving a school along its
  pipeline, reassigning it and overriding a gate are management actions the brief gives
  the founder, and `mayOverride` already encoded that. Widening the matrix row would have
  made the rulebook a lie, so `requirePipeline()` separates the two instead.
- **`schools.state_key` keeps its column name** and holds the acquisition stage. The old
  eleven-value vocabulary was mapped onto the new ladder by the migration; the mapping is
  in `LEGACY_STATE_MAP` where it can be read, not buried in a script.
- **The school edit form can no longer set the stage.** A form that could change it
  silently would make the gate decorative.
- **Six statuses, not seven.** The two briefs disagreed — one said PENDING, the other
  said OPEN plus ASSIGNED. `open` covers both; ownership is a separate field that is
  always required, and an unowned item is a health finding rather than a status. Adding
  `assigned` would have been a second word for something the system already records.
- **No new Workstream table.** A workstream is a label on work plus the business context
  that already exists on `opportunity_id` / `podcast_id` / `delivery_id`.
