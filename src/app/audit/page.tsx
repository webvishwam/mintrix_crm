import Link from "next/link";
import * as db from "@/server/db";
import * as audit from "@/domain/audit";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, Pill, Top, shortDate } from "@/ui/primitives";
import { page, flash, first, type SP } from "@/ui/page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** WHO CHANGED THE SYSTEM. Separate from the activity timeline, which is what happened. */
export default async function AuditLog({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;

  const { me, data } = await page(async (u) => {
    if (u.role !== "founder") redirect("/?err=" +
      encodeURIComponent("The audit log is the founder's."));
    const rows = await audit.search({
      actorId: first(sp.actor) || null,
      action: first(sp.action) || null,
      schoolId: first(sp.school) || null,
      accountId: first(sp.account) || null,
      limit: 200,
    });
    return {
      rows,
      actors: await db.many(
        `select distinct p.id, p.full_name from public.audit_events a
           join public.profiles p on p.id = a.actor_id order by p.full_name`),
      actions: await db.many(
        "select action, count(*) n from public.audit_events group by action order by n desc"),
      school: first(sp.school) ? await db.get("schools", first(sp.school)) : null,
    };
  });

  const q = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
      actor: first(sp.actor), action: first(sp.action), school: first(sp.school),
      ...patch })) if (v) p.set(k, v);
    return `/audit?${p}`;
  };

  return (
    <Shell me={me} path="/audit">
      <Flash msg={msg} err={err} />
      <Top title={data.school ? `Audit log — ${data.school.name as string}` : "Audit log"}
           sub="Who changed what, when, and why. Append-only — no policy on this table permits an update or a delete, for anyone."
           right={data.school
             ? <Link className="btn grey" href="/audit">Everything</Link> : undefined} />

      <div className="tabs">
        <Link className={!first(sp.actor) && !first(sp.action) ? "on" : ""}
              href="/audit">All</Link>
        {data.actors.map((a) => (
          <Link key={a.id as string} className={first(sp.actor) === a.id ? "on" : ""}
                href={q({ actor: a.id as string })}>{a.full_name as string}</Link>))}
      </div>
      <div className="tabs">
        {data.actions.slice(0, 10).map((a) => (
          <Link key={a.action as string}
                className={first(sp.action) === a.action ? "on" : ""}
                href={q({ action: a.action as string })}>
            {String(a.action).replace(/_/g, " ").toLowerCase()} ({a.n as number})
          </Link>))}
      </div>

      <Card title={`${data.rows.length} event${data.rows.length === 1 ? "" : "s"}`}>
        {data.rows.length === 0 ? <Empty what="Nothing matches that filter." /> : (
          <div className="rows">
            {data.rows.map((a) => (
              <div className="row" key={String(a.id)}>
                <div className="grow">
                  <div className="t">
                    {String(a.action).replace(/_/g, " ").toLowerCase()}
                    {" — "}
                    {a.school_name
                      ? <Link href={`/schools/${a.school_id}`}>{a.school_name as string}</Link>
                      : a.account_name
                        ? <Link href={`/accounts/${a.account_id}`}>
                            {a.account_name as string}</Link>
                        : <span className="muted">{a.object_type as string}</span>}
                  </div>
                  <div className="s">
                    {a.actor_name as string} · {shortDate(a.occurred_at as string)}
                    {a.reason ? ` · ${a.reason as string}` : ""}
                  </div>
                  {(a.before_value || a.after_value) && (
                    <details>
                      <summary className="lk">Before and after</summary>
                      <div className="dbody">
                        <pre className="diff">
{JSON.stringify({ before: a.before_value, after: a.after_value }, null, 2)}
                        </pre>
                      </div>
                    </details>
                  )}
                </div>
                <div className="rt">
                  <Pill colour={String(a.action).includes("REVERT") ? "amber"
                    : String(a.action).includes("ROLE") ? "plum" : "slate"}>
                    {a.object_type as string}
                  </Pill>
                </div>
              </div>))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
