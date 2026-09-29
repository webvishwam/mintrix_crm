# V0.4 — the commercial layer, and closing the last parallel pipeline

V0.3 collapsed the Trust Engine, the Partnership Engine and the Delivery Engine into
one school journey. It left one thing undone, and this is it.

---

## The problem that was still there

`opportunities.stage` was a `journey_stage` column that **nothing kept in sync** with
`schools.stage`. The school page read one; a query against the opportunity read the
other. There were no opportunities in the database yet, so it had not yet produced a
wrong answer — but it was a second ladder waiting to happen, which is precisely what
the correction ruled out.

`/opportunities/[id]` was linked from two places and **did not exist**. Clicking the
commercial state on a school page was a 404.

## What changed

### 1. The deal has no ladder of its own

`opportunities.stage` is now written by exactly one function — `commercial.mirrorStage()`
— which is called by exactly one caller: the transition engine, in both `move()` and
`revert()`, inside the same transaction as the school's own stage write.

```
school moves  →  mirror follows      (same transaction)
undo          →  mirror follows back (same transaction)
```

If the two ever disagree — an old row, a restore from backup — the opportunity page
says so in plain words and names the school as the authority, rather than quietly
showing a number that is not true.

### 2. A deal cannot exist before Discovery

The database already said so: a check constraint limits `opportunities.stage` to
Discovery and later. That constraint was being enforced as a raw Postgres error. It
is now a rule the domain states first:

> There is nothing to quote for yet. W.H. Smith Memorial School is at Lead; a deal
> opens from Discovery onwards. Move the school when the stage is earned.

and the page that opens a deal refuses to show the form at all when the school is
too early, with a link to the place where the school actually moves.

This matters because Discovery is the first stage where a school has told us a
problem **in its own words**. Before that there is a relationship, not a deal.

### 3. A deal is won or parked — never "lost"

The terminal states are `won` and `parked`. There is deliberately no "lost".

Whether a **school** is lost is the school's own holding state on the one ladder.
Recording it in two places is how two places come to disagree, so closing a deal
says, out loud:

> Opportunity parked. The school stays where it is on the ladder — move it to
> nurture or lost yourself if that is what you mean.

### 4. Opening a deal is a decision somebody makes

Nothing opens one as a side effect. Not recording an episode, not publishing it, not
a stage move. `/schools/[id]/opportunity/new` asks for a reason in their words, a
route to market, and optionally the signal from the show that it came out of — and
puts the opener's name on it.

### 5. Stakeholders are about the decision, not the school

`opportunity_stakeholders.capacity` is a separate vocabulary from a person's school
role — *decides · approves the money · recommends · will use it · can block it* — for
the same reason school role and Mintrix relationship are separate: a principal is not
automatically the buyer, and the accounts head who can stop a purchase is not a
"stakeholder" in any useful sense until somebody says what they can actually do.

The page says so when it matters:

> Nobody here has been named as able to say yes. A deal with no named decider is a
> conversation.

> 1 person can stop this on their own — Rakesh Tiwari: has stopped two purchases this
> year over recurring fees.

---

## Two defects found and fixed on the way

**`Promise.all` over one pooled connection.** `commercial.byId()` originally fired
ten reads at once. One request holds one connection, so node-postgres queued them
anyway and emitted a deprecation warning — the pattern breaks outright in `pg@9`. The
reads are sequential now, which is what was actually happening.

**Dates shown as timestamps.** `expected_decision_date`, `signed_on`, `banked_on` and
`invoiced_on` are `date` columns and were being rendered through the timestamp
formatter, so a decision date read "17 Oct, 00:00".

---

## Files

| | |
|---|---|
| `src/domain/commercial.ts` | routes, capacities, open/close, stakeholders, `mirrorStage` |
| `src/domain/stage.ts` | calls `mirrorStage` in `move()` and `revert()` |
| `src/app/opportunities/[id]/page.tsx` | the deal: stage (read from the school), money, who decides, paperwork, history |
| `src/app/schools/[id]/opportunity/new/page.tsx` | opening one, deliberately |
| `src/app/actions.ts` | `openOpportunity`, `addStakeholder`, `closeOpportunity` |
| `tests/acceptance.mts` | 15 tests covering all of the above |

---

# Also fixed in V0.4 — found by looking, not by being told

## An hour-old session handed the user a 500

`refresh()` exchanged the refresh token and then wrote the new cookie. A Next.js
**Server Component render is not permitted to set cookies** — only a Server Action, a
Route Handler or middleware may — so the write threw, and the throw escaped as a 500.

The access-token cookie is set to expire with the token itself, so this fired for
every user, one hour after signing in, on whatever page they happened to open. It was
found by hitting it: the dev server was restarted, the session had aged past an hour,
and `/admin` returned *"THAT DID NOT WORK"*.

Fixed in two places, because one was not enough:

- `src/middleware.ts` (new) refreshes on navigation, where a cookie **can** be
  written. The trigger is precise: the access cookie absent while the refresh cookie
  is present means the token has expired.
- `refresh()` now treats the cookie write as best effort. If the jar is read-only it
  swallows the refusal and returns the fresh token anyway, so the current request
  succeeds and middleware persists the cookie on the next navigation.

## The school page took sixteen seconds

`liveStatus()` — the function behind the most-opened screen in the application — made
**fourteen sequential round trips**. Every one crosses to Mumbai at about 80ms. It is
two queries now (one gathering everything single-valued through lateral joins, one for
the opportunities, which can be several), and one of the fourteen turned out to be
dead: a count that was computed and then overwritten before it was used.

| | before | after |
|---|---|---|
| `liveStatus()` | 1,986 ms | 160 ms |
| `/schools/SCH-0001` end to end | 16.0 s | 2.9 s |
| `/accounts/ACC-0001` | 4.3 s | 1.7 s |

The remaining seconds are round-trip latency from a laptop in India to a database in
Mumbai, a few dozen milliseconds at a time. Deployed next to the database it will be
a fraction of this. An acceptance test now pins `liveStatus()` under 600ms.

## Lists that lied about how much they were showing

`/accounts` capped at 300 rows and then printed *"300 accounts"* — with 502 in the
database. A rep searching for the 400th school alphabetically would have been told,
in effect, that it did not exist. Both `/accounts` and `/people` now report the true
total and say plainly when the view is truncated.

## A dropped connection became a 500

Supabase's pooler closes idle sockets, and node-postgres can hand back a client that
died between being pooled and being used — *"Connection terminated unexpectedly"* on
the first request after a quiet spell. Connection checkout now retries once.

## Six functions were published as REST endpoints

Supabase's own linter flagged `is_staff`, `is_founder`, `has_grant`, `can_see_school`,
`can_see_account` and `current_role_key` as `SECURITY DEFINER` functions callable by
any signed-in user at `/rest/v1/rpc/…`.

They were never an escalation path — each answers exactly one question about the
**caller**, and discloses nothing a `SELECT` would not. But the endpoints had no
reason to exist, so they were moved to a `private` schema that PostgREST does not
expose. `EXECUTE` stays granted to `authenticated` deliberately: a policy expression
is evaluated as the querying role, so revoking it would break row-level security
rather than tighten it.

Moving them broke their own internal calls — the bodies referred to each other as
`public.is_staff()` — which the test suite caught immediately. `create or replace`
repointed them without changing their OIDs, which is what the policies actually
reference.

Six of the seven security advisories are now clear. The seventh is
**leaked-password protection**, which is a dashboard toggle only you can flip.
