import Link from "next/link";
import { notFound } from "next/navigation";
import * as show from "@/domain/show";
import { stageName, teamName, workstreamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, Empty, Flash, KV, Notice, Pill, Top,
  dateOnly, dueText, shortDate,
} from "@/ui/primitives";
import { setPodcastStatus, updateEpisode, setShowPath, recordSignal } from "@/app/actions";
import { page, flash, isStaff, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

const phaseColour = (p: string) =>
  p === "Planning" ? "slate" : p === "Production" ? "amber"
  : p === "Execution" ? "green" : "plum";

/**
 * BEYOND THE CLASSROOM, for one school.
 *
 * Planning, production and execution on one screen, with the work each step
 * actually requires. The school's own stage is shown at the top and cannot be
 * changed from here — that is the point of the two being separate.
 */
export default async function ShowPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);

  const { me, data } = await page(async () => show.detail(id));
  if (!data) notFound();

  const { school, account, pod, people, guest, owner, status, def, phases,
          signals, gateResult, history, prog, nextOptions } = data;
  const staff = isStaff(me);

  return (
    <Shell me={me} path="/show">
      <Flash msg={msg} err={err} />
      <Breadcrumb
        account={account ? { id: account.id as string, name: account.name as string } : null}
        school={{ id: school.id as string, name: school.name as string }} />

      <Top
        title="Beyond the Classroom"
        sub={`${school.name as string} — a workstream, not a stage.`}
        right={
          <Link className="btn ghost" href={`/schools/${id}`}>Back to the school</Link>
        } />

      <Notice kind="info" title="This does not move the school">
        The school is at <b>{stageName(String(school.stage))}</b> and stays there
        whatever happens here. The one thing on this page that touches the
        relationship is a <b>signal</b> — something they actually said — which is
        what opens Discovery.
      </Notice>

      {/* WHERE THE SHOW IS */}
      <div className="states">
        <div className="st">
          <div className="k">Show</div>
          <div className="v">{pod
            ? <Pill colour={phaseColour(def?.phase ?? "")}>{def?.name}</Pill>
            : <span className="muted">not started</span>}</div>
        </div>
        <div className="st">
          <div className="k">Phase</div>
          <div className="v">{def?.phase ?? "—"}</div>
        </div>
        <div className="st">
          <div className="k">School&rsquo;s own stage</div>
          <div className="v"><Pill colour="slate">{stageName(String(school.stage))}</Pill></div>
        </div>
        <div className="st">
          <div className="k">Guest</div>
          <div className="v">{guest
            ? <Link href={`/people/${guest.id}`}>{guest.name as string}</Link>
            : <span className="muted">not named</span>}</div>
        </div>
        <div className="st">
          <div className="k">Recording</div>
          <div className="v">{pod?.recording_date
            ? dateOnly(pod.recording_date as string)
            : <span className="muted">no date</span>}</div>
        </div>
        <div className="st">
          <div className="k">Path</div>
          <div className="v">{pod?.path
            ? <Pill colour="green">{pod.path as string}</Pill>
            : <span className="muted">not decided</span>}</div>
        </div>
      </div>

      {!pod ? (
        <Card title="Put this school on the show">
          <p className="lede">
            It starts with a question. If another school could answer it, it is the
            wrong question.
          </p>
          {staff ? (
            <form action={setPodcastStatus}>
              <input type="hidden" name="school_id" value={id} />
              <input type="hidden" name="status" value="planned" />
              <label htmlFor="episode_question">The episode question</label>
              <textarea id="episode_question" name="episode_question" rows={2}
                        placeholder="What does this school know that nobody ever asks them about?" />
              <label htmlFor="note">Why this school?</label>
              <textarea id="note" name="note" rows={2}
                        placeholder="They run three campuses on one admissions process and nobody talks about it." />
              <button className="btn primary">Start planning</button>
            </form>
          ) : <p className="muted">Your access does not cover the show.</p>}
        </Card>
      ) : (
        <div className="two">
          <div>
            {/* THE WHOLE LIFECYCLE, EVERY STEP WITH ITS WORK */}
            {phases.map((ph) => (
              <Card key={ph.def.key}
                    title={`${ph.def.phase} — ${ph.def.name}`}
                    extra={
                      ph.state === "here" ? <Pill colour="amber">here now</Pill>
                      : ph.state === "done" ? <Pill colour="green">done</Pill>
                      : <Pill colour="slate">ahead</Pill>
                    }>
                <p className="lede">{ph.def.meaning}</p>

                {ph.work.length === 0 ? (
                  <p className="muted sm">
                    {ph.state === "ahead"
                      ? `${ph.def.work.length} piece(s) of work will be created when the show reaches here.`
                      : "No work was created for this step."}
                  </p>
                ) : (
                  <table className="tbl">
                    <tbody>
                      {ph.work.map((w) => {
                        const done = ["resolved", "cancelled"].includes(String(w.status));
                        return (
                          <tr key={w.id as string} className={done ? "done" : ""}>
                            <td>
                              <Link href={`/work/${w.id}`}>{w.title as string}</Link>
                              <div className="muted sm">
                                {teamName(w.team as string)} ·{" "}
                                {workstreamName(w.workstream as string)}
                                {w.blocking ? " · blocking" : " · alongside"}
                              </div>
                            </td>
                            <td className="muted sm">{(w.owner_name as string) ?? "—"}</td>
                            <td>{done
                              ? <Pill colour="slate">{w.status as string}</Pill>
                              : <Pill colour={w.blocking ? "amber" : "slate"}>
                                  {dueText(w.due_at as string)}
                                </Pill>}</td>
                          </tr>);
                      })}
                    </tbody>
                  </table>
                )}

                {ph.state === "ahead" && ph.work.length === 0 && (
                  <details>
                    <summary className="lk">What this step will ask for</summary>
                    <ul className="plain sm">
                      {ph.def.work.map((w) => (
                        <li key={w.key}>
                          <b>{w.title.replace("{school}", school.name as string)}</b>
                          {" — "}{w.reason}
                          <span className="muted"> ({teamName(w.team)},
                            {w.blocking ? " blocking" : " alongside"})</span>
                        </li>))}
                    </ul>
                  </details>
                )}
              </Card>
            ))}

            {/* SIGNALS — the only thing here that touches the relationship */}
            <Card title="What they actually said"
                  extra={signals.length
                    ? <Pill colour="plum">{signals.length}</Pill> : null}>
              <p className="lede">
                A signal needs their exact words and, where you have it, the time it
                was said. An interpretation is a wish.
              </p>
              {signals.length === 0
                ? <Empty what="Nothing recorded yet." />
                : signals.map((s) => (
                    <div key={s.id as string} style={{ marginBottom: 12 }}>
                      <blockquote className="quote">
                        &ldquo;{s.verbatim_quote as string}&rdquo;
                      </blockquote>
                      <div className="muted sm">
                        <Pill colour="plum">
                          {show.signalTypeName(s.signal_type as string)}
                        </Pill>{" "}
                        {s.speaker as string}
                        {s.speaker_role ? `, ${s.speaker_role as string}` : ""}
                        {s.timecode ? ` · ${s.timecode as string}` : ""}
                        {" · "}{dateOnly(s.observed_at as string)}
                      </div>
                    </div>))}

              {staff && (
                <details style={{ marginTop: 8 }}>
                  <summary className="lk">Record something they said</summary>
                  <form action={recordSignal} className="form tight">
                    <input type="hidden" name="school_id" value={id} />
                    <input type="hidden" name="return_to" value={`/schools/${id}/show`} />
                    <label>Their exact words <span className="req">*</span>
                      <textarea name="verbatim_quote" rows={3} required
                                placeholder="We re-key every admission form into three systems and the counts never agree." />
                    </label>
                    <label>Who said it <span className="req">*</span>
                      <input name="speaker" required list="show-people"
                             placeholder="Anjali Verma" />
                      <datalist id="show-people">
                        {people.map((p) => (
                          <option key={p.id as string} value={p.name as string} />))}
                      </datalist>
                    </label>
                    <label>Their role
                      <input name="speaker_role" placeholder="Principal" />
                    </label>
                    <label>What kind of signal
                      <select name="signal_type" defaultValue="named_a_problem">
                        {show.SIGNAL_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>{t.name}</option>))}
                      </select>
                    </label>
                    <label>Timecode
                      <input name="timecode" placeholder="00:34:12" />
                    </label>
                    <button className="btn">Record it</button>
                  </form>
                </details>
              )}
            </Card>
          </div>

          <div>
            {/* MOVING THE SHOW ON */}
            <Card title="Move the show on">
              {prog && prog.total > 0 && (
                <p className="lede">
                  {prog.done} of {prog.total} blocking things done for{" "}
                  <b>{def?.name}</b>.
                  {prog.alongside.length > 0 &&
                    ` ${prog.alongside.length} more running alongside.`}
                </p>
              )}
              {prog && prog.open.length > 0 && (
                <Notice kind="warn" title="Still to do before this step closes"
                        items={prog.open.map((t) => t.title as string)} />
              )}
              {nextOptions.length === 0
                ? <p className="muted">
                    The show has nowhere further to go for this school.
                  </p>
                : staff && (
                  <form action={setPodcastStatus}>
                    <input type="hidden" name="school_id" value={id} />
                    <label htmlFor="status">Where to</label>
                    <select id="status" name="status" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {nextOptions.map((n) => (
                        <option key={n} value={n}>
                          {show.SHOW_BY_KEY[n].name} — {show.SHOW_BY_KEY[n].what}
                        </option>))}
                    </select>

                    {status === "planned" && (
                      <>
                        <label htmlFor="guest_person_id">The guest</label>
                        <select id="guest_person_id" name="guest_person_id"
                                defaultValue={(pod.guest_person_id as string) ?? ""}>
                          <option value="">Not decided</option>
                          {people.map((p) => (
                            <option key={p.id as string} value={p.id as string}>
                              {p.name as string}
                              {p.school_role ? ` — ${p.school_role as string}` : ""}
                            </option>))}
                        </select>
                        {people.length === 0 && (
                          <div className="help">
                            Nobody is on record here.{" "}
                            <Link href={`/schools/${id}/people/new`}>Add a person</Link>.
                          </div>)}
                      </>
                    )}
                    {status === "invited" && (
                      <>
                        <label htmlFor="recording_date">The recording date</label>
                        <input id="recording_date" name="recording_date" type="date" />
                        <label htmlFor="recording_location">Where</label>
                        <input id="recording_location" name="recording_location"
                               placeholder="Their campus, the principal's office" />
                      </>
                    )}
                    {status === "delivered" && (
                      <>
                        <label htmlFor="episode_url">Where it will live</label>
                        <input id="episode_url" name="episode_url"
                               placeholder="https://…" />
                      </>
                    )}

                    <label htmlFor="note">What happened</label>
                    <textarea id="note" name="note" rows={2}
                              placeholder="She said yes on the phone and confirmed by email." />
                    <button className="btn primary">Move the show</button>

                    {me.role === "founder" && (
                      <details style={{ marginTop: 8 }}>
                        <summary className="lk">Move it anyway</summary>
                        <label htmlFor="override_reason">Why, on the record</label>
                        <textarea id="override_reason" name="override_reason" rows={2}
                                  placeholder="We are recording tomorrow and the consent is in hand, just not filed." />
                      </details>
                    )}
                  </form>
                )}
            </Card>

            {/* THE SIX PATHS */}
            {status === "published" && (
              <Card title="The path after the episode">
                <p className="lede">
                  The right next step varies enormously. Forcing every school down the
                  same one is how this asset gets burned.
                </p>
                {pod.path ? (
                  <KV rows={[
                    ["Path", `${pod.path as string} — ${show.pathName(pod.path as string)}`],
                    ["Decided", pod.path_set_on
                      ? dateOnly(pod.path_set_on as string) : "—"],
                  ]} />
                ) : staff && (
                  <form action={setShowPath}>
                    <input type="hidden" name="school_id" value={id} />
                    <label htmlFor="path">Which path</label>
                    <select id="path" name="path" required defaultValue="">
                      <option value="" disabled>Choose on the evidence…</option>
                      {show.PATHS.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.key} — {p.name}
                        </option>))}
                    </select>
                    <div className="help">
                      {show.PATHS.map((p) => (
                        <div key={p.key}><b>{p.key}</b> · {p.when}</div>))}
                    </div>
                    <label htmlFor="reason">What in the conversation puts them here</label>
                    <textarea id="reason" name="reason" rows={2} required
                              placeholder="She asked, unprompted, what we do — twice." />
                    <button className="btn">Record the path</button>
                  </form>
                )}
              </Card>
            )}

            {/* THE HANDOFF QUALITY GATE */}
            {gateResult && (
              <Card title="Before this becomes a commercial conversation"
                    extra={gateResult.ok
                      ? <Pill colour="green">all seven</Pill>
                      : <Pill colour="amber">
                          {7 - gateResult.missing.length}/7
                        </Pill>}>
                <p className="lede">
                  Path E or F needs every one of these. Any unchecked box and the
                  school stays on C or D.
                </p>
                <ul className="plain sm">
                  {gateResult.checks.map((c) => (
                    <li key={c.key}>
                      <Pill colour={c.ok ? "green" : "slate"}>{c.ok ? "✓" : "—"}</Pill>{" "}
                      {c.label}
                      {!c.ok && <div className="muted">{c.why}</div>}
                    </li>))}
                </ul>
              </Card>
            )}

            {/* THE RECORD */}
            <Card title="The episode">
              <KV rows={[
                ["Question", (pod.episode_question as string) ?? "not written"],
                ["Must not be asked", (pod.do_not_ask as string) ?? "nothing recorded"],
                ["Location", (pod.recording_location as string) ?? "—"],
                ["Published", pod.published_on
                  ? dateOnly(pod.published_on as string) : "—"],
                ["URL", pod.episode_url
                  ? <a href={pod.episode_url as string} target="_blank"
                       rel="noreferrer">{pod.episode_url as string}</a> : "—"],
                ["Cuts asked for", String(pod.cut_requests ?? 0)],
                ["Cuts refused", Number(pod.cut_requests_refused ?? 0) > 0
                  ? <Pill colour="red">{String(pod.cut_requests_refused)}</Pill>
                  : "none"],
                ["Owner", (owner?.full_name as string) ?? "unassigned"],
              ]} />
              {staff && (
                <details style={{ marginTop: 8 }}>
                  <summary className="lk">Correct these details</summary>
                  <form action={updateEpisode} className="form tight">
                    <input type="hidden" name="school_id" value={id} />
                    <label>The episode question
                      <textarea name="episode_question" rows={2}
                                defaultValue={(pod.episode_question as string) ?? ""} />
                    </label>
                    <label>What must not be asked
                      <textarea name="do_not_ask" rows={2}
                                defaultValue={(pod.do_not_ask as string) ?? ""}
                                placeholder="Anything about the court case. Anything about the other trustee." />
                    </label>
                    <label>Recording date
                      <input name="recording_date" type="date"
                             defaultValue={(pod.recording_date as string) ?? ""} />
                    </label>
                    <label>Episode URL
                      <input name="episode_url"
                             defaultValue={(pod.episode_url as string) ?? ""} />
                    </label>
                    <label>Cuts asked for
                      <input name="cut_requests" type="number" min="0"
                             defaultValue={String(pod.cut_requests ?? 0)} />
                    </label>
                    <label>Cuts refused
                      <input name="cut_requests_refused" type="number" min="0"
                             defaultValue={String(pod.cut_requests_refused ?? 0)} />
                    </label>
                    <div className="help">
                      A refused cut is a governance incident, not a negotiation.
                    </div>

                    <label className="chk">
                      <input type="checkbox" name="invisibility_test_passed"
                             defaultChecked={!!pod.invisibility_test_passed} />
                      The Invisibility Test passed — the published episode does not sell
                    </label>
                    <label className="chk">
                      <input type="checkbox" name="no_deck_confirmed"
                             defaultChecked={!!pod.no_deck_confirmed} />
                      Nobody has sent this school a deck
                    </label>
                    <div className="help">
                      These two are the only checks the system cannot make for itself.
                      Ticking one puts your name and the time against it.
                    </div>
                    <button className="btn grey">Save</button>
                  </form>
                </details>
              )}
            </Card>

            <Card title="What has happened">
              {history.length === 0 ? <Empty what="Nothing logged yet." /> : (
                <ul className="feed">
                  {history.map((h) => (
                    <li key={h.id as string}>
                      <div>{h.summary as string}</div>
                      <div className="muted sm">
                        {(h.actor_name as string) ?? "system"} ·{" "}
                        {shortDate(h.occurred_at as string)}
                      </div>
                    </li>))}
                </ul>)}
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}
