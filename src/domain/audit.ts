import * as db from "@/server/db";

/**
 * THE AUDIT TRAIL — who changed the system.
 *
 * Deliberately NOT the activity timeline. Two different questions:
 *
 *   activity  "Shrey spoke with the Principal."          business history
 *   audit     "Shrey moved the school Target → Research." accountability
 *
 * Append-only: no policy on audit_events permits update or delete, for anyone.
 * Never contains a password, a token or any other secret.
 */

export type AuditAction =
  | "SCHOOL_CREATED" | "SCHOOL_STAGE_CHANGED" | "SCHOOL_STAGE_REVERTED"
  | "SCHOOL_OWNER_CHANGED" | "SCHOOL_ARCHIVED" | "SCHOOL_RESTORED"
  | "PERSON_CREATED" | "PERSON_MERGED" | "PERSON_ASSOCIATION_ENDED"
  | "WORK_CREATED" | "WORK_ASSIGNED" | "WORK_RESOLVED" | "WORK_REOPENED"
  | "WORK_CANCELLED" | "WORK_STATUS_CHANGED"
  | "OPPORTUNITY_OPENED" | "OPPORTUNITY_STAGE_CHANGED"
  | "OPPORTUNITY_STAKEHOLDER_SET" | "OPPORTUNITY_CLOSED"
  | "PODCAST_STATUS_CHANGED" | "SIGNAL_RECORDED" | "PODCAST_PATH_SET"
  | "DELIVERY_STAGE_CHANGED"
  | "USER_PROFILE_UPDATED" | "USER_EMAIL_CHANGE_REQUESTED" | "USER_EMAIL_CHANGED"
  | "USER_PASSWORD_CHANGED" | "USER_ROLE_CHANGED" | "USER_TEAM_CHANGED"
  | "USER_SCOPE_GRANTED" | "USER_SCOPE_REVOKED" | "USER_DISABLED" | "USER_ENABLED"
  | "SETTINGS_CHANGED" | "IMPORT_COMMITTED" | "DUPLICATE_RESOLVED";

export interface AuditInput {
  action: AuditAction;
  objectType: string;
  objectId: string;
  actorLabel?: string;
  accountId?: string | null;
  schoolId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** The ONE way an audit row is written. Nothing else inserts into audit_events. */
export async function record(a: AuditInput): Promise<void> {
  await db.run(
    `insert into public.audit_events
       (actor_id, actor_label, action, object_type, object_id, account_id, school_id,
        before_value, after_value, reason)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [db.currentUserId(), a.actorLabel ?? null, a.action, a.objectType, a.objectId,
     a.accountId ?? null, a.schoolId ?? null,
     a.before === undefined ? null : JSON.stringify(a.before),
     a.after === undefined ? null : JSON.stringify(a.after),
     a.reason ?? null]);
}

export interface AuditFilter {
  actorId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  action?: string | null;
  schoolId?: string | null;
  accountId?: string | null;
  since?: string | null;
  limit?: number;
}

export async function search(f: AuditFilter = {}): Promise<db.Row[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { where.push(sql); args.push(v); };
  if (f.actorId) add("a.actor_id = ?", f.actorId);
  if (f.objectType) add("a.object_type = ?", f.objectType);
  if (f.objectId) add("a.object_id = ?", f.objectId);
  if (f.action) add("a.action = ?", f.action);
  if (f.schoolId) add("a.school_id = ?", f.schoolId);
  if (f.accountId) add("a.account_id = ?", f.accountId);
  if (f.since) add("a.occurred_at >= ?", f.since);
  args.push(Math.min(f.limit ?? 100, 500));
  return db.many(
    `select a.*, coalesce(p.full_name, a.actor_label, 'system') as actor_name,
            s.name as school_name, ac.name as account_name
       from public.audit_events a
       left join public.profiles p on p.id = a.actor_id
       left join public.schools s  on s.id = a.school_id
       left join public.accounts ac on ac.id = a.account_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by a.occurred_at desc
      limit ?`, args);
}

/** Everything that has ever happened to one object, for its history panel. */
export const historyOf = (objectType: string, objectId: string) =>
  search({ objectType, objectId, limit: 200 });
