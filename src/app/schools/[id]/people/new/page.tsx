import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/server/db";
import * as people from "@/domain/people";
import Shell from "@/ui/Shell";
import { Breadcrumb, Card, Flash, Notice, Top } from "@/ui/primitives";
import { addPerson } from "@/app/actions";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** I met someone at the school. Record them before you forget. */
export default async function AddPerson(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const { me, data } = await page(async () => {
    const school = await db.get("schools", id);
    if (!school) return null;
    return {
      school,
      account: (await db.get("accounts", school.account_id as string))!,
      existing: await db.many(
        `select p.id, p.name from public.person_roles r
           join public.people p on p.id = r.person_id
          where r.school_id = ? and r.ended_on is null order by p.name`, [id]),
    };
  });
  if (!data) notFound();
  const { school, account, existing } = data;

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Breadcrumb account={{ id: account.id as string, name: account.name as string }}
                  school={{ id, name: school.name as string }} />
      <Top title="Add a person"
           sub={`You met someone at ${school.name}. Record them before you forget.`} />

      <form action={addPerson}>
        <input type="hidden" name="account_id" value={account.id as string} />
        <input type="hidden" name="school_id" value={id} />
        <div className="card">
          <div className="bd">
            <Notice kind="info">
              <b>Account:</b> {account.name as string}{" · "}
              <b>School:</b> {school.name as string}. Filled in for you — a person is
              identified by name <i>and</i> role <i>and</i> school, never by name alone.
            </Notice>

            <label htmlFor="name">Name <span className="req">*</span></label>
            <input id="name" name="name" required autoFocus
                   defaultValue={first(sp.name)} placeholder="Priya Sharma" />

            <label htmlFor="school_role">Their role at this school</label>
            <select id="school_role" name="school_role" defaultValue={first(sp.school_role)}>
              <option value="">— choose —</option>
              {people.ROLE_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {people.SCHOOL_ROLES.filter((r) => r.group === g).map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>))}
                </optgroup>))}
            </select>

            <label htmlFor="custom_role">Or type the title they actually use</label>
            <input id="custom_role" name="custom_role" defaultValue={first(sp.custom_role)}
                   placeholder="Dean — Academics, Creativity & Innovations" />
            <div className="help">What you type wins over the dropdown.</div>

            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" defaultValue={first(sp.phone)} />
            <label htmlFor="whatsapp">WhatsApp (if different)</label>
            <input id="whatsapp" name="whatsapp" defaultValue={first(sp.whatsapp)} />
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={first(sp.email)} />

            <fieldset>
              <legend>How they relate to Mintrix</legend>
              <div className="help">
                A different question from their role at the school. They may hold several.
              </div>
              {people.RELATIONSHIPS.map((r) => (
                <label className="cb" key={r.key}>
                  <input type="checkbox" name="relationships" value={r.key} />
                  <span>{r.name} <i>{r.what}</i></span>
                </label>))}
            </fieldset>

            <label htmlFor="relationship_status">Where the relationship stands</label>
            <select id="relationship_status" name="relationship_status" defaultValue="unknown">
              {people.RELATIONSHIP_STATUSES.map(([k, n, w]) => (
                <option key={k} value={k}>{n} — {w}</option>))}
            </select>

            <label htmlFor="discovered_how">How did you meet them?</label>
            <select id="discovered_how" name="discovered_how"
                    defaultValue={first(sp.discovered_how) || "school_visit"}>
              {people.DISCOVERY_ROUTES.map(([k, n]) => (
                <option key={k} value={k}>{n}</option>))}
            </select>

            {existing.length > 0 && (
              <>
                <label htmlFor="introduced_by">Introduced by</label>
                <select id="introduced_by" name="introduced_by" defaultValue="">
                  <option value="">nobody in particular</option>
                  {existing.map((p) => (
                    <option key={p.id as string} value={p.id as string}>
                      {p.name as string}</option>))}
                </select>
              </>
            )}

            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={3} defaultValue={first(sp.notes)}
                      placeholder="She runs admissions day to day and said the forms are re-keyed twice." />

            <div className="btns" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">Add person</button>
              <Link className="btn grey" href={`/schools/${id}`}>Cancel</Link>
            </div>
          </div>
        </div>
      </form>
    </Shell>
  );
}
