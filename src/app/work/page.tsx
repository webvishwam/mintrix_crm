import Link from "next/link";
import * as db from "@/server/db";
import * as work from "@/domain/work";
import { TEAMS, WORKSTREAMS, teamName, workstreamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, Pill, Top, dueText } from "@/ui/primitives";
import { page, flash, first, isStaff, isFounder, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** One work system, different views. Never a second work database. */
export default async function WorkPage({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;

  const { me, data } = await page(async (u) => {
    const view = first(sp.view) || "mine";
    const only = first(sp.only);
    const mine = await work.mine(u.id);
    if (view === "mine" || u.role === "external") {
      return { view: "mine", only, mine, rows: [], overview: null, orphans: [] };
    }
    const where = [`w.status in ${work.ACTIVE}`];
    const args: unknown[] = [];
    if (TEAMS.some((t) => t.key === view)) {
      where.push("w.team = ?::mintrix_team"); args.push(view);
    }
    if (first(sp.workstream)) {
      where.push("w.workstream = ?::workstream"); args.push(first(sp.workstream));
    }
    if (only === "overdue") where.push("w.status in ('open','in_progress') and w.due_at < now()");
    else if (only === "waiting") where.push("w.status = 'waiting'");
    else if (only === "blocked") where.push("w.status = 'blocked'");
    const rows = await work.withNames(where.join(" and "), args);
    const all = await db.many(
      `select team::text, workstream::text, status::text, due_at from public.work_items
        where status in ${work.ACTIVE}`);
    const now = new Date();
    const overdue = (r: db.Row) => ["open", "in_progress"].includes(String(r.status))
      && new Date(r.due_at as string) < now;
    return {
      view, only, mine, rows,
      overview: {
        total: all.length,
        overdue: all.filter(overdue).length,
        waiting: all.filter((r) => r.status === "waiting").length,
        blocked: all.filter((r) => r.status === "blocked").length,
        teams: TEAMS.map((t) => ({ ...t,
          active: all.filter((r) => r.team === t.key).length,
          overdue: all.filter((r) => r.team === t.key && overdue(r)).length }))
          .filter((t) => t.active > 0),
        streams: WORKSTREAMS.map((w) => ({ ...w,
          active: all.filter((r) => r.workstream === w.key).length }))
          .filter((w) => w.active > 0),
      },
      orphans: u.role === "founder" ? await work.orphaned() : [],
    };
  });

  const { view, only, mine, rows, overview, orphans } = data;
  const Row = ({ t }: { t: db.Row }) => (
    <div className="wrow">
      <div className={`mark ${t.status === "blocked" ? "stop"
        : t.status === "waiting" ? "warn" : "open"}`}>
        {t.status === "blocked" ? "⊘" : t.status === "waiting" ? "⚠"
          : t.status === "in_progress" ? "●" : "○"}
      </div>
      <div className="grow">
        <div className="t"><Link href={`/work/${t.id}`}>{t.title as string}</Link></div>
        <div className="s">
          {[t.owner_name, teamName(t.team as string),
            workstreamName(t.workstream as string), t.school_name]
            .filter(Boolean).join(" · ")}
        </div>
        {t.status === "waiting" && (
          <div className="s">Waiting on {(t.waiting_on as string) ?? "the school"}</div>
        )}
      </div>
      <div className="rt"><span className="s">{dueText(t.due_at as string)}</span></div>
    </div>
  );

  return (
    <Shell me={me} path="/work">
      <Flash msg={msg} err={err} />
      <Top title={view === "mine" ? "My work" : "Team work"}
           sub={view === "mine"
             ? "Everything you own, whatever it is attached to."
             : "What each team is actually doing right now."} />

      {isStaff(me) && (
        <div className="tabs">
          <Link className={view === "mine" ? "on" : ""} href="/work?view=mine">My work</Link>
          <Link className={view === "all" ? "on" : ""} href="/work?view=all">Everyone</Link>
          {TEAMS.map((t) => (
            <Link key={t.key} className={view === t.key ? "on" : ""}
                  href={`/work?view=${t.key}`}>{t.name}</Link>))}
        </div>
      )}

      {view === "mine" ? (
        <>
          <div className="wgrid">
            {([["Overdue", mine.overdue.length, true], ["Today", mine.today.length, false],
               ["Upcoming", mine.upcoming.length, false],
               ["Waiting", mine.waiting.length, false],
               ["Blocked", mine.blocked.length, true],
               ["Resolved today", mine.resolvedToday.length, false]] as
               [string, number, boolean][]).map(([k, v, hot]) => (
              <div className={`cell${hot && v > 0 ? " hot" : ""}`} key={k}>
                <div className="k">{k}</div><div className="v">{v}</div>
              </div>))}
          </div>
          {([["Overdue", mine.overdue], ["Today", mine.today],
             ["Upcoming", mine.upcoming], ["Waiting on somebody else", mine.waiting],
             ["Blocked", mine.blocked]] as [string, db.Row[]][])
            .filter(([, r]) => r.length)
            .map(([label, r]) => (
              <Card key={label} title={label} extra={<Pill>{r.length}</Pill>}>
                {r.map((t) => <Row key={t.id as string} t={t} />)}
              </Card>))}
          {!mine.overdue.length && !mine.today.length && !mine.upcoming.length
            && !mine.waiting.length && !mine.blocked.length && (
            <Card title="Nothing open">
              <Empty what="Nothing is assigned to you."
                action={isStaff(me)
                  ? <Link className="btn" href="/pipeline">Open the pipeline</Link> : null} />
            </Card>)}
        </>
      ) : (
        <>
          {overview && (
            <>
              <div className="wgrid">
                {([["Active", overview.total, false],
                   ["Overdue", overview.overdue, true],
                   ["Waiting on school", overview.waiting, false],
                   ["Blocked", overview.blocked, true]] as [string, number, boolean][])
                  .map(([k, v, hot]) => (
                    <div className={`cell${hot && v > 0 ? " hot" : ""}`} key={k}>
                      <div className="k">{k}</div><div className="v">{v}</div>
                    </div>))}
              </div>
              <Card title="By team">
                <div className="rows">
                  {overview.teams.map((t) => (
                    <div className="row" key={t.key}>
                      <div className="grow">
                        <div className="t">
                          <Link href={`/work?view=${t.key}`}>{t.name}</Link>
                        </div>
                        <div className="s">{t.active} active · {t.what}</div>
                      </div>
                      <div className="rt">
                        {t.overdue > 0 ? <Pill colour="red">{t.overdue} overdue</Pill>
                          : <Pill colour="green">on track</Pill>}
                      </div>
                    </div>))}
                </div>
              </Card>
            </>
          )}
          <div className="tabs">
            <Link className={!only ? "on" : ""} href={`/work?view=${view}`}>Everything</Link>
            {["overdue", "waiting", "blocked"].map((k) => (
              <Link key={k} className={only === k ? "on" : ""}
                    href={`/work?view=${view}&only=${k}`}>{k}</Link>))}
            {WORKSTREAMS.map((w) => (
              <Link key={w.key} href={`/work?view=${view}&workstream=${w.key}`}>
                {w.name}
              </Link>))}
          </div>
          <Card title={view === "all" ? `All work (${rows.length})`
                                      : `${teamName(view)} (${rows.length})`}>
            {rows.length === 0 ? <Empty what="Nothing matches that view." />
              : rows.map((t) => <Row key={t.id as string} t={t} />)}
          </Card>
          {isFounder(me) && (
            <Card title="Work that cannot be acted on">
              {orphans.length === 0
                ? <p style={{ margin: 0 }}>
                    Everything open has an owner, a team and a context.
                  </p>
                : (
                  <div className="rows">
                    {orphans.slice(0, 25).map(({ item, why }) => (
                      <div className="row" key={item.id as string}>
                        <div className="grow">
                          <div className="t">
                            <Link href={`/work/${item.id}`}>{item.title as string}</Link>
                          </div>
                          <div className="s">{why.join(" · ")}</div>
                        </div>
                        <div className="rt"><Pill colour="amber">Orphaned</Pill></div>
                      </div>))}
                  </div>
                )}
            </Card>
          )}
        </>
      )}
    </Shell>
  );
}
