import Link from "next/link";
import { redirect } from "next/navigation";
import * as db from "@/server/db";
import * as people from "@/domain/people";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, ContactButtons, Flash, Notice, Pill, Top,
} from "@/ui/primitives";
import { addPerson } from "@/app/actions";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** Same person, or different people? The system will not guess, and never merges. */
export default async function Resolve({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const name = first(sp.name);
  const accountId = first(sp.account_id);
  const schoolId = first(sp.school_id);
  if (!name || !accountId) redirect("/people");

  const fields: Record<string, string> = {
    name, account_id: accountId, school_id: schoolId,
    school_role: first(sp.school_role), custom_role: first(sp.custom_role),
    phone: first(sp.phone), email: first(sp.email), whatsapp: first(sp.whatsapp),
    discovered_how: first(sp.discovered_how), notes: first(sp.notes),
    relationships: first(sp.relationships),
  };

  const { me, data } = await page(async () => ({
    account: await db.get("accounts", accountId),
    school: schoolId ? await db.get("schools", schoolId) : null,
    matches: await people.possibleDuplicates(name, {
      accountId, phone: fields.phone, email: fields.email }),
  }));
  if (!data.account) redirect("/people");
  if (!data.matches.length) {
    redirect(schoolId ? `/schools/${schoolId}/people/new` : `/accounts/${accountId}`);
  }

  const roleLabel = people.schoolRoleName(fields.school_role, fields.custom_role);

  return (
    <Shell me={me} path="/people">
      <Flash msg={msg} err={err} />
      <Breadcrumb account={{ id: data.account.id as string,
                             name: data.account.name as string }}
                  school={data.school
                    ? { id: data.school.id as string,
                        name: data.school.name as string } : null} />
      <Top title="Possible duplicate" sub={`Somebody called ${name} is already on file.`} />

      <Notice kind="warn" title="Nothing has been saved yet.">
        Two people can share a name. Decide which this is — the system will not guess,
        and it never merges anything on its own.
      </Notice>

      <Card title="The person you are adding">
        <div className="t">{name}</div>
        <div className="s">
          {[roleLabel, data.school?.name as string, data.account.name as string]
            .filter(Boolean).join(" · ")}
        </div>
        <div className="s">
          {[fields.phone, fields.email].filter(Boolean).join(" · ")
            || "no contact details given"}
        </div>
      </Card>

      <Card title={`Already on file (${data.matches.length})`}>
        <div className="rows">
          {data.matches.map((m) => (
            <div className="row" key={m.person.id as string}>
              <div className="grow">
                <div className="t">
                  <Link href={`/people/${m.person.id}`}>{m.person.name as string}</Link>{" "}
                  <Pill colour={m.confidence === "HIGH" ? "red" : "amber"}>{m.reason}</Pill>
                </div>
                <div className="s">{m.identity}</div>
                <div style={{ marginTop: 6 }}>
                  <ContactButtons person={m.person} sm />
                </div>
              </div>
              <div className="rt">
                <Link className="btn sm" href={`/people/${m.person.id}`}>
                  Same person — open them
                </Link>
              </div>
            </div>))}
        </div>
        <p className="help" style={{ marginTop: 10 }}>
          If it is the same person, open their record and add this school there. A
          Director who runs three campuses should be one person with three
          associations, not three people.
        </p>
      </Card>

      <Card title="Or: these are different people">
        <p style={{ margin: "0 0 10px" }}>
          Keep both. {name} at <b>{data.school?.name ?? data.account.name}</b> as{" "}
          <b>{roleLabel}</b> will be created separately, and the role and school are
          what tell them apart from here on.
        </p>
        <form action={addPerson}>
          {Object.entries(fields).map(([k, v]) =>
            k === "relationships" ? null
              : <input key={k} type="hidden" name={k} value={v} />)}
          {fields.relationships.split(",").filter(Boolean).map((r) => (
            <input key={r} type="hidden" name="relationships" value={r} />))}
          <input type="hidden" name="confirmed" value="yes" />
          <div className="btns">
            <button className="btn grey" type="submit">
              These are different people — create a separate record
            </button>
            <Link className="btn grey"
                  href={schoolId ? `/schools/${schoolId}` : `/accounts/${accountId}`}>
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </Shell>
  );
}
