import Link from "next/link";
import * as db from "@/server/db";
import { stageName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Flash, Notice, Pill, Top } from "@/ui/primitives";
import { page, flash, type SP } from "@/ui/page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Exceptions only. A health page that lists everything is a second inbox. */
export default async function Health({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const { me, data } = await page(async (u) => {
    if (u.role === "external") redirect("/work");
    const q = (sql: string, args: unknown[] = []) => db.many(sql, args);
    return {
      noNext: await q(
        `select s.id, s.name, s.stage::text, a.name as account_name
           from public.schools s join public.accounts a on a.id = s.account_id
          where s.stage not in ('lead','nurture','disqualified','lost')
            and not exists (select 1 from public.work_items w
                             where w.school_id = s.id and w.status in ('open','in_progress'))
          order by s.name limit 100`),
      noOwner: await q(
        `select s.id, s.name, s.stage::text, a.name as account_name
           from public.schools s join public.accounts a on a.id = s.account_id
          where s.owner_id is null
            and s.stage not in ('lead','nurture','disqualified','lost') limit 100`),
      stale: await q(
        `select s.id, s.name, s.stage::text, a.name as account_name,
                coalesce(max(ac.occurred_at), s.stage_entered_at) as last_touch
           from public.schools s join public.accounts a on a.id = s.account_id
           left join public.activities ac on ac.school_id = s.id
          where s.stage not in ('lead','nurture','disqualified','lost')
          group by s.id, s.name, s.stage, a.name, s.stage_entered_at
         having coalesce(max(ac.occurred_at), s.stage_entered_at) < now() - interval '7 days'
          order by 5 limit 100`),
      overdue: await q(
        `select w.id, w.title, w.due_at, s.name as school_name, p.full_name as owner
           from public.work_items w
           left join public.schools s on s.id = w.school_id
           left join public.profiles p on p.id = w.owner_id
          where w.status in ('open','in_progress') and w.due_at < now()
          order by w.due_at limit 100`),
      orphanWork: await q(
        `select w.id, w.title from public.work_items w
          where w.status in ('open','in_progress','waiting','blocked')
            and (w.owner_id is null or w.team is null) limit 50`),
      overrides: await q(
        `select t.*, s.name as school_name, p.full_name as by_name
           from public.stage_transitions t
           left join public.schools s on s.id = t.subject_id
           left join public.profiles p on p.id = t.moved_by
          where t.overridden = true order by t.moved_at desc limit 30`),
      dupes: await q(
        `select id, incoming_name, existing_name, confidence, reason
           from public.duplicate_reviews where status = 'open'
          order by case confidence when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end
          limit 50`),
    };
  });

  const sections: [string, number, string, React.ReactNode][] = [
    ["Schools being worked with no next action", data.noNext.length,
     "A school in the pipeline with nothing scheduled is not being worked, whatever the stage says.",
     data.noNext.map((s) => (
       <div className="row" key={s.id as string}>
         <div className="grow">
           <div className="t"><Link href={`/schools/${s.id}`}>{s.name as string}</Link></div>
           <div className="s">{s.account_name as string} · {stageName(s.stage as string)}</div>
         </div>
       </div>))],
    ["Schools in play with no owner", data.noOwner.length,
     "Every school in play needs a named human.",
     data.noOwner.map((s) => (
       <div className="row" key={s.id as string}>
         <div className="grow">
           <div className="t"><Link href={`/schools/${s.id}`}>{s.name as string}</Link></div>
           <div className="s">{s.account_name as string}</div>
         </div>
       </div>))],
    ["Sitting still for more than a week", data.stale.length,
     "Not moved automatically and not closed automatically — just visible.",
     data.stale.map((s) => (
       <div className="row" key={s.id as string}>
         <div className="grow">
           <div className="t"><Link href={`/schools/${s.id}`}>{s.name as string}</Link></div>
           <div className="s">
             {stageName(s.stage as string)} · last touched{" "}
             {String(s.last_touch).slice(0, 10)}
           </div>
         </div>
       </div>))],
    ["Overdue work", data.overdue.length, "Past its SLA and still open.",
     data.overdue.map((w) => (
       <div className="row" key={w.id as string}>
         <div className="grow">
           <div className="t"><Link href={`/work/${w.id}`}>{w.title as string}</Link></div>
           <div className="s">
             {[w.school_name, w.owner].filter(Boolean).join(" · ")}
           </div>
         </div>
       </div>))],
    ["Work nobody can act on", data.orphanWork.length,
     "No owner or no team. Work that does not happen.",
     data.orphanWork.map((w) => (
       <div className="row" key={w.id as string}>
         <div className="grow">
           <div className="t"><Link href={`/work/${w.id}`}>{w.title as string}</Link></div>
         </div>
       </div>))],
    ["Stage moves made by override", data.overrides.length,
     "A gate was skipped on purpose. Read the reason and decide whether it still holds.",
     data.overrides.map((t) => (
       <div className="row" key={t.id as string}>
         <div className="grow">
           <div className="t">
             <Link href={`/schools/${t.subject_id}`}>{t.school_name as string}</Link>
           </div>
           <div className="s">
             {stageName(t.from_stage as string)} → {stageName(t.to_stage as string)} ·{" "}
             {t.by_name as string} · {t.override_reason as string}
           </div>
         </div>
       </div>))],
    ["Possible duplicates waiting on a decision", data.dupes.length,
     "Flagged at import. Nothing was merged.",
     data.dupes.map((d) => (
       <div className="row" key={d.id as string}>
         <div className="grow">
           <div className="t">{d.incoming_name as string}</div>
           <div className="s">
             looks like {(d.existing_name as string) ?? "—"} · {d.reason as string}
           </div>
         </div>
         <div className="rt"><Pill colour={d.confidence === "HIGH" ? "red" : "amber"}>
           {d.confidence as string}</Pill></div>
       </div>))],
  ];

  const clean = sections.every(([, n]) => n === 0);

  return (
    <Shell me={me} path="/health">
      <Flash msg={msg} err={err} />
      <Top title="CRM health" sub="Exceptions only — the things that need a decision." />
      {clean && (
        <Notice kind="ok" title="Nothing needs attention.">
          Every school in play has an owner and a next action, no work is overdue, and
          nothing is waiting on a duplicate decision.
        </Notice>
      )}
      {sections.filter(([, n]) => n > 0).map(([title, n, why, rows]) => (
        <Card key={title} title={title} extra={<Pill colour="amber">{n}</Pill>}>
          <p className="help" style={{ marginTop: 0 }}>{why}</p>
          <div className="rows">{rows}</div>
        </Card>))}
    </Shell>
  );
}
