import Link from "next/link";
import * as db from "@/server/db";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, Pill, Top } from "@/ui/primitives";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

export default async function People({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const q = first(sp.q);
  const CAP = 1000;
  const { me, data } = await page(async () => ({
    rows: await db.many(
    `select p.id, p.name, p.title, p.phone, p.email, a.name as account_name,
            (select s.name from public.person_roles r
               join public.schools s on s.id = r.school_id
              where r.person_id = p.id and r.ended_on is null limit 1) as school_name,
            (select count(*) from public.people d where lower(d.name) = lower(p.name)) as namesakes
       from public.people p join public.accounts a on a.id = p.account_id
      ${q ? "where lower(p.name) like ? or p.phone like ? or lower(p.email) like ?" : ""}
      order by p.name limit ${CAP}`,
    q ? [`%${q.toLowerCase()}%`, `%${q}%`, `%${q.toLowerCase()}%`] : []),
    total: Number((await db.one(
      `select count(*) c from public.people p
        ${q ? "where lower(p.name) like ? or p.phone like ? or lower(p.email) like ?" : ""}`,
      q ? [`%${q.toLowerCase()}%`, `%${q}%`, `%${q.toLowerCase()}%`] : []))!.c),
  }));
  const { rows, total } = data;

  return (
    <Shell me={me} path="/people">
      <Flash msg={msg} err={err} />
      <Top title="People"
           sub="Name, role, school and account together — a name on its own identifies nobody." />
      <form method="get" className="searchrow">
        <input name="q" defaultValue={q} placeholder="Name, phone or email" />
        <button className="btn grey" type="submit">Search</button>
      </form>
      <Card title={`${total} ${total === 1 ? "person" : "people"}`}
            extra={rows.length < total
              ? `showing the first ${rows.length} — narrow the search to see the rest`
              : undefined}>
        {rows.length === 0 ? <Empty what="Nothing matches." /> : (
          <div className="rows">
            {rows.map((p) => (
              <div className="row" key={p.id as string}>
                <div className="grow">
                  <div className="t">
                    <Link href={`/people/${p.id}`}>{p.name as string}</Link>
                    {Number(p.namesakes) > 1 && (
                      <> <Pill colour="amber">shares this name</Pill></>)}
                  </div>
                  <div className="s">
                    {[p.title, p.school_name ?? "group level", p.account_name]
                      .filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
