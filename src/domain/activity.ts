import * as db from "@/server/db";

/**
 * THE ACTIVITY TIMELINE — what happened.
 *
 * Not work (what needs to happen) and not audit (who changed the system). Append-only:
 * there is no update or delete policy on the table, because a call that happened
 * still happened.
 */
export interface ActivityInput {
  accountId: string;
  schoolId?: string | null;
  personId?: string | null;
  opportunityId?: string | null;
  podcastId?: string | null;
  workItemId?: string | null;
  type: string;
  direction?: string | null;
  outcomeKey?: string | null;
  outcomeLabel?: string | null;
  summary: string;
  occurredAt?: string;
}

/** The ONE way an activity row is written. */
export async function log(a: ActivityInput): Promise<string> {
  if (!a.summary.trim()) throw new Error("An activity needs a summary.");
  return db.insert("activities", {
    account_id: a.accountId, school_id: a.schoolId ?? null,
    person_id: a.personId ?? null, opportunity_id: a.opportunityId ?? null,
    podcast_id: a.podcastId ?? null, work_item_id: a.workItemId ?? null,
    activity_type: a.type, direction: a.direction ?? null,
    outcome_key: a.outcomeKey ?? null, outcome_label: a.outcomeLabel ?? null,
    summary: a.summary.trim(), occurred_at: a.occurredAt ?? db.now(),
    logged_by: db.currentUserId(),
  });
}

export async function forSchool(schoolId: string, limit = 60): Promise<db.Row[]> {
  return db.many(
    `select a.*, coalesce(p.full_name, '') as actor_name, pe.name as person_name
       from public.activities a
       left join public.profiles p on p.id = a.logged_by
       left join public.people pe on pe.id = a.person_id
      where a.school_id = ?
      order by a.occurred_at desc limit ?`, [schoolId, limit]);
}

export async function forAccount(accountId: string, limit = 60): Promise<db.Row[]> {
  return db.many(
    `select a.*, coalesce(p.full_name, '') as actor_name, s.name as school_name
       from public.activities a
       left join public.profiles p on p.id = a.logged_by
       left join public.schools s on s.id = a.school_id
      where a.account_id = ?
      order by a.occurred_at desc limit ?`, [accountId, limit]);
}
