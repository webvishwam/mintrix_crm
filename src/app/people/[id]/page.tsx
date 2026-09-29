import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/server/db";
import * as people from "@/domain/people";
import { stageName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, ContactButtons, Empty, Flash, KV, Notice, Pill, Top, dateOnly,
} from "@/ui/primitives";
import { updatePerson, linkPerson, endAssociation } from "@/app/actions";
import { page, flash, isFounder, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

export default async function PersonPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);
  const { me, data } = await page(async () => {
    const ctx = await people.context(id);
    if (!ctx) return null;
    const linked = new Set(ctx.associations.map((a) => a.school_id));
    return {
      ctx,
      otherSchools: (await db.many(
        "select id, name from public.schools where account_id = ? order by name",
        [ctx.account.id])).filter((s) => !linked.has(s.id as string)),
      work: await db.many(
        `select id, title, status::text, due_at from public.work_items
          where person_id = ? or external_person_id = ?
            and status in ('open','in_progress','waiting','blocked')
          order by due_at limit 10`, [id, id]),
    };
  });
  if (!data) notFound();
  const { ctx, otherSchools, work } = data;
  const first = ctx.associations[0];

  return (
    <Shell me={me} path="/people">
      <Flash msg={msg} err={err} />
      <Breadcrumb account={{ id: ctx.account.id as string, name: ctx.account.name as string }}
                  school={first ? { id: first.school_id, name: first.school_name } : null} />
      <Top title={ctx.person.name as string}
           sub={ctx.identity.replace(`${ctx.person.name} — `, "")}
           right={<ContactButtons person={ctx.person} />} />

      {!!ctx.person.do_not_contact && (
        <Notice kind="err" title="Do not contact.">
          This person has asked not to be contacted.
        </Notice>
      )}

      <Card title="What now?">
        <div className="btns">
          <ContactButtons person={ctx.person} />
          {first && (
            <Link className="btn grey" href={`/schools/${first.school_id}`}>
              Open their school
            </Link>
          )}
          <Link className="btn grey"
                href={`/work/new?school=${first?.school_id ?? ""}&person=${id}`}>
            + Create work
          </Link>
        </div>
      </Card>

      <div className="grid g-main">
        <div>
          <Card title="Where they belong">
            {ctx.associations.length === 0 ? (
              <Empty what="Not attached to any school, so nobody can tell which school they speak for." />
            ) : ctx.associations.map((a) => (
              <div className="wrow" key={a.id as string}>
                <div className="grow">
                  <div className="t">
                    <b>{a.role_label}</b> at{" "}
                    <Link href={`/schools/${a.school_id}`}>{a.school_name}</Link>
                  </div>
                  <div className="s">
                    {a.account_name !== a.school_name ? `${a.account_name} · ` : ""}
                    since {a.started_on ? dateOnly(a.started_on as string) : "unknown"}
                  </div>
                  {a.relationships.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {a.relationships.map((r) => {
                        const m = people.relationshipMeta(r);
                        return m ? <Pill key={r} colour="slate">{m.name}</Pill> : null;
                      })}
                    </div>
                  )}
                  <details style={{ marginTop: 6 }}>
                    <summary className="lk">They have left this school</summary>
                    <form action={endAssociation} className="form tight">
                      <input type="hidden" name="person_id" value={id} />
                      <input type="hidden" name="association_id" value={a.id as string} />
                      <label>Why
                        <input name="reason" placeholder="Moved to another group in March" />
                      </label>
                      <div className="btns">
                        <button className="btn grey" type="submit">End this association</button>
                      </div>
                      <p className="help">
                        Nothing is deleted. The history stays; they stop appearing as
                        current at this school.
                      </p>
                    </form>
                  </details>
                </div>
              </div>
            ))}

            {otherSchools.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="lk">Also works at another school in this group</summary>
                <form action={linkPerson} className="form tight">
                  <input type="hidden" name="person_id" value={id} />
                  <label>School
                    <select name="school_id" required>
                      <option value="">— choose —</option>
                      {otherSchools.map((s) => (
                        <option key={s.id as string} value={s.id as string}>
                          {s.name as string}</option>))}
                    </select>
                  </label>
                  <label>Role there
                    <select name="school_role">
                      <option value="">— choose —</option>
                      {people.ROLE_GROUPS.map((g) => (
                        <optgroup key={g} label={g}>
                          {people.SCHOOL_ROLES.filter((r) => r.group === g).map((r) => (
                            <option key={r.key} value={r.key}>{r.name}</option>))}
                        </optgroup>))}
                    </select>
                  </label>
                  <label>Or type the title they use there<input name="custom_role" /></label>
                  <div className="btns">
                    <button className="btn" type="submit">Add this school</button>
                  </div>
                  <p className="help">
                    One person, several schools. Do not create a second record for the
                    same human.
                  </p>
                </form>
              </details>
            )}
          </Card>

          {ctx.past.length > 0 && (
            <Card title="Previously">
              {ctx.past.map((a) => (
                <div className="wrow" key={a.id as string}>
                  <div className="grow">
                    <div className="t">{a.role_label} at{" "}
                      <Link href={`/schools/${a.school_id}`}>{a.school_name}</Link></div>
                    <div className="s">Until {dateOnly(a.ended_on as string)}</div>
                  </div>
                </div>))}
            </Card>
          )}

          {work.length > 0 && (
            <Card title="Open with them">
              {work.map((t) => (
                <div className="wrow" key={t.id as string}>
                  <div className="grow">
                    <div className="t">
                      <Link href={`/work/${t.id}`}>{t.title as string}</Link>
                    </div>
                    <div className="s">{String(t.status).replace("_", " ")}</div>
                  </div>
                </div>))}
            </Card>
          )}

          {ctx.opportunities.length > 0 && (
            <Card title="Opportunities they are part of">
              {ctx.opportunities.map((o) => (
                <div className="wrow" key={o.id as string}>
                  <div className="grow">
                    <div className="t">{o.name as string}</div>
                    <div className="s">{stageName(o.stage as string)}</div>
                  </div>
                </div>))}
            </Card>
          )}
        </div>

        <div>
          <Card title="Contact">
            <KV rows={[
              ["Phone", (ctx.person.phone as string) ?? "—"],
              ["WhatsApp", (ctx.person.whatsapp as string)
                ?? (ctx.person.phone as string) ?? "—"],
              ["Email", (ctx.person.email as string) ?? "—"],
              ["Prefers", (ctx.person.preferred_channel as string) ?? "not known"],
            ]} />
          </Card>

          <Card title="What is missing">
            <div className="rows">
              {ctx.quality.map((q) => (
                <div className="row" key={q.field}>
                  <div className="grow"><div className="t">
                    {q.ok ? "✓" : "⚠"} {q.label}</div></div>
                </div>))}
            </div>
          </Card>

          <Card title="Edit this person">
            <form action={updatePerson} className="form tight">
              <input type="hidden" name="person_id" value={id} />
              <label>Name<input name="name" defaultValue={ctx.person.name as string} required /></label>
              <label>Phone<input name="phone" defaultValue={(ctx.person.phone as string) ?? ""} /></label>
              <label>WhatsApp<input name="whatsapp" defaultValue={(ctx.person.whatsapp as string) ?? ""} /></label>
              <label>Email<input name="email" defaultValue={(ctx.person.email as string) ?? ""} /></label>
              <label>Where the relationship stands
                <select name="relationship_status"
                        defaultValue={(ctx.person.relationship_status as string) ?? "unknown"}>
                  {people.RELATIONSHIP_STATUSES.map(([k, n, w]) => (
                    <option key={k} value={k}>{n} — {w}</option>))}
                </select>
              </label>
              <label>Notes<textarea name="notes" rows={3}
                       defaultValue={(ctx.person.notes as string) ?? ""} /></label>
              <label className="cb">
                <input type="checkbox" name="do_not_contact" value="yes"
                       defaultChecked={!!ctx.person.do_not_contact} />
                <span>Do not contact — they have asked us to stop</span>
              </label>
              <div className="btns"><button className="btn" type="submit">Save</button></div>
            </form>
          </Card>

          {isFounder(me) && (
            <Card title="Duplicate of someone already here?">
              <p style={{ margin: "0 0 10px" }}>
                Only if it is the same human. Two people who share a name are not a
                duplicate — the role and the school tell them apart.
              </p>
              <Link className="btn grey" href={`/people/merge?keep=${id}`}>
                Merge a duplicate into this record
              </Link>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
