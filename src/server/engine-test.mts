import fs from "node:fs";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)![1].trim();
}
const db = await import("@/server/db");
const stage = await import("@/domain/stage");
const work = await import("@/domain/work");
const audit = await import("@/domain/audit");

const founder = (await db.asService("test setup", async () =>
  db.one("select user_id from public.legacy_user_map where legacy_id='USR-0001'")))!
  .user_id as string;

let pass = 0, fail = 0;
const check = (name: string, cond: unknown, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `\n         ${detail}` : ""}`); }
};
let testAccount = "";
const threw = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
};

await db.withUser(founder, async () => {
  // A throwaway account with four schools, exactly the brief's §92 scenario.
  const acc = await db.insert("accounts", { name: "ZZ Engine Test Group", city: "Varanasi" });
  const mk = (n: string) => db.insert("schools", {
    account_id: acc, name: n, city: "Varanasi", board: "CBSE", locality: "Sigra",
    owner_id: founder });
  const A = await mk("ZZ School A"), B = await mk("ZZ School B");
  const C = await mk("ZZ School C"), D = await mk("ZZ School D");

  check("Every new school starts at lead",
        (await db.many("select stage from public.schools where account_id = ?", [acc]))
          .every((s) => s.stage === "lead"));

  const g1 = await stage.gate(A, "target");
  check("Target's entry checks pass for a filled school", g1.ok,
        g1.missingEntry.map((c) => c.check.label).join("; "));
  const m1 = await stage.move(A, "target", { isFounder: true, note: "Worth our time." });
  check("School A moved to target", (await db.get("schools", A))!.stage === "target");
  check("Schools B, C, D did not move",
        (await db.many("select stage from public.schools where id in (?,?,?)", [B, C, D]))
          .every((s) => s.stage === "lead"));
  check("The account has no stage column at all",
        !("stage" in (await db.get("accounts", acc))!));
  check("Target created its work", m1.created.length >= 2);

  const p0 = await stage.progress(A, "target");
  check("Progress counts blocking work only", p0.total === p0.blocking.length && p0.total >= 2);
  check("It starts at 0/n", p0.done === 0);

  const blocked = await threw(() => stage.move(A, "research", { isFounder: true }));
  check("The stage will not close while blocking work is open", !!blocked);
  check("The refusal names what is missing",
        !!blocked && blocked.includes("Still to do"), blocked ?? "");

  for (const t of p0.open) {
    await work.resolve(t.id as string, { kind: "completed", note: `Done: ${t.title}` });
  }
  const p1 = await stage.progress(A, "target");
  check("Resolved blocking work reads n/n", p1.done === p1.total && p1.ready);

  // Research needs an ICP assessment; the gate should say so rather than guess.
  const g2 = await stage.gate(A, "research");
  check("Research is gated on the ICP assessment",
        g2.missingEntry.some((c) => c.check.key === "icp"),
        g2.missingEntry.map((c) => c.check.label).join("; "));
  await db.insert("icp_assessments", { account_id: acc, school_id: A,
    axes: JSON.stringify({ first_poc: "A" }), band: "A" });
  check("Recording it opens the gate", (await stage.gate(A, "research")).ok);

  const m2 = await stage.move(A, "research", { isFounder: true });
  check("Moved target -> research", (await db.get("schools", A))!.stage === "research");
  check("Exactly one live stage clock",
        (await db.many(`select id from public.stage_slas where subject_type='school'
                        and subject_id = ? and closed_at is null`, [A])).length === 1);
  check("A handoff was written",
        !!(await db.one("select id from public.stage_handoffs where subject_id = ?", [A])));
  check("An audit row was written",
        (await audit.search({ objectId: A, action: "SCHOOL_STAGE_CHANGED" })).length === 2);

  const jump = await threw(() => stage.move(B, "proposal", { isFounder: true }));
  check("Stages cannot be skipped", !!jump && jump.includes("does not follow"), jump ?? "");
  const repOnly = await threw(() => stage.move(B, "target", { isFounder: false,
    overrideReason: null }));
  check("A legal move still works for a non-founder when the gate is open",
        repOnly === null || !repOnly.includes("founder"), repOnly ?? "");

  // Holding states are never gated.
  await stage.move(C, "nurture", { isFounder: true });
  check("Any school may go to a holding state", (await db.get("schools", C))!.stage === "nurture");

  // UNDO
  const undo = await stage.revert(m2.transitionId, "Moved it by mistake.", true);
  check("Undo puts the stage back", (await db.get("schools", A))!.stage === "target");
  check("Undo is itself recorded, not a silent rewrite",
        (await audit.search({ objectId: A, action: "SCHOOL_STAGE_REVERTED" })).length === 1);
  check("Undo cancels the work the mistake created, rather than deleting it",
        undo.cancelled >= 1);
  check("The original transition is marked, never erased",
        !!(await db.get("stage_transitions", m2.transitionId))!.reverted_by_id);
  const twice = await threw(() => stage.revert(m2.transitionId, "again", true));
  check("The same move cannot be undone twice", !!twice);

  testAccount = acc;
});

// Cleanup needs the service role: there is deliberately NO delete policy on work,
// activities or audit for any user. That is the point — history is not deletable.
if (testAccount) {
  await db.asService("remove engine-test fixtures", async () => {
    // Children before parents — activities point at work items, which point at schools.
    for (const t of ["activities", "audit_events", "stage_handoffs", "stage_slas",
                     "stage_transitions", "work_items", "icp_assessments", "schools"]) {
      await db.run(`delete from public.${t} where account_id = $ACC`.replace("$ACC", "?"),
                   [testAccount]);
    }
    await db.run("delete from public.accounts where id = ?", [testAccount]);
  });
}

console.log(`\n  engine: ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
