import Link from "next/link";
import * as db from "@/server/db";
import { stageName, stageColour } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, Pill, Top } from "@/ui/primitives";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

export default async function Accounts({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const q = first(sp.q);

  const CAP = 1000;
  const { me, data } = await page(async () => ({
    rows: await db.many(
    `select a.id, a.name, a.city,
            count(s.id) as schools,
            count(*) filter (where s.stage <> 'lead') as worked,
            min(s.stage::text) as any_stage
       from public.accounts a
       left join public.schools s on s.account_id = a.id
      ${q ? "where lower(a.name) like ?" : ""}
      group by a.id, a.name, a.city
      order by count(*) filter (where s.stage <> 'lead') desc, a.name
      limit ${CAP}`, q ? [`%${q.toLowerCase()}%`] : []),
    total: Number((await db.one(
      `select count(*) c from public.accounts a
        ${q ? "where lower(a.name) like ?" : ""}`,
      q ? [`%${q.toLowerCase()}%`] : []))!.c),
  }));
  const { rows, total } = data;

  return (
    <Shell me={me} path="/accounts">
      <Flash msg={msg} err={err} />
      <Top title="Accounts"
           sub="Institutions. Each one contains schools, and each school moves on its own." />
      <form method="get" className="searchrow">
        <input name="q" defaultValue={q} placeholder="Find an account" />
        <button className="btn grey" type="submit">Search</button>
      </form>
      <Card title={`${total} account${total === 1 ? "" : "s"}`}
            extra={rows.length < total
              ? `showing the first ${rows.length} — narrow the search to see the rest`
              : undefined}>
        {rows.length === 0 ? <Empty what="Nothing matches." /> : (
          <div className="rows">
            {rows.map((a) => (
              <div className="row" key={a.id as string}>
                <div className="grow">
                  <div className="t">
                    <Link href={`/accounts/${a.id}`}>{a.name as string}</Link>
                  </div>
                  <div className="s">
                    {[a.city, `${a.schools as number} school(s)`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="rt">
                  {Number(a.worked) > 0
                    ? <Pill colour="plum">{a.worked as number} being worked</Pill>
                    : <Pill colour="slate">untouched</Pill>}
                </div>
              </div>))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
