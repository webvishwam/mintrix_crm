import * as db from "@/server/db";
import * as audit from "./audit";
import * as activity from "./activity";
import * as work from "./work";
import * as commercial from "./commercial";
import {
  BY_KEY, LADDER, HOLDING, isLegalMove, stageName, teamName,
  type Stage, type StageDef, type EntryCheck,
} from "./journey";

/**
 * THE STAGE TRANSITION ENGINE.
 *
 * ONE function. Drag-and-drop, the Move button, the stage selector, the bulk action
 * and any future API all call `move()`. There is no second copy of this logic in a
 * component, which is the only way the gate can be trusted.
 *
 * Side effects are defined here and nowhere else:
 *   close the old SLA -> open the new one -> create the stage's work ->
 *   write the transition -> write the handoff -> log the activity -> write the audit
 * All inside one savepoint, so a school never ends up moved with its history missing.
 */

export type CheckResult = { check: EntryCheck; ok: boolean; detail: string };

// --------------------------------------------------------------------------
// Entry checks — evaluated live against data, never stored as a flag
// --------------------------------------------------------------------------
export async function entryChecks(schoolId: string, stage: string): Promise<CheckResult[]> {
  const def = BY_KEY[stage];
  if (!def || !def.entry.length) return [];
  const school = await db.get("schools", schoolId);
  if (!school) return [];

  const people = await db.many(
    `select p.*, r.relationship_types
       from public.person_roles r join public.people p on p.id = r.person_id
      where r.school_id = ? and r.ended_on is null`, [schoolId]);
  const reachable = people.filter((p) =>
    usable(p.phone as string) || usable(p.email as string));
  const dm = people.filter((p) =>
    (p.relationship_types as string[] ?? []).includes("decision_maker"));
  const icp = await db.one(
    "select id from public.icp_assessments where school_id = ? limit 1", [schoolId]);
  const signal = await db.one(
    "select verbatim_quote, speaker from public.podcast_signals where school_id = ? limit 1",
    [schoolId]);
  const problem = await db.one(
    `select d.problem from public.discoveries d
      where d.school_id = ? and coalesce(btrim(d.problem),'') <> '' limit 1`, [schoolId]);

  return def.entry.map((check): CheckResult => {
    switch (check.key) {
      case "identified": {
        const missing = (["board", "locality"] as const)
          .filter((f) => !String(school[f] ?? "").trim());
        return { check, ok: missing.length === 0,
                 detail: missing.length ? `Missing: ${missing.join(", ")}`
                   : `${school.board} · ${school.locality}` };
      }
      case "account":
        return { check, ok: !!school.account_id, detail: String(school.account_id ?? "—") };
      case "owner":
        return { check, ok: !!school.owner_id,
                 detail: school.owner_id ? "Owned" : "Nobody owns this school" };
      case "icp":
        return { check, ok: !!icp, detail: icp ? "Recorded" : "No ICP assessment yet" };
      case "person":
        return { check, ok: people.length > 0,
                 detail: people.length ? `${people.length} on file` : "Nobody on file" };
      case "contact_route":
        return { check, ok: reachable.length > 0,
                 detail: reachable.length ? `${reachable.length} reachable`
                   : "No phone or email on anyone here" };
      case "decision_maker":
        return { check, ok: dm.length > 0,
                 detail: dm.length ? (dm[0].name as string) : "No decision maker named" };
      case "signal":
        return { check, ok: !!signal,
                 detail: signal ? `"${String(signal.verbatim_quote).slice(0, 60)}…" — ${signal.speaker}`
                   : "No recorded signal. The show does not create one; a human does." };
      case "problem":
        return { check, ok: !!problem,
                 detail: problem ? String(problem.problem).slice(0, 70)
                   : "The problem has not been written down in their words" };
      default:
        return { check, ok: false, detail: "Unknown check" };
    }
  });
}

const usable = (v?: string | null) => {
  const s = String(v ?? "").trim().toLowerCase();
  return !!s && !["not found", "not publicly verified", "uncertain", "-", "n/a"]
    .some((b) => s.startsWith(b));
};

export const fixHref = (c: EntryCheck, schoolId: string) =>
  c.fix.replace("{school}", schoolId);

// --------------------------------------------------------------------------
// Progress — blocking work only, because only blocking work holds a stage
// --------------------------------------------------------------------------
export interface Progress {
  def: StageDef;
  items: db.Row[];
  blocking: db.Row[];
  open: db.Row[];
  nonBlocking: db.Row[];
  done: number;
  total: number;
  ready: boolean;
}

export async function progress(schoolId: string, stage: string): Promise<Progress> {
  const def = BY_KEY[stage] ?? BY_KEY.lead;
  const items = await work.withNames(
    "w.school_id = ? and w.stage = ?::journey_stage", [schoolId, stage],
    "w.blocking desc, w.created_at");
  const blocking = items.filter((t) => t.blocking && t.status !== "cancelled");
  const open = blocking.filter((t) => t.status !== "resolved");
  return {
    def, items, blocking, open,
    nonBlocking: items.filter((t) => !t.blocking),
    done: blocking.length - open.length, total: blocking.length,
    ready: open.length === 0,
  };
}

// --------------------------------------------------------------------------
// The gate
// --------------------------------------------------------------------------
export interface Gate {
  from: StageDef;
  to: StageDef | null;
  legal: boolean;
  illegalReason: string | null;
  entry: CheckResult[];
  missingEntry: CheckResult[];
  progress: Progress;
  missingWork: db.Row[];
  ok: boolean;
}

export async function gate(schoolId: string, to: string): Promise<Gate> {
  const school = await db.get("schools", schoolId);
  const fromKey = String(school?.stage ?? "lead");
  const from = BY_KEY[fromKey] ?? BY_KEY.lead;
  const target = BY_KEY[to] ?? null;

  const legal = !!target && isLegalMove(fromKey, to);
  const illegalReason = !target ? `"${to}" is not a stage.`
    : fromKey === to ? `This school is already at ${target.name}.`
    : legal ? null
    : `${target.name} does not follow ${from.name}. Work the stage this school is in, ` +
      "or ask the founder to override.";

  const entry = target ? await entryChecks(schoolId, to) : [];
  const prog = await progress(schoolId, fromKey);
  const missingEntry = entry.filter((c) => !c.ok);
  // A holding state is a decision, not an achievement: never gated on work.
  const missingWork = target?.terminal ? [] : prog.open;

  return {
    from, to: target, legal, illegalReason, entry, missingEntry,
    progress: prog, missingWork,
    ok: legal && missingEntry.length === 0 && missingWork.length === 0,
  };
}

export async function nextStageOf(schoolId: string): Promise<StageDef | null> {
  const s = await db.get("schools", schoolId);
  const def = BY_KEY[String(s?.stage ?? "lead")];
  return def?.next ? BY_KEY[def.next] ?? null : null;
}

// --------------------------------------------------------------------------
// The work a stage requires
// --------------------------------------------------------------------------
export async function ownerForTeam(team: string, school: db.Row): Promise<string | null> {
  if (team === "sales") return (school.owner_id as string) ?? db.currentUserId();
  const member = await db.one(
    `select user_id from public.user_roles
      where team = ?::mintrix_team and status = 'active' order by granted_at limit 1`,
    [team]);
  if (member) return member.user_id as string;
  const founder = await db.one(
    "select user_id from public.user_roles where role = 'founder' and status = 'active' limit 1");
  return (founder?.user_id as string) ?? (school.owner_id as string) ?? db.currentUserId();
}

export async function createStageWork(schoolId: string, stage: string): Promise<string[]> {
  const def = BY_KEY[stage];
  const school = await db.get("schools", schoolId);
  if (!def || !school) return [];
  const created: string[] = [];
  for (const w of def.work) {
    try {
      const id = await work.create({
        accountId: school.account_id as string, schoolId,
        title: w.title.replace("{school}", school.name as string),
        reason: w.reason, requiredOutcome: w.outcome ?? null,
        team: w.team, workstream: w.workstream, taskType: w.task_type,
        blocking: w.blocking, stage, templateKey: w.key, slaHours: w.sla_hours,
        ownerId: await ownerForTeam(w.team, school), autoGenerated: true,
      });
      if (!created.includes(id)) created.push(id);
    } catch { /* a rejected title must never block a stage move */ }
  }
  return created;
}

// --------------------------------------------------------------------------
// The handoff — assembled from rows, nothing generated
// --------------------------------------------------------------------------
export async function buildHandoff(schoolId: string, from: string, to: string,
                                   opts: { overridden?: boolean; reason?: string | null } = {}) {
  const school = await db.get("schools", schoolId);
  const account = await db.get("accounts", school!.account_id as string);
  const clock = await db.one(
    `select * from public.stage_slas where subject_type = 'school' and subject_id = ?
       and closed_at is null order by entered_at desc limit 1`, [schoolId]);
  const since = (clock?.entered_at as string) ?? (school!.created_at as string);

  const items = await work.withNames("w.school_id = ? and w.created_at >= ?",
                                     [schoolId, since], "w.created_at");
  const acts = await db.many(
    `select occurred_at, summary from public.activities
      where school_id = ? and occurred_at >= ? order by occurred_at desc limit 12`,
    [schoolId, since]);
  const stakeholders = await db.many(
    `select p.name, r.school_role, r.custom_role, r.relationship_types
       from public.person_roles r join public.people p on p.id = r.person_id
      where r.school_id = ? and r.ended_on is null`, [schoolId]);
  const discovery = await db.one(
    "select problem from public.discoveries where school_id = ? limit 1", [schoolId]);
  const quotes = await db.many(
    `select verbatim_quote, speaker from public.podcast_signals
      where school_id = ? order by observed_at desc limit 3`, [schoolId]);
  const blockers = await db.many(
    "select item, blocker_type, requested_on from public.blockers where school_id = ? and resolved_at is null",
    [schoolId]);
  const target = BY_KEY[to];

  return {
    school: school!.name as string,
    account: (account?.name as string) ?? "",
    previous_stage: stageName(from),
    new_stage: stageName(to),
    date_entered: (clock?.entered_at as string) ?? null,
    date_exited: db.now(),
    days_in_stage: db.daysBetween(since),
    sla_met: clock?.due_at
      ? (String(clock.due_at) >= db.now() ? "met" : "MISSED") : "no clock was running",
    reason_for_transition: opts.reason?.trim()
      || (opts.overridden ? "Moved by override"
          : `Exit criteria met: ${BY_KEY[from]?.exit ?? "—"}`),
    overridden: !!opts.overridden,
    completed: items.filter((t) => t.status === "resolved").map((t) => ({
      title: t.title, outcome: t.resolution_note ?? "", by: t.owner_name ?? "" })),
    cancelled: items.filter((t) => t.status === "cancelled").map((t) => ({
      title: t.title, why: t.resolution_note ?? "cancelled, no reason recorded" })),
    outstanding: [
      ...items.filter((t) => ["open", "in_progress", "waiting", "blocked"]
        .includes(String(t.status))).map((t) => `${t.title} — still ${t.status}`),
      ...blockers.map((b) => `${b.item} — ${b.blocker_type}, since ${b.requested_on}`),
    ],
    activities: acts.map((a) => ({ when: a.occurred_at, what: a.summary })),
    stakeholders: stakeholders.map((s) => ({
      name: s.name,
      role: (s.custom_role as string) || (s.school_role as string) || "role not recorded",
      relationship: ((s.relationship_types as string[]) ?? []).join(", ") || "none recorded",
    })),
    problem: (discovery?.problem as string) ?? null,
    their_words: quotes.map((q) => ({ quote: q.verbatim_quote, speaker: q.speaker })),
    new_sla: target?.sla_hours ? `${target.sla_hours} hours` : null,
    next_actions: (target?.work ?? []).filter((w) => w.blocking)
      .map((w) => w.title.replace("{school}", school!.name as string)),
  };
}

// --------------------------------------------------------------------------
// THE MOVE
// --------------------------------------------------------------------------
export interface MoveResult {
  from: string; to: string; created: string[]; overridden: boolean; carried: number;
  transitionId: string;
}

export async function move(schoolId: string, to: string, opts: {
  overrideReason?: string | null; note?: string | null; isFounder: boolean;
} = { isFounder: false }): Promise<MoveResult> {
  const school = await db.get("schools", schoolId);
  if (!school) throw new Error("That school no longer exists.");
  const g = await gate(schoolId, to);
  if (!g.to) throw new Error(g.illegalReason ?? "Unknown stage.");

  const override = opts.overrideReason?.trim() || null;
  if (!g.legal && !override) throw new Error(g.illegalReason!);
  if (!g.ok && !override) {
    const missing = [...g.missingEntry.map((c) => c.check.label),
                     ...g.missingWork.map((t) => t.title as string)];
    throw new Error(`${g.to.name} is not open yet. Still to do: ${missing.join("; ")}`);
  }
  if (!g.ok && !opts.isFounder) {
    throw new Error("Only the founder can move a school past its requirements.");
  }

  const fromKey = String(school.stage);
  return db.transaction(async () => {
    const payload = await buildHandoff(schoolId, fromKey, to,
      { overridden: !g.ok, reason: opts.note ?? override });

    const transitionId = await db.insert("stage_transitions", {
      subject_type: "school", subject_id: schoolId,
      account_id: school.account_id, from_stage: fromKey, to_stage: to,
      overridden: !g.ok, override_reason: g.ok ? null : override,
      reason: payload.reason_for_transition, moved_by: db.currentUserId(),
    });

    await db.update("schools", schoolId, { stage: to, stage_entered_at: db.now() });

    // The opportunity does not have a ladder of its own. Its stage is a mirror of
    // the school's, written here and nowhere else, so the two cannot drift apart.
    await commercial.mirrorStage(schoolId, to);

    // One live stage clock, always.
    await db.run(
      `update public.stage_slas set closed_at = now(), closed_reason = 'moved_on'
        where subject_type = 'school' and subject_id = ? and closed_at is null`,
      [schoolId]);
    const hours = g.to!.sla_hours;
    await db.insert("stage_slas", {
      subject_type: "school", subject_id: schoolId,
      account_id: school.account_id, stage: to, sla_hours: hours,
      entered_at: db.now(), due_at: hours ? db.plusHours(hours) : null,
    });

    await db.insert("stage_handoffs", {
      transition_id: transitionId, subject_type: "school", subject_id: schoolId,
      account_id: school.account_id, from_stage: fromKey, to_stage: to,
      entered_at: payload.date_entered, exited_at: payload.date_exited,
      from_owner: school.owner_id, to_owner: school.owner_id,
      payload: JSON.stringify(payload),
    });

    // Non-blocking work from the stage we left keeps running. It was never the reason
    // the stage was shut, so leaving the stage does not finish it.
    const carried = (await db.many(
      `select id from public.work_items
        where school_id = ? and stage = ?::journey_stage and blocking = false
          and status in ${work.ACTIVE}`, [schoolId, fromKey])).length;

    const created = await createStageWork(schoolId, to);

    await activity.log({
      accountId: school.account_id as string, schoolId,
      type: "stage_moved", direction: "internal", outcomeKey: to,
      outcomeLabel: "Relationship stage changed",
      summary: `${school.name} moved from ${stageName(fromKey)} to ${stageName(to)}.` +
               (override ? ` Override: ${override}` : "") +
               (opts.note ? ` ${opts.note}` : ""),
    });
    await audit.record({
      action: "SCHOOL_STAGE_CHANGED", objectType: "school", objectId: schoolId,
      accountId: school.account_id as string, schoolId,
      before: { stage: fromKey }, after: { stage: to },
      reason: payload.reason_for_transition,
    });

    return { from: fromKey, to, created, overridden: !g.ok, carried, transitionId };
  });
}

/**
 * UNDO. Reverts through the same engine rather than writing the column back, so the
 * reversal gets its own history, its own SLA and its own audit row. Nothing is erased.
 */
export async function revert(transitionId: string, why: string, isFounder: boolean) {
  if (!why.trim()) throw new Error("Say why this is being put back.");
  const t = await db.get("stage_transitions", transitionId);
  if (!t) throw new Error("That change no longer exists.");
  if (t.reverted_by_id) throw new Error("That change has already been put back.");
  if (t.subject_type !== "school") throw new Error("Only a school move can be reverted here.");
  if (!isFounder && t.moved_by !== db.currentUserId()) {
    throw new Error("You can only put back a move you made yourself.");
  }
  const school = await db.get("schools", t.subject_id as string);
  if (!school) throw new Error("That school no longer exists.");
  if (String(school.stage) !== String(t.to_stage)) {
    throw new Error(
      `This school has moved on since — it is at ${stageName(school.stage as string)} ` +
      `now, not ${stageName(t.to_stage as string)}. Correct it from the stage selector.`);
  }

  return db.transaction(async () => {
    const back = String(t.from_stage);
    const undoId = await db.insert("stage_transitions", {
      subject_type: "school", subject_id: t.subject_id, account_id: t.account_id,
      from_stage: t.to_stage, to_stage: back, overridden: true,
      override_reason: `Reverting ${transitionId}`, reason: why.trim(),
      moved_by: db.currentUserId(), reverts_id: transitionId,
    });
    await db.update("stage_transitions", transitionId, { reverted_by_id: undoId });
    await db.update("schools", t.subject_id as string,
                    { stage: back, stage_entered_at: db.now() });
    await commercial.mirrorStage(t.subject_id as string, back);

    await db.run(
      `update public.stage_slas set closed_at = now(), closed_reason = 'reverted'
        where subject_type = 'school' and subject_id = ? and closed_at is null`,
      [t.subject_id]);
    const hours = BY_KEY[back]?.sla_hours ?? null;
    await db.insert("stage_slas", {
      subject_type: "school", subject_id: t.subject_id, account_id: t.account_id,
      stage: back, sla_hours: hours, entered_at: db.now(),
      due_at: hours ? db.plusHours(hours) : null,
    });

    // The work the mistaken stage created is cancelled, not deleted — and only the
    // work nobody has started.
    const undone = await db.run(
      `update public.work_items
          set status = 'cancelled',
              resolution_note = 'Cancelled: the stage move that created it was put back.'
        where school_id = ? and stage = ?::journey_stage and auto_generated = true
          and status = 'open'`, [t.subject_id, t.to_stage]);

    await activity.log({
      accountId: t.account_id as string, schoolId: t.subject_id as string,
      type: "stage_reverted", direction: "internal",
      outcomeLabel: "Stage put back",
      summary: `${school.name} put back from ${stageName(t.to_stage as string)} to ` +
               `${stageName(back)}. ${why.trim()}`,
    });
    await audit.record({
      action: "SCHOOL_STAGE_REVERTED", objectType: "school",
      objectId: t.subject_id as string, accountId: t.account_id as string,
      schoolId: t.subject_id as string,
      before: { stage: t.to_stage }, after: { stage: back },
      reason: why.trim(),
    });
    return { back, cancelled: undone.changes };
  });
}

export const ladder = () => LADDER;
export const holding = () => HOLDING;
export { stageName, teamName };
export type { Stage };
