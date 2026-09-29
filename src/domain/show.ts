/**
 * BEYOND THE CLASSROOM — the show, as an operating layer.
 *
 * THIS IS NOT A FUNNEL. A school has one journey and it is the ladder in
 * `journey.ts`. The show is a WORKSTREAM that runs alongside it: a status, the work
 * that status requires, and the people who do it. A school can be at Research with
 * an episode already published, or at Negotiation having never been on the show.
 *
 * There is exactly ONE place the show touches the relationship, and it is not the
 * status. It is a recorded SIGNAL — something the guest actually said, in their own
 * words — which is what opens Discovery. Publishing an episode moves nothing.
 *
 * Everything here is taken from `mintrix-btc-show/06-COMMERCIAL/24_handoff_and_crm.md`:
 * the six paths and their expected distribution, the T+0 to T+90 handoff sequence,
 * the nine permitted signal types, and the seven-point quality gate before a school
 * may be treated as a commercial conversation.
 */
import * as db from "@/server/db";
import * as work from "./work";
import * as audit from "./audit";
import * as activity from "./activity";
import { ownerForTeam } from "./stage";
import type { Team, Workstream } from "./journey";

export type ShowStatus =
  | "planned" | "invited" | "scheduled" | "recorded" | "delivered" | "published"
  | "nurture" | "declined";

export interface ShowCheck {
  key: string;
  label: string;
  fix: string;
  test: (pod: db.Row) => boolean;
}

export interface ShowWork {
  key: string;
  title: string;
  reason: string;
  team: Team;
  workstream: Workstream;
  task_type: string;
  /** Only blocking work can hold the show status shut. */
  blocking: boolean;
  sla_hours: number;
  outcome?: string;
}

export interface ShowStatusDef {
  key: ShowStatus;
  name: string;
  phase: "Planning" | "Production" | "Execution" | "Holding";
  what: string;
  meaning: string;
  entry: ShowCheck[];
  work: ShowWork[];
  exit: string;
  sla_hours: number | null;
  next: ShowStatus[];
  terminal?: boolean;
}

// --------------------------------------------------------------------------
// Entry checks — facts that must be in the record, not opinions about it
// --------------------------------------------------------------------------
const C = {
  question: {
    key: "question",
    label: "An episode question exists that only this school can answer",
    fix: "Write the question. If another school could answer it, it is the wrong question.",
    test: (p: db.Row) => !!String(p.episode_question ?? "").trim(),
  },
  guest: {
    key: "guest",
    label: "The guest is named",
    fix: "Name the person who is coming on, from the people already on record here.",
    test: (p: db.Row) => !!p.guest_person_id,
  },
  date: {
    key: "date",
    label: "A recording date is agreed in writing",
    fix: "Put the date on the record. A verbal maybe is not a date.",
    test: (p: db.Row) => !!p.recording_date,
  },
  happened: {
    key: "happened",
    label: "The recording date has arrived",
    fix: "This cannot be marked recorded before the date it is booked for.",
    test: (p: db.Row) => !!p.recording_date
      && new Date(String(p.recording_date)) <= new Date(),
  },
  url: {
    key: "url",
    label: "The episode has somewhere to live",
    fix: "Record the published URL.",
    test: (p: db.Row) => !!String(p.episode_url ?? "").trim(),
  },
} satisfies Record<string, ShowCheck>;

// --------------------------------------------------------------------------
// THE STATUSES, with the work each one actually requires
// --------------------------------------------------------------------------
export const SHOW_STATUSES: ShowStatusDef[] = [
  {
    key: "planned", name: "Planned", phase: "Planning",
    what: "An episode question exists for this school.",
    meaning:
      "Somebody decided this school is worth a conversation and can say why. " +
      "Nothing has been asked of them yet.",
    entry: [],
    work: [
      { key: "question", title: "Write the episode question only {school} can answer",
        reason: "A question any school could answer produces an episode any school could have been on.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: true, sla_hours: 72,
        outcome: "One question, written down, that would be a waste of time to ask anybody else." },
      { key: "guest", title: "Decide who at {school} should be the guest, and why",
        reason: "The wrong guest produces a polite hour and nothing else. A principal is not automatically the right one.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: true, sla_hours: 72,
        outcome: "A named person and a sentence saying what they specifically would know." },
      { key: "no_ask", title: "Write down what must never be asked at {school}",
        reason: "Knowing the boundary before the invitation is what makes the invitation safe to accept.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: false, sla_hours: 168 },
    ],
    exit: "The question and the guest are both settled.",
    sla_hours: 168, next: ["invited", "nurture", "declined"],
  },
  {
    key: "invited", name: "Invited", phase: "Planning",
    what: "Asked. Waiting on a yes or a no.",
    meaning: "The ask has gone out. Four touches, then stop — chasing costs more than the episode is worth.",
    entry: [C.question, C.guest],
    work: [
      { key: "invite", title: "Send the invitation to {school} with the question in it",
        reason: "The question is the invitation. Without it this is a request for their time with nothing offered.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 48,
        outcome: "Sent, logged, and the question is in the message itself." },
      { key: "rhythm", title: "Follow the four-touch rhythm with {school}, then stop",
        reason: "Four touches then silence. A fifth turns an invitation into pressure, and the asset is the relationship.",
        team: "sales", workstream: "podcast", task_type: "call",
        blocking: false, sla_hours: 336,
        outcome: "Four attempts logged, or a reply. Then it goes to nurture." },
    ],
    exit: "They said yes and a date exists, or they said no.",
    sla_hours: 336, next: ["scheduled", "nurture", "declined"],
  },
  {
    key: "scheduled", name: "Scheduled", phase: "Planning",
    what: "A date is confirmed in writing.",
    meaning: "Now it is a production job. Everything that makes the hour worth their time happens here.",
    entry: [C.date],
    work: [
      { key: "consent", title: "Get consent and usage agreed in writing from {school}",
        reason: "Recording somebody without a written understanding of where it goes is not a thing we do.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 72,
        outcome: "Written agreement covering recording, publication and clips." },
      { key: "brief", title: "Send the guest at {school} the brief and what to expect",
        reason: "A guest who knows the shape of the hour gives a better hour. Surprise is not a production value.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 72 },
      { key: "questions", title: "Build the question set from {school}'s own context",
        reason: "A generic question set wastes the research that got us in the room.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: true, sla_hours: 96,
        outcome: "Questions that could only have been written after reading this school's file." },
      { key: "logistics", title: "Confirm location, travel and the room at {school}",
        reason: "A bad room is an unusable recording, and there is no second take of a first conversation.",
        team: "production", workstream: "production", task_type: "logistics",
        blocking: true, sla_hours: 96 },
      { key: "kit", title: "Check camera, audio, power and cards the day before {school}",
        reason: "Every failure anybody has ever had was discovered on the day.",
        team: "production", workstream: "production", task_type: "logistics",
        blocking: true, sla_hours: 24,
        outcome: "Kit tested, batteries charged, cards empty and formatted." },
    ],
    exit: "The conversation happened.",
    sla_hours: 720, next: ["recorded", "nurture", "declined"],
  },
  {
    key: "recorded", name: "Recorded", phase: "Production",
    what: "The conversation happened.",
    meaning:
      "T+0. The hour after a recording is the most valuable and the most often " +
      "wasted. What was said is still exact; tomorrow it is a paraphrase.",
    entry: [C.happened],
    work: [
      { key: "backup", title: "Back the {school} recording up in two places",
        reason: "One copy is not a copy. This is unrepeatable material.",
        team: "production", workstream: "production", task_type: "logistics",
        blocking: true, sla_hours: 24,
        outcome: "Two copies, and one of them is not the camera card." },
      { key: "debrief", title: "Debrief the {school} recording within the hour",
        reason: "T+0 in the handoff sequence. After an hour you are writing down an impression, not a fact.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: true, sla_hours: 1,
        outcome: "What surprised you, what they repeated, and what you now know that you did not." },
      { key: "signals", title: "Log what {school} actually said, in their words",
        reason:
          "This is the only thing on the show that touches the relationship. A signal " +
          "needs a verbatim quote and a timecode — an interpretation is a wish.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: true, sla_hours: 48,
        outcome: "One row per thing they said, quoted exactly, with the time it was said." },
      { key: "thank_you", title: "Thank the guest at {school} — no ask, no attachment",
        reason: "T+1. The first three contacts after a recording contain no ask whatsoever. Three clean gives.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 24,
        outcome: "A message with nothing in it for us." },
      { key: "transcript", title: "Transcribe the {school} conversation",
        reason: "The transcript is what makes the quotes checkable later.",
        team: "production", workstream: "production", task_type: "production",
        blocking: false, sla_hours: 96 },
      { key: "edit", title: "Cut the {school} episode",
        reason: "The edit is the product. It is also what the guest is trusting us with.",
        team: "production", workstream: "production", task_type: "production",
        blocking: true, sla_hours: 240 },
      { key: "clips", title: "Cut {school}'s own clips, for them to use",
        reason: "The clips are the part the school actually uses. They are the gift, not the marketing.",
        team: "production", workstream: "production", task_type: "production",
        blocking: false, sla_hours: 336 },
    ],
    exit: "The guest has their package, before anybody else sees it.",
    sla_hours: 408, next: ["delivered"],
  },
  {
    key: "delivered", name: "Delivered to the guest", phase: "Execution",
    what: "The guest has their package — before publication.",
    meaning:
      "T+17. They see it first. Every cut they ask for is honoured, without " +
      "negotiation. This is the whole trust proposition of the show.",
    entry: [C.date],
    work: [
      { key: "package", title: "Send {school} their package before anything is published",
        reason: "T+17. The guest sees it before the public does, every time, without exception.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 24,
        outcome: "Film, clips and stills delivered, with publication not yet scheduled." },
      { key: "approval", title: "Get approval from {school}, or take their cut requests",
        reason: "Publishing without a yes is how a trust-first show becomes a liability.",
        team: "sales", workstream: "podcast", task_type: "call",
        blocking: true, sla_hours: 96,
        outcome: "An explicit yes, or a list of cuts." },
      { key: "cuts", title: "Make every cut {school} asked for",
        reason: "Every cut request is honoured. A refused cut is a governance incident, not a negotiation.",
        team: "production", workstream: "production", task_type: "production",
        blocking: true, sla_hours: 48 },
    ],
    exit: "They have said yes and any cuts are made.",
    sla_hours: 168, next: ["published"],
  },
  {
    key: "published", name: "Published", phase: "Execution",
    what: "It is out.",
    meaning:
      "T+18 onwards. The handoff sequence runs from here: the path-specific message, " +
      "the register line, one genuinely useful thing, and a review at ninety days.",
    entry: [],
    work: [
      { key: "publish", title: "Publish the {school} episode and record the URL",
        reason: "An episode nobody can link to has not been published.",
        team: "production", workstream: "production", task_type: "production",
        blocking: true, sla_hours: 24 },
      { key: "notify", title: "Tell {school} it is live, with their three best clips ready to post",
        reason: "T+18. They should hear it from us, with the work already done for them.",
        team: "marketing", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 24 },
      { key: "path", title: "Decide the path for {school} and send that message",
        reason:
          "T+21. The right next step varies enormously, and forcing every school down " +
          "the same one is how this asset gets burned.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: true, sla_hours: 96,
        outcome: "A path chosen on the evidence, and the message that path calls for." },
      { key: "register", title: "Publish the {school} register line as a standalone post",
        reason: "T+35. The line stands on its own and tags them. It is for them, not for us.",
        team: "marketing", workstream: "production", task_type: "production",
        blocking: false, sla_hours: 408 },
      { key: "useful", title: "Send {school} one genuinely useful thing — no ask",
        reason: "T+60. A finding, an introduction, an article. The third clean give.",
        team: "sales", workstream: "podcast", task_type: "email",
        blocking: false, sla_hours: 1008,
        outcome: "Something they can use, with nothing attached." },
      { key: "review", title: "Review {school} at ninety days — has the relationship moved?",
        reason: "T+90. If it has not moved, it goes to Path B permanently and stays warm. That is a fine outcome.",
        team: "sales", workstream: "podcast", task_type: "research",
        blocking: false, sla_hours: 1728 },
    ],
    exit: "The show's work here is done. Whatever happens next happens on the school's own ladder.",
    sla_hours: null, next: [],
  },
  {
    key: "nurture", name: "Nurture", phase: "Holding",
    what: "No for now. Ask again in six months.",
    meaning: "A decision, not a failure. Holding states are never gated on work.",
    entry: [],
    work: [
      { key: "ask_again", title: "Ask {school} about the show again in six months",
        reason: "A no now is not a no forever, but only if somebody remembers to ask.",
        team: "sales", workstream: "podcast", task_type: "call",
        blocking: false, sla_hours: 4320 },
    ],
    exit: "Somebody decides to ask again.",
    sla_hours: null, next: ["planned", "invited"], terminal: true,
  },
  {
    key: "declined", name: "Declined", phase: "Holding",
    what: "They said no.",
    meaning: "Recorded so nobody asks again by accident. No work follows a no.",
    entry: [], work: [],
    exit: "Nothing. This is an ending.",
    sla_hours: null, next: ["planned"], terminal: true,
  },
];

export const SHOW_BY_KEY: Record<string, ShowStatusDef> =
  Object.fromEntries(SHOW_STATUSES.map((s) => [s.key, s]));

export const SHOW_LADDER = SHOW_STATUSES.filter((s) => !s.terminal);
export const SHOW_HOLDING = SHOW_STATUSES.filter((s) => s.terminal);

export const showStatusName = (k?: string | null) =>
  SHOW_BY_KEY[String(k ?? "")]?.name ?? "Not started";

export const showPhase = (k?: string | null) =>
  SHOW_BY_KEY[String(k ?? "")]?.phase ?? null;

/** Work template keys must be unique across the whole show, or idempotency lies. */
{
  const seen = new Set<string>();
  for (const s of SHOW_STATUSES) {
    for (const w of s.work) {
      const key = `show:${s.key}:${w.key}`;
      if (seen.has(key)) throw new Error(`Duplicate show work template: ${key}`);
      seen.add(key);
    }
  }
}

// --------------------------------------------------------------------------
// THE SIX PATHS — what happens after an episode, and how often it should
// --------------------------------------------------------------------------
export const PATHS = [
  { key: "A", name: "Send the content. Nothing else, ever",
    when: "Not a fit: too small, too large, wrong market, or simply no signal.",
    share: 25 },
  { key: "B", name: "Content, a genuine thank-you, stay in touch",
    when: "Good conversation, no operational signal.", share: 25 },
  { key: "C", name: "Content plus two or three honest observations, offered freely",
    when: "Signals present, no expressed interest.", share: 20 },
  { key: "D", name: "Content, observations, and an offer to compare notes — no agenda",
    when: "They named a problem; interest implied but not stated.", share: 15 },
  { key: "E", name: "A structured diagnostic conversation, offered as its own thing",
    when: "They asked for help, or asked what we do, unprompted.", share: 10 },
  { key: "F", name: "A pilot conversation",
    when: "They explicitly asked to discuss working together.", share: 5 },
] as const;

export const pathName = (k?: string | null) =>
  PATHS.find((p) => p.key === k)?.name ?? "Not decided";

/** E and F are the only paths that are a commercial conversation. */
export const COMMERCIAL_PATHS = ["E", "F"];

// --------------------------------------------------------------------------
// THE NINE PERMITTED SIGNAL TYPES. A signal needs a quote and a timecode.
// --------------------------------------------------------------------------
export const SIGNAL_TYPES = [
  { key: "asked_what_mintrix_does", name: "Asked what Mintrix does", weight: "high" },
  { key: "asked_for_help", name: "Asked for help", weight: "high" },
  { key: "requested_demo", name: "Asked to see it", weight: "high" },
  { key: "requested_followup", name: "Asked to talk again", weight: "high" },
  { key: "named_a_problem", name: "Named a problem", weight: "medium" },
  { key: "expressed_dissatisfaction", name: "Said something is not working", weight: "medium" },
  { key: "mentioned_expansion", name: "Mentioned expansion", weight: "medium" },
  { key: "offered_introduction", name: "Offered an introduction", weight: "medium" },
  { key: "declined_topic", name: "Would not discuss something", weight: "low" },
] as const;

export const signalTypeName = (k?: string | null) =>
  SIGNAL_TYPES.find((s) => s.key === k)?.name ?? String(k ?? "");

/** The signals that mean the guest asked, unprompted. */
const UNPROMPTED = ["asked_what_mintrix_does", "asked_for_help",
                    "requested_demo", "requested_followup"];

/** Contacts after a recording that carry no ask at all. The three clean gives. */
const NO_ASK_GIVES = [
  "show:recorded:thank_you",
  "show:delivered:package",
  "show:published:notify",
  "show:published:useful",
];

// --------------------------------------------------------------------------
// THE HANDOFF QUALITY GATE — all seven, before Path E or F
// --------------------------------------------------------------------------
export interface GateCheck { key: string; label: string; ok: boolean; why: string }

export async function handoffGate(podcastId: string): Promise<{
  ok: boolean; checks: GateCheck[]; missing: GateCheck[];
}> {
  const pod = await db.get("podcast_relationships", podcastId);
  if (!pod) return { ok: false, checks: [], missing: [] };

  const signals = await db.many(
    "select signal_type from public.podcast_signals where podcast_id = ?", [podcastId]);

  // "Three contacts with no ask" is counted from the gives that actually exist in
  // the system — the thank-you, the package, the live notification, the useful
  // thing — not from a self-reported number.
  const gives = await db.many(
    `select template_key from public.work_items
      where podcast_id = ? and status = 'resolved' and template_key = any(?)`,
    [podcastId, NO_ASK_GIVES]);
  const contacts = Math.max(gives.length, Number(pod.no_ask_contacts ?? 0));

  const profileDone = Number((await db.one(
    `select count(*) c from public.work_items
      where podcast_id = ? and template_key = 'show:recorded:debrief'
        and status = 'resolved'`, [podcastId]))!.c) > 0;

  const checks: GateCheck[] = [
    { key: "unprompted", label: "The guest asked, unprompted, what Mintrix does or for help",
      ok: signals.some((s) => UNPROMPTED.includes(String(s.signal_type))),
      why: "Without this it is our idea, not theirs." },
    { key: "published", label: "The episode is published and the guest received it first",
      ok: pod.status === "published" && !!pod.published_on,
      why: "They see it before the public does. Every time." },
    { key: "cuts", label: "Every cut request was honoured",
      ok: Number(pod.cut_requests_refused ?? 0) === 0,
      why: "A refused cut is a governance incident, not a negotiation." },
    { key: "no_ask", label: "At least three contacts have been made with no ask",
      ok: contacts >= 3,
      why: "Three clean gives. Not a soft ask. Not “no pressure but”." },
    { key: "profile", label: "The debrief is complete, with evidence rather than guesses",
      ok: profileDone,
      why: "An interpretation dressed as insight is worse than nothing." },
    // Neither of these can be derived from anything the system can see. They are a
    // person's confirmation or they are nothing — an auto-tick here would be the
    // gate lying to whoever relies on it.
    { key: "invisibility", label: "The Invisibility Test passed on the published episode",
      ok: !!pod.invisibility_test_passed,
      why: "If the episode sells, it is not the show any more. Somebody has to watch it and say so." },
    { key: "no_deck", label: "Nobody has sent a deck",
      ok: !!pod.no_deck_confirmed,
      why: "The system cannot see your outbox. Confirm it yourself, with your name on it." },
  ];
  const missing = checks.filter((c) => !c.ok);
  return { ok: missing.length === 0, checks, missing };
}

// --------------------------------------------------------------------------
// Moving the show along
// --------------------------------------------------------------------------
export function isLegalShowMove(from: string, to: string): boolean {
  if (from === to) return false;
  const f = SHOW_BY_KEY[from], t = SHOW_BY_KEY[to];
  if (!f || !t) return false;
  return f.next.includes(to as ShowStatus);
}

export async function progress(podcastId: string, status: string) {
  const items = await db.many(
    `select id, title, blocking, status, team::text, workstream::text, due_at
       from public.work_items
      where podcast_id = ? and template_key like ?
      order by blocking desc, due_at nulls last`,
    [podcastId, `show:${status}:%`]);
  const blocking = items.filter((t) => t.blocking);
  const open = blocking.filter((t) => !["resolved", "cancelled"].includes(String(t.status)));
  const done = blocking.length - open.length;
  return {
    items, blocking, open, done, total: blocking.length,
    ready: open.length === 0,
    alongside: items.filter((t) => !t.blocking
      && !["resolved", "cancelled"].includes(String(t.status))),
  };
}

export interface ShowGate {
  from: ShowStatusDef | null;
  to: ShowStatusDef | null;
  legal: boolean;
  illegalReason: string | null;
  entry: { check: ShowCheck; ok: boolean }[];
  missingEntry: { check: ShowCheck; ok: boolean }[];
  missingWork: db.Row[];
  ok: boolean;
}

/**
 * `pending` carries the facts this move is about to write. A form that asks for the
 * recording date and the move in one step is the natural way to work, so the gate
 * judges the record as it will be, not as it was a moment ago.
 */
export async function gate(schoolId: string, to: string,
                           pending: db.Row = {}): Promise<ShowGate> {
  const stored = await db.one(
    "select * from public.podcast_relationships where school_id = ?", [schoolId]);
  // Where it IS comes from the record. What the entry checks judge is the record as
  // this move will leave it.
  const fromKey = stored ? String(stored.status) : null;
  const pod = stored ? { ...stored, ...pending, status: stored.status } : stored;
  const from = fromKey ? SHOW_BY_KEY[fromKey] ?? null : null;
  const target = SHOW_BY_KEY[to] ?? null;

  // Nothing yet: the only way in is Planned.
  const legal = !target ? false
    : !stored ? to === "planned"
    : isLegalShowMove(fromKey!, to);

  const illegalReason = !target ? `"${to}" is not a show status.`
    : !stored && to !== "planned"
      ? "This school is not on the show yet. It starts at Planned."
    : stored && fromKey === to ? `The show for this school is already ${target.name}.`
    : legal ? null
    : `${target.name} does not follow ${from?.name ?? "nothing"}. `
      + `From ${from?.name} the show can go to: `
      + (from?.next.map((n) => SHOW_BY_KEY[n].name).join(", ") || "nowhere");

  const entry = target && pod
    ? target.entry.map((c) => ({ check: c, ok: c.test(pod as db.Row) }))
    : [];
  const missingEntry = entry.filter((e) => !e.ok);

  // A holding status is a decision. It is never gated on work.
  const prog = stored && from ? await progress(stored.id as string, fromKey!) : null;
  const missingWork = target?.terminal ? [] : (prog?.open ?? []);

  return {
    from, to: target, legal, illegalReason, entry, missingEntry, missingWork,
    ok: legal && missingEntry.length === 0 && missingWork.length === 0,
  };
}

async function createShowWork(podcastId: string, status: string,
                              school: db.Row): Promise<string[]> {
  const def = SHOW_BY_KEY[status];
  if (!def) return [];
  const created: string[] = [];
  for (const w of def.work) {
    try {
      const id = await work.create({
        accountId: school.account_id as string,
        schoolId: school.id as string,
        podcastId,
        title: w.title.replace("{school}", school.name as string),
        reason: w.reason, requiredOutcome: w.outcome ?? null,
        team: w.team, workstream: w.workstream, taskType: w.task_type,
        blocking: w.blocking, templateKey: `show:${status}:${w.key}`,
        slaHours: w.sla_hours, autoGenerated: true,
        ownerId: await ownerForTeam(w.team, school),
      });
      if (!created.includes(id)) created.push(id);
    } catch { /* a rejected title must never hold up the show */ }
  }
  return created;
}

export interface ShowMoveOptions {
  note?: string | null;
  overrideReason?: string | null;
  isFounder?: boolean;
  guestPersonId?: string | null;
  recordingDate?: string | null;
  recordingLocation?: string | null;
  episodeQuestion?: string | null;
  episodeUrl?: string | null;
  publishedOn?: string | null;
}

/**
 * THE ONE WAY THE SHOW MOVES.
 *
 * It does not touch `schools.stage`, and there is no code path here that could. The
 * relationship moves when somebody moves it, on the school's own page, for a reason
 * they can say out loud.
 */
export async function move(schoolId: string, to: string, opts: ShowMoveOptions = {}) {
  const school = await db.get("schools", schoolId);
  if (!school) throw new Error("That school no longer exists.");

  // What this move is about to write, so the gate judges the record as it will be.
  const fields: db.Row = { status: to, status_entered_at: db.now() };
  if (opts.episodeQuestion) fields.episode_question = opts.episodeQuestion;
  if (opts.guestPersonId) fields.guest_person_id = opts.guestPersonId;
  if (opts.recordingDate) fields.recording_date = opts.recordingDate;
  if (opts.recordingLocation) fields.recording_location = opts.recordingLocation;
  if (opts.episodeUrl) fields.episode_url = opts.episodeUrl;
  if (to === "published") fields.published_on = opts.publishedOn || db.today();

  const g = await gate(schoolId, to, fields);
  if (!g.legal) throw new Error(g.illegalReason ?? "That is not a move the show makes.");

  const override = (opts.overrideReason ?? "").trim();
  if (!g.ok && !override) {
    const missing = [
      ...g.missingEntry.map((e) => e.check.fix),
      ...g.missingWork.map((t) => t.title as string),
    ];
    throw new Error(
      `${g.to!.name} is not open yet. Still to do: ${missing.join("; ")}`);
  }
  if (!g.ok && override && !opts.isFounder) {
    throw new Error("Only the founder can move the show past its requirements.");
  }

  return db.transaction(async () => {
    let pod = await db.one(
      "select * from public.podcast_relationships where school_id = ?", [schoolId]);
    const fromKey = pod ? String(pod.status) : null;

    if (!pod) {
      const id = await db.insert("podcast_relationships", {
        account_id: school.account_id, school_id: schoolId,
        owner_id: db.currentUserId(), ...fields,
      });
      pod = await db.get("podcast_relationships", id);
    } else {
      await db.update("podcast_relationships", pod.id as string, fields);
    }
    const podcastId = pod!.id as string;

    const created = await createShowWork(podcastId, to, school);

    await activity.log({
      accountId: school.account_id as string, schoolId, podcastId,
      type: "podcast_status", direction: "internal",
      outcomeKey: to, outcomeLabel: "Beyond the Classroom",
      summary: `${school.name as string}: the show is now ${SHOW_BY_KEY[to].name}`
             + (opts.note ? ` — ${opts.note}` : ""),
    });
    await audit.record({
      action: "PODCAST_STATUS_CHANGED", objectType: "podcast", objectId: podcastId,
      accountId: school.account_id as string, schoolId,
      before: { status: fromKey }, after: { status: to, overridden: !g.ok },
      reason: opts.note || override || null,
    });

    return { podcastId, created: created.length, overridden: !g.ok };
  });
}

/** Choosing the path is a decision with evidence behind it, not a mood. */
export async function setPath(schoolId: string, path: string, why: string) {
  const reason = why?.trim();
  if (!PATHS.some((p) => p.key === path)) throw new Error("That is not one of the six paths.");
  if (!reason) throw new Error("Say what in the conversation puts them on this path.");

  const pod = await db.one(
    "select * from public.podcast_relationships where school_id = ?", [schoolId]);
  if (!pod) throw new Error("This school is not on the show.");

  if (COMMERCIAL_PATHS.includes(path)) {
    const g = await handoffGate(pod.id as string);
    if (!g.ok) {
      throw new Error(
        "Path " + path + " is a commercial conversation and the handoff gate is not "
        + "clear. Still open: " + g.missing.map((c) => c.label).join("; ")
        + ". Stay on Path C or D — there is no urgency worth the asset.");
    }
  }

  await db.transaction(async () => {
    await db.update("podcast_relationships", pod.id as string,
                    { path, path_set_on: db.today() });
    await activity.log({
      accountId: pod.account_id as string, schoolId, podcastId: pod.id as string,
      type: "podcast_path", outcomeKey: path, outcomeLabel: `Path ${path}`,
      summary: `Path ${path} — ${pathName(path)}. ${reason}`,
    });
    await audit.record({
      action: "PODCAST_PATH_SET", objectType: "podcast", objectId: pod.id as string,
      accountId: pod.account_id as string, schoolId,
      before: { path: pod.path }, after: { path }, reason,
    });
  });
}

// --------------------------------------------------------------------------
// Reading one episode
// --------------------------------------------------------------------------
export async function detail(schoolId: string) {
  const school = await db.get("schools", schoolId);
  if (!school) return null;
  const account = await db.get("accounts", school.account_id as string);
  const pod = await db.one(
    "select * from public.podcast_relationships where school_id = ?", [schoolId]);

  const people = await db.many(
    `select p.id, p.name, p.phone, p.whatsapp, p.email,
            r.school_role::text as school_role
       from public.people p
       join public.person_roles r on r.person_id = p.id
      where r.school_id = ? and r.ended_on is null order by p.name`, [schoolId]);

  if (!pod) {
    return {
      school, account, pod: null, people,
      status: null, def: null, phases: [], signals: [], gateResult: null,
      work: [], prog: null, nextOptions: ["planned"], history: [],
    };
  }
  const podcastId = pod.id as string;
  const status = String(pod.status);
  const def = SHOW_BY_KEY[status] ?? null;

  const guest = pod.guest_person_id
    ? await db.get("people", pod.guest_person_id as string) : null;
  const owner = pod.owner_id
    ? await db.one("select full_name from public.profiles where id = ?", [pod.owner_id])
    : null;

  // Every piece of show work for this school, whatever status created it, so the
  // whole operation is on one screen rather than only the current step.
  const allWork = await db.many(
    `select w.*, p.full_name as owner_name from public.work_items w
       left join public.profiles p on p.id = w.owner_id
      where w.podcast_id = ?
      order by (w.status in ('resolved','cancelled')),
               w.blocking desc, w.due_at nulls last`, [podcastId]);

  const signals = await db.many(
    `select s.*, p.full_name as logged_by_name from public.podcast_signals s
       left join public.profiles p on p.id = s.logged_by
      where s.podcast_id = ? order by s.observed_at desc`, [podcastId]);

  const history = await db.many(
    `select a.*, p.full_name as actor_name from public.activities a
       left join public.profiles p on p.id = a.logged_by
      where a.podcast_id = ? order by a.occurred_at desc limit 12`, [podcastId]);

  const prog = await progress(podcastId, status);
  const gateResult = await handoffGate(podcastId);

  // The whole lifecycle, each step with its own work, so planning, production and
  // execution are visible at once instead of one step at a time.
  const byTemplate = new Map<string, db.Row[]>();
  for (const w of allWork) {
    const key = String(w.template_key ?? "").split(":")[1] ?? "other";
    if (!byTemplate.has(key)) byTemplate.set(key, []);
    byTemplate.get(key)!.push(w);
  }
  const order = SHOW_LADDER.map((s) => s.key);
  const reached = order.indexOf(status as ShowStatus);
  const phases = SHOW_LADDER.map((s, i) => ({
    def: s,
    state: def?.terminal ? "holding"
      : i < reached ? "done" : i === reached ? "here" : "ahead",
    work: byTemplate.get(s.key) ?? [],
  }));

  return {
    school, account, pod, people, guest, owner,
    status, def, phases, signals, gateResult, history,
    work: allWork, prog,
    unassigned: byTemplate.get("other") ?? [],
    nextOptions: def?.next ?? [],
  };
}

// --------------------------------------------------------------------------
// The show at a glance. One batched pass — never a query per school.
// --------------------------------------------------------------------------
export interface ShowCard {
  podcastId: string;
  schoolId: string; school: string; accountId: string; account: string;
  status: string; statusName: string; phase: string;
  /** The school's own place on the ONE ladder. Shown alongside, never merged. */
  journeyStage: string;
  guest: string | null;
  owner: string | null;
  question: string | null;
  recordingDate: string | null;
  publishedOn: string | null;
  path: string | null;
  open: number; overdue: number; blocking: number;
  signals: number;
  since: string;
}

export async function board(filter: { only?: string; viewerId?: string } = {}) {
  const pods = await db.many(
    `select r.id, r.school_id, r.account_id, r.status::text as status,
            r.status_entered_at, r.episode_question, r.recording_date,
            r.published_on, r.path, r.guest_person_id, r.owner_id,
            s.name as school, s.stage::text as journey_stage,
            a.name as account,
            g.name as guest, u.full_name as owner
       from public.podcast_relationships r
       join public.schools s on s.id = r.school_id
       join public.accounts a on a.id = r.account_id
       left join public.people g on g.id = r.guest_person_id
       left join public.profiles u on u.id = r.owner_id
      order by r.status_entered_at desc`);
  if (pods.length === 0) return [];

  const ids = pods.map((p) => p.id as string);
  const counts = new Map<string, { open: number; overdue: number; blocking: number }>();
  for (const row of await db.many(
    `select podcast_id,
            count(*) filter (where status in ('open','in_progress','waiting','blocked')) as open,
            count(*) filter (where status in ('open','in_progress') and due_at < now()) as overdue,
            count(*) filter (where blocking and status in ('open','in_progress','waiting','blocked')) as blocking
       from public.work_items where podcast_id = any(?) group by podcast_id`, [ids])) {
    counts.set(row.podcast_id as string, {
      open: Number(row.open), overdue: Number(row.overdue),
      blocking: Number(row.blocking) });
  }
  const signals = new Map<string, number>();
  for (const row of await db.many(
    `select podcast_id, count(*) c from public.podcast_signals
      where podcast_id = any(?) group by podcast_id`, [ids])) {
    signals.set(row.podcast_id as string, Number(row.c));
  }

  let cards: ShowCard[] = pods.map((p) => {
    const c = counts.get(p.id as string) ?? { open: 0, overdue: 0, blocking: 0 };
    return {
      podcastId: p.id as string,
      schoolId: p.school_id as string, school: p.school as string,
      accountId: p.account_id as string, account: p.account as string,
      status: String(p.status), statusName: showStatusName(p.status as string),
      phase: SHOW_BY_KEY[String(p.status)]?.phase ?? "—",
      journeyStage: String(p.journey_stage),
      guest: (p.guest as string) ?? null,
      owner: (p.owner as string) ?? null,
      question: (p.episode_question as string) ?? null,
      recordingDate: (p.recording_date as string) ?? null,
      publishedOn: (p.published_on as string) ?? null,
      path: (p.path as string) ?? null,
      open: c.open, overdue: c.overdue, blocking: c.blocking,
      signals: signals.get(p.id as string) ?? 0,
      since: p.status_entered_at as string,
    };
  });

  if (filter.only === "mine" && filter.viewerId) {
    cards = cards.filter((c) => pods.find((p) => p.id === c.podcastId)
      ?.owner_id === filter.viewerId);
  } else if (filter.only === "overdue") {
    cards = cards.filter((c) => c.overdue > 0);
  } else if (filter.only === "no_signals") {
    cards = cards.filter((c) => c.status === "published" && c.signals === 0);
  } else if (filter.only === "no_path") {
    cards = cards.filter((c) => c.status === "published" && !c.path);
  }
  return cards;
}

/** How the six paths are actually landing, against the shape they should have. */
export async function pathMix() {
  const rows = await db.many(
    `select path, count(*) c from public.podcast_relationships
      where path is not null group by path`);
  const total = rows.reduce((n, r) => n + Number(r.c), 0);
  return {
    total,
    rows: PATHS.map((p) => {
      const actual = Number(rows.find((r) => r.path === p.key)?.c ?? 0);
      return {
        ...p, actual,
        pct: total ? Math.round((actual / total) * 100) : 0,
      };
    }),
    /** The show becoming a sales instrument is the failure mode worth watching. */
    drifting: total >= 5
      && (rows.filter((r) => COMMERCIAL_PATHS.includes(String(r.path)))
            .reduce((n, r) => n + Number(r.c), 0) / total) > 0.20,
  };
}
