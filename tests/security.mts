/**
 * MINTRIX SECURITY TESTS — run against the live database.
 *
 *   npm run test:security
 *
 * Every check here tries to do something the system is supposed to refuse, and
 * fails if it succeeds. Nothing is asserted about the user interface: hiding a
 * button is not a permission. Each attempt is made as a real user, through the
 * same connection the app uses.
 */
import fs from "node:fs";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)![1].trim();
}
const db = await import("@/server/db");

let pass = 0; const failures: string[] = [];
const check = (name: string, cond: unknown, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n         ${detail}` : ""}`); }
};
const section = (t: string) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
/** Returns the error message if the statement was refused, else null. */
const refused = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
};
const count = (sql: string, a: unknown[] = []) =>
  db.asService("test measurement", async () =>
    Number((await db.one(`select count(*) n from ${sql}`, a))!.n));

const uid = async (legacy: string) => (await db.asService("test setup", async () =>
  db.one("select user_id from public.legacy_user_map where legacy_id = ?", [legacy])))!
  .user_id as string;
const FOUNDER = await uid("USR-0001");
const REP = await uid("USR-0002");

// An external collaborator — the sharpest test of scope, because everything is
// denied by default and exactly one school is granted.
const EXT = "00000000-0000-4000-8000-0000000000ff";
let GRANTED = "", UNGRANTED = "";

try {
await db.asService("grant the collaborator one school for this run", async () => {
  const two = await db.many("select id from public.schools order by id limit 2");
  GRANTED = two[0].id as string; UNGRANTED = two[1].id as string;
  const seat = await db.one("select 1 from public.user_roles where user_id = ?", [EXT]);
  if (!seat) throw new Error(
    "The external-collaborator seat is missing. Apply the "
    + "security_test_collaborator_seat migration before running this suite.");
  await db.run("delete from public.access_grants where user_id = ?", [EXT]);
  await db.run(`insert into public.access_grants
                  (id, user_id, scope_type, scope_id, can_edit, granted_by)
                values (gen_random_uuid(), ?, 'school', ?, false, ?)`,
               [EXT, GRANTED, FOUNDER]);
});

// ==========================================================================
section("THE DATABASE, NOT THE FRONT END, IS WHERE THIS IS ENFORCED");
// ==========================================================================
const noRls = await db.asService("audit", async () => db.many(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`));
check("Row-level security is on for every table, with no exceptions",
      noRls.length === 0, noRls.map((r) => r.relname).join(", "));

const roles = await db.asService("audit", async () => db.many(
  `select rolname, rolsuper, rolbypassrls from pg_roles
    where rolname in ('mintrix_app','authenticated','anon')`));
check("The role the app logs in as is not a superuser and cannot bypass RLS",
      roles.every((r) => !r.rolsuper && !r.rolbypassrls),
      JSON.stringify(roles));

const anonGrants = await db.asService("audit", async () => db.many(
  `select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'`));
check("The anonymous role holds no privileges on any business table",
      anonGrants.length === 0, anonGrants.slice(0, 5).map((g) => g.table_name).join(", "));

const loose = await db.asService("audit", async () => db.many(
  `select n.nspname || '.' || p.proname as proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'))
                       as c(v) where v like 'search_path=%')`));
check("Every SECURITY DEFINER function pins its search_path",
      loose.length === 0, loose.map((r) => r.proname).join(", "));

// The RLS helpers answer only about the caller, so they were never an escalation
// path — but in `public` they were also published as REST endpoints.
const exposed = await db.asService("audit", async () => db.many(
  `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_staff','is_founder','has_grant','can_see_school',
                        'can_see_account','current_role_key')`));
check("The permission helpers are not published as REST endpoints",
      exposed.length === 0, exposed.map((r) => r.proname).join(", "));
check("The schema they moved to is closed to signed-out visitors",
      !(await db.asService("audit", async () => db.one(
        `select 1 from information_schema.usage_privileges
          where object_schema = 'private' and grantee = 'anon'`))));

// ==========================================================================
section("A USER CANNOT GIVE THEMSELVES AUTHORITY");
// ==========================================================================
await db.withUser(REP, async () => {
  check("A rep cannot insert a founder role for themselves",
        !!await refused(() => db.run(
          `insert into public.user_roles (user_id, role, team, status)
           values (?, 'founder', 'founder', 'active')`, [REP])));

  await refused(() => db.run(
    "update public.user_roles set role = 'founder' where user_id = ?", [REP]));
  const stillRep = await db.asService("verify", async () => db.one(
    "select role from public.user_roles where user_id = ?", [REP]));
  check("A rep cannot promote themselves by updating their own role",
        stillRep!.role === "ae", String(stillRep!.role));

  await refused(() => db.run("delete from public.user_roles where user_id = ?", [REP]));
  check("A rep cannot delete their role row to escape it",
        await count("public.user_roles where user_id = ?", [REP]) === 1);

  check("A rep cannot grant themselves access to anything",
        !!await refused(() => db.run(
          `insert into public.access_grants
             (id, user_id, scope_type, scope_id, can_edit, granted_by)
           values (gen_random_uuid(), ?, 'school', ?, true, ?)`,
          [REP, UNGRANTED, REP])));

  check("A rep cannot change somebody else's profile",
        await (async () => { await refused(() => db.run(
          "update public.profiles set full_name = 'Owned' where id = ?", [FOUNDER]));
          return (await db.asService("verify", async () => db.one(
            "select full_name from public.profiles where id = ?", [FOUNDER])))!
            .full_name !== "Owned"; })());
});

await db.withUser(FOUNDER, async () => {
  await refused(() => db.run(
    "update public.user_roles set role = 'external' where user_id = ?", [REP]));
  const untouched = await db.asService("verify", async () => db.one(
    "select role from public.user_roles where user_id = ?", [REP]));
  check("Not even the founder can rewrite authority in an ordinary session — "
        + "role changes go through the audited admin path",
        untouched!.role === "ae", String(untouched!.role));
});

// ==========================================================================
section("SCOPE HOLDS WHEN THE URL IS EDITED BY HAND");
// ==========================================================================
await db.withUser(EXT, async () => {
  const visible = await db.many("select id from public.schools");
  check("An external collaborator sees only what was granted, not the other 558",
        visible.length === 1 && visible[0].id === GRANTED,
        `${visible.length} rows`);

  // The URL-manipulation test: ask for a record by id that was never granted.
  check("Typing another school's id into the URL returns nothing, not a denial page",
        (await db.get("schools", UNGRANTED)) === null);
  check("The granted school is still reachable",
        (await db.get("schools", GRANTED))?.id === GRANTED);

  await refused(() => db.run(
    "update public.schools set name = 'Renamed' where id = ?", [GRANTED]));
  const name = await db.asService("verify", async () => db.one(
    "select name from public.schools where id = ?", [GRANTED]));
  check("Being able to see a school does not mean being able to change it",
        name!.name !== "Renamed");

  check("An external collaborator cannot create schools",
        !!await refused(() => db.run(
          `insert into public.schools (id, account_id, name, city, stage)
           values ('SCH-HACK', (select account_id from public.schools where id = ?),
                   'Hack', 'Varanasi', 'lead')`, [GRANTED])));

  const before = await count("public.schools");
  await refused(() => db.run("delete from public.schools where id = ?", [GRANTED]));
  check("An external collaborator cannot delete anything",
        await count("public.schools") === before);

  check("An external collaborator cannot read the audit trail",
        (await db.many("select id from public.audit_events")).length === 0);

  check("An external collaborator cannot enumerate staff profiles",
        (await db.many("select id from public.profiles")).length <= 1);

  check("An external collaborator cannot read work they neither own nor share",
        (await db.many(
          "select id from public.work_items where school_id is distinct from ?",
          [GRANTED])).length === 0);
});

// ==========================================================================
section("HISTORY CAN BE ADDED TO, NEVER REWRITTEN");
// ==========================================================================
const anyAudit = await db.asService("test setup", async () => db.one(
  "select id, action from public.audit_events order by occurred_at limit 1"));
const auditTotal = await count("public.audit_events");

await db.withUser(REP, async () => {
  check("A user cannot write an audit row in somebody else's name",
        !!await refused(() => db.run(
          `insert into public.audit_events (actor_id, action, object_type, object_id)
           values (?, 'SCHOOL_STAGE_CHANGED', 'school', 'SCH-0001')`, [FOUNDER])));

  if (anyAudit) {
    await refused(() => db.run(
      "update public.audit_events set action = 'NOTHING_HAPPENED' where id = ?",
      [anyAudit.id as string]));
    const after = await db.asService("verify", async () => db.one(
      "select action from public.audit_events where id = ?", [anyAudit.id as string]));
    check("An audit row cannot be edited after the fact",
          after!.action === anyAudit.action, String(after!.action));

    await refused(() => db.run("delete from public.audit_events where id = ?",
                               [anyAudit.id as string]));
    check("An audit row cannot be deleted", await count("public.audit_events") === auditTotal);
  }

  const actTotal = await count("public.activities");
  await refused(() => db.run("delete from public.activities"));
  check("Activity history cannot be deleted, not even by the person who logged it",
        await count("public.activities") === actTotal);

  const workTotal = await count("public.work_items");
  await refused(() => db.run("delete from public.work_items"));
  check("Work is cancelled with a reason, never deleted",
        await count("public.work_items") === workTotal);
});

// ==========================================================================
section("SECRETS DO NOT REACH THE BROWSER");
// ==========================================================================
const env = fs.readFileSync(".env.local", "utf8");
const publicVars = env.split("\n").filter((l) => l.startsWith("NEXT_PUBLIC_"));
check("The only things exposed to the browser are the project URL and the "
      + "publishable key — both safe, because RLS decides what they can reach",
      publicVars.every((l) =>
        /^NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY|PUBLISHABLE_KEY)=/.test(l)),
      publicVars.map((l) => l.split("=")[0]).join(", "));
check("The service-role key is not published under a NEXT_PUBLIC_ name",
      !/NEXT_PUBLIC_[A-Z_]*=.*service_role/i.test(env));
check("The database URL is not published under a NEXT_PUBLIC_ name",
      !/NEXT_PUBLIC_[A-Z_]*=\s*postgres/i.test(env));

const ignored = fs.existsSync(".gitignore") ? fs.readFileSync(".gitignore", "utf8") : "";
check("The env file and the credentials note are both gitignored",
      /(^|\n)\.env\*?\.local/.test(ignored) && /SUPABASE_CREDENTIALS/.test(ignored));

const dbPassword = (env.match(/DATABASE_URL=postgres(?:ql)?:\/\/[^:]+:([^@]+)@/) ?? [])[1];
const bundleDir = ".next/static";
if (fs.existsSync(bundleDir)) {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`; e.isDirectory() ? walk(p) : /\.(js|css|map)$/.test(p) && files.push(p); } };
  walk(bundleDir);
  const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  check(`No service-role key in any of the ${files.length} built browser files`,
        !text.includes("service_role"));
  check("No database password in the built browser files",
        !!dbPassword && !text.includes(decodeURIComponent(dbPassword)));
  check("No connection string in the built browser files",
        !/postgres(ql)?:\/\/[^\s"']+@/.test(text));
} else {
  console.log("  SKIP  browser bundle scan — run `npm run build` first");
}

} finally {
  await db.asService("take the temporary grant back", async () =>
    db.run("delete from public.access_grants where user_id = ?", [EXT]));
}

console.log(`\n${"=".repeat(64)}`);
console.log(`  ${pass} passed, ${failures.length} failed`);
if (failures.length) for (const f of failures) console.log(`   - ${f}`);
console.log("=".repeat(64));
await db.close();
process.exit(failures.length ? 1 : 0);
