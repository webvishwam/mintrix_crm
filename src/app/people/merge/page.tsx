import Link from "next/link";
import { redirect } from "next/navigation";
import * as db from "@/server/db";
import * as people from "@/domain/people";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, KV, Notice, Pill, Top } from "@/ui/primitives";
import { mergePeople } from "@/app/actions";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** A controlled merge, shown field by field. Nothing runs until a human presses it. */
export default async function Merge({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const keepId = first(sp.keep), dropId = first(sp.drop);

  const { me, data } = await page(async (u) => {
    if (u.role !== "founder") redirect("/people?err=" +
      encodeURIComponent("Merging records is the founder's."));
    const keep = keepId ? await people.context(keepId) : null;
    const drop = dropId ? await people.context(dropId) : null;
    const count = async (id: string) => ({
      activities: Number((await db.one(
        "select count(*) c from public.activities where person_id = ?", [id]))!.c),
      work: Number((await db.one(
        "select count(*) c from public.work_items where person_id = ?", [id]))!.c),
    });
    return {
      keep, drop,
      candidates: keep && !drop
        ? await people.possibleDuplicates(keep.person.name as string, {
            accountId: keep.account.id as string,
            phone: keep.person.phone as string, email: keep.person.email as string,
            excludeId: keepId })
        : [],
      keepCount: keep ? await count(keepId) : null,
      dropCount: drop ? await count(dropId) : null,
    };
  });

  return (
    <Shell me={me} path="/people">
      <Flash msg={msg} err={err} />
      <Top title="Merge two people"
           sub="Only when they are genuinely the same human. Two people who share a name are not a duplicate." />

      {!data.keep && (
        <Card title="Which record are you keeping?">
          <Empty what="Open the person you want to keep, then use 'Merge a duplicate into this record'."
                 action={<Link className="btn" href="/people">The people list</Link>} />
        </Card>
      )}

      {data.keep && !data.drop && (
        <Card title={`Keeping: ${data.keep.identity}`}>
          {data.candidates.length === 0
            ? <Empty what="Nothing on file looks like a duplicate of this person." />
            : (
              <div className="rows">
                {data.candidates.map((m) => (
                  <div className="row" key={m.person.id as string}>
                    <div className="grow">
                      <div className="t">{m.person.name as string}{" "}
                        <Pill colour={m.confidence === "HIGH" ? "red" : "amber"}>
                          {m.reason}</Pill></div>
                      <div className="s">{m.identity}</div>
                    </div>
                    <div className="rt">
                      <Link className="btn sm grey"
                            href={`/people/merge?keep=${keepId}&drop=${m.person.id}`}>
                        Review this merge</Link>
                    </div>
                  </div>))}
              </div>
            )}
        </Card>
      )}

      {data.keep && data.drop && (
        <>
          <Notice kind="warn" title="This cannot be undone.">
            The record on the right disappears. Everything attached to it moves onto the
            one on the left. No history is deleted.
          </Notice>
          <Card title="Field by field">
            <div className="tw">
              <table>
                <thead><tr><th>Field</th>
                  <th>Keeping — {data.keep.person.name as string}</th>
                  <th>Removing — {data.drop.person.name as string}</th></tr></thead>
                <tbody>
                  {(["name", "title", "phone", "whatsapp", "email", "notes"] as const)
                    .map((f) => (
                      <tr key={f}>
                        <td>{f}</td>
                        <td>{(data.keep!.person[f] as string) || "—"}</td>
                        <td>
                          {(data.drop!.person[f] as string) || "—"}
                          {!data.keep!.person[f] && data.drop!.person[f] && (
                            <> <Pill colour="green">will be copied</Pill></>)}
                        </td>
                      </tr>))}
                  <tr><td>Schools</td>
                    <td>{data.keep.associations.map((a) =>
                      `${a.role_label}, ${a.school_name}`).join("; ") || "—"}</td>
                    <td>{data.drop.associations.map((a) =>
                      `${a.role_label}, ${a.school_name}`).join("; ") || "—"}</td></tr>
                  <tr><td>Activities</td>
                    <td>{data.keepCount?.activities}</td>
                    <td>{data.dropCount?.activities} — will move across</td></tr>
                  <tr><td>Work</td>
                    <td>{data.keepCount?.work}</td>
                    <td>{data.dropCount?.work} — will move across</td></tr>
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Are these the same human?">
            <KV rows={[["Keeping", data.keep.identity],
                       ["Removing", data.drop.identity]]} />
            <p style={{ marginTop: 10 }}>
              If the role or the school differs, stop. A Principal at one school and a
              Coordinator at another are two people who happen to share a name.
            </p>
            <form action={mergePeople}>
              <input type="hidden" name="keep_id" value={keepId} />
              <input type="hidden" name="drop_id" value={dropId} />
              <label>Why are they the same person? <span className="req">*</span>
                <input name="reason" required
                       placeholder="Same mobile, same school, entered twice after the visit" />
              </label>
              <div className="btns" style={{ marginTop: 12 }}>
                <button className="btn" type="submit">
                  Merge into {data.keep.person.name as string}</button>
                <Link className="btn grey" href={`/people/${keepId}`}>Cancel</Link>
              </div>
            </form>
          </Card>
        </>
      )}
    </Shell>
  );
}
