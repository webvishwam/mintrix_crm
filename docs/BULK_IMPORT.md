# Importing leads in bulk

The short version:

```bash
npm run import -- "path/to/file.xlsx" --dry-run     # read the report
npm run import -- "path/to/file.xlsx"               # do it
```

Always dry-run first. The report is not a simulation — the importer really runs inside a
database transaction and rolls it back, so what it tells you is exactly what would happen,
including every duplicate it would catch.

---

## What it accepts

`.xlsx` and `.csv`. Excel files are read directly, with no library and no conversion step.

```bash
npm run import -- file.xlsx --list-sheets     # what is in this workbook?
npm run import -- file.xlsx --sheet 3_FULL_UNIVERSE
```

A sheet that starts with a title row and a blank row before the real headers is handled
automatically — the header row is detected by looking for the one that maps to the most
known fields. Override it with `--header-row 3` (1-based) if it guesses wrong.

## Columns map themselves

You do not write a config file. The importer matches your headers against known aliases,
case- and punctuation-insensitively, and prints what it decided before doing anything:

```
Column mapping
  affiliation_no     <- Affiliation no.
  board              <- Board
  school_name        <- School
  udise              <- UDISE code
  ...
Columns not imported (3)
  Universe ID · Affiliation Level · Entity Type
```

If a column is mapped wrongly, or not at all, override just that one:

```bash
npm run import -- file.xlsx --map school_name="Institution Name",udise="UDISE+ Code"
```

The fields it understands are listed in `FIELD_ALIASES` in `src/lib/import.ts`. Adding a
new alias is one line.

---

## How it decides a school is already on file

Three keys, in order of authority. The first that matches wins, and the report tells you
which one it was.

| # | Key | Why |
|---|---|---|
| 1 | **UDISE code** | The government's 11-digit school code. Every school in India is issued one. A match here is a match, full stop. |
| 2 | **Affiliation number** | CBSE / CISCE. Authoritative when both sides carry a clean number. Values like `Multiple - per campus` or `UDISE 09670910911` are correctly rejected as *not* affiliation numbers. |
| 3 | **Name + city** | Normalised conservatively: lower-cased, punctuation and parentheticals dropped, **every word kept**. `Little Flower House (LFH)` = `Little Flower House`. |

Two of these are also enforced by the database itself, so a duplicate cannot be created
even by a bug or by hand:

```sql
CREATE UNIQUE INDEX uq_schools_udise    ON schools(udise_code) WHERE udise_code IS NOT NULL;
CREATE UNIQUE INDEX uq_schools_identity ON schools(identity_key) WHERE identity_key IS NOT NULL;
CREATE UNIQUE INDEX uq_accounts_external_ref ON accounts(external_ref) WHERE external_ref IS NOT NULL;
```

**Put the UDISE code in whenever you have it.** It is the only identifier that cannot
collide, and it is the difference between "probably the same school" and "the same school".

### What it deliberately does NOT do

It does not strip generic words to compare the "core" of a name. That was tried against
the real Varanasi list and it merged **Glorious Academy**, **Glorious Convent School** and
**Glorious Public School** into one record — three different schools. A wrong merge
destroys data that a duplicate merely clutters. So near-misses are flagged, never merged.

---

## Three outcomes per row

| Outcome | What happens |
|---|---|
| **NEW** | Nothing matched. The school is created, and its account too unless the row names a group or a parent account that already exists. |
| **KNOWN** | An authoritative key matched. Nothing is created. Any field the existing record was missing is **filled in** from this row — blanks only, never overwriting what is already there. |
| **FLAGGED** | It looks like something already on file, but no authoritative key agrees. The row **is imported**, and the pair is filed at `/imports` for a human. |

A cell that names several institutions at once — `Kendriya Vidyalaya BHU / Central Hindu
School / DLW Inter College` — is rejected rather than imported as one school, and flagged
so you can split it.

## What gets flagged

- every distinctive word in one name appears in the other
- the two names reduce to the *same* distinctive words (`St. John's School, B.L.W.` and
  `St. John's School, D.L.W.`)
- they share a published phone number or email address

That last one is worth more than it looks: on the Varanasi list it caught **UPPS** as the
same institution as **Udai Pratap Public School**, and **IHS Varanasi** as **International
Hindu School** — acronym-versus-full-name pairs that no name rule would ever find.

Across the 557 real rows this flags about 17%, of which the high-confidence ones included two
genuine spelling duplicates (`Bal Vidyalaya` / `Bal Vidhyalaya`) and several real
group-campus repeats.

## Deciding a flagged pair

Open **/imports** as the founder. Each pair shows both records, why they look alike, and
their identifiers. Two buttons:

- **Merge** — everything on the losing record moves to the winner: people, tasks,
  activities, waiting items, podcast and opportunity links. Fields the winner was missing
  are filled from the loser. If the loser's account is left empty it is removed. The merge
  is recorded on the winner's `source_ref`.
- **Different schools** — both are kept, and the pair stops appearing.

Nothing expires and nothing decides itself.

---

## Provenance

Every import writes a row to `lead_imports` (file, sheet, counts, who ran it, whether it
was a dry run), and every account, school and person it creates carries a `source_ref` of
the form `IMP-0003:row57`. You can always answer "where did this record come from".

## Adding a new field

1. Add the column to `db/schema.sql`.
2. Add its header aliases to `FIELD_ALIASES` in `src/lib/import.ts`.
3. Write it in the insert block in the same file.

If it is an identifier that should prevent duplicates, also add it to `findSchool()` in
`src/lib/identity.ts` and give it a unique index.
