import Link from "next/link";
import { notFound } from "next/navigation";
import * as commercial from "@/domain/commercial";
import * as db from "@/server/db";
import { workstreamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, ContactButtons, Empty, Flash, KV, Notice, Pill, Top,
  dateOnly, dueText, shortDate,
} from "@/ui/primitives";
import { addStakeholder, closeOpportunity } from "@/app/actions";
import { page, flash, isStaff, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  n ? `₹${n.toLocaleString("en-IN")}` : "—";

/**
 * ONE OPPORTUNITY — the paperwork of a deal, not a second pipeline.
 *
 * The stage shown here is the school's stage. There is no way to move it from this
 * page, on purpose: a school advances on the school's page, through the one
 * transition engine, with its entry checks and its outstanding work.
 */
export default async function OpportunityPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);

  const { me, data } = await page(async () => {
    const d = await commercial.byId(id);
    if (!d) return null;
    return {
      ...d,
      // People at this school who are not yet named on the deal.
      candidates: await db.many(
        `select p.id, p.name, r.school_role::text as school_role
           from public.people p
           join public.person_roles r on r.person_id = p.id
          where r.school_id = ? and r.ended_on is null
            and p.id not in (select person_id from public.opportunity_stakeholders
                              where opportunity_id = ?)
          order by p.name`, [d.o.school_id, id]),
    };
  });
  if (!data) notFound();

  const {
    o, school, account, owner, primary, signal, schoolStage, drifted, stageName,
    stakeholders, proposals, contracts, payments, pilot, work, history,
    money, decider, blockers, candidates,
  } = data;
  const closed = !!o.terminal_state;
  const staff = isStaff(me);

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Breadcrumb
        account={account ? { id: account.id as string, name: account.name as string } : null}
        school={school ? { id: school.id as string, name: school.name as string } : null}
        opportunity={{ id: o.id, name: "This deal" }} />

      <Top
        title={o.name}
        sub={`${commercial.routeName(o.route)} · opened ${shortDate(o.created_at as string)}`}
        right={
          <div className="row">
            <Link className="btn" href={`/schools/${o.school_id}`}>Open the school</Link>
            {!closed && staff && (
              <Link className="btn ghost" href={`/schools/${o.school_id}/advance`}>
                Move the school
              </Link>)}
          </div>
        } />

      {closed && (
        <Notice kind="info" title={`This opportunity is closed — ${o.terminal_state}`}>
          It is kept because what happened here is part of the school&rsquo;s record.
        </Notice>
      )}

      {drifted && (
        <Notice kind="warn" title="This deal and the school disagreed about the stage">
          The school is the authority, and it says <b>{stageName}</b>. The next move
          through the school will bring this back into line.
        </Notice>
      )}

      {/* WHERE THIS IS — read from the school, never set here. */}
      <div className="states">
        <div className="st">
          <div className="k">Stage — the school&rsquo;s</div>
          <div className="v"><Pill colour="green">{stageName}</Pill></div>
        </div>
        <div className="st">
          <div className="k">Route</div>
          <div className="v">{commercial.routeName(o.route)}</div>
        </div>
        <div className="st">
          <div className="k">Quoted</div>
          <div className="v">{inr(Number(o.pilot_fee_quoted ?? 0))}</div>
        </div>
        <div className="st">
          <div className="k">Invoiced / banked</div>
          <div className="v">{inr(money.invoiced)} / <b>{inr(money.banked)}</b></div>
        </div>
        <div className="st">
          <div className="k">Owner</div>
          <div className="v">{(owner?.full_name as string) ?? "Unassigned"}</div>
        </div>
        <div className="st">
          <div className="k">Decision expected</div>
          <div className="v">{o.expected_decision_date
            ? dateOnly(o.expected_decision_date as string)
            : <span className="muted">no date agreed</span>}</div>
        </div>
      </div>

      {!decider && !closed && (
        <Notice kind="warn" title="Nobody here has been named as able to say yes">
          A deal with no named decider is a conversation. Add the person who can
          decide, or find out who they are.
        </Notice>
      )}
      {blockers.length > 0 && (
        <Notice kind="warn"
                title={`${blockers.length} ${blockers.length === 1 ? "person" : "people"} can stop this on their own`}
                items={blockers.map((b) => `${b.name as string} — ${(b.note as string) ?? "reason not recorded"}`)} />
      )}

      <div className="two">
        <div>
          <Card title="Why this is a deal">
            <p className="lede">{(o.description as string) || "No reason recorded."}</p>
            {signal && (
              <blockquote className="quote">
                &ldquo;{signal.verbatim_quote as string}&rdquo;
                <cite>— {signal.speaker as string}
                  {signal.speaker_role ? `, ${signal.speaker_role as string}` : ""},
                  on Beyond the Classroom</cite>
              </blockquote>
            )}
            <KV rows={[
              ["School", school
                ? <Link href={`/schools/${school.id}`}>{school.name as string}</Link>
                : "—"],
              ["Account", account
                ? <Link href={`/accounts/${account.id}`}>{account.name as string}</Link>
                : "—"],
              ["Main contact", primary
                ? <Link href={`/people/${primary.id}`}>{primary.name as string}</Link>
                : <span className="muted">not set</span>],
            ]} />
          </Card>

          <Card title={`Who decides (${stakeholders.length})`}>
            {stakeholders.length === 0
              ? <Empty what="Nobody is named on this deal yet." />
              : (
                <table className="tbl">
                  <tbody>
                    {stakeholders.map((s) => (
                      <tr key={s.id as string}>
                        <td>
                          <Link href={`/people/${s.person_id}`}>{s.name as string}</Link>
                          <div className="muted sm">{(s.school_role as string) ?? "role not recorded"}</div>
                        </td>
                        <td><Pill colour={s.capacity === "blocks" ? "red"
                          : s.capacity === "decides" ? "green" : "slate"}>
                          {commercial.capacityName(s.capacity as string)}</Pill></td>
                        <td className="muted sm">{(s.note as string) ?? ""}</td>
                        <td><ContactButtons person={s} sm /></td>
                      </tr>))}
                  </tbody>
                </table>)}

            {staff && !closed && candidates.length > 0 && (
              <form action={addStakeholder} className="inline-form">
                <input type="hidden" name="opportunity_id" value={o.id} />
                <select name="person_id" required defaultValue="">
                  <option value="" disabled>Who else matters here…</option>
                  {candidates.map((c) => (
                    <option key={c.id as string} value={c.id as string}>
                      {c.name as string}{c.school_role ? ` — ${c.school_role as string}` : ""}
                    </option>))}
                </select>
                <select name="capacity" required defaultValue="">
                  <option value="" disabled>What they do to the decision…</option>
                  {commercial.CAPACITIES.map((c) => (
                    <option key={c.key} value={c.key}>{c.name} — {c.what}</option>))}
                </select>
                <input name="note" placeholder="What makes you say so?" />
                <button className="btn">Add</button>
              </form>
            )}
            {staff && !closed && candidates.length === 0 && stakeholders.length === 0 && (
              <p className="muted">
                Nobody is on record at this school yet.{" "}
                <Link href={`/schools/${o.school_id}/people/new`}>Add a person</Link> first.
              </p>
            )}
          </Card>

          <Card title={`Commercial work (${work.filter((w) => !["resolved", "cancelled"].includes(String(w.status))).length} open)`}>
            {work.length === 0
              ? <Empty what="No commercial work on this school."
                       action={<Link className="btn" href={`/work/new?school=${o.school_id}`}>+ Add work</Link>} />
              : (
                <table className="tbl">
                  <tbody>
                    {work.map((w) => {
                      const done = ["resolved", "cancelled"].includes(String(w.status));
                      return (
                        <tr key={w.id as string} className={done ? "done" : ""}>
                          <td><Link href={`/work/${w.id}`}>{w.title as string}</Link>
                            <div className="muted sm">{workstreamName(w.workstream as string)}</div></td>
                          <td className="muted sm">{(w.owner_name as string) ?? "Unassigned"}</td>
                          <td>{done
                            ? <Pill colour="slate">{w.status as string}</Pill>
                            : <Pill colour="amber">{dueText(w.due_at as string)}</Pill>}</td>
                        </tr>);
                    })}
                  </tbody>
                </table>)}
          </Card>
        </div>

        <div>
          <Card title="Paperwork">
            <div className="k">Proposals</div>
            {proposals.length === 0 ? <p className="muted">None sent.</p> : (
              <ul className="plain">
                {proposals.map((p) => (
                  <li key={p.id as string}>
                    <Pill colour="slate">{p.status as string}</Pill>{" "}
                    {(p.scope as string) ?? "scope not recorded"}
                    <span className="muted sm"> · {shortDate(p.created_at as string)}</span>
                  </li>))}
              </ul>)}

            <div className="k">Contracts</div>
            {contracts.length === 0 ? <p className="muted">None.</p> : (
              <ul className="plain">
                {contracts.map((c) => (
                  <li key={c.id as string}>
                    <Pill colour={c.signed_on ? "green" : "slate"}>{c.status as string}</Pill>{" "}
                    {inr(Number(c.value_inr ?? 0))}
                    {c.signed_on && <span className="muted sm"> · signed {dateOnly(c.signed_on as string)}</span>}
                  </li>))}
              </ul>)}

            <div className="k">Payments</div>
            {payments.length === 0 ? <p className="muted">Nothing invoiced.</p> : (
              <ul className="plain">
                {payments.map((p) => (
                  <li key={p.id as string}>
                    {inr(Number(p.amount_inr ?? 0))}{" "}
                    {p.banked_on
                      ? <Pill colour="green">banked {dateOnly(p.banked_on as string)}</Pill>
                      : <Pill colour="amber">invoiced {dateOnly(p.invoiced_on as string)}</Pill>}
                  </li>))}
              </ul>)}
          </Card>

          {pilot && (
            <Card title="Pilot">
              <KV rows={[
                ["Hypothesis", (pilot.hypothesis as string) ?? "—"],
                ["Champion", (pilot.champion as string) ?? "—"],
                ["Success means", (pilot.success_criteria as string) ?? "—"],
                ["Decision", (pilot.conversion_decision as string) ?? "not yet"],
              ]} />
            </Card>
          )}

          <Card title="What has happened">
            {history.length === 0 ? <Empty what="Nothing logged yet." /> : (
              <ul className="feed">
                {history.map((h) => (
                  <li key={h.id as string}>
                    <div>{h.summary as string}</div>
                    <div className="muted sm">
                      {(h.actor_name as string) ?? "system"} · {shortDate(h.occurred_at as string)}
                    </div>
                  </li>))}
              </ul>)}
          </Card>

          {staff && !closed && (
            <Card title="Close this opportunity">
              <p className="muted sm">
                A deal is won or parked. Whether the <i>school</i> is lost is the
                school&rsquo;s own state — say that on the school itself, and mean it.
              </p>
              <form action={closeOpportunity}>
                <input type="hidden" name="opportunity_id" value={o.id} />
                <select name="state" required defaultValue="">
                  <option value="" disabled>How did it end…</option>
                  {commercial.TERMINAL.map((t) => (
                    <option key={t.key} value={t.key}>{t.name} — {t.what}</option>))}
                </select>
                <textarea name="reason" rows={2} required
                          placeholder="What actually happened?" />
                <button className="btn danger">Close it</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
