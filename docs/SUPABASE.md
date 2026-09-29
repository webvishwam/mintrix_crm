# SUPABASE — what is live, and what is not

**Project** `mintrix-sales-os` · ref `teminhoomnvtheupjlho` · `ap-south-1` (Mumbai,
closest to Varanasi) · **$0/month**, free tier ·
`https://teminhoomnvtheupjlho.supabase.co`

Credentials are in `SUPABASE_CREDENTIALS.local.txt` (gitignored). Change every
password at first sign-in.

---

## What is live

**The canonical schema**, in the refactored shape from `ARCHITECTURE_AUDIT.md` — so the
architectural collapse and the database move happened once, not twice.

| | |
|---|---|
| **One journey vocabulary** | `journey_stage`: lead · target · research · engagement · discovery · mapping · proposal · negotiation · contract · payment · customer · expansion, plus nurture · disqualified · lost |
| **Accounts** | **no stage column at all.** An institution has no relationship stage; its schools each have one |
| **Schools** | `stage journey_stage` — the one canonical relationship state |
| **Opportunities** | the same vocabulary, CHECK-constrained to the commercial half |
| **Podcast** | `podcast_status` — a workstream with a status, not a seven-stage funnel |
| **Delivery** | `delivery_stage` — its own operational lifecycle, never a sales stage |
| **Work** | one `work_items` table: task or ticket, team, workstream, blocking |

**The data.** Every row moved and was counted against the source:

```
accounts 502 · schools 559 · people 155 · person_roles 115
duplicate reviews 131 open · research 33
UDISE 326 · affiliation 144 · group-level people 40
```

**Identity, split three ways** — the thing the old build got wrong:

```
auth.users     the login. Supabase owns it.
profiles       what the user may edit about themselves.
user_roles     the authority. The user cannot write to this table at all.
access_grants  the scope. Which records, not which verbs.
```

Authorisation is deliberately **not** in `raw_user_meta_data`: a user can edit their own
metadata, so a role living there would be self-promotable.

---

## Security, proven rather than asserted

Every table has RLS enabled and deny-by-default. A signed-out visitor has no privileges
on any table — `revoke all ... from anon`. Tested against the live API:

| Test | Result |
|---|---|
| Founder signs in | sees 559 schools, sees the audit log |
| AE signs in | sees 559 schools, **audit log returns 0 rows** |
| External collaborator, granted one school | sees that school only |
| External: the school they were **not** granted, by direct id | **blocked** |
| External: opportunities (pricing) | **0 rows**, whatever grants they hold |
| External: work items | only their own production ticket, not the commercial one |
| Any user PATCHes their own `user_roles` row | **0 rows affected** |
| Old address `hiten@mintrix.ai` | `invalid_credentials` |

---

## Two things worth knowing

**Directly-inserted auth users need empty-string tokens.** GoTrue scans
`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*` and
`reauthentication_token` into Go strings and cannot read NULL. A row created by SQL
rather than by the Auth API gets NULLs, and every sign-in then fails with
`Database error querying schema`. Set them to `''`.

**Revoking EXECUTE from `public` on a trigger function breaks Supabase Auth.** Postgres
checks EXECUTE against the role firing the trigger, and Auth runs as
`supabase_auth_admin`. Grant it back to that role specifically.

---

## What is NOT done

**The Next.js application still runs on SQLite.** It has not been pointed at Supabase.
That port is 736 synchronous `db.*` call sites across 62 files, all of which become
`await`, cascading through 148 exported helpers. It is mechanical but large, and doing
it in the same pass as the architectural collapse would have risked breaking a CRM that
currently works.

So today there are two databases: the local SQLite one the app reads, and Supabase,
which holds the canonical schema and a verified copy of the same data. **That is a
deliberate midpoint, not a finished state** — the brief is explicit that two sources of
truth are the problem, so the next step closes it.

Remaining, in order:

1. Port `src/lib/db.ts` to `@supabase/supabase-js` and make the call sites async.
2. Replace session-cookie auth with Supabase Auth.
3. Collapse the app's rule files onto the one journey (the audit's section D).
4. My Account: self-service profile, password, and the email-change flow.
5. Retire `/board`, fold the three pipeline screens into one.
6. Undo/restore on stage moves.

## Housekeeping

The migration loader Edge Function `etl-load` has had its body replaced with a stub that
holds no key and returns 410. **Delete it from the dashboard** when convenient:
Project → Edge Functions → `etl-load` → Delete.

## Migrations added in V0.4

| | |
|---|---|
| `security_test_collaborator_seat` | A permanent, login-disabled external collaborator (`banned_until = infinity`, password hash that hashes nothing) so the security suite can prove scope without manufacturing an auth user at run time. Holds no grants. |
| `move_rls_helpers_out_of_the_api_schema` | `is_staff`, `is_founder`, `has_grant`, `can_see_school`, `can_see_account`, `current_role_key` moved from `public` to `private`, removing their `/rest/v1/rpc/` endpoints. `EXECUTE` stays granted to `authenticated` — policies are evaluated as the querying role. |
| `repoint_rls_helpers_at_their_new_schema` | The helper bodies called each other as `public.…`; `create or replace` repointed them at `private.…` while keeping their OIDs, which is what the policies reference. |

## Migration added in V0.5

| | |
|---|---|
| `handoff_gate_human_confirmations` | Two of the seven handoff checks — the Invisibility Test, and whether anybody has sent a deck — cannot be derived from anything the system can see. They were auto-passing, so the gate was ticking boxes nobody had checked. They are now stored confirmations with the confirming user and timestamp. |
