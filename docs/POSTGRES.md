# Moving to PostgreSQL / Supabase

The SQLite schema is written in the intersection of SQLite and PostgreSQL, so the move
is a migration rather than a rewrite. This file lists everything that actually changes.

## 1. The schema

```bash
npx tsx scripts/make-postgres.mts > docs/schema.postgres.sql
psql "$DATABASE_URL" -f docs/schema.postgres.sql
```

It is generated from `db/schema.sql`, so the two cannot drift. Text IDs keep their
canonical prefixes (`ACC-0001`, `SCH-0001`, `CON-0001` …), which is what
`05_CRM_DATA_MODEL.md` §16 asks you to get right today so the scale form is a migration.

## 2. Three queries need a dialect change

Everything else is portable. These live in `app/engine.py`:

| Where | SQLite | PostgreSQL |
|---|---|---|
| `health()` duplicate accounts | `GROUP_CONCAT(id)` | `string_agg(id, ',')` |
| `health()` duplicate people | `GROUP_CONCAT(id)` | `string_agg(id, ',')` |
| `merge.ts` / `import.ts` | `REPLACE(...)` on affiliation | unchanged, both dialects have it |

The partial unique indexes (`... WHERE udise_code IS NOT NULL`) are valid PostgreSQL as
written — they are the same syntax in both engines.

`src/lib/db.ts` uses `PRAGMA table_info(...)` for column introspection; replace with
`information_schema.columns`, or hardcode the column sets.

## 3. Timestamps

Stored as ISO-8601 **text** (`2026-09-25 14:30:00`), compared as text, which sorts
correctly. Converting the columns to `timestamptz` is optional and can be done later
without touching application logic, because `db.parse()` already normalises on read.

## 4. What does not move

- `src/lib/rules/` — pure data. Untouched.
- `src/lib/engine.ts` — apart from the two `GROUP_CONCAT`s above.
- `src/lib/identity.ts`, `src/lib/import.ts`, `src/lib/xlsx.ts` — the whole import path.
- `scripts/seed.mts` — the seeder.
- `tests/` — all 129 acceptance tests.

## 5. Moving auth to Supabase

Authentication moves to Supabase Auth; `users`, `sessions`, `hashPassword` and
`createSession` in `src/lib/auth.ts` are then redundant. Everything else — the rules, the
engine, the importer — is driver-agnostic already.
