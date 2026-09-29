# V0.5 — Beyond the Classroom as an operating layer

## The question this answers

> *"I am not able to figure out the part where we are working on the podcast and
> show thing. How have you managed it in the funnel? And all its tasks — where are
> they?"*

They were nowhere. That was the defect.

Up to V0.4 the show was a **label**. `podcast_relationships.status` moved through
eight values, changing it wrote an audit row and an activity row, and it created
**zero work**. The comment in `journey.ts` claimed the old Trust Engine T0–T6 was
"now podcast STATUS plus work items" — the status half existed, the work items half
had never been built. There was no planning, no production, no execution, no show
screen, and no way to see the show at all except one line on a school page.

So the answer to "where are its tasks" was: there were none.

## Where the show sits — and why it is not in the funnel

It is **not** in the funnel, deliberately, and that has not changed. A school has
one journey. The show is a **workstream** that runs alongside it.

```
THE ONE LADDER     lead → target → research → engagement → discovery → …
                     │
THE SHOW             └── planned → invited → scheduled → recorded → delivered → published
                                                            │
                                                            └── a SIGNAL — their words
                                                                 opens Discovery
```

A school can be at **Research** with an episode already **Recorded** — the demo
fixture is exactly that, on purpose. Publishing an episode moves nothing and opens
no opportunity. Both are tested.

There is exactly one place the show touches the relationship: a **signal**, which is
something the guest actually said, quoted, with a timecode. That is what opens
Discovery, and a person still has to decide to act on it.

## What now exists

### The lifecycle, with the work each step requires

Eight statuses across four phases, each carrying its standing work, each piece owned
by a team and marked blocking or alongside:

| Phase | Status | Work created |
|---|---|---|
| **Planning** | Planned | the episode question · the guest and why them · what must never be asked |
| **Planning** | Invited | the invitation with the question in it · the four-touch rhythm, then stop |
| **Planning** | Scheduled | consent and usage in writing · the brief to the guest · a question set from their own context · location and travel · kit checked the day before |
| **Production** | Recorded | back up in two places · debrief within the hour · **log what they said, in their words** · thank-you with no ask · transcript · the edit · the school's own clips |
| **Execution** | Delivered | the package to the guest before publication · approval or cut requests · make every cut asked for |
| **Execution** | Published | publish and record the URL · tell them, with clips ready to post · decide the path and send it · the register line · one genuinely useful thing · the ninety-day review |
| **Holding** | Nurture | ask again in six months |
| **Holding** | Declined | nothing. A no is an ending. |

Blocking work holds the step shut. Non-blocking work — the transcript, the school's
clips, the four-touch rhythm — keeps running after the show has moved on, exactly as
on the main ladder.

Ownership is automatic and correct: the backup, the edit and the kit check land on
Production; the debrief, the quotes and the thank-you land on the person who owns the
relationship. That is visible in the demo, where the production work is assigned to
Harshit and the relationship work to the school's owner.

### The handoff sequence is real work, not a document

T+0 debrief within the hour · T+1 thank-you with no ask · T+17 the guest's package ·
T+18 publication and notification · T+21 the path message · T+35 the register line ·
T+60 one useful thing · T+90 the review. Each has an SLA measured from the step that
creates it.

### The six paths, with their expected distribution

A (25%) · B (25%) · C (20%) · D (15%) · E (10%) · F (5%), each with the condition
that puts a school on it. The board shows how they are actually landing against that
shape, and says so plainly when more than a fifth are reaching E or F:

> The show is drifting towards being a sales instrument. The healthy shape is a wide
> base of A and B.

### The seven-point handoff gate

Path E or F — the only two that are a commercial conversation — is **refused** unless
all seven are clear, and the refusal names what is missing:

> Path E is a commercial conversation and the handoff gate is not clear. Still open:
> … Stay on Path C or D — there is no urgency worth the asset.

Five of the seven are checked against the record. **Two cannot be**: whether the
published episode passes the Invisibility Test, and whether anybody has sent a deck.
Those were originally auto-passing, which meant the gate was ticking boxes nobody had
checked — worse than not having them. They are now a person's confirmation, stored
with their user id and the time.

### Nine signal types, and nothing else

The permitted list is enforced in the action, not just offered in a dropdown. A
signal still requires a verbatim quote; the timecode is captured where it exists.

## The screens

| | |
|---|---|
| `/show` | the whole workstream, grouped by step, with **each school's own ladder stage printed beside it** so the two are visibly different things |
| `/schools/[id]/show` | one episode: every phase with its work, the signals, the move control, the handoff gate, the path, the episode record |
| the school page | a summary card with the status, the phase, the path and a count of open show work, linking through |

The move control only offers **legal next steps** — you cannot jump from Planned to
Recorded — and refuses with what is missing rather than "invalid".

## Try it

```bash
npm run demo:show
```

Creates one account with two DEMO schools: one recorded while the school is only at
Research, one still being planned. Then open `/show`.

```bash
npm run demo:clear
```

Removes every trace of it.

## Defects found while building this

**The gate judged the record as it was, not as the move would leave it.** The form
that asks for the recording date and the move in one step is the natural way to work,
but the entry check ran against the stored row and refused a date being supplied in
the same action. `gate()` now takes the pending values.

**Work template idempotency did not work for anything without a stage.**
`where stage = ?::journey_stage` never matches when the stage is null, which is every
piece of show work. It is `is not distinct from` now. The duplicate-title check was
catching it in practice, so nothing was actually duplicated.

**`recordSignal` accepted any signal type.** The nine are canon and now enforced.
