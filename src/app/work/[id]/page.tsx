import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/server/db";
import * as work from "@/domain/work";
import { TEAMS, WORKSTREAMS, teamName, workstreamName, stageName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, ContactButtons, Empty, Flash, KV, Notice, Pill, Top,
  dueText, shortDate,
} from "@/ui/primitives";
import { resolveWork, setWorkStatus, assignWork } from "@/app/actions";
import { page, flash, isStaff, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** One work item: what it is, whose move it is, what is blocking it, what done means. */
export default async function WorkItem(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);

  const { me, data } = await page(async () => {
    const t = await work.byId(id);
    if (!t) return null;
    return {
      t,
      who: await work.actionOwner(t),
      dep: await work.blockedBy(t),
      blocks: await work.withNames("w.depends_on_id = ?", [id]),
      account: await db.get("accounts", t.account_id as string),
      school: t.school_id ? await db.get("schools", t.school_id as string) : null,
      external: t.external_person_id
        ? await db.get("people", t.external_person_id as string) : null,
      owners: await db.many(
        `select p.id, p.full_name, r.team::text from public.profiles p
           join public.user_roles r on r.user_id = p.id
          where r.status = 'active' order by p.full_name`),
      history: await db.many(
        `select a.*, p.full_name as actor_name from public.activities a
           left join public.profiles p on p.id = a.logged_by
          where a.work_item_id = ? or (a.school_id = ? and a.school_id is not null)
          order by a.occurred_at desc limit 8`, [id, t.school_id ?? null]),
    };
  });
  if (!data) notFound();

  const { t, who, dep, blocks, account, school, external, owners, history } = data;
  const done = ["resolved", "cancelled"].includes(String(t.status));
  const mine = t.owner_id === me.id;

  return (
    <Shell me={me} path="/work">
      <Flash msg={msg} err={err} />
      {account && (
        <Breadcrumb account={{ id: account.id as string, name: account.name as string }}
                    school={school
                      ? { id: school.id as string, name: school.name as string } : null} />
      )}
      <Top title={t.title as string}
           sub={[workstreamName(t.workstream as string), teamName(t.team as string),
                 t.work_type === "ticket" ? "Operational work" : "Action"]
             .filter(Boolean).join(" · ")}
           right={school
             ? <Link className="btn grey" href={`/schools/${school.id}`}>The school</Link>
             : undefined} />

      <div className="pills" style={{ margin: "-8px 0 14px" }}>
        <Pill colour={done ? (t.status === "resolved" ? "green" : "slate") : "blue"}>
          {String(t.status).replace("_", " ")}
        </Pill>
        {!!t.blocking && <Pill colour="amber">blocking the stage</Pill>}
        {!!t.stage && <Pill colour="slate">required by {stageName(t.stage as string)}</Pill>}
      </div>

      <Card title="Who is expected to act">
        <KV rows={[
          ["Action owner", who.owner],
          ["Internal team", who.internal],
          ...(who.waitingOn ? [["Waiting on", who.waitingOn]] as
            [string, React.ReactNode][] : []),
          ...(who.external ? [["At the school", external
            ? <Link key="e" href={`/people/${external.id}`}>{who.external}</Link>
            : who.external]] as [string, React.ReactNode][] : []),
          ["Due", dueText(t.due_at as string)],
          ["SLA", `${t.sla_hours as number} hours`],
        ]} />
        {dep && (
          <Notice kind="warn" title="This is blocked by other work, not by its owner.">
            <Link href={`/work/${dep.id}`}>{dep.title as string}</Link> has to be
            resolved first.
          </Notice>
        )}
      </Card>

      <div className="grid g-main">
        <div>
          <Card title="What needs to happen">
            <p style={{ margin: 0 }}>{t.reason as string}</p>
            {!!t.required_outcome && (
              <>
                <div className="lbl" style={{ marginTop: 12 }}>Done means</div>
                <p style={{ margin: "2px 0 0" }}>{t.required_outcome as string}</p>
              </>
            )}
          </Card>

          {done ? (
            <Card title={t.status === "resolved" ? "Resolved" : "Cancelled"}>
              <KV rows={[
                ["Outcome", work.RESOLUTIONS.find(([k]) => k === t.resolution_kind)?.[1]
                  ?? (t.status === "cancelled" ? "Cancelled" : "Completed")],
                ["When", t.completed_at ? shortDate(t.completed_at as string) : "—"],
              ]} />
              {!!t.resolution_note && (
                <p style={{ marginTop: 10 }}>{t.resolution_note as string}</p>
              )}
              <p className="help" style={{ marginTop: 8 }}>
                It has left the active queue. It stays here permanently.
              </p>
            </Card>
          ) : (
            <>
              <Card title="Resolve this">
                <form action={resolveWork} className="form tight">
                  <input type="hidden" name="work_id" value={id} />
                  <label>What happened <span className="req">*</span>
                    <select name="kind" required defaultValue="completed">
                      {work.RESOLUTIONS.map(([k, name, what]) => (
                        <option key={k} value={k}>{name} — {what}</option>))}
                    </select>
                  </label>
                  <label>Resolution notes <span className="req">*</span>
                    <textarea name="note" rows={3} required
                              placeholder={(t.required_outcome as string)
                                ? `Say how "${t.required_outcome}" was met.`
                                : "What was actually done."} />
                  </label>
                  <details>
                    <summary className="lk">This produced something else to do</summary>
                    <div style={{ padding: "0 0 4px" }}>
                      <label>Follow-up<input name="follow_up_title" /></label>
                      <label>Why it is the right next thing
                        <input name="follow_up_reason" /></label>
                      <label>Who owns it
                        <select name="follow_up_owner" defaultValue={(t.owner_id as string) ?? ""}>
                          {owners.map((o) => (
                            <option key={o.id as string} value={o.id as string}>
                              {o.full_name as string}</option>))}
                        </select>
                      </label>
                    </div>
                  </details>
                  <div className="btns">
                    <button className="btn" type="submit">Confirm resolution</button>
                  </div>
                  <p className="help">
                    Opening something is not finishing it. The owner says what was done.
                  </p>
                </form>
              </Card>

              <details>
                <summary className="lk">
                  Park or cancel this — currently {String(t.status).replace("_", " ")}
                </summary>
                <form action={setWorkStatus} className="form tight">
                  <input type="hidden" name="work_id" value={id} />
                  <label>What is happening with it
                    <select name="status" defaultValue={t.status as string}>
                      {work.STATUSES.filter((s) => s.key !== "resolved").map((s) => (
                        <option key={s.key} value={s.key}>{s.name} — {s.what}</option>))}
                    </select>
                  </label>
                  <label>Waiting on / blocked by whom
                    <input name="waiting_on" defaultValue={(t.waiting_on as string) ?? ""}
                           placeholder="The school's admin office" /></label>
                  <label>Come back to it on
                    <input type="date" name="follow_up_on"
                           defaultValue={String(t.follow_up_on ?? "").slice(0, 10)} /></label>
                  <label>Why<input name="reason"
                           placeholder="They asked us to wait until after exams" /></label>
                  <div className="btns">
                    <button className="btn grey" type="submit">Update</button>
                  </div>
                  <p className="help">
                    Cancelled is not resolved. A call that was made and a meeting the
                    school refused are different facts, and the history keeps them apart.
                  </p>
                </form>
              </details>
            </>
          )}

          {blocks.length > 0 && (
            <Card title="This is holding up">
              {blocks.map((b) => (
                <div className="wrow" key={b.id as string}>
                  <div className="grow">
                    <div className="t">
                      <Link href={`/work/${b.id}`}>{b.title as string}</Link>
                    </div>
                    <div className="s">{b.owner_name as string}</div>
                  </div>
                </div>))}
            </Card>
          )}

          <Card title="What happened around this">
            {history.length === 0 ? <Empty what="Nothing logged yet." /> : (
              <ul className="tl">
                {history.map((a) => (
                  <li key={a.id as string}>
                    <span className="d">{shortDate(a.occurred_at as string)}</span>
                    <div className="grow">
                      <div>{(a.outcome_label as string) || (a.activity_type as string)}</div>
                      <div className="s muted">{a.summary as string}</div>
                    </div>
                  </li>))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <Card title="Context">
            <KV rows={[
              ...(account ? [["Account",
                <Link key="a" href={`/accounts/${account.id}`}>
                  {account.name as string}</Link>]] as [string, React.ReactNode][] : []),
              ...(school ? [["School",
                <Link key="s" href={`/schools/${school.id}`}>
                  {school.name as string}</Link>]] as [string, React.ReactNode][] : []),
              ["Workstream", workstreamName(t.workstream as string)],
              ["Requested by", (t.requester_name as string) ?? "—"],
              ["Raised", shortDate(t.created_at as string)],
            ]} />
          </Card>

          {external && (
            <Card title="At the school">
              <div className="t">
                <Link href={`/people/${external.id}`}>{external.name as string}</Link>
              </div>
              <div className="s">{(external.title as string) ?? ""}</div>
              <div style={{ marginTop: 6 }}><ContactButtons person={external} sm /></div>
            </Card>
          )}

          {!done && (mine || isStaff(me)) && (
            <Card title="Hand this to someone else">
              <form action={assignWork} className="form tight">
                <input type="hidden" name="work_id" value={id} />
                <label>New owner
                  <select name="owner_id" defaultValue={(t.owner_id as string) ?? ""}>
                    <option value="">Nobody — it will count as orphaned</option>
                    {owners.map((o) => (
                      <option key={o.id as string} value={o.id as string}>
                        {o.full_name as string} — {teamName(o.team as string)}
                      </option>))}
                  </select>
                </label>
                <label>Why<input name="reason" /></label>
                <div className="btns">
                  <button className="btn grey" type="submit">Reassign</button>
                </div>
              </form>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
