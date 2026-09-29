import Link from "next/link";
import { notFound } from "next/navigation";
import * as db from "@/server/db";
import * as schools from "@/domain/schools";
import * as stage from "@/domain/stage";
import * as work from "@/domain/work";
import * as people from "@/domain/people";
import * as activity from "@/domain/activity";
import * as audit from "@/domain/audit";
import {
  LADDER, HOLDING, TEAMS, stageName, stageColour, teamName,
} from "@/domain/journey";
import Shell from "@/ui/Shell";
import {
  Breadcrumb, Card, ContactButtons, Empty, Flash, KV, Notice, Pill, Top,
  dueText, shortDate, dateOnly,
} from "@/ui/primitives";
import {
  updateSchool, assignSchool, setPodcastStatus, recordSignal, revertStage,
} from "@/app/actions";
import { showStatusName, showPhase, pathName } from "@/domain/show";
import { page, flash, first, isFounder, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

/**
 * THE SCHOOL — the central operational context.
 *
 * Answers, in order: where are we, what do I do now, what must close before the next
 * stage, what is everyone doing, who matters, what happened, who changed it.
 */
export default async function SchoolPage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP },
) {
  const { id } = await params;
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;

  const { me, data } = await page(async (u) => {
    const school = await db.get("schools", id);
    if (!school) return null;
    const account = (await db.get("accounts", school.account_id as string))!;
    const wf = first(sp.work);
    return {
      school, account,
      live: await schools.liveStatus(id),
      progress: await stage.progress(id, String(school.stage)),
      next: await stage.nextStageOf(id),
      folk: await people.atSchool(id),
      board: await work.schoolBoard(id, {
        team: TEAMS.some((t) => t.key === wf) ? wf : null,
        ownerId: wf === "mine" ? u.id : null,
        status: ["waiting", "blocked"].includes(wf) ? wf : null,
      }),
      wf,
      resolved: await work.withNames(
        `w.school_id = ? and w.status in ('resolved','cancelled')`, [id],
        "w.completed_at desc nulls last"),
      timeline: await activity.forSchool(id, 30),
      history: await audit.search({ schoolId: id, limit: 40 }),
      transitions: await db.many(
        `select t.*, p.full_name as by_name from public.stage_transitions t
           left join public.profiles p on p.id = t.moved_by
          where t.subject_type = 'school' and t.subject_id = ?
          order by t.moved_at desc`, [id]),
      podcast: await db.one(
        "select * from public.podcast_relationships where school_id = ?", [id]),
      showWork: (await db.one(
        `select count(*) filter (where status in ('open','in_progress','waiting','blocked')) as open,
                count(*) filter (where status in ('open','in_progress') and due_at < now()) as overdue
           from public.work_items
          where school_id = ? and workstream in ('podcast','production')`, [id]))!,
      signals: await db.many(
        `select * from public.podcast_signals where school_id = ?
          order by observed_at desc limit 5`, [id]),
      owners: await db.many(
        `select p.id, p.full_name from public.profiles p
           join public.user_roles r on r.user_id = p.id
          where r.status='active' and r.role <> 'external' order by p.full_name`),
    };
  });
  if (!data) notFound();

  const { school, account, live, progress, next, folk, board, wf, resolved,
          timeline, history, transitions, podcast, showWork, signals,
          owners } = data;
  const lastMove = transitions.find((t) => !t.reverted_by_id && !t.reverts_id);

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Breadcrumb account={{ id: account.id as string, name: account.name as string }}
                  school={{ id, name: school.name as string }} />
      <Top
        title={school.name as string}
        sub={[school.locality ?? school.city, school.board,
              school.enrolled_student_count ? `${school.enrolled_student_count} students` : null,
              school.udise_code ? `UDISE ${school.udise_code}` : null]
          .filter(Boolean).join(" · ")}
        right={
          <div className="btns">
            <Link className="btn" href={`/schools/${id}/people/new`}>+ Add person</Link>
            <Link className="btn ghost" href={`/work/new?school=${id}`}>+ Add work</Link>
          </div>
        }
      />

      {/* FOUR STATES, SIDE BY SIDE. None of them competing. */}
      <div className="states">
        <div className="st">
          <div className="k">Relationship</div>
          <div className="v"><Pill colour={live.stageColour}>{live.stage}</Pill></div>
        </div>
        <div className="st">
          <div className="k">Beyond the Classroom</div>
          <div className="v">{live.podcast
            ? <Pill colour="plum">{live.podcast.status}</Pill>
            : <span className="muted">not started</span>}</div>
        </div>
        <div className="st">
          <div className="k">Commercial</div>
          <div className="v">{live.commercial.length
            ? live.commercial.map((o) => (
                <Link key={o.id} href={`/opportunities/${o.id}`}>
                  <Pill colour="green">{o.stage}</Pill>
                </Link>))
            : <Link className="muted" href={`/schools/${id}/opportunity/new`}>
                + open one
              </Link>}</div>
        </div>
        <div className="st">
          <div className="k">Delivery</div>
          <div className="v">{live.delivery
            ? <Pill colour="amber">{live.delivery.stage}</Pill>
            : <span className="muted">not started</span>}</div>
        </div>
        <div className="st">
          <div className="k">Owner</div><div className="v">{live.owner}</div>
        </div>
        <div className="st">
          <div className="k">SLA</div>
          <div className="v"><Pill colour={
            live.clock.state === "overdue" ? "red"
            : live.clock.state === "at_risk" ? "amber"
            : live.clock.state === "on_track" ? "green" : "slate"
          }>{live.clock.text}</Pill></div>
        </div>
      </div>

      {/* The ladder. One journey, current position marked. */}
      <div className="ladder">
        {LADDER.map((s) => s.key === live.stageKey
          ? <span key={s.key} className="on">{s.num}. {s.name}</span>
          : <Link key={s.key} href={`/schools/${id}/advance?to=${s.key}`}
                  className={s.num < (LADDER.find((x) => x.key === live.stageKey)?.num ?? 0)
                    ? "past" : ""}>{s.num}. {s.name}</Link>)}
        {HOLDING.map((s) => s.key === live.stageKey
          ? <span key={s.key} className="on">{s.name}</span>
          : <Link key={s.key} href={`/schools/${id}/advance?to=${s.key}`}>{s.name}</Link>)}
      </div>

      <div className="wgrid">
        {([["Active work", board.counts.active, false],
           ["Overdue", board.counts.overdue, board.counts.overdue > 0],
           ["Waiting on school", board.counts.waiting, false],
           ["Blocked", board.counts.blocked, board.counts.blocked > 0],
           ["Resolved", live.resolved, false],
           ["People", folk.all.length, false]] as [string, number, boolean][])
          .map(([k, v, hot]) => (
            <div className={`cell${hot ? " hot" : ""}`} key={k}>
              <div className="k">{k}</div><div className="v">{v}</div>
            </div>))}
      </div>

      {live.noNextAction && (
        <Notice kind="warn" title="No next action.">
          This school is being worked but nothing is scheduled against it. That is a
          management problem, not a customer signal.
        </Notice>
      )}

      <div className="grid g-main">
        <div>
          {/* WHAT DO I DO NOW? */}
          <Card title="What needs to happen now">
            {live.nextAction ? (
              <>
                <div className="t" style={{ fontSize: 16 }}>
                  <Link href={`/work/${live.nextAction.id}`}>
                    {live.nextAction.title as string}
                  </Link>
                </div>
                <p style={{ margin: "6px 0 10px" }}>{live.nextAction.reason as string}</p>
                <KV rows={[
                  ["Owner", live.owner],
                  ["Due", dueText(live.nextAction.due_at as string)],
                  ["Team", teamName(live.nextAction.team as string)],
                ]} />
                <div className="btns" style={{ marginTop: 10 }}>
                  <Link className="btn" href={`/work/${live.nextAction.id}`}>Open it</Link>
                </div>
              </>
            ) : (
              <Empty what={live.stageKey === "lead"
                ? "This is a fresh lead. Move it to Target when you decide to work it."
                : "Nothing is scheduled against this school."}
                action={<Link className="btn" href={`/work/new?school=${id}`}>
                  + Add work
                </Link>} />
            )}
          </Card>

          {/* Before this stage can close. Blocking only. */}
          <Card title={`Stage: ${progress.def.name}`}
                extra={progress.total
                  ? <Pill colour={progress.ready ? "green" : "amber"}>
                      {progress.done}/{progress.total} required work done
                    </Pill>
                  : <Pill colour="slate">no standing work</Pill>}>
            <p style={{ margin: "0 0 10px" }}>{progress.def.meaning}</p>
            {progress.items.map((t) => (
              <div className="wrow" key={t.id as string}>
                <div className={`mark ${t.status === "resolved" ? "done"
                  : t.status === "blocked" ? "stop"
                  : t.status === "waiting" ? "warn" : "open"}`}>
                  {t.status === "resolved" ? "✓" : t.status === "blocked" ? "⊘"
                    : t.status === "waiting" ? "⚠" : "○"}
                </div>
                <div className="grow">
                  <div className="t">
                    <Link href={`/work/${t.id}`}>{t.title as string}</Link>
                  </div>
                  <div className="s">
                    {[t.owner_name, teamName(t.team as string),
                      t.blocking ? "blocking" : "non-blocking"].filter(Boolean).join(" · ")}
                  </div>
                  {t.status === "resolved" && !!t.resolution_note && (
                    <div className="s">{t.resolution_note as string}</div>
                  )}
                </div>
                <div className="rt"><span className="s">{dueText(t.due_at as string)}</span></div>
              </div>
            ))}
            <div className="s" style={{ marginTop: 8 }}>
              <b>Done when:</b> {progress.def.exit}
            </div>
            {next && (
              <div className="btns" style={{ marginTop: 12 }}>
                <Link className={progress.ready ? "btn" : "btn grey"}
                      href={`/schools/${id}/advance?to=${next.key}`}>
                  Move to {next.name}
                </Link>
                {!progress.ready && progress.open[0] && (
                  <Link className="btn grey" href={`/work/${progress.open[0].id}`}>
                    Open the missing work
                  </Link>
                )}
              </div>
            )}
            {progress.ready && next && (
              <p className="help" style={{ marginTop: 8 }}>
                Everything {progress.def.name} requires is done. Nothing moves until you
                say so.
              </p>
            )}
          </Card>

          {/* ALL the work, grouped by workstream. Parallel, not sequential. */}
          <Card title="Active work"
                extra={<Link className="btn sm" href={`/work/new?school=${id}`}>+ Add</Link>}>
            <div className="tabs">
              {([["", "All"], ["mine", "Mine"],
                 ...TEAMS.map((t) => [t.key, t.name] as [string, string]),
                 ["waiting", "Waiting"], ["blocked", "Blocked"]] as [string, string][])
                .map(([k, label]) => (
                  <Link key={k || "all"} className={wf === k ? "on" : ""}
                        href={k ? `/schools/${id}?work=${k}` : `/schools/${id}`}>{label}</Link>
                ))}
            </div>
            {board.groups.length === 0 ? (
              <Empty what={wf ? "No work of that kind is open here."
                : "Nothing is open for this school right now."}
                action={<Link className="btn" href={`/work/new?school=${id}`}>
                  + Add the first piece of work
                </Link>} />
            ) : board.groups.map((g) => (
              <div className="wstream" key={g.key}>
                <h4>{g.name}</h4>
                {g.items.map((t) => (
                  <div className="wrow" key={t.id as string}>
                    <div className={`mark ${t.status === "blocked" ? "stop"
                      : t.status === "waiting" ? "warn"
                      : t.status === "in_progress" ? "warn" : "open"}`}>
                      {t.status === "blocked" ? "⊘" : t.status === "waiting" ? "⚠"
                        : t.status === "in_progress" ? "●" : "○"}
                    </div>
                    <div className="grow">
                      <div className="t">
                        <Link href={`/work/${t.id}`}>{t.title as string}</Link>
                      </div>
                      <div className="s">
                        {[t.owner_name, teamName(t.team as string),
                          t.blocking ? "blocking" : null].filter(Boolean).join(" · ")}
                      </div>
                      {t.status === "waiting" && (
                        <div className="s">
                          Waiting on {(t.waiting_on as string) ?? "the school"}
                          {t.follow_up_on
                            ? ` · chase ${String(t.follow_up_on).slice(0, 10)}` : ""}
                        </div>
                      )}
                      {!!t.blocked_by_title && (
                        <div className="s">
                          Blocked by <Link href={`/work/${t.blocked_by_id}`}>
                            {t.blocked_by_title as string}</Link> — not by its owner
                        </div>
                      )}
                    </div>
                    <div className="rt">
                      <span className="s">{dueText(t.due_at as string)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Card>

          {/* PEOPLE, grouped so a rep can read them. */}
          <Card title={`People (${folk.all.length})`}
                extra={<Link className="btn sm" href={`/schools/${id}/people/new`}>
                  + Add person</Link>}>
            {folk.all.length === 0 && folk.groupLevel.length === 0 ? (
              <Empty what="Nobody is on file here. A school is reached through a person, never through a building."
                action={<Link className="btn" href={`/schools/${id}/people/new`}>
                  + Add the first person</Link>} />
            ) : (
              <>
                {folk.primaryPoc && (
                  <div className="wstream">
                    <h4>Primary point of contact</h4>
                    <PersonRow p={folk.primaryPoc} />
                  </div>
                )}
                {([["Decision makers and leadership", folk.decisionMakers],
                   ["Operational contacts", folk.operational],
                   ["Other contacts", folk.other]] as [string, db.Row[]][])
                  .filter(([, rows]) => rows.length)
                  .map(([label, rows]) => (
                    <div className="wstream" key={label}>
                      <h4>{label}</h4>
                      {rows.map((p) => <PersonRow key={p.id as string} p={p} />)}
                    </div>
                  ))}
                {folk.groupLevel.length > 0 && (
                  <div className="wstream">
                    <h4>Group level — {account.name as string}</h4>
                    <p className="help">
                      Recorded against the account rather than a campus. If one of them
                      really belongs here, open them and add the association.
                    </p>
                    {folk.groupLevel.map((p) => <PersonRow key={p.id as string} p={p} />)}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card title="What happened">
            {timeline.length === 0
              ? <Empty what="Nothing has been logged against this school yet." />
              : (
                <ul className="tl">
                  {timeline.map((a) => (
                    <li key={a.id as string}>
                      <span className="d">{shortDate(a.occurred_at as string)}</span>
                      <div className="grow">
                        <div>{(a.outcome_label as string) || (a.activity_type as string)}</div>
                        <div className="s muted">
                          {a.summary as string}
                          {a.actor_name ? ` · ${a.actor_name as string}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </Card>

          {!!resolved.length && (
            <details>
              <summary>What has already been done ({resolved.length})</summary>
              <div className="dbody">
                {resolved.map((t) => (
                  <div className="wrow" key={t.id as string}>
                    <div className={`mark ${t.status === "resolved" ? "done" : "open"}`}>
                      {t.status === "resolved" ? "✓" : "×"}
                    </div>
                    <div className="grow">
                      <div className="t">{t.title as string}</div>
                      <div className="s">
                        {t.status === "cancelled" ? "Cancelled" : "Resolved"}
                        {t.completed_at ? ` · ${dateOnly(t.completed_at as string)}` : ""}
                        {t.resolution_note ? ` — ${t.resolution_note as string}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div>
          {/* UNDO: put the last move back, through the same engine. */}
          {lastMove && (
            <Card title="Last stage change">
              <KV rows={[
                ["Moved", `${stageName(lastMove.from_stage as string)} → ` +
                          `${stageName(lastMove.to_stage as string)}`],
                ["By", (lastMove.by_name as string) ?? "—"],
                ["When", shortDate(lastMove.moved_at as string)],
                ["Why", (lastMove.reason as string) ?? "—"],
              ]} />
              <details style={{ marginTop: 10 }}>
                <summary className="lk">That was wrong — put it back</summary>
                <form action={revertStage} className="form tight">
                  <input type="hidden" name="school_id" value={id} />
                  <input type="hidden" name="transition_id" value={lastMove.id as string} />
                  <label>Why is it being put back?
                    <input name="why" required placeholder="Moved the wrong school." />
                  </label>
                  <div className="btns">
                    <button className="btn grey" type="submit">
                      Put back to {stageName(lastMove.from_stage as string)}
                    </button>
                  </div>
                  <p className="help">
                    The reversal is recorded as its own event. Nothing is erased, and
                    work nobody has started is cancelled rather than deleted.
                  </p>
                </form>
              </details>
            </Card>
          )}

          {/* Beyond the Classroom — a workstream with its own operation. */}
          <Card title="Beyond the Classroom"
                extra={showWork.open > 0
                  ? <Pill colour={showWork.overdue > 0 ? "red" : "amber"}>
                      {showWork.open} open
                    </Pill>
                  : null}>
            <KV rows={[
              ["Status", podcast
                ? <>{showStatusName(podcast.status as string)}{" "}
                    <span className="s">· {showPhase(podcast.status as string)}</span></>
                : "Not started"],
              ...(podcast?.episode_question
                ? [["Episode question", podcast.episode_question as string]] as
                    [string, React.ReactNode][] : []),
              ...(podcast?.path
                ? [["Path", `${podcast.path as string} — ${pathName(podcast.path as string)}`]] as
                    [string, React.ReactNode][] : []),
            ]} />
            <div className="btns" style={{ marginTop: 8 }}>
              <Link className="btn" href={`/schools/${id}/show`}>
                {podcast ? "Open the show workstream" : "Put this school on the show"}
              </Link>
            </div>
            <p className="help">
              Planning, production and publication all live there. None of it moves the
              school — a recorded signal and a human decision do that.
            </p>
          </Card>

          {/* Signals: what they actually said. The only thing that justifies Discovery. */}
          <Card title="What they have said"
                extra={signals.length ? <Pill colour="plum">{signals.length}</Pill> : null}>
            {signals.length === 0
              ? <p className="s" style={{ margin: 0 }}>
                  Nothing recorded yet. Discovery opens when somebody at the school
                  names a problem in their own words.
                </p>
              : signals.map((s) => (
                  <div key={s.id as string} style={{ marginBottom: 10 }}>
                    <div className="quote">{s.verbatim_quote as string}</div>
                    <div className="s">
                      {s.speaker as string}
                      {s.speaker_role ? `, ${s.speaker_role as string}` : ""} ·{" "}
                      {dateOnly(s.observed_at as string)}
                    </div>
                  </div>
                ))}
            <details style={{ marginTop: 8 }}>
              <summary className="lk">Record something they said</summary>
              <form action={recordSignal} className="form tight">
                <input type="hidden" name="school_id" value={id} />
                <label>Their exact words <span className="req">*</span>
                  <textarea name="verbatim_quote" rows={3} required
                            placeholder="We re-key every admission form into three systems and the counts never agree." />
                </label>
                <label>Who said it <span className="req">*</span>
                  <input name="speaker" required placeholder="Priya Sharma" />
                </label>
                <label>Their role
                  <input name="speaker_role" placeholder="Principal" />
                </label>
                <div className="btns">
                  <button className="btn" type="submit">Record it</button>
                </div>
                <p className="help">
                  A quote and a named speaker, never a summary. Without that a CRM of
                  interpretations is indistinguishable from a CRM of wishes.
                </p>
              </form>
            </details>
          </Card>

          <Card title="Who owns this school">
            <p style={{ margin: "0 0 10px" }}>
              <b>{live.owner}</b>
              {live.stageKey === "lead"
                ? " — nothing is required until it is made a Target."
                : " — this school's work appears in their day."}
            </p>
            <details>
              <summary className="lk">Reassign</summary>
              <form action={assignSchool} className="form tight">
                <input type="hidden" name="school_id" value={id} />
                <label>New owner
                  <select name="owner_id" defaultValue={(school.owner_id as string) ?? ""}>
                    <option value="">Nobody — it will count as orphaned</option>
                    {owners.map((o) => (
                      <option key={o.id as string} value={o.id as string}>
                        {o.full_name as string}
                      </option>))}
                  </select>
                </label>
                <label>Why<input name="reason" placeholder="Founder taking the commercial conversation" /></label>
                <div className="btns">
                  <button className="btn grey" type="submit">Reassign</button>
                </div>
                <p className="help">
                  Ownership is per school. Reassigning one campus does not move the rest
                  of the group.
                </p>
              </form>
            </details>
          </Card>

          <Card title="This school">
            <KV rows={[
              ["Account", <Link key="a" href={`/accounts/${account.id}`}>
                {account.name as string}</Link>],
              ["Board", (school.board as string) ?? "—"],
              ["Locality", (school.locality as string) ?? (school.city as string) ?? "—"],
              ["Students", school.enrolled_student_count
                ? String(school.enrolled_student_count) : "not established"],
              ["UDISE", (school.udise_code as string) ?? "not recorded"],
              ["Affiliation", (school.affiliation_number as string) ?? "not recorded"],
              ["Systems", (school.existing_erp_lms as string) ?? "not established"],
            ]} />
            {!!school.context_note && (
              <>
                <div className="lbl" style={{ marginTop: 12 }}>Why this school matters</div>
                <p style={{ margin: "2px 0 0" }}>{school.context_note as string}</p>
              </>
            )}
            <details style={{ marginTop: 10 }}>
              <summary className="lk">Correct these details</summary>
              <form action={updateSchool} className="form tight">
                <input type="hidden" name="school_id" value={id} />
                {([["board", "Board"], ["locality", "Locality"],
                   ["official_phone", "Office phone"], ["official_email", "Office email"],
                   ["website", "Website"], ["udise_code", "UDISE code"]] as const)
                  .map(([k, label]) => (
                    <label key={k}>{label}
                      <input name={k} defaultValue={(school[k] as string) ?? ""} />
                    </label>))}
                <label>Students
                  <input name="enrolled_student_count" type="number"
                         defaultValue={(school.enrolled_student_count as number) ?? ""} />
                </label>
                <label>Why this school matters
                  <textarea name="context_note" rows={3}
                            defaultValue={(school.context_note as string) ?? ""} />
                </label>
                <div className="btns"><button className="btn" type="submit">Save</button></div>
                <p className="help">
                  The stage is not editable here. It changes through the gate, which
                  checks what must be true first — a form that could set it silently
                  would make the gate decorative.
                </p>
              </form>
            </details>
          </Card>

          {isFounder(me) && (
            <Card title="Who changed what" extra={<Link className="lk"
                    href={`/audit?school=${id}`}>Everything</Link>}>
              {history.length === 0 ? <p className="s" style={{ margin: 0 }}>Nothing yet.</p>
                : (
                  <ul className="tl">
                    {history.slice(0, 8).map((a) => (
                      <li key={String(a.id)}>
                        <span className="d">{shortDate(a.occurred_at as string)}</span>
                        <div className="grow">
                          <div>{String(a.action).replace(/_/g, " ").toLowerCase()}</div>
                          <div className="s muted">
                            {a.actor_name as string}
                            {a.reason ? ` — ${a.reason as string}` : ""}
                          </div>
                        </div>
                      </li>))}
                  </ul>
                )}
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}

function PersonRow({ p }: { p: db.Row }) {
  return (
    <div className="wrow">
      <div className="grow">
        <div className="t">
          <Link href={`/people/${p.id}`}>{p.name as string}</Link>{" "}
          {((p.relationships as string[]) ?? []).map((r) => {
            const m = people.relationshipMeta(r);
            return m ? <Pill key={r} colour="slate">{m.short}</Pill> : null;
          })}
        </div>
        <div className="s">{(p.role_label as string) ?? (p.title as string) ?? ""}</div>
        <div style={{ marginTop: 4 }}><ContactButtons person={p} sm /></div>
      </div>
    </div>
  );
}
