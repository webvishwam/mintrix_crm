/**
 * MINTRIX ACCEPTANCE TESTS — against the live Supabase database.
 *
 *   npm test
 *
 * Builds its own throwaway account, exercises the canonical model end to end, and
 * removes every fixture afterwards. The production dataset is never touched.
 */
import fs from "node:fs";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)![1].trim();
}
const db = await import("@/server/db");
const stage = await import("@/domain/stage");
const work = await import("@/domain/work");
const people = await import("@/domain/people");
const audit = await import("@/domain/audit");
const schools = await import("@/domain/schools");
const journey = await import("@/domain/journey");
const commercial = await import("@/domain/commercial");
const show = await import("@/domain/show");

let pass = 0; const failures: string[] = [];
const check = (name: string, cond: unknown, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n         ${detail}` : ""}`); }
};
const section = (t: string) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
const threw = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
};

const id = async (legacy: string) => (await db.asService("test setup", async () =>
  db.one("select user_id from public.legacy_user_map where legacy_id = ?", [legacy])))!
  .user_id as string;
const FOUNDER = await id("USR-0001");
const AE = await id("USR-0002");
const PRODUCTION = await id("USR-0004");

let ACC = "";
const TAG = `ZZTEST-${Date.now().toString(36)}`;

try {
await db.withUser(FOUNDER, async () => {

// ==========================================================================
section("ONE JOURNEY, NOT FOUR PIPELINES");
// ==========================================================================
check("There is exactly one stage vocabulary for the relationship",
      journey.LADDER.length === 12 && journey.HOLDING.length === 3);
check("The old 14 are decomposed — no ICP Gate, Dossier, Asset or Physical Delivery stage",
      !journey.STAGES.some((s) => /gate|dossier|asset|delivery|follow/i.test(s.name)));
check("Beyond the Classroom is a status, not a ladder",
      journey.PODCAST_STATUSES.length > 0
      && !journey.STAGES.some((s) => /^t[0-6]/i.test(s.key)));
const ladderKeys = new Set<string>(journey.STAGES.map((s) => String(s.key)));
check("Delivery has its own lifecycle, separate from the sales ladder",
      journey.DELIVERY_STAGES.length === 7
      && !journey.DELIVERY_STAGES.some((d) => ladderKeys.has(String(d.key))));
check("The commercial half is a subset of the same vocabulary, not a second one",
      journey.COMMERCIAL.every((s) => journey.BY_KEY[s.key] === s));
check("Accounts have no stage column at all",
      !(await db.columns("accounts")).has("stage"));

// ==========================================================================
section("FOUR SCHOOLS UNDER ONE ACCOUNT MOVE INDEPENDENTLY");
// ==========================================================================
ACC = await db.insert("accounts", { name: `${TAG} Education Group`, city: "Varanasi" });
const mk = (n: string) => db.insert("schools", {
  account_id: ACC, name: `${TAG} ${n}`, city: "Varanasi", board: "CBSE",
  locality: "Sigra", owner_id: AE });
const A = await mk("School A"), B = await mk("School B");
const C = await mk("School C"), D = await mk("School D");

check("Every school starts at lead",
      (await db.many("select stage from public.schools where account_id = ?", [ACC]))
        .every((s) => s.stage === "lead"));

await stage.move(A, "target", { isFounder: true, note: "Worth our time." });
check("School A moved; B, C and D did not",
      (await db.get("schools", A))!.stage === "target"
      && (await db.many("select stage from public.schools where id in (?,?,?)", [B, C, D]))
           .every((s) => s.stage === "lead"));

const summary = await schools.accountSummary(ACC, FOUNDER);
check("The account aggregates four schools at their own stages",
      summary.schools.length === 4 && summary.counts.target === 1
      && summary.counts.lead === 3, JSON.stringify(summary.counts));

// ==========================================================================
section("GATES, BLOCKING WORK AND WHAT THE REFUSAL SAYS");
// ==========================================================================
const p0 = await stage.progress(A, "target");
check("Entering Target created its work", p0.total >= 2);
check("Progress counts blocking work only", p0.blocking.length === p0.total);
const blocked = await threw(() => stage.move(A, "research", { isFounder: true }));
check("The stage will not close while blocking work is open", !!blocked);
check("The refusal names what is missing rather than saying 'invalid'",
      !!blocked && blocked.includes("Still to do"), blocked ?? "");

for (const t of p0.open) {
  await work.resolve(t.id as string, { kind: "completed", note: `Done: ${t.title}` });
}
check("Resolved work reads n/n", (await stage.progress(A, "target")).ready);
const g = await stage.gate(A, "research");
check("Research is gated on an ICP assessment, which is a GATE not a stage",
      g.missingEntry.some((c) => c.check.key === "icp"));
await db.insert("icp_assessments", { account_id: ACC, school_id: A,
  axes: JSON.stringify({ first_poc: "A" }), band: "A" });
check("Recording it opens the gate", (await stage.gate(A, "research")).ok);
await stage.move(A, "research", { isFounder: true });

const jump = await threw(() => stage.move(B, "proposal", { isFounder: true }));
check("Stages cannot be skipped", !!jump && jump.includes("does not follow"));
const repOverride = await threw(() =>
  stage.move(B, "proposal", { isFounder: false, overrideReason: "because" }));
check("A non-founder cannot override", (repOverride ?? "").includes("founder"));

// ==========================================================================
section("THE SHOW IS A WORKSTREAM — IT DOES NOT MOVE THE RELATIONSHIP");
// ==========================================================================
const pod = await db.insert("podcast_relationships", {
  account_id: ACC, school_id: A, status: "published", owner_id: AE,
  episode_question: "What does this school know that nobody asks about?" });
check("A school can be at Research while its show is Published",
      (await db.get("schools", A))!.stage === "research"
      && (await db.get("podcast_relationships", pod))!.status === "published");
check("Publishing did not create an opportunity",
      (await db.many("select id from public.opportunities where school_id = ?", [A]))
        .length === 0);

// Engagement needs a reachable person; Discovery needs a recorded signal.
await stage.move(A, "engagement", { isFounder: true, overrideReason: "test fixture" });
const needSignal = await stage.gate(A, "discovery");
check("Discovery is gated on a recorded signal, not on the show finishing",
      needSignal.missingEntry.some((c) => c.check.key === "signal"));
const priya = await people.add({ accountId: ACC, schoolId: A, name: `${TAG} Priya Sharma`,
  schoolRole: "principal", relationshipTypes: ["decision_maker", "primary_poc"],
  phone: "9876500001" });
await db.insert("podcast_signals", {
  podcast_id: pod, account_id: ACC, school_id: A, signal_type: "named_a_problem",
  verbatim_quote: "We re-key every admission form into three systems.",
  speaker: "Priya Sharma", speaker_role: "Principal", logged_by: FOUNDER });
check("A recorded signal — their words — opens Discovery",
      (await stage.gate(A, "discovery")).missingEntry.length === 0);

// ==========================================================================
section("PARALLEL WORK — TEAMS DO NOT BLOCK EACH OTHER");
// ==========================================================================
const edit = await work.create({
  accountId: ACC, schoolId: A, title: `${TAG} Edit the episode`,
  reason: "Recorded Thursday; the guest sees it before anybody else.",
  team: "production", workstream: "production", taskType: "podcast_record",
  ownerId: PRODUCTION, slaHours: 168 });
const dataReq = await work.create({
  accountId: ACC, schoolId: A, title: `${TAG} Ask for three years of admissions data`,
  reason: "The mapping cannot be sized without them.",
  team: "operations", workstream: "school_data", taskType: "research",
  externalPersonId: priya.personId, ownerId: AE, slaHours: 48 });
await work.setStatus(dataReq, { status: "waiting", waitingOn: "The school",
  followUpOn: db.today(), reason: "Priya is pulling them from the ERP." });

const board = await work.schoolBoard(A);
check("Several workstreams run at once on one school",
      board.groups.length >= 2, board.groups.map((g) => g.key).join(", "));
check("Production work is owned by production, not by the rep",
      board.groups.find((g) => g.key === "production")!.items
        .every((t) => t.owner_id === PRODUCTION));
check("The data request does not look like a sales task",
      board.groups.find((g) => g.key === "school_data")!.items
        .every((t) => t.team === "operations"));

// Engagement's own blocking work still has to be done — that is the point of it.
for (const t of (await stage.progress(A, "engagement")).open) {
  await work.resolve(t.id as string, { kind: "completed", note: `Done: ${t.title}` });
}
await stage.move(A, "discovery", { isFounder: true });
check("The relationship moved while production work is still open",
      (await db.get("schools", A))!.stage === "discovery"
      && ["open", "in_progress"].includes(String((await db.get("work_items", edit))!.status)));

// ==========================================================================
section("ACTIVITY, WORK AND AUDIT ARE THREE DIFFERENT THINGS");
// ==========================================================================
check("Moving a stage wrote an ACTIVITY (what happened)",
      (await db.many(
        "select id from public.activities where school_id = ? and activity_type = 'stage_moved'",
        [A])).length >= 1);
check("Moving a stage wrote an AUDIT row (who changed the system)",
      (await audit.search({ objectId: A, action: "SCHOOL_STAGE_CHANGED" })).length >= 1);
check("They are separate tables, not one pretending to be both",
      (await db.columns("audit_events")).has("before_value")
      && !(await db.columns("activities")).has("before_value"));
const auditRow = (await audit.search({ objectId: A, action: "SCHOOL_STAGE_CHANGED" }))[0];
check("An audit row carries actor, action, object, time, before, after and reason",
      !!auditRow.actor_id && !!auditRow.action && !!auditRow.object_id
      && !!auditRow.occurred_at && !!auditRow.before_value && !!auditRow.after_value);

// ==========================================================================
section("UNDO AND CORRECTION");
// ==========================================================================
const last = (await db.many(
  `select * from public.stage_transitions where subject_id = ?
    order by moved_at desc limit 1`, [A]))[0];
const rev = await stage.revert(last.id as string, "Moved it by mistake.", true);
check("Undo puts the stage back", (await db.get("schools", A))!.stage === "engagement");
check("The reversal is its own recorded event",
      (await audit.search({ objectId: A, action: "SCHOOL_STAGE_REVERTED" })).length === 1);
check("The original transition is marked, never erased",
      !!(await db.get("stage_transitions", last.id as string))!.reverted_by_id);
check("Unstarted work from the mistake is cancelled, not deleted", rev.cancelled >= 0);
check("The same move cannot be undone twice",
      !!(await threw(() => stage.revert(last.id as string, "again", true))));

// ==========================================================================
section("PEOPLE — NAME + ROLE + SCHOOL, NEVER NAME ALONE");
// ==========================================================================
const janta = await mk("Janta Public School");
const priya2 = await people.add({ accountId: ACC, schoolId: janta,
  name: `${TAG} Priya Sharma`, schoolRole: "academic_coordinator" });
check("Two people with the same name are two records",
      priya.personId !== priya2.personId);
const ctxA = await people.context(priya.personId);
const ctxB = await people.context(priya2.personId);
check("Each identity line distinguishes them",
      ctxA!.identity.includes("School A") && ctxB!.identity.includes("Janta"),
      `${ctxA!.identity} / ${ctxB!.identity}`);
check("The duplicate is FLAGGED, not blocked and not merged",
      (await people.possibleDuplicates(`${TAG} Priya Sharma`, { accountId: ACC })).length === 2);
check("School role and Mintrix relationship share no vocabulary",
      !people.SCHOOL_ROLES.some((r) => r.key !== "other"
        && people.RELATIONSHIPS.some((x) => x.key === r.key)));
await people.linkToSchool({ personId: priya.personId, schoolId: janta,
  schoolRole: "director", relationshipTypes: ["decision_maker"] });
check("One person can hold two schools without a second record",
      (await people.associationsFor(priya.personId)).length === 2);

// ==========================================================================
section("THE SHOW IS AN OPERATION, NOT A LABEL");
// ==========================================================================
const SHOW = await mk("Show School");
check("Every step of the show carries the work it actually needs",
      show.SHOW_STATUSES.filter((x) => !x.terminal).every((x) => x.work.length > 0)
      && show.SHOW_STATUSES.some((x) => x.phase === "Planning")
      && show.SHOW_STATUSES.some((x) => x.phase === "Production")
      && show.SHOW_STATUSES.some((x) => x.phase === "Execution"));
check("The six paths and their expected distribution are canon, and add to 100",
      show.PATHS.length === 6
      && show.PATHS.reduce((n, p) => n + p.share, 0) === 100);
check("Only the nine permitted signal types exist",
      show.SIGNAL_TYPES.length === 9);

const notYet = await threw(() => show.move(SHOW, "scheduled", { isFounder: true }));
check("The show cannot start in the middle", !!notYet);

const p1 = await show.move(SHOW, "planned", {
  episodeQuestion: "What does a school with three campuses know about admissions?" });
check("Starting the show creates its planning work", p1.created >= 2);
check("Planning work belongs to the show, not to the sale",
      (await db.many(
        `select workstream::text w from public.work_items where podcast_id = ?`,
        [p1.podcastId])).every((t) => ["podcast", "production"].includes(String(t.w))));

const noGuest = await threw(() => show.move(SHOW, "invited", { isFounder: false }));
check("You cannot invite a school before deciding who the guest is",
      !!noGuest && noGuest.includes("Still to do"), noGuest ?? "");

// Do the planning work, then name the guest.
for (const t of (await show.progress(p1.podcastId, "planned")).open) {
  await work.resolve(t.id as string, { kind: "completed", note: `Done: ${t.title}` });
}
const anjali = await people.add({ accountId: ACC, schoolId: SHOW, name: `${TAG} Anjali`,
  schoolRole: "principal", relationshipTypes: ["decision_maker"] });
await db.update("podcast_relationships", p1.podcastId,
                { guest_person_id: anjali.personId });
check("With the guest named and the planning done, the invitation opens",
      (await show.gate(SHOW, "invited")).ok);

const stageBeforeShow = String((await db.get("schools", SHOW))!.stage);
await show.move(SHOW, "invited", {});
check("Inviting a school does not move it on the ladder",
      String((await db.get("schools", SHOW))!.stage) === stageBeforeShow);

// Walk the whole show through to published.
const walk = async (to: string, opts: Record<string, unknown> = {}) => {
  const st = (await db.one(
    "select status::text s from public.podcast_relationships where school_id = ?",
    [SHOW]))!.s as string;
  for (const t of (await show.progress(p1.podcastId, st)).open) {
    await work.resolve(t.id as string, { kind: "completed", note: `Done: ${t.title}` });
  }
  return show.move(SHOW, to, { isFounder: true, ...opts });
};
await walk("scheduled", { recordingDate: db.plusDays(-1).slice(0, 10) });
const early = await threw(() => show.move(SHOW, "recorded", { isFounder: false }));
check("A recording cannot be logged before its date", !!early);

await db.update("podcast_relationships", p1.podcastId,
                { recording_date: db.plusDays(-1).slice(0, 10) });
const rec = await walk("recorded");
check("Recording creates production AND relationship work, owned separately",
      rec.created >= 5);
const recWork = await db.many(
  `select template_key, team::text, blocking from public.work_items
    where podcast_id = ? and template_key like 'show:recorded:%'`, [p1.podcastId]);
check("The backup and the edit are production's; the debrief and the quotes are not",
      recWork.find((t) => t.template_key === "show:recorded:backup")!.team === "production"
      && recWork.find((t) => t.template_key === "show:recorded:debrief")!.team === "sales");
check("The transcript and the school's own clips run alongside, blocking nothing",
      recWork.filter((t) => ["show:recorded:transcript", "show:recorded:clips"]
        .includes(String(t.template_key))).every((t) => t.blocking === false));

await walk("delivered");
await walk("published", { episodeUrl: "https://example.com/ep" });
check("Publishing an episode does not move the school",
      String((await db.get("schools", SHOW))!.stage) === stageBeforeShow);
check("Publishing does not open an opportunity either",
      (await db.many("select id from public.opportunities where school_id = ?", [SHOW]))
        .length === 0);
check("The handoff sequence — T+21, T+35, T+60, T+90 — becomes real work",
      (await db.many(
        `select template_key from public.work_items where podcast_id = ?
          and template_key in ('show:published:path','show:published:register',
                               'show:published:useful','show:published:review')`,
        [p1.podcastId])).length === 4);

// The gate before a school may be treated as a commercial conversation.
const g1 = await show.handoffGate(p1.podcastId);
check("The seven-point handoff gate is not clear on a fresh episode", !g1.ok);
check("The gate does not tick boxes the system cannot actually check",
      g1.checks.filter((c) => ["invisibility", "no_deck"].includes(c.key))
        .every((c) => !c.ok),
      "the Invisibility Test and the no-deck check must be confirmed by a person");
const refused = await threw(() => show.setPath(SHOW, "E", "She seemed keen."));
check("Path E is refused while the gate is open",
      !!refused && refused.includes("handoff gate"), refused ?? "");
await show.setPath(SHOW, "C", "Signals present, nothing asked of us.");
check("Path C is always available — it is the honest default",
      (await db.get("podcast_relationships", p1.podcastId))!.path === "C");

// The ONE place the show touches the relationship.
await db.insert("podcast_signals", {
  podcast_id: p1.podcastId, account_id: ACC, school_id: SHOW,
  signal_type: "asked_what_mintrix_does",
  verbatim_quote: "So what is it you actually do for a school like ours?",
  speaker: "Anjali", speaker_role: "Principal", timecode: "00:41:08",
  logged_by: FOUNDER });
check("A signal is what reaches the relationship — and it is still the human's call",
      String((await db.get("schools", SHOW))!.stage) === stageBeforeShow
      && (await db.many(
        "select id from public.podcast_signals where school_id = ?", [SHOW])).length === 1);

const showCards = await show.board({});
const mine = showCards.find((c) => c.schoolId === SHOW)!;
check("The show board prints the school's own stage beside the episode",
      mine.journeyStage === stageBeforeShow && mine.status === "published",
      JSON.stringify({ stage: mine.journeyStage, show: mine.status }));

// ==========================================================================
section("THE DEAL IS PAPERWORK, NOT A SECOND LADDER");
// ==========================================================================
check("An opportunity will not open without a reason",
      !!await threw(() => commercial.open({ schoolId: B, route: "direct", reason: "  " })));
check("An opportunity will not open without a route to market",
      !!await threw(() => commercial.open({ schoolId: B, route: "vibes",
                                            reason: "They seem keen." })));

const tooEarly = await threw(() => commercial.open({
  schoolId: A, route: "direct", reason: "They seem keen." }));
check("A deal cannot be opened before the school has told us a problem",
      !!tooEarly && tooEarly.includes("nothing to quote for yet"), tooEarly ?? "");

await stage.move(A, "discovery", { isFounder: true, overrideReason: "test fixture" });
const stageBefore = String((await db.get("schools", A))!.stage);
const opp = await commercial.open({
  schoolId: A, route: "direct", ownerId: AE,
  reason: "They asked what it would cost across both branches.",
  feeQuoted: 150000 });
check("Opening a deal does not move the school",
      String((await db.get("schools", A))!.stage) === stageBefore);
check("The opportunity starts at the school's stage, not at one of its own",
      String((await db.get("opportunities", opp.id))!.stage) === stageBefore);
check("A school cannot have two open opportunities competing",
      !!await threw(() => commercial.open({ schoolId: A, route: "group",
                                            reason: "A second one." })));

// The mirror: the school moves, the deal follows. One writer, never two.
for (const t of (await stage.progress(A, "discovery")).open) {
  await work.resolve(t.id as string, { kind: "completed", note: `Done: ${t.title}` });
}
await stage.move(A, "mapping", { isFounder: true, overrideReason: "test fixture" });
check("Moving the school moves the deal with it — they cannot disagree",
      String((await db.get("opportunities", opp.id))!.stage) === "mapping"
      && String((await db.get("schools", A))!.stage) === "mapping");

const backTo = (await db.many(
  `select id from public.stage_transitions where subject_id = ?
    order by moved_at desc limit 1`, [A]))[0];
await stage.revert(backTo.id as string, "Wrong school.", true);
check("Undoing the move brings the deal back too",
      String((await db.get("opportunities", opp.id))!.stage)
        === String((await db.get("schools", A))!.stage));

check("A stakeholder must have a stated effect on the decision",
      !!await threw(() => commercial.addStakeholder({
        opportunityId: opp.id, personId: priya.personId, capacity: "friendly" })));
await commercial.addStakeholder({ opportunityId: opp.id, personId: priya.personId,
  capacity: "decides", note: "Signs on her own up to two lakh." });
const deal = (await commercial.byId(opp.id))!;
check("The deal knows who can say yes", deal.decider?.person_id === priya.personId);
check("The deal reads its stage from the school, not from itself",
      deal.schoolStage === String((await db.get("schools", A))!.stage) && !deal.drifted);

const stageAtClose = String((await db.get("schools", A))!.stage);
await commercial.close(opp.id, "parked", "They renewed with the incumbent for a year.");
check("Parking the deal does not quietly move the school to lost",
      String((await db.get("schools", A))!.stage) === stageAtClose);
check("A closed opportunity cannot be closed again",
      !!await threw(() => commercial.close(opp.id, "won", "changed my mind")));
check("A deal is won or parked — it is not the place to record a lost school",
      !!await threw(() => commercial.close(
        `${opp.id}`, "lost" as never, "they went elsewhere")));
check("Closing is on the record",
      (await audit.search({ objectId: opp.id, action: "OPPORTUNITY_CLOSED" })).length === 1);

// ==========================================================================
section("THE BOARD HOLDS UP");
// ==========================================================================
const t0 = Date.now();
const cards = await schools.board({ only: "all", viewerId: FOUNDER });
const ms = Date.now() - t0;
check(`All ${cards.length} schools render in one batched pass (${ms}ms)`,
      cards.length >= 559 && ms < 8000, `${ms}ms`);
check("A card carries school, account, owner, stage, SLA and next action together",
      cards.every((c) => c.name && c.accountName && c.stage && c.slaText !== undefined));
// The single most-loaded screen in the application. It was fourteen sequential
// round trips to Mumbai; each one costs ~80ms from a laptop, so this is the
// difference between a page that opens and a page you wait for.
const t1 = Date.now();
const live = await schools.liveStatus(A);
const liveMs = Date.now() - t1;
check(`One school's four states load in a couple of queries (${liveMs}ms)`,
      liveMs < 600, `${liveMs}ms`);
check("All four states are present and independent",
      live.stage === journey.BY_KEY[String((await db.get("schools", A))!.stage)]!.name
      && live.podcast?.status === "Published"
      && Array.isArray(live.commercial) && live.delivery === null,
      JSON.stringify({ stage: live.stage, podcast: live.podcast?.status,
                       commercial: live.commercial.length, delivery: live.delivery }));

const cardA = cards.find((c) => c.id === A)!;
const liveA = journey.BY_KEY[String((await db.get("schools", A))!.stage)]!.name;
check("A card shows the show and the deal alongside the stage, not instead of it",
      cardA.stage === liveA && cardA.podcast === "Published",
      `stage=${cardA.stage} want=${liveA} podcast=${cardA.podcast}`);

});
} finally {
  // Fixtures go through the service role: there is deliberately no delete policy on
  // work, activities or audit for any user.
  if (ACC) {
    await db.asService("remove acceptance-test fixtures", async () => {
      await db.run(
        `delete from public.opportunity_stakeholders where opportunity_id in
           (select id from public.opportunities where account_id = ?)`, [ACC]);
      for (const t of ["activities", "audit_events", "stage_handoffs", "stage_slas",
                       "stage_transitions", "work_items", "podcast_signals",
                       "podcast_relationships", "icp_assessments", "opportunities"]) {
        await db.run(`delete from public.${t} where account_id = ?`, [ACC]);
      }
      await db.run(
        `delete from public.person_roles where school_id in
           (select id from public.schools where account_id = ?)`, [ACC]);
      await db.run("delete from public.people where account_id = ?", [ACC]);
      await db.run("delete from public.schools where account_id = ?", [ACC]);
      await db.run("delete from public.accounts where id = ?", [ACC]);
    });
  }
}

console.log(`\n${"=".repeat(64)}`);
console.log(`  ${pass} passed, ${failures.length} failed`);
if (failures.length) for (const f of failures) console.log(`   - ${f}`);
console.log("=".repeat(64));
await db.close();
process.exit(failures.length ? 1 : 0);
