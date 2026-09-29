/**
 * THE COMMERCIAL WORKSTREAM.
 *
 * An Opportunity is not a pipeline. It is the paperwork of one school's journey:
 * which route the deal is taking, what was quoted, who has to say yes, and what
 * has been proposed, signed and paid.
 *
 * Where the deal has got to is the SCHOOL's stage. There is one ladder and the
 * school is on it. `opportunities.stage` is a mirror of that, written only by the
 * transition engine, so that a query against either table gives the same answer.
 * Nothing here moves a stage.
 *
 * It is never created automatically. Recording a podcast does not open a deal;
 * somebody decides to, and says why.
 */
import * as db from "@/server/db";
import * as audit from "@/domain/audit";
import * as activity from "@/domain/activity";
import { BY_KEY, COMMERCIAL } from "@/domain/journey";

/** How this school is being sold to. Chosen once, changed with a reason. */
export const ROUTES = [
  { key: "direct", name: "Direct to the school",
    what: "The school decides for itself." },
  { key: "group", name: "Through the group",
    what: "A trust or chain decides for several schools at once." },
  { key: "referral", name: "Referral",
    what: "Somebody the school already trusts introduced us." },
  { key: "inbound", name: "They came to us",
    what: "The school asked first." },
] as const;

export const routeName = (k?: string | null) =>
  ROUTES.find((r) => r.key === k)?.name ?? "Not set";

/** What a stakeholder does to a deal — not their job at the school. */
export const CAPACITIES = [
  { key: "decides", name: "Decides", what: "Can say yes on their own." },
  { key: "approves_budget", name: "Approves the money", what: "Signs off spend." },
  { key: "recommends", name: "Recommends", what: "Their opinion carries." },
  { key: "uses", name: "Will use it", what: "Lives with the result." },
  { key: "blocks", name: "Can block it", what: "Can stop this on their own." },
] as const;

export const capacityName = (k?: string | null) =>
  CAPACITIES.find((c) => c.key === k)?.name ?? String(k ?? "");

/** The stages at which a deal can exist at all. The same list the check uses. */
export const CAN_OPEN_FROM = COMMERCIAL;

export interface Opportunity {
  id: string; account_id: string; school_id: string; name: string;
  stage: string; route: string | null; [k: string]: unknown;
}

// --------------------------------------------------------------------------
// Opening one
// --------------------------------------------------------------------------
export async function open(input: {
  schoolId: string; route: string; reason: string;
  ownerId?: string | null; feeQuoted?: number | null;
  expectedDecision?: string | null; primaryPersonId?: string | null;
  fromSignalId?: string | null;
}): Promise<{ id: string }> {
  const reason = input.reason?.trim();
  if (!reason) throw new Error("Say why this is a real opportunity.");
  if (!ROUTES.some((r) => r.key === input.route)) {
    throw new Error("Choose how this school is being sold to.");
  }

  const school = await db.get("schools", input.schoolId);
  if (!school) throw new Error("That school no longer exists.");

  // A deal cannot exist before there is something to sell against. Discovery is
  // the first stage where a school has told us a problem in its own words; before
  // that there is a relationship, not an opportunity.
  const here = String(school.stage);
  if (!COMMERCIAL.some((s) => s.key === here)) {
    throw new Error(
      `There is nothing to quote for yet. ${school.name as string} is at `
      + `${BY_KEY[here]?.name ?? here}; a deal opens from `
      + `${COMMERCIAL[0].name} onwards. Move the school when the stage is earned.`);
  }

  const existing = await db.one(
    `select id from public.opportunities
      where school_id = ? and terminal_state is null`, [input.schoolId]);
  if (existing) {
    throw new Error(
      "This school already has an open opportunity. Work that one, or close it first.");
  }

  const account = await db.get("accounts", school.account_id as string);

  return db.transaction(async () => {
    const id = await db.insert("opportunities", {
      account_id: school.account_id,
      school_id: input.schoolId,
      name: `${school.name as string} — ${routeName(input.route)}`,
      stage: String(school.stage),
      stage_entered_at: db.now(),
      route: input.route,
      description: reason,
      owner_id: input.ownerId ?? school.owner_id ?? db.currentUserId(),
      primary_person_id: input.primaryPersonId ?? null,
      opened_from_signal_id: input.fromSignalId ?? null,
      pilot_fee_quoted: input.feeQuoted ?? null,
      expected_decision_date: input.expectedDecision || null,
    });

    await activity.log({
      accountId: school.account_id as string, schoolId: input.schoolId,
      opportunityId: id, type: "opportunity_opened",
      outcomeKey: input.route, outcomeLabel: "Opportunity opened",
      summary: `Opportunity opened against ${school.name as string} — ${reason}`,
    });
    await audit.record({
      action: "OPPORTUNITY_OPENED", objectType: "opportunity", objectId: id,
      accountId: school.account_id as string, schoolId: input.schoolId,
      after: { route: input.route, stage: school.stage,
               account: account?.name ?? null },
      reason,
    });
    return { id };
  });
}

// --------------------------------------------------------------------------
// Reading one
// --------------------------------------------------------------------------
export async function byId(id: string) {
  const o = await db.get("opportunities", id);
  if (!o) return null;

  const school = await db.get("schools", o.school_id as string);
  const account = await db.get("accounts", o.account_id as string);

  // The school's stage is the truth. If the mirror has drifted — an old row, a
  // restore — say so rather than showing two different answers.
  const schoolStage = String(school?.stage ?? o.stage);
  const drifted = schoolStage !== String(o.stage);

  // One request holds one connection, so these run one after another. Firing them
  // at the same client with Promise.all only queues them anyway, and node-postgres
  // has deprecated it.
  const owner = o.owner_id
    ? await db.one("select full_name from public.profiles where id = ?", [o.owner_id])
    : null;
  const primary = o.primary_person_id
    ? await db.get("people", o.primary_person_id as string) : null;
  const stakeholders = await db.many(
    `select s.*, p.name, p.phone, p.whatsapp, p.email,
            r.school_role::text as school_role
       from public.opportunity_stakeholders s
       join public.people p on p.id = s.person_id
       left join public.person_roles r
              on r.person_id = p.id and r.school_id = ? and r.ended_on is null
      where s.opportunity_id = ? order by s.created_at`,
    [o.school_id, id]);
  const proposals = await db.many(
    "select * from public.proposals where opportunity_id = ? order by created_at desc", [id]);
  const contracts = await db.many(
    "select * from public.contracts where opportunity_id = ? order by created_at desc", [id]);
  const payments = await db.many(
    "select * from public.payments where opportunity_id = ? order by created_at desc", [id]);
  const pilot = await db.one("select * from public.pilots where opportunity_id = ?", [id]);
  const work = await db.many(
    `select w.*, p.full_name as owner_name from public.work_items w
       left join public.profiles p on p.id = w.owner_id
      where w.school_id = ? and w.workstream in ('commercial','contract','pilot')
      order by (w.status in ('resolved','cancelled')), w.due_at nulls last`,
    [o.school_id]);
  const signal = o.opened_from_signal_id
    ? await db.one(`select verbatim_quote, speaker, speaker_role
                      from public.podcast_signals where id = ?`, [o.opened_from_signal_id])
    : null;
  const history = await db.many(
    `select a.*, p.full_name as actor_name from public.activities a
       left join public.profiles p on p.id = a.logged_by
      where a.school_id = ? order by a.occurred_at desc limit 10`, [o.school_id]);

  const banked = payments
    .filter((p) => p.banked_on)
    .reduce((n, p) => n + Number(p.amount_inr ?? 0), 0);
  const invoiced = payments.reduce((n, p) => n + Number(p.amount_inr ?? 0), 0);

  return {
    o: o as Opportunity, school, account, owner, primary, signal,
    schoolStage, drifted,
    stageName: BY_KEY[schoolStage]?.name ?? schoolStage,
    commercialStages: COMMERCIAL,
    stakeholders, proposals, contracts, payments, pilot, work, history,
    money: { invoiced, banked },
    /** Who can still stop this, and whether anybody has been named who can say yes. */
    decider: stakeholders.find((s) => s.capacity === "decides") ?? null,
    blockers: stakeholders.filter((s) => s.capacity === "blocks"),
  };
}

export async function addStakeholder(input: {
  opportunityId: string; personId: string; capacity: string; note?: string | null;
}) {
  if (!CAPACITIES.some((c) => c.key === input.capacity)) {
    throw new Error("Say what this person does to the decision.");
  }
  const o = await db.get("opportunities", input.opportunityId);
  if (!o) throw new Error("That opportunity no longer exists.");
  const person = await db.get("people", input.personId);
  if (!person) throw new Error("That person no longer exists.");

  const already = await db.one(
    `select id from public.opportunity_stakeholders
      where opportunity_id = ? and person_id = ?`,
    [input.opportunityId, input.personId]);
  if (already) {
    await db.update("opportunity_stakeholders", already.id as string,
                    { capacity: input.capacity, note: input.note ?? null });
  } else {
    await db.insert("opportunity_stakeholders", {
      opportunity_id: input.opportunityId, person_id: input.personId,
      capacity: input.capacity, note: input.note ?? null,
    });
  }
  await audit.record({
    action: "OPPORTUNITY_STAKEHOLDER_SET", objectType: "opportunity",
    objectId: input.opportunityId, accountId: o.account_id as string,
    schoolId: o.school_id as string,
    after: { person: person.name, capacity: input.capacity },
    reason: input.note ?? null,
  });
}

/**
 * Closing is a decision about the deal, not about the school. The school stays
 * where it is on the ladder; somebody moves it to lost or nurture separately, and
 * means it.
 */
/**
 * A deal ends won, or it is parked. It does not end "lost": whether the SCHOOL is
 * lost is the school's own state on the one ladder, and saying it in two places is
 * how two places come to disagree.
 */
export const TERMINAL = [
  { key: "won", name: "Won", what: "They said yes and it is signed." },
  { key: "parked", name: "Parked", what: "Not now. The school stays where it is." },
] as const;

export async function close(id: string, state: "won" | "parked", why: string) {
  const reason = why?.trim();
  if (!reason) throw new Error("Say why this opportunity is closing.");
  const o = await db.get("opportunities", id);
  if (!o) throw new Error("That opportunity no longer exists.");
  if (o.terminal_state) throw new Error("This opportunity is already closed.");
  if (!TERMINAL.some((t) => t.key === state)) {
    throw new Error("An opportunity is either won or parked.");
  }

  await db.transaction(async () => {
    await db.update("opportunities", id,
                    { terminal_state: state, archived_at: db.now() });
    await activity.log({
      accountId: o.account_id as string, schoolId: o.school_id as string,
      opportunityId: id, type: "opportunity_closed",
      outcomeKey: state,
      outcomeLabel: state === "won" ? "Opportunity won" : "Opportunity parked",
      summary: `Opportunity closed as ${state} — ${reason}`,
    });
    await audit.record({
      action: "OPPORTUNITY_CLOSED", objectType: "opportunity", objectId: id,
      accountId: o.account_id as string, schoolId: o.school_id as string,
      before: { terminal_state: null }, after: { terminal_state: state }, reason,
    });
  });
}

/**
 * Called by the transition engine, and by nothing else. Keeps the mirror honest.
 * Returns the number of opportunities brought into line.
 */
export async function mirrorStage(schoolId: string, stage: string): Promise<number> {
  if (!COMMERCIAL.some((s) => s.key === stage)) return 0;
  const { changes } = await db.run(
    `update public.opportunities
        set stage = ?::journey_stage, stage_entered_at = now(), updated_at = now()
      where school_id = ? and terminal_state is null and stage <> ?::journey_stage`,
    [stage, schoolId, stage]);
  return changes ?? 0;
}
