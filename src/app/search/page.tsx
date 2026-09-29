import Link from "next/link";
import * as db from "@/server/db";
import { stageName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Empty, Notice, Pill, Top } from "@/ui/primitives";
import { page, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** A result without context is not an answer. Two Priya Sharmas must be tellable apart. */
export default async function Search({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = first(sp.q).trim();

  const { me, data } = await page(async () => {
    if (q.length < 2) return { people: [], schools: [], accounts: [], work: [] };
    const like = `%${q.toLowerCase()}%`;
    const numeric = q.replace(/\D/g, "");
    return {
      people: await db.many(
        `select p.id, p.name, p.title, p.phone, p.email, a.name as account_name,
                (select s.name from public.person_roles r
                   join public.schools s on s.id = r.school_id
                  where r.person_id = p.id and r.ended_on is null limit 1) as school_name,
                (select coalesce(r.custom_role, r.school_role) from public.person_roles r
                  where r.person_id = p.id and r.ended_on is null limit 1) as role,
                (select count(*) from public.people d
                  where lower(d.name) = lower(p.name)) as namesakes
           from public.people p join public.accounts a on a.id = p.account_id
          where lower(p.name) like ? or lower(coalesce(p.email,'')) like ?
             ${numeric.length >= 4 ? "or regexp_replace(coalesce(p.phone,''),'\\D','','g') like ?" : ""}
          limit 30`,
        numeric.length >= 4 ? [like, like, `%${numeric}%`] : [like, like]),
      schools: await db.many(
        `select s.id, s.name, s.stage::text, s.locality, s.city, s.udise_code,
                a.name as account_name, o.full_name as owner
           from public.schools s join public.accounts a on a.id = s.account_id
           left join public.profiles o on o.id = s.owner_id
          where lower(s.name) like ? or coalesce(s.udise_code,'') like ?
             or coalesce(s.affiliation_number,'') like ?
             or lower(coalesce(s.city,'')) like ?
             or lower(coalesce(s.locality,'')) like ?
          order by s.name limit 30`, [like, `%${q}%`, `%${q}%`, like, like]),
      accounts: await db.many(
        "select id, name, city from public.accounts where lower(name) like ? limit 20", [like]),
      work: await db.many(
        `select w.id, w.title, w.status::text, s.name as school_name
           from public.work_items w left join public.schools s on s.id = w.school_id
          where lower(w.title) like ? limit 20`, [like]),
    };
  });

  const dupNames = new Set(data.people.filter((p) => Number(p.namesakes) > 1)
    .map((p) => String(p.name).toLowerCase()));
  const total = data.people.length + data.schools.length + data.accounts.length
    + data.work.length;

  return (
    <Shell me={me} path="/search">
      <Top title={q ? `"${q}"` : "Search"}
           sub={q.length >= 2 ? `${total} result${total === 1 ? "" : "s"}`
             : "Names, phone numbers, email addresses, UDISE codes."} />
      <Card title="Search">
        <form method="get">
          <label htmlFor="q">What are you looking for?</label>
          <input id="q" name="q" defaultValue={q} autoFocus
                 placeholder="Sunbeam, Sigra, Priya Sharma, 9876543210" />
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="btn" type="submit">Search</button>
          </div>
        </form>
      </Card>

      {q.length >= 2 && total === 0 && (
        <Card title="Nothing found">
          <Empty what={`No person, school, account or work item matches "${q}".`} />
        </Card>
      )}

      {data.people.length > 0 && (
        <Card title="People">
          {dupNames.size > 0 && (
            <Notice kind="warn" title="More than one person here shares a name.">
              They are separate records. Read the role and the school before picking one.
            </Notice>
          )}
          {data.people.map((p) => (
            <Link className="sr" key={p.id as string} href={`/people/${p.id}`}>
              <div className="st">
                {p.name as string}
                {dupNames.has(String(p.name).toLowerCase()) && (
                  <> <Pill colour="amber">shares this name</Pill></>)}
              </div>
              <div className="sc">
                {[(p.role as string) ?? (p.title as string),
                  (p.school_name as string) ?? "group level",
                  p.account_name as string].filter(Boolean).join(" · ")}
              </div>
              <div className="sm">{[p.phone, p.email].filter(Boolean).join(" · ")}</div>
            </Link>))}
        </Card>
      )}

      {data.schools.length > 0 && (
        <Card title="Schools">
          {data.schools.map((s) => (
            <Link className="sr" key={s.id as string} href={`/schools/${s.id}`}>
              <div className="st">{s.name as string}</div>
              <div className="sc">{s.account_name as string}</div>
              <div className="sm">
                {[stageName(s.stage as string), s.locality, s.city,
                  s.owner ? `owner ${s.owner as string}` : null,
                  s.udise_code ? `UDISE ${s.udise_code as string}` : null]
                  .filter(Boolean).join(" · ")}
              </div>
            </Link>))}
        </Card>
      )}

      {data.accounts.length > 0 && (
        <Card title="Accounts">
          {data.accounts.map((a) => (
            <Link className="sr" key={a.id as string} href={`/accounts/${a.id}`}>
              <div className="st">{a.name as string}</div>
              <div className="sm">{(a.city as string) ?? ""}</div>
            </Link>))}
        </Card>
      )}

      {data.work.length > 0 && (
        <Card title="Work">
          {data.work.map((w) => (
            <Link className="sr" key={w.id as string} href={`/work/${w.id}`}>
              <div className="st">{w.title as string}</div>
              <div className="sm">
                {[(w.school_name as string), String(w.status).replace("_", " ")]
                  .filter(Boolean).join(" · ")}
              </div>
            </Link>))}
        </Card>
      )}
    </Shell>
  );
}
