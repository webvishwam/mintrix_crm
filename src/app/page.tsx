import Link from "next/link";
import * as work from "@/domain/work";
import * as db from "@/server/db";
import Shell from "@/ui/Shell";
import {
  Card, Empty, Flash, Pill, Top, dueText, Breadcrumb,
} from "@/ui/primitives";
import { page, flash, isStaff, type SP } from "@/ui/page";
import { stageName } from "@/domain/journey";

export const dynamic = "force-dynamic";

/** WHAT NEEDS MY ATTENTION? Actionable, not a productivity dashboard. */
export default async function MyDay({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const { me, data } = await page(async (u) => {
    const mine = await work.mine(u.id);
    const schools = isStaff({ ...u })
      ? await db.many(
          `select s.id, s.name, s.stage::text, a.name as account_name
             from public.schools s join public.accounts a on a.id = s.account_id
            where s.owner_id = ? and s.stage not in ('lead','nurture','disqualified','lost')
            order by s.stage_entered_at desc limit 12`, [u.id])
      : [];
    return { mine, schools };
  });

  const { mine, schools } = data;
  const nothing = !mine.overdue.length && !mine.today.length && !mine.upcoming.length
    && !mine.waiting.length && !mine.blocked.length;

  const Row = ({ t }: { t: db.Row }) => (
    <div className="wrow">
      <div className="grow">
        <div className="t"><Link href={`/work/${t.id}`}>{t.title as string}</Link></div>
        <div className="s">
          {[t.account_name, t.school_name, t.owner_name].filter(Boolean).join(" · ")}
        </div>
        <div className="s">{t.reason as string}</div>
        {t.status === "waiting" && (
          <div className="s">
            Waiting on {(t.waiting_on as string) ?? "the school"}
            {t.follow_up_on ? ` · chase ${String(t.follow_up_on).slice(0, 10)}` : ""}
          </div>
        )}
      </div>
      <div className="rt"><span className="s">{dueText(t.due_at as string)}</span></div>
    </div>
  );

  return (
    <Shell me={me} path="/">
      <Flash msg={msg} err={err} />
      <Top title="My day"
           sub={nothing ? "Nothing is due and nothing is overdue."
                        : "What needs your attention, in order."} />

      {([["Overdue", mine.overdue, "red"], ["Today", mine.today, "plum"],
         ["Waiting on somebody else", mine.waiting, "amber"],
         ["Blocked", mine.blocked, "red"],
         ["Coming up", mine.upcoming, "slate"]] as const)
        .filter(([, rows]) => rows.length)
        .map(([label, rows, colour]) => (
          <Card key={label} title={label}
                extra={<Pill colour={colour}>{rows.length}</Pill>}>
            {rows.map((t) => <Row key={t.id as string} t={t} />)}
          </Card>
        ))}

      {nothing && (
        <Card title="Nothing is due">
          <Empty
            what={isStaff(me)
              ? "Nothing is assigned to you right now. Pick up a school from the pipeline."
              : "No work is assigned to you right now."}
            action={isStaff(me)
              ? <Link className="btn" href="/pipeline">Open the school pipeline</Link>
              : null} />
        </Card>
      )}

      {!!mine.resolvedToday.length && (
        <Card title="Resolved today"
              extra={<Pill colour="green">{mine.resolvedToday.length}</Pill>}>
          {mine.resolvedToday.map((t) => (
            <div className="wrow" key={t.id as string}>
              <div className="mark done">✓</div>
              <div className="grow">
                <div className="t">{t.title as string}</div>
                <div className="s">{t.resolution_note as string}</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {!!schools.length && (
        <Card title="My schools"
              extra={<Link className="btn sm grey" href="/pipeline?only=mine">
                The pipeline
              </Link>}>
          <div className="rows">
            {schools.map((s) => (
              <div className="row" key={s.id as string}>
                <div className="grow">
                  <div className="t">
                    <Link href={`/schools/${s.id}`}>{s.name as string}</Link>
                  </div>
                  <div className="s">{s.account_name as string}</div>
                </div>
                <div className="rt"><Pill>{stageName(s.stage as string)}</Pill></div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Shell>
  );
}
