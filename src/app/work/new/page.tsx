import Link from "next/link";
import { redirect } from "next/navigation";
import * as db from "@/server/db";
import * as work from "@/domain/work";
import { TEAMS, WORKSTREAMS, teamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Breadcrumb, Card, Flash, Notice, Pill, Top } from "@/ui/primitives";
import { createWork } from "@/app/actions";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

const TYPES = ["call", "meeting", "visit", "research", "meeting_prep", "proposal",
               "discovery_meeting", "diagnostic", "podcast_record", "handoff",
               "po_chase", "payment_chase", "onboarding"];

/** Before creating work, show what already looks like it. Never auto-merge. */
export default async function NewWork({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const schoolId = first(sp.school) || null;
  const title = first(sp.title);

  const { me, data } = await page(async (u) => {
    const school = schoolId ? await db.get("schools", schoolId) : null;
    const accountId = school ? (school.account_id as string) : first(sp.account);
    const account = accountId ? await db.get("accounts", accountId) : null;
    if (!account) return null;
    return {
      school, account,
      similar: title ? await work.similar(account.id as string, title, schoolId) : [],
      people: school
        ? await db.many(
            `select p.id, p.name, p.title from public.person_roles r
               join public.people p on p.id = r.person_id
              where r.school_id = ? and r.ended_on is null order by p.name`, [schoolId])
        : await db.many("select id, name, title from public.people where account_id = ?",
                        [account.id]),
      owners: await db.many(
        `select p.id, p.full_name, r.team::text from public.profiles p
           join public.user_roles r on r.user_id = p.id
          where r.status='active' order by p.full_name`),
      open: await db.many(
        `select id, title from public.work_items where account_id = ?
           and status in ('open','in_progress','waiting','blocked')
          order by created_at desc limit 25`, [account.id]),
      myTeam: u.team,
    };
  });
  if (!data) redirect("/accounts");
  const { school, account, similar, people, owners, open, myTeam } = data;

  return (
    <Shell me={me} path="/work">
      <Flash msg={msg} err={err} />
      <Breadcrumb account={{ id: account.id as string, name: account.name as string }}
                  school={school
                    ? { id: school.id as string, name: school.name as string } : null} />
      <Top title="New work" sub={(school?.name ?? account.name) as string} />

      {similar.length > 0 && (
        <Card title="Similar work is already open">
          <Notice kind="warn" title="This may already be somebody's job.">
            Nothing has been created. Open the existing item, or carry on.
          </Notice>
          <div className="rows">
            {similar.map((t) => (
              <div className="row" key={t.id as string}>
                <div className="grow">
                  <div className="t">
                    <Link href={`/work/${t.id}`}>{t.title as string}</Link>
                  </div>
                  <div className="s">
                    {teamName(t.team as string)} · {String(t.status).replace("_", " ")}
                  </div>
                </div>
                <div className="rt">
                  <Link className="btn sm grey" href={`/work/${t.id}`}>Open existing</Link>
                </div>
              </div>))}
          </div>
        </Card>
      )}

      <form action={createWork}>
        <input type="hidden" name="account_id" value={account.id as string} />
        {school && <input type="hidden" name="school_id" value={school.id as string} />}
        <div className="card">
          <div className="bd">
            {school && (
              <Notice kind="info">
                <b>Account:</b> {account.name as string}{" · "}
                <b>School:</b> {school.name as string}. Work with no school is work
                nobody can trace.
              </Notice>
            )}

            <label htmlFor="title">What needs doing? <span className="req">*</span></label>
            <input id="title" name="title" required defaultValue={title} autoFocus
                   placeholder="Prepare the recording setup for Sunbeam Bhagwanpur" />
            <div className="help">
              A verb and an object. "Follow up" is rejected — it is not an action.
            </div>

            <label htmlFor="reason">Why is this the right thing? <span className="req">*</span></label>
            <textarea id="reason" name="reason" required
                      placeholder="Recording is Thursday and the kit has not been checked since the last shoot." />

            <label htmlFor="required_outcome">Done means</label>
            <textarea id="required_outcome" name="required_outcome" rows={2}
                      placeholder="Camera, audio and lighting confirmed for the date and location." />
            <div className="help">Write this where "done" is not obvious.</div>

            <label htmlFor="team">Which team</label>
            <select id="team" name="team" defaultValue={myTeam ?? "sales"}>
              {TEAMS.map((t) => (
                <option key={t.key} value={t.key}>{t.name} — {t.what}</option>))}
            </select>

            <label htmlFor="owner_id">Who owns it</label>
            <select id="owner_id" name="owner_id" defaultValue={me.id}>
              {owners.map((o) => (
                <option key={o.id as string} value={o.id as string}>
                  {o.full_name as string} — {teamName(o.team as string)}
                </option>))}
            </select>
            <div className="help">
              The team is the group responsible. The owner is the person accountable.
            </div>

            <label htmlFor="workstream">Workstream</label>
            <select id="workstream" name="workstream" defaultValue="acquisition">
              {WORKSTREAMS.map((w) => (
                <option key={w.key} value={w.key}>{w.name} — {w.what}</option>))}
            </select>

            <label htmlFor="task_type">Type</label>
            <select id="task_type" name="task_type" defaultValue="call">
              {TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>))}
            </select>

            <label htmlFor="external_person_id">Who at the school we need</label>
            <select id="external_person_id" name="external_person_id" defaultValue="">
              <option value="">nobody — this is internal work</option>
              {people.map((p) => (
                <option key={p.id as string} value={p.id as string}>
                  {p.name as string}{p.title ? ` — ${p.title as string}` : ""}
                </option>))}
            </select>

            <label htmlFor="depends_on">Waits for other work</label>
            <select id="depends_on" name="depends_on" defaultValue="">
              <option value="">nothing — it can start now</option>
              {open.map((t) => (
                <option key={t.id as string} value={t.id as string}>
                  {t.title as string}</option>))}
            </select>

            <label htmlFor="sla_hours">Allow how long (hours)</label>
            <input id="sla_hours" name="sla_hours" type="number" min="1"
                   defaultValue={48} style={{ maxWidth: 120 }} />

            <div className="btns" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">Create the work</button>
              <Link className="btn grey"
                    href={school ? `/schools/${school.id}` : `/accounts/${account.id}`}>
                Cancel</Link>
            </div>
          </div>
        </div>
      </form>
    </Shell>
  );
}
