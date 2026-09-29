import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/server/db";
import * as schools from "@/domain/schools";
import * as activity from "@/domain/activity";
import { stageName, stageColour } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, KV, Pill, Top, shortDate } from "@/ui/primitives";
import { page, flash, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/**
 * THE ACCOUNT — a container, not a pipeline object.
 *
 * It has no stage of its own. Four campuses at four different points is the normal
 * case, and collapsing them into one number was the bug this page exists to avoid.
 */
export default async function AccountPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);
  const { me, data } = await page(async (u) => {
    const account = await db.get("accounts", id);
    if (!account) return null;
    return {
      account,
      summary: await schools.accountSummary(id, u.id),
      people: await db.many(
        `select p.*, (select s.name from public.person_roles r
                        join public.schools s on s.id = r.school_id
                       where r.person_id = p.id and r.ended_on is null limit 1) as school_name
           from public.people p where p.account_id = ? order by p.name`, [id]),
      timeline: await activity.forAccount(id, 25),
    };
  });
  if (!data) notFound();
  const { account, summary, people, timeline } = data;

  return (
    <Shell me={me} path="/accounts">
      <Flash msg={msg} err={err} />
      <Top title={account.name as string}
           sub={[account.city, account.external_ref].filter(Boolean).join(" · ")}
           right={<Link className="btn grey"
                        href={`/pipeline?account=${id}&only=all`}>On the pipeline</Link>} />

      <div className="wgrid">
        {([["Schools", summary.schools.length, false],
           ["Active work", summary.active, false],
           ["Overdue", summary.overdue, summary.overdue > 0],
           ["Waiting on school", summary.waiting, false],
           ["Blocked", summary.blocked, summary.blocked > 0],
           ["Opportunities", summary.opportunities, false],
           ["On the show", summary.podcasts, false]] as [string, number, boolean][])
          .map(([k, v, hot]) => (
            <div className={`cell${hot ? " hot" : ""}`} key={k}>
              <div className="k">{k}</div><div className="v">{v}</div>
            </div>))}
      </div>

      <div className="pills" style={{ margin: "0 0 16px" }}>
        {Object.entries(summary.counts).sort(([, a], [, b]) => b - a).map(([k, n]) => (
          <Pill key={k} colour={stageColour(k)}>{stageName(k)}: {n}</Pill>))}
      </div>

      <div className="grid g-main">
        <div>
          <Card title={`Schools (${summary.schools.length})`}>
            {summary.schools.length === 0
              ? <Empty what="No school is recorded under this account, so there is nothing for people, work or opportunities to attach to." />
              : (
                <div className="rows">
                  {summary.schools.map((c) => (
                    <div className="row" key={c.id}>
                      <div className="grow">
                        <div className="t">
                          <Link href={`/schools/${c.id}`}>{c.name}</Link>
                        </div>
                        <div className="s">{c.location}</div>
                        <div className="s" style={{ marginTop: 3 }}>
                          <b>Owner:</b> {c.owner}
                          {c.podcast ? ` · Show: ${c.podcast}` : ""}
                          {c.commercial ? ` · Deal: ${c.commercial}` : ""}
                          {c.delivery ? ` · Delivery: ${c.delivery}` : ""}
                        </div>
                        <div className="s">
                          <b>Next:</b>{" "}
                          {c.next ?? (c.noNextAction
                            ? <span className="warnish">nothing written down</span>
                            : "nothing required yet")}
                        </div>
                      </div>
                      <div className="rt">
                        <Pill colour={stageColour(c.stageKey)}>{c.stage}</Pill>
                        <div className="s" style={{ marginTop: 4 }}>{c.slaText}</div>
                        <div style={{ marginTop: 4 }}>
                          {c.active > 0 && <Pill colour="slate">{c.active} active</Pill>}
                          {c.overdue > 0 && <> <Pill colour="red">
                            {c.overdue} overdue</Pill></>}
                        </div>
                        <div className="btns" style={{ marginTop: 6 }}>
                          <Link className="btn sm grey"
                                href={`/schools/${c.id}/people/new`}>+ Person</Link>
                          <Link className="btn sm" href={`/schools/${c.id}`}>Open</Link>
                        </div>
                      </div>
                    </div>))}
                </div>
              )}
            <p className="help" style={{ marginTop: 10 }}>
              Each school moves on its own. One campus can be a customer while another
              has never been contacted — the account does not have a stage.
            </p>
          </Card>

          <Card title={`People (${people.length})`}>
            {people.length === 0 ? <Empty what="Nobody is recorded against this account." />
              : (
                <div className="rows">
                  {people.map((p) => (
                    <div className="row" key={p.id as string}>
                      <div className="grow">
                        <div className="t">
                          <Link href={`/people/${p.id}`}>{p.name as string}</Link>
                        </div>
                        <div className="s">
                          {[p.title, p.school_name ?? "group level"]
                            .filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>))}
                </div>
              )}
          </Card>

          <Card title="What happened recently">
            {timeline.length === 0 ? <Empty what="Nothing logged yet." /> : (
              <ul className="tl">
                {timeline.map((a) => (
                  <li key={a.id as string}>
                    <span className="d">{shortDate(a.occurred_at as string)}</span>
                    <div className="grow">
                      <div>
                        {(a.outcome_label as string) || (a.activity_type as string)}
                        {a.school_name ? ` — ${a.school_name as string}` : ""}
                      </div>
                      <div className="s muted">{a.summary as string}</div>
                    </div>
                  </li>))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <Card title="The institution">
            <KV rows={[
              ["City", (account.city as string) ?? "—"],
              ["Reference", (account.external_ref as string) ?? "—"],
              ["Ownership", (account.ownership_type as string) ?? "—"],
              ["Source", (account.source as string) ?? "—"],
            ]} />
            {!!account.context_note && (
              <>
                <div className="lbl" style={{ marginTop: 12 }}>Why this account matters</div>
                <p style={{ margin: "2px 0 0" }}>{account.context_note as string}</p>
              </>)}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
