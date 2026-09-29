import Link from "next/link";
import * as db from "@/server/db";
import * as stage from "@/domain/stage";
import { stageName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Flash, Pill, Top } from "@/ui/primitives";
import { bulkMove } from "@/app/actions";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/** A bulk move is previewed per school. It never half-succeeds in silence. */
export default async function Bulk({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const ids = (Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : []).map(String);
  const to = first(sp.to);

  const { me, data } = await page(async () => {
    const rows = [];
    for (const id of ids) {
      const school = await db.get("schools", id);
      if (!school) continue;
      const g = await stage.gate(id, to);
      rows.push({
        school, g,
        why: g.legal
          ? [...g.missingEntry.map((c) => c.check.label),
             ...g.missingWork.map((t) => t.title as string)]
          : [g.illegalReason ?? "Not a legal move"],
      });
    }
    return rows;
  });

  const can = data.filter((r) => r.g.ok);
  const cannot = data.filter((r) => !r.g.ok);

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Top title={`Move ${data.length} school${data.length === 1 ? "" : "s"} to ${stageName(to)}`}
           sub="Each one is checked on its own. Nothing moves until you confirm." />

      <Card title={`Can move (${can.length})`}>
        {can.length === 0 ? <p style={{ margin: 0 }}>None of these can move yet.</p> : (
          <div className="rows">
            {can.map((r) => (
              <div className="row" key={r.school.id as string}>
                <div className="grow">
                  <div className="t">{r.school.name as string}</div>
                  <div className="s">
                    {stageName(r.school.stage as string)} → {stageName(to)}
                  </div>
                </div>
                <div className="rt"><Pill colour="green">Ready</Pill></div>
              </div>))}
          </div>
        )}
      </Card>

      {cannot.length > 0 && (
        <Card title={`Cannot move (${cannot.length})`}>
          <div className="rows">
            {cannot.map((r) => (
              <div className="row" key={r.school.id as string}>
                <div className="grow">
                  <div className="t">{r.school.name as string}</div>
                  <ul className="bul">{r.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
                <div className="rt">
                  <Link className="btn sm grey"
                        href={`/schools/${r.school.id}/advance?to=${to}`}>Open this one</Link>
                </div>
              </div>))}
          </div>
          <p className="help" style={{ marginTop: 8 }}>
            These stay where they are.
          </p>
        </Card>
      )}

      {can.length > 0 && (
        <form action={bulkMove}>
          <input type="hidden" name="to" value={to} />
          {can.map((r) => (
            <input key={r.school.id as string} type="hidden" name="id"
                   value={r.school.id as string} />))}
          <div className="btns">
            <button className="btn" type="submit">Move the {can.length} that can go</button>
            <Link className="btn grey" href="/pipeline">Cancel</Link>
          </div>
        </form>
      )}
      {can.length === 0 && <Link className="btn grey" href="/pipeline">Back</Link>}
    </Shell>
  );
}
