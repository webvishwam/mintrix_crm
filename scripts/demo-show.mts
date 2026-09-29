/**
 * A worked example of Beyond the Classroom, so the operation can be walked through
 * before any real school is put on the show.
 *
 *   npm run demo:show      create it
 *   npm run demo:clear     remove every trace of it
 *
 * It creates one account with two schools, both named DEMO. One is mid-production
 * with the episode already recorded while the school itself is only at Research —
 * which is the whole point: the show runs alongside the journey, not as part of it.
 */
import fs from "node:fs";
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)![1].trim();
}
const db = await import("@/server/db");
const mode = process.argv[2] === "clear" ? "clear" : "create";

const founder = (await db.asService("demo setup", async () => db.one(
  "select user_id from public.legacy_user_map where legacy_id = 'USR-0001'")))!
  .user_id as string;

if (mode === "clear") {
  await db.asService("remove the show demo", async () => {
    const accs = await db.many("select id from public.accounts where name like 'DEMO %'");
    for (const a of accs) {
      const id = a.id as string;
      await db.run(`delete from public.opportunity_stakeholders where opportunity_id in
                      (select id from public.opportunities where account_id = ?)`, [id]);
      for (const t of ["activities", "audit_events", "stage_handoffs", "stage_slas",
                       "stage_transitions", "work_items", "podcast_signals",
                       "podcast_relationships", "icp_assessments", "opportunities"]) {
        await db.run(`delete from public.${t} where account_id = ?`, [id]);
      }
      await db.run(`delete from public.person_roles where school_id in
                      (select id from public.schools where account_id = ?)`, [id]);
      await db.run("delete from public.people where account_id = ?", [id]);
      await db.run("delete from public.schools where account_id = ?", [id]);
      await db.run("delete from public.accounts where id = ?", [id]);
    }
    console.log(accs.length ? `Removed ${accs.length} demo account(s).` : "Nothing to remove.");
  });
  await db.close();
  process.exit(0);
}

const people = await import("@/domain/people");
const show = await import("@/domain/show");
const work = await import("@/domain/work");

await db.withUser(founder, async () => {
  const existing = await db.one("select id from public.accounts where name like 'DEMO %'");
  if (existing) {
    console.log("The demo already exists. Run `npm run demo:clear` first.");
    return;
  }
  const acc = await db.insert("accounts",
    { name: "DEMO Sunrise Education Trust", city: "Varanasi" });
  const school = (name: string, stage: string) => db.insert("schools", {
    account_id: acc, name: `DEMO ${name}`, city: "Varanasi", board: "CBSE",
    locality: "Bhelupur", stage, stage_entered_at: db.now(), owner_id: founder });
  const clear = async (podcastId: string, status: string, note: string) => {
    for (const t of (await show.progress(podcastId, status)).open) {
      await work.resolve(t.id as string, { kind: "completed", note });
    }
  };

  // One school deep into production while the relationship is only at Research.
  const a = await school("Sunrise Public School", "research");
  const anjali = await people.add({
    accountId: acc, schoolId: a, name: "Anjali Verma", schoolRole: "principal",
    relationshipTypes: ["decision_maker", "primary_poc"], phone: "9876543210" });
  const r = await show.move(a, "planned", {
    episodeQuestion:
      "What does a school running three campuses know about admissions that nobody asks?" });
  await clear(r.podcastId, "planned", "Done.");
  await show.move(a, "invited", { guestPersonId: anjali.personId,
    note: "Asked by email, with the question in the message itself." });
  await clear(r.podcastId, "invited", "She said yes the same week.");
  await show.move(a, "scheduled", {
    recordingDate: db.plusDays(-9).slice(0, 10),
    recordingLocation: "Their campus, the principal's office",
    note: "Confirmed by email." });
  await clear(r.podcastId, "scheduled", "Done.");
  await show.move(a, "recorded", {
    note: "Ninety minutes. She came back to the re-keying twice, unprompted." });

  // A second school still being planned — nothing has been asked of them yet.
  const b = await school("Janta Public School", "lead");
  await people.add({ accountId: acc, schoolId: b, name: "Rakesh Tiwari",
    schoolRole: "director", relationshipTypes: ["decision_maker"], phone: "9876500002" });
  await show.move(b, "planned", {
    episodeQuestion: "What changes in a school when the founder's own child joins it?" });

  console.log(`Demo created.
  /show                        the whole workstream
  /schools/${a}/show   recorded, while the school is only at Research
  /schools/${b}/show   still being planned

Remove it with: npm run demo:clear`);
});
await db.close();
