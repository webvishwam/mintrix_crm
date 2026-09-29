import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as db from "@/server/db";
import * as commercial from "@/domain/commercial";
import Shell from "@/ui/Shell";
import { stageName } from "@/domain/journey";
import { Breadcrumb, Card, Flash, Notice, Top, dateOnly } from "@/ui/primitives";
import { openOpportunity } from "@/app/actions";
import { page, flash, isStaff, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/**
 * OPENING A DEAL IS A DECISION.
 *
 * Nothing opens one automatically — not recording an episode, not publishing it,
 * not a stage move. Somebody says this is real, and says why, and their name is on
 * it. That is the whole point of this page existing.
 */
export default async function NewOpportunity(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);

  const { me, data } = await page(async () => {
    const school = await db.get("schools", id);
    if (!school) return null;
    return {
      school,
      account: await db.get("accounts", school.account_id as string),
      open: await db.one(
        `select id from public.opportunities
          where school_id = ? and terminal_state is null`, [id]),
      people: await db.many(
        `select p.id, p.name, r.school_role::text as school_role
           from public.people p
           join public.person_roles r on r.person_id = p.id
          where r.school_id = ? and r.ended_on is null order by p.name`, [id]),
      signals: await db.many(
        `select id, verbatim_quote, speaker, speaker_role, observed_at
           from public.podcast_signals where school_id = ?
          order by observed_at desc nulls last limit 10`, [id]),
    };
  });
  if (!data) notFound();
  if (!isStaff(me)) {
    redirect(`/schools/${id}?err=${encodeURIComponent(
      "Your access covers the work assigned to you, nothing wider.")}`);
  }
  if (data.open) redirect(`/opportunities/${data.open.id}`);

  const { school, account, people, signals } = data;

  // The domain refuses this too. Saying it here means nobody fills in a form that
  // was never going to be accepted.
  const here = String(school.stage);
  const tooEarly = !commercial.CAN_OPEN_FROM.some((s) => s.key === here);

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Breadcrumb
        account={account ? { id: account.id as string, name: account.name as string } : null}
        school={{ id: school.id as string, name: school.name as string }} />
      <Top title="Open an opportunity"
           sub={`${school.name as string} — this does not move the school.`} />

      {tooEarly ? (
        <Notice kind="warn" title="There is nothing to quote for yet">
          <p>
            {school.name as string} is at <b>{stageName(here)}</b>. A deal opens from{" "}
            <b>{commercial.CAN_OPEN_FROM[0].name}</b> onwards — the first stage where
            a school has told us a problem in its own words. Until then there is a
            relationship here, not an opportunity.
          </p>
          <div className="row">
            <Link className="btn" href={`/schools/${id}/advance`}>
              Move the school on
            </Link>
            <Link className="btn ghost" href={`/schools/${id}`}>Back to the school</Link>
          </div>
        </Notice>
      ) : (
        <Notice kind="info" title="What this does and does not do">
          It records that there is a deal to be done here and who owns it. The school
          stays exactly where it is on the ladder; you move it on the school&rsquo;s
          own page when the stage is actually earned.
        </Notice>
      )}

      <div className="two">
        <div>
          {!tooEarly && <Card title="The deal">
            <form action={openOpportunity}>
              <input type="hidden" name="school_id" value={id} />

              <label htmlFor="reason">Why is this real?</label>
              <textarea id="reason" name="reason" rows={3} required
                        placeholder="They asked what it would cost to run this across both branches." />
              <div className="help">
                In their words where you have them. &ldquo;Seems interested&rdquo; is not a reason.
              </div>

              <label htmlFor="route">How is this school being sold to?</label>
              <select id="route" name="route" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {commercial.ROUTES.map((r) => (
                  <option key={r.key} value={r.key}>{r.name} — {r.what}</option>))}
              </select>

              <label htmlFor="primary_person_id">Main contact</label>
              <select id="primary_person_id" name="primary_person_id" defaultValue="">
                <option value="">Not sure yet</option>
                {people.map((p) => (
                  <option key={p.id as string} value={p.id as string}>
                    {p.name as string}{p.school_role ? ` — ${p.school_role as string}` : ""}
                  </option>))}
              </select>
              {people.length === 0 && (
                <div className="help">
                  Nobody is on record at this school.{" "}
                  <Link href={`/schools/${id}/people/new`}>Add a person</Link>.
                </div>)}

              <label htmlFor="fee">Quoted, if anything has been said (₹)</label>
              <input id="fee" name="fee" type="number" min="0" step="1000"
                     placeholder="Leave blank if no number has been said out loud" />

              <label htmlFor="expected_decision">When do they expect to decide?</label>
              <input id="expected_decision" name="expected_decision" type="date" />
              <div className="help">A date they gave you, not one you hope for.</div>

              {signals.length > 0 && (
                <>
                  <label htmlFor="signal_id">Did this come out of the show?</label>
                  <select id="signal_id" name="signal_id" defaultValue="">
                    <option value="">No — it came from somewhere else</option>
                    {signals.map((s) => (
                      <option key={s.id as string} value={s.id as string}>
                        “{String(s.verbatim_quote).slice(0, 70)}…” — {s.speaker as string}
                      </option>))}
                  </select>
                </>)}

              <div className="row">
                <button className="btn primary">Open it</button>
                <Link className="btn ghost" href={`/schools/${id}`}>Cancel</Link>
              </div>
            </form>
          </Card>}
        </div>

        <div>
          <Card title="What they actually said">
            {signals.length === 0
              ? <p className="muted">
                  No signals recorded from Beyond the Classroom for this school.
                </p>
              : (
                <ul className="feed">
                  {signals.map((s) => (
                    <li key={s.id as string}>
                      <blockquote className="quote sm">
                        &ldquo;{s.verbatim_quote as string}&rdquo;
                      </blockquote>
                      <div className="muted sm">
                        {s.speaker as string}
                        {s.speaker_role ? `, ${s.speaker_role as string}` : ""}
                        {s.observed_at ? ` · ${dateOnly(s.observed_at as string)}` : ""}
                      </div>
                    </li>))}
                </ul>)}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
