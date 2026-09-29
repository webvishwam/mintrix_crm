import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/server/db";
import * as stage from "@/domain/stage";
import { LADDER, HOLDING, stageName, teamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, Flash, KV, Notice, Pill, Top,
} from "@/ui/primitives";
import { moveStage } from "@/app/actions";
import { page, flash, first, isFounder, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/**
 * THE GATE.
 *
 * Reached three ways — a drop on the board, the button on the school, a bulk action —
 * and it is the only place a school's stage changes. It never says "invalid": it says
 * what is missing and links to where each thing is fixed.
 */
export default async function Advance(
  { params, searchParams }: {
    params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;

  const { me, data } = await page(async () => {
    const school = await db.get("schools", id);
    if (!school) return null;
    const account = (await db.get("accounts", school.account_id as string))!;
    const next = await stage.nextStageOf(id);
    const to = first(sp.to) || next?.key || "";
    if (!to) return { school, account, to: "", g: null, preview: null };
    const g = await stage.gate(id, to);
    const preview = g.to
      ? await stage.buildHandoff(id, String(school.stage), to, { overridden: !g.ok })
      : null;
    return { school, account, to, g, preview };
  });
  if (!data) notFound();

  const { school, account, to, g, preview } = data;

  if (!to || !g?.to) {
    return (
      <Shell me={me} path="/pipeline">
        <Top title={school.name as string} sub={stageName(school.stage as string)} />
        <Notice kind="info" title="There is no stage after this one.">
          Move it to a holding state below if the situation has changed.
        </Notice>
        <Link className="btn grey" href={`/schools/${id}`}>Back to the school</Link>
      </Shell>
    );
  }

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Breadcrumb account={{ id: account.id as string, name: account.name as string }}
                  school={{ id, name: school.name as string }} />
      <Top title={`Move ${school.name} to ${g.to.name}?`}
           sub={`${account.name} · currently ${g.from.name}`} />

      <Card title="What is about to change">
        <KV rows={[
          ["Current", `${g.from.num}. ${g.from.name}`],
          ["New", g.to.terminal ? g.to.name : `${g.to.num}. ${g.to.name}`],
          ["What that means", g.to.meaning],
          ["New SLA", g.to.sla_hours ? `${g.to.sla_hours} hours from the move`
            : "no clock on that stage"],
          ["Work that will be created", g.to.work.length ? (
            <ul className="bul" key="w">
              {g.to.work.map((w) => (
                <li key={w.key}>
                  {w.title.replace("{school}", school.name as string)} — <i>{teamName(w.team)}</i>
                  {w.blocking ? "" : " (non-blocking)"}
                </li>))}
            </ul>) : "none — this stage has no standing work"],
        ]} />
      </Card>

      {!g.legal && (
        <Notice kind="err" title={`${g.to.name} does not follow ${g.from.name}.`}>
          {g.illegalReason} Skipping stages would mean the gates in between were never
          evaluated.
        </Notice>
      )}

      {g.to.entry.length > 0 && (
        <Card title={`Required before ${g.to.name}`}
              extra={<Pill colour={g.missingEntry.length ? "amber" : "green"}>
                {g.entry.length - g.missingEntry.length}/{g.entry.length}
              </Pill>}>
          <div className="rows">
            {g.entry.map((c) => (
              <div className="row" key={c.check.key}>
                <div className="grow">
                  <div className="t">{c.ok ? "✓" : "⚠"} {c.check.label}</div>
                  <div className="s">{c.detail}</div>
                </div>
                <div className="rt">
                  {c.ok ? <Pill colour="green">Done</Pill>
                    : <Link className="btn sm grey" href={stage.fixHref(c.check, id)}>
                        Fix this
                      </Link>}
                </div>
              </div>))}
          </div>
        </Card>
      )}

      {!g.to.terminal && (
        <Card title={`${g.from.name}'s blocking work`}
              extra={<Pill colour={g.missingWork.length ? "amber" : "green"}>
                {g.progress.done}/{g.progress.total} resolved
              </Pill>}>
          {g.progress.blocking.length === 0
            ? <p style={{ margin: 0 }}>
                {g.from.name} has no blocking work, so nothing here holds the stage shut.
              </p>
            : (
              <div className="rows">
                {g.progress.blocking.map((t) => (
                  <div className="row" key={t.id as string}>
                    <div className="grow">
                      <div className="t">
                        {t.status === "resolved" ? "✓" : "⚠"} {t.title as string}
                      </div>
                      <div className="s">
                        {teamName(t.team as string)}
                        {t.status !== "resolved"
                          ? ` · ${String(t.status).replace("_", " ")}`
                          : ` · ${(t.resolution_note as string) ?? "resolved"}`}
                      </div>
                    </div>
                    <div className="rt">
                      {t.status === "resolved" ? <Pill colour="green">Resolved</Pill>
                        : <Link className="btn sm grey" href={`/work/${t.id}`}>
                            Open this work
                          </Link>}
                    </div>
                  </div>))}
              </div>
            )}
          {g.progress.nonBlocking.length > 0 && (
            <>
              <div className="lbl" style={{ marginTop: 12 }}>Non-blocking, carries on</div>
              <ul className="bul">
                {g.progress.nonBlocking.map((t) => (
                  <li key={t.id as string}>
                    {t.title as string} — {teamName(t.team as string)},{" "}
                    {String(t.status).replace("_", " ")}
                  </li>))}
              </ul>
              <p className="help">
                These keep running after the move. Production editing must never stop a
                relationship moving.
              </p>
            </>
          )}
        </Card>
      )}

      {!g.ok && g.legal && (
        <Notice kind="warn" title={`${school.name} cannot move to ${g.to.name} yet.`}
                items={[...g.missingEntry.map((c) => c.check.label),
                        ...g.missingWork.map((t) => t.title as string)]} />
      )}

      {preview && (
        <details>
          <summary>The handoff this move will write{" "}
            <span className="s">— what the next person reads</span></summary>
          <div className="dbody">
            <KV rows={[
              ["Came from", preview.previous_stage],
              ["Time in that stage", `${preview.days_in_stage} day(s)`],
              ["SLA", preview.sla_met],
              ["Why it moved", preview.reason_for_transition],
            ]} />
            {preview.problem && (
              <>
                <div className="lbl" style={{ marginTop: 10 }}>The problem, in their words</div>
                <p style={{ margin: "2px 0 0" }}>{preview.problem}</p>
              </>)}
            {preview.their_words.length > 0 && (
              <>
                <div className="lbl" style={{ marginTop: 10 }}>They said</div>
                {preview.their_words.map((q, i) => (
                  <div key={i}>
                    <div className="quote">{q.quote as string}</div>
                    <div className="s">{q.speaker as string}</div>
                  </div>))}
              </>)}
            {preview.stakeholders.length > 0 && (
              <>
                <div className="lbl" style={{ marginTop: 10 }}>Who was involved</div>
                <ul className="bul">
                  {preview.stakeholders.map((s, i) => (
                    <li key={i}>{s.name as string} — {s.role as string}</li>))}
                </ul>
              </>)}
            {preview.outstanding.length > 0 && (
              <Notice kind="warn" title="Still outstanding" items={preview.outstanding} />)}
            {preview.next_actions.length > 0 && (
              <>
                <div className="lbl" style={{ marginTop: 10 }}>Then</div>
                <ul className="bul">
                  {preview.next_actions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </>)}
          </div>
        </details>
      )}

      {g.ok ? (
        <form action={moveStage}>
          <input type="hidden" name="school_id" value={id} />
          <input type="hidden" name="to" value={to} />
          <label htmlFor="note">Why now? (optional, goes into the handoff)</label>
          <input id="note" name="note"
                 placeholder="Principal confirmed the visit for Thursday" />
          <div className="btns" style={{ marginTop: 12 }}>
            <button className="btn" type="submit">Confirm move to {g.to.name}</button>
            <Link className="btn grey" href={`/schools/${id}`}>Cancel</Link>
          </div>
        </form>
      ) : isFounder(me) ? (
        <Card title="Override">
          <Notice kind="warn">
            This records your name, the time, both stages and your reason, permanently.
            It shows on the school's history and in the audit log.
          </Notice>
          <form action={moveStage}>
            <input type="hidden" name="school_id" value={id} />
            <input type="hidden" name="to" value={to} />
            <label htmlFor="override">Why are you overriding? <span className="req">*</span></label>
            <textarea id="override" name="override" required
                      placeholder="Trustee asked for pricing in the first meeting." />
            <div className="btns" style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Override and move</button>
              <Link className="btn grey" href={`/schools/${id}`}>Cancel</Link>
            </div>
          </form>
        </Card>
      ) : (
        <>
          <Notice kind="warn">
            Not yet. Each open item above links to where it is closed. If this school
            genuinely needs to skip ahead, the founder can override.
          </Notice>
          <Link className="btn grey" href={`/schools/${id}`}>Back to the school</Link>
        </>
      )}

      <Card title="Or move it somewhere else">
        <div className="ladder">
          {[...LADDER, ...HOLDING].map((s) => s.key === g.from.key
            ? <span key={s.key} className="on">{s.name} (now)</span>
            : <Link key={s.key} className={s.key === to ? "past" : ""}
                    href={`/schools/${id}/advance?to=${s.key}`}>{s.name}</Link>)}
        </div>
        <p className="help">
          Nurture, disqualified and lost are always available — they are decisions about
          a relationship, not achievements, so they are not gated on work.
        </p>
      </Card>
    </Shell>
  );
}
