import * as db from "@/server/db";
import { BY_KEY, stageName, stageColour, podcastStatusName, deliveryStageName }
  from "./journey";
import * as stage from "./stage";
import * as people from "./people";
import { ACTIVE } from "./work";

/**
 * READING A SCHOOL.
 *
 * The four states a school can be in are shown side by side, never collapsed:
 *
 *   relationship  where we are with them          schools.stage
 *   podcast       where the show is               podcast_relationships.status
 *   commercial    where a specific deal is        opportunities.stage
 *   delivery      where implementation is         delivery_projects.stage
 *
 * ABC School at Discovery, podcast Recorded, Production editing, opportunity at
 * Proposal, delivery not started is five true facts — not five contradictory
 * pipelines.
 */

export interface LiveStatus {
  stage: string;
  stageKey: string;
  stageColour: string;
  owner: string;
  ownerId: string | null;
  clock: { state: string; text: string; due: string | null };
  podcast: { status: string; key: string | null } | null;
  commercial: { id: string; name: string; stage: string }[];
  delivery: { id: string; stage: string } | null;
  active: number; overdue: number; waiting: number; blocked: number; resolved: number;
  nextAction: db.Row | null;
  blockers: number;
  stale: boolean; staleDays: number; noNextAction: boolean;
}

function clockOf(row: db.Row | null) {
  if (!row?.due_at) {
    return { state: "none", text: row ? "no clock on this stage" : "not started",
             due: null };
  }
  const ms = new Date(row.due_at as string).getTime() - Date.now();
  const total = (row.sla_hours as number) || 24;
  const fmt = (m: number) => {
    const s = Math.floor(Math.abs(m) / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    const mi = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${String(mi).padStart(2, "0")}m`
                                 : `${Math.max(mi, 1)}m`;
  };
  if (ms < 0) return { state: "overdue", text: `${fmt(ms)} overdue`, due: row.due_at as string };
  if (ms / 3_600_000 <= total * 0.25) {
    return { state: "at_risk", text: `${fmt(ms)} left`, due: row.due_at as string };
  }
  return { state: "on_track", text: `${fmt(ms)} left`, due: row.due_at as string };
}

/**
 * THE FOUR STATES OF ONE SCHOOL, side by side.
 *
 * This used to be fourteen sequential round trips. Every one of them crosses to
 * Mumbai and costs about 80ms, so the most important page in the application took
 * the better part of two seconds before it had drawn anything. It is two queries
 * now: one that gathers everything single-valued, and one for the opportunities,
 * which can be several.
 */
export async function liveStatus(schoolId: string): Promise<LiveStatus> {
  const row = await db.one(
    `select s.*,
            p.full_name              as owner_name,
            pr.status::text          as podcast_status,
            d.id                     as delivery_id,
            d.stage::text            as delivery_stage,
            sla.due_at               as sla_due_at,
            sla.sla_hours            as sla_hours,
            act.last_activity,
            blk.blockers,
            w.active, w.overdue, w.waiting, w.blocked, w.resolved,
            nx.id as next_id, nx.title as next_title, nx.reason as next_reason,
            nx.due_at as next_due_at, nx.team::text as next_team,
            nx.required_outcome as next_required_outcome
       from public.schools s
       left join public.profiles p                on p.id = s.owner_id
       left join public.podcast_relationships pr  on pr.school_id = s.id
       left join public.delivery_projects d       on d.school_id = s.id
       left join lateral (
         select sl.due_at, sl.sla_hours from public.stage_slas sl
          where sl.subject_type = 'school' and sl.subject_id = s.id
            and sl.closed_at is null
          order by sl.entered_at desc limit 1) sla on true
       left join lateral (
         select max(a.occurred_at) as last_activity
           from public.activities a where a.school_id = s.id) act on true
       left join lateral (
         select count(*) as blockers from public.blockers b
          where b.school_id = s.id and b.resolved_at is null) blk on true
       left join lateral (
         select count(*) filter (where wi.status in ${ACTIVE})            as active,
                count(*) filter (where wi.status in ('open','in_progress')
                                   and wi.due_at < now())                      as overdue,
                count(*) filter (where wi.status = 'waiting')                  as waiting,
                count(*) filter (where wi.status = 'blocked')                  as blocked,
                count(*) filter (where wi.status = 'resolved')                 as resolved
           from public.work_items wi where wi.school_id = s.id) w on true
       left join lateral (
         select wi.id, wi.title, wi.reason, wi.due_at, wi.team, wi.required_outcome
           from public.work_items wi
          where wi.school_id = s.id and wi.status in ('open','in_progress')
          order by wi.due_at nulls last limit 1) nx on true
      where s.id = ?`, [schoolId]);
  const s = row!;

  const opps = await db.many(
    `select id, name, stage::text from public.opportunities
      where school_id = ? and terminal_state is null order by updated_at desc`,
    [schoolId]);

  const next = s.next_id
    ? { id: s.next_id, title: s.next_title, reason: s.next_reason,
        due_at: s.next_due_at, team: s.next_team,
        required_outcome: s.next_required_outcome }
    : null;

  const staleDays = db.daysBetween(
    (s.last_activity as string) ?? (s.stage_entered_at as string)
    ?? (s.created_at as string));
  const def = BY_KEY[String(s.stage)];
  const fresh = s.stage === "lead";

  return {
    stage: stageName(s.stage as string), stageKey: String(s.stage),
    stageColour: stageColour(s.stage as string),
    owner: (s.owner_name as string) ?? "unassigned",
    ownerId: (s.owner_id as string) ?? null,
    clock: clockOf(s.sla_due_at ? { due_at: s.sla_due_at, sla_hours: s.sla_hours } : null),
    podcast: s.podcast_status
      ? { status: podcastStatusName(s.podcast_status as string),
          key: s.podcast_status as string } : null,
    commercial: opps.map((o) => ({ id: o.id as string, name: o.name as string,
                                   stage: stageName(o.stage as string) })),
    delivery: s.delivery_id
      ? { id: s.delivery_id as string,
          stage: deliveryStageName(s.delivery_stage as string) } : null,
    active: Number(s.active ?? 0),
    overdue: Number(s.overdue ?? 0),
    waiting: Number(s.waiting ?? 0),
    blocked: Number(s.blocked ?? 0),
    resolved: Number(s.resolved ?? 0),
    nextAction: next,
    blockers: Number(s.blockers ?? 0),
    stale: !fresh && !def?.terminal && staleDays >= 7,
    staleDays,
    noNextAction: !fresh && !def?.terminal && !next,
  };
}

// --------------------------------------------------------------------------
// The board. One query pass for the whole thing — 559 schools once meant several
// thousand queries and half a minute.
// --------------------------------------------------------------------------
export interface Card {
  id: string; name: string; accountId: string; accountName: string; location: string;
  stageKey: string; stage: string; owner: string; ownerId: string | null;
  poc: { id: string; name: string; role: string; phone: string | null } | null;
  next: string | null; nextId: string | null;
  done: number; total: number;
  slaState: string; slaText: string;
  active: number; overdue: number; waiting: number;
  podcast: string | null; commercial: string | null; delivery: string | null;
  blocked: number;
  stale: boolean; staleDays: number; noNextAction: boolean;
  nextStageKey: string | null; nextStageName: string | null;
  ready: boolean; missing: number;
  updatedAt: string;
}

export interface BoardFilter {
  only?: "mine" | "all" | "overdue" | "no_next_action" | "waiting" | "stale";
  ownerId?: string | null; accountId?: string | null; city?: string | null;
  sort?: "sla" | "name" | "owner" | "updated";
  viewerId: string;
}

export async function board(f: BoardFilter): Promise<Card[]> {
  const where: string[] = ["s.archived_at is null"];
  const args: unknown[] = [];
  if (f.only === "mine") { where.push("s.owner_id = ?"); args.push(f.viewerId); }
  else if (f.ownerId) { where.push("s.owner_id = ?"); args.push(f.ownerId); }
  if (f.accountId) { where.push("s.account_id = ?"); args.push(f.accountId); }
  if (f.city) { where.push("lower(coalesce(s.city,'')) = ?"); args.push(f.city.toLowerCase()); }

  const rows = await db.many(
    `select s.id, s.name, s.account_id, s.locality, s.city, s.board, s.stage::text,
            s.stage_entered_at, s.created_at, s.owner_id,
            a.name as account_name, o.full_name as owner_name
       from public.schools s
       join public.accounts a on a.id = s.account_id
       left join public.profiles o on o.id = s.owner_id
      where ${where.join(" and ")}
      order by s.name limit 2000`, args);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id as string);
  const stageOf = new Map(rows.map((r) => [r.id as string, String(r.stage)]));

  // One pass each, joined in memory.
  const counts = new Map<string,
    { active: number; overdue: number; waiting: number; blocked: number }>();
  const nextOf = new Map<string, db.Row>();
  const prog = new Map<string, { done: number; total: number; open: number }>();
  for (const id of ids) {
    counts.set(id, { active: 0, overdue: 0, waiting: 0, blocked: 0 });
    prog.set(id, { done: 0, total: 0, open: 0 });
  }
  for (const t of await db.many(
    `select id, school_id, status::text, due_at, blocking, stage::text, title
       from public.work_items
      where school_id = any(?) and status <> 'cancelled'
      order by due_at`, [ids])) {
    const sid = t.school_id as string;
    const c = counts.get(sid);
    const live = t.status !== "resolved";
    if (c && live) {
      c.active++;
      if (["open", "in_progress"].includes(String(t.status))
          && new Date(t.due_at as string) < new Date()) c.overdue++;
      if (t.status === "waiting") c.waiting++;
      if (t.status === "blocked") c.blocked++;
      if (["open", "in_progress"].includes(String(t.status)) && !nextOf.has(sid)) {
        nextOf.set(sid, t);
      }
    }
    if (t.blocking && t.stage === stageOf.get(sid)) {
      const p = prog.get(sid)!;
      p.total++;
      if (t.status === "resolved") p.done++; else p.open++;
    }
  }

  const clocks = new Map<string, db.Row>();
  for (const c of await db.many(
    `select * from public.stage_slas where subject_type='school' and subject_id = any(?)
       and closed_at is null order by entered_at`, [ids])) {
    clocks.set(c.subject_id as string, c);
  }
  const lastAct = new Map<string, string>();
  for (const a of await db.many(
    `select school_id, max(occurred_at) m from public.activities
      where school_id = any(?) group by school_id`, [ids])) {
    lastAct.set(a.school_id as string, String(a.m));
  }
  const pods = new Map<string, string>();
  for (const p of await db.many(
    "select school_id, status::text from public.podcast_relationships where school_id = any(?)",
    [ids])) pods.set(p.school_id as string, p.status as string);
  const dels = new Map<string, string>();
  for (const d of await db.many(
    "select school_id, stage::text from public.delivery_projects where school_id = any(?)",
    [ids])) dels.set(d.school_id as string, d.stage as string);
  const opps = new Map<string, string>();
  for (const o of await db.many(
    `select school_id, stage::text from public.opportunities
      where school_id = any(?) and terminal_state is null`, [ids])) {
    if (!opps.has(o.school_id as string)) opps.set(o.school_id as string, o.stage as string);
  }

  interface Facts { count: number; reachable: number; dm: boolean; poc: Card["poc"];
                    first: Card["poc"] }
  const facts = new Map<string, Facts>();
  for (const id of ids) facts.set(id, { count: 0, reachable: 0, dm: false, poc: null, first: null });
  for (const r of await db.many(
    `select r.school_id, r.school_role, r.custom_role, r.relationship_types,
            p.id, p.name, p.phone, p.email
       from public.person_roles r join public.people p on p.id = r.person_id
      where r.school_id = any(?) and r.ended_on is null`, [ids])) {
    const fx = facts.get(r.school_id as string);
    if (!fx) continue;
    fx.count++;
    if (String(r.phone ?? "").trim() || String(r.email ?? "").trim()) fx.reachable++;
    const rel = (r.relationship_types as string[]) ?? [];
    if (rel.includes("decision_maker")) fx.dm = true;
    const who = { id: r.id as string, name: r.name as string,
                  role: people.schoolRoleName(r.school_role as string, r.custom_role as string),
                  phone: (r.phone as string) ?? null };
    if (!fx.first) fx.first = who;
    if (!fx.poc && rel.includes("primary_poc")) fx.poc = who;
  }
  const hasIcp = new Set((await db.many(
    "select distinct school_id from public.icp_assessments where school_id = any(?)",
    [ids])).map((r) => r.school_id as string));
  const hasSignal = new Set((await db.many(
    "select distinct school_id from public.podcast_signals where school_id = any(?)",
    [ids])).map((r) => r.school_id as string));
  const hasProblem = new Set((await db.many(
    `select distinct school_id from public.discoveries
      where school_id = any(?) and coalesce(btrim(problem),'') <> ''`, [ids]))
    .map((r) => r.school_id as string));

  const missingEntry = (row: db.Row, target: string): number => {
    const def = BY_KEY[target];
    if (!def) return 0;
    const fx = facts.get(row.id as string)!;
    let n = 0;
    for (const c of def.entry) {
      switch (c.key) {
        case "identified":
          if (!String(row.board ?? "").trim() || !String(row.locality ?? "").trim()) n++;
          break;
        case "account": if (!row.account_id) n++; break;
        case "owner": if (!row.owner_id) n++; break;
        case "icp": if (!hasIcp.has(row.id as string)) n++; break;
        case "person": if (fx.count === 0) n++; break;
        case "contact_route": if (fx.reachable === 0) n++; break;
        case "decision_maker": if (!fx.dm) n++; break;
        case "signal": if (!hasSignal.has(row.id as string)) n++; break;
        case "problem": if (!hasProblem.has(row.id as string)) n++; break;
      }
    }
    return n;
  };

  const today = db.today();
  const cards: Card[] = rows.map((s) => {
    const id = s.id as string;
    const key = String(s.stage);
    const def = BY_KEY[key];
    const nextKey = def?.next ?? null;
    const c = counts.get(id)!;
    const p = prog.get(id)!;
    const fx = facts.get(id)!;
    const cl = clockOf(clocks.get(id) ?? null);
    const last = lastAct.get(id) ?? String(s.stage_entered_at ?? s.created_at);
    const staleDays = db.daysBetween(last, today);
    const fresh = key === "lead";
    const na = nextOf.get(id) ?? null;
    const me = nextKey ? missingEntry(s, nextKey) : 0;
    const mw = nextKey && !BY_KEY[nextKey]?.terminal ? p.open : 0;

    return {
      id, name: s.name as string, accountId: s.account_id as string,
      accountName: s.account_name as string,
      location: [s.locality, s.city].filter(Boolean).join(", "),
      stageKey: key, stage: stageName(key),
      owner: (s.owner_name as string) ?? "unassigned",
      ownerId: (s.owner_id as string) ?? null,
      poc: fx.poc ?? fx.first,
      next: na ? (na.title as string) : null,
      nextId: na ? (na.id as string) : null,
      done: p.done, total: p.total,
      slaState: cl.state, slaText: cl.text,
      active: c.active, overdue: c.overdue, waiting: c.waiting,
      podcast: pods.has(id) ? podcastStatusName(pods.get(id)) : null,
      commercial: opps.has(id) ? stageName(opps.get(id)) : null,
      delivery: dels.has(id) ? deliveryStageName(dels.get(id)) : null,
      blocked: c.blocked,
      stale: !fresh && !def?.terminal && staleDays >= 7, staleDays,
      noNextAction: !fresh && !def?.terminal && !na,
      nextStageKey: nextKey, nextStageName: nextKey ? stageName(nextKey) : null,
      ready: !!nextKey && me === 0 && mw === 0, missing: me + mw,
      updatedAt: String(s.stage_entered_at ?? s.created_at),
    };
  });

  const filtered = f.only === "overdue" ? cards.filter((c) => c.overdue > 0)
    : f.only === "no_next_action" ? cards.filter((c) => c.noNextAction)
    : f.only === "waiting" ? cards.filter((c) => c.waiting > 0)
    : f.only === "stale" ? cards.filter((c) => c.stale)
    : cards;

  const rank: Record<string, number> = { overdue: 0, at_risk: 1, on_track: 2, none: 3 };
  const sort = f.sort ?? "sla";
  filtered.sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name)
    : sort === "owner" ? a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name)
    : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt)
    : (rank[a.slaState] ?? 9) - (rank[b.slaState] ?? 9) || a.name.localeCompare(b.name));
  return filtered;
}

/**
 * An account aggregates its schools. It has no stage of its own.
 *
 * Built on the same batched pass the board uses. Calling liveStatus() per school was
 * twelve round trips each — 13 seconds for a twelve-campus trust.
 */
export async function accountSummary(accountId: string, viewerId: string) {
  const cards = await board({ only: "all", accountId, sort: "name", viewerId });
  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.stageKey] = (counts[c.stageKey] ?? 0) + 1;
  const sum = (f: (c: Card) => number) => cards.reduce((a, c) => a + f(c), 0);
  return {
    schools: cards, counts,
    active: sum((c) => c.active), overdue: sum((c) => c.overdue),
    waiting: sum((c) => c.waiting), blocked: sum((c) => c.blocked),
    opportunities: cards.filter((c) => c.commercial).length,
    podcasts: cards.filter((c) => c.podcast).length,
  };
}
