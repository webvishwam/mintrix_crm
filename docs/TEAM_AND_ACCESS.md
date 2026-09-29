# The team, and who may touch what

Add people at **/team** (founder only). Each person gets one **role**, which decides what
they may do, plus any **hats** they also wear.

---

## The six roles

They are not invented here. They come from `15_ROLES_RACI_AND_KRAS.md` §1, and what each
may touch comes from `05_CRM_DATA_MODEL.md` §12.

| Role | Mandate | Hire order |
|---|---|---|
| **Founder** | Trust, vision, education insight, the upward referral. Appears in high-trust moments, then exits to the AE. | already here |
| **Founding AE** | Owns the number end to end: pipeline → discovery → objections → commercials → close → PO → cash → SLA. | **hire #1** |
| **Business Administrator** | Scheduling, CRM hygiene, follow-up logistics, asset delivery, PO paperwork, payment reminders. | **hire #2** |
| **Research Associate** | School and trust dossiers, public-data research, list-building, the door-opener's factual spine. | **hire #3** |
| **Designer** | Turns research and product into assets a decision-maker will read. | fractional |
| **AI Workflow Engineer** | Builds and runs delivery and the pilot's product workflows. Owns tickets. | shared / product-funded |
| *Customer Success Manager* | Post-sale health, adoption, renewal. | ~20–30 schools |

The canon's own note on why this matters at two people:

> "The founder + AE effectively **are** most of these roles. The permission matrix still
> matters because it tells you **which hat you are wearing**, and it is the blueprint for
> the moment a role splits off."

## Three hats

A hat is work a role does not imply, granted on top of it. The Trust Engine's stage cards
assign work to a Producer and a Host by name, and canon §9.1 says the engineer — "or the
founder wearing the hat" — runs tickets.

| Hat | What it grants |
|---|---|
| **Producer** | T0 Target, T1 Research, T2 Invite, T4 Deliver on Beyond the Classroom |
| **Host** | T3 Record, T5 Debrief, T6 Permission — runs the conversation |
| **Support** | Tickets and delivery projects |

Raman starts with all three, because at two people somebody has to. Take them off the day
you hire the person who should hold them — that is the whole point of making them
removable rather than baking them into the matrix.

## What each role may touch

`C` create · `R` read · `U` update · `D` delete. The live matrix is in the app at
**/team** and **/rules**; `src/lib/rules/roles.ts` is the source.

A few consequences worth knowing:

- **The AE owns opportunities outright** (`CRUD`). The founder only reads them — which is
  the RACI's whole point: the founder is never in the room when price is discussed.
- **The designer never gets contact PII.** Read-only on contacts, no update.
- **The RA cannot touch contracts or invoices at all.**
- **Tickets belong to the engineer.** The AE, BA and founder read them; the Support hat is
  what lets anybody else work them.
- **Only the founder manages the team.** Enforced in one place and asserted by a test.
- **Deleting is rare by design.** Most "delete" is a status change, so the audit trail
  survives.

Every page and every server action asks the permission module. Hiding a button is not a
permission — the AE's browser will not render a Team link, and typing `/team` redirects
with a reason.

---

## Adding someone

1. **/team → Add someone.** Name, email, role, any hats, and a starting password.
2. Give them the password however you like. **They are forced to replace it the first time
   they sign in** — until they do, every other page redirects to their profile. You stop
   knowing their password, which is the point.
3. Their work shows up in *their* My Day, not yours.

**Disabling** someone keeps all their history — tasks, tickets, logged activity, stage
transitions stay exactly where they are — but ends every session and blocks sign-in.
Two guards you cannot talk your way past: you cannot disable your own account, and the
last active founder cannot be demoted or disabled.

**Resetting a password** ends every session that person holds and forces another change.
Use it when somebody is locked out, not as a routine.

## Who sees whose work

The founder and the BA see everyone's open work. Everybody else sees their own. That is
one flag per role (`seesAllWork`), and it drives My Day, the nav badges, and the pipeline
and health views.

Assign work to anybody on the team from **+ Action** on an account, or hand over an
existing one from its outcome page. An action with no named owner counts as **stalled** —
that rule does not soften because a team exists.

---

## Tickets

`05_CRM_DATA_MODEL.md` §9.1. A ticket is raised by **adult school staff** about a school.
A student can never appear on one, because the child-data wall means a person row can
never be a minor.

| Severity | Answer within | Means |
|---|---|---|
| **S1** | 4 hours | Cannot use it at all, or data is at risk. Somebody stops what they are doing. |
| **S2** | 24 hours | A core workflow is broken with no reasonable way around it. |
| **S3** | 72 hours | Something is wrong or unclear; they can carry on meanwhile. |
| **S4** | 1 week | Cosmetic, or a request with no deadline. |

Status runs `New → In progress → Waiting on school → Escalated → Resolved → Closed`.

- **The clock stops while a ticket is waiting on the school.** Counting their delay
  against us would make the number meaningless.
- **Changing severity re-bases the clock** — unless we are the ones waiting.
- **A ticket cannot be resolved or closed without a written resolution.** One closed with
  no answer teaches nobody anything.
- **A closed ticket is never edited.** If it comes back, raise a new one referencing it.
- Every change is appended to the ticket's history, which cannot be rewritten.

Severity, priority, status and the SLA table all live in `src/lib/rules/tickets.ts`.
