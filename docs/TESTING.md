# TESTING — what the 140 tests actually prove

```bash
npm test                # all three suites
npm run test:engine     # 25  the transition engine in isolation
npm run test:acceptance # 82  the model, end to end
npm run test:security   # 33  every refusal the system depends on
```

All three run **against the live Supabase database**. They are not mocked and there
is no test double of the schema, because the thing most likely to be wrong is the
agreement between the code and the database — a mock would agree with the code by
construction and prove nothing.

Each suite builds its own fixtures and removes them in a `finally` block. The
production dataset (502 accounts / 559 schools / 155 people) is counted before and
after; a failing run cleans up too.

---

## Why some cleanup needs the service role

There is deliberately no `DELETE` policy on `work_items`, `activities` or
`audit_events` — for anybody, including the founder. Work is cancelled with a
reason; history is added to. So the suites remove their own fixtures through
`db.asService()`, which states a reason and is the only path that can.

That is the same reason the two work items and two activities from the V0.3
walkthrough of `SCH-0001` are still in the database. They record a stage move and
the undo of it, both real, both mine. Deleting them is exactly the operation the
system exists to refuse.

---

## The external collaborator

`tests/security.mts` needs a real non-staff user to prove scope, and `profiles`,
`user_roles` and `access_grants` all reference `auth.users`. The application's own
database role cannot write `auth.users` — correctly — so the seat is created once,
by the `security_test_collaborator_seat` migration, rather than manufactured at run
time.

It cannot be signed in to: `banned_until` is `infinity` and the stored password hash
is not a hash of anything. It holds no grants. The suite grants it exactly one
school for the length of a run and takes the grant back afterwards.

---

## What each suite covers

### `test:engine` — the transition engine (25)

Entry checks, blocking versus non-blocking work, legal moves, founder override,
SLA open/close, handoff payload, the audit and activity rows a move writes, undo as
a new linked event, and the refusal to undo the same move twice.

### `test:acceptance` — the model (82)

| Section | What it holds to |
|---|---|
| One journey, not four pipelines | One stage vocabulary; the old 14 are decomposed; T0–T6 is a status; delivery has its own lifecycle; **accounts have no stage column at all** |
| Four schools under one account | Each moves independently; the account aggregates rather than owning a stage |
| Gates, blocking work, refusals | The refusal *names what is missing*, not "invalid transition"; stages cannot be skipped; a non-founder cannot override |
| The show is a workstream | A school can be at Research while its episode is Published; **publishing does not create an opportunity**; Discovery is gated on a recorded signal, not on the show finishing |
| Parallel work | Production work is owned by production; the relationship moves while production work is still open |
| Activity, work and audit | Three different things, in three different tables, with different columns |
| Undo and correction | The stage goes back; the reversal is its own event; the original is marked, never erased |
| People | Two people with the same name are two records; the identity line distinguishes them; duplicates are **flagged, never merged**; school role and Mintrix relationship share no vocabulary |
| The show is an operation | Every step carries the work it needs; the six paths add to 100; only the nine signal types exist; **inviting, recording and publishing all leave the school exactly where it was**; publishing opens no opportunity; the T+21/T+35/T+60/T+90 sequence becomes real work; production work is production's and the debrief is not; Path E is refused while the handoff gate is open; **the gate does not tick the two boxes the system cannot check** |
| The deal is paperwork | Opening does not move the school; a deal cannot open before Discovery; moving the school moves the deal and undoing brings it back; a deal is won or parked — never "lost", because whether the *school* is lost is the school's own state |
| The board holds up | All 559 schools render in one batched pass in about 1.2 seconds; **one school's four states load in two queries**, which is pinned at under 600ms so the fourteen-round-trip version cannot come back |

### `test:security` — the refusals (33)

Each of these tries to do the thing and fails if it works.

| Section | What it tries |
|---|---|
| The database, not the front end | RLS on every table with no exceptions; the app's login role is not a superuser and cannot bypass RLS; `anon` holds no privileges on any business table; every `SECURITY DEFINER` function pins its `search_path`; the permission helpers are not published as REST endpoints |
| A user cannot give themselves authority | Insert a founder role for themselves; update their own role; delete their role row; grant themselves a scope; edit somebody else's profile. **Not even the founder** can rewrite authority in an ordinary session |
| Scope holds when the URL is edited by hand | An external collaborator sees 1 school, not 559; asking for another school's id **returns nothing, not a denial page**; seeing is not editing; cannot create, cannot delete, cannot read the audit trail, cannot enumerate staff |
| History can be added to, never rewritten | Write an audit row in somebody else's name; edit an audit row; delete one; delete activities; delete work |
| Secrets do not reach the browser | Only the project URL and publishable key are `NEXT_PUBLIC_`; the built browser bundle contains no service-role key, no database password and no connection string |

---

## What is not covered

Stated plainly, because a test suite that implies more coverage than it has is worse
than a small one.

- **No browser-driven tests.** The screens were walked by hand against live data
  (sign-in, the school page, a gate, a move, an undo, the opportunity, the account
  page, My Account). Nothing automated clicks them, so a broken form would not fail
  `npm test`.
- **No concurrency tests.** Two people moving the same school at the same moment is
  not exercised. `move()` runs in a transaction, so the second should see the first's
  result, but that is reasoning, not evidence.
- **No load testing** beyond the 559-school board pass.
- **Email change and password change** are tested by hand against GoTrue, not in the
  suite, because both need a live mailbox to complete.
