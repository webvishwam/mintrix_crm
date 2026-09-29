import * as db from "@/server/db";
import * as audit from "./audit";
import * as activity from "./activity";

/**
 * PEOPLE.
 *
 * A person is never identified by name alone. The identity is
 *   name + role at the school + school + account,
 * because two people called Priya Sharma at two campuses of one trust are two people,
 * and the system must not decide otherwise on their behalf.
 *
 * The association IS the record: `person_roles` joins a person to a school in a role.
 * A Director of three campuses is ONE person with three associations, and leaving a
 * school sets an end date rather than deleting anything.
 */

/** What they ARE at their school. Grouped, and a free-text box always overrides. */
export const SCHOOL_ROLES: { key: string; name: string; group: string; rank: number }[] = [
  { key: "owner", name: "Owner", group: "Leadership", rank: 1 },
  { key: "chairman", name: "Chairman", group: "Leadership", rank: 1 },
  { key: "trustee", name: "Trustee", group: "Leadership", rank: 2 },
  { key: "secretary", name: "Secretary", group: "Leadership", rank: 2 },
  { key: "director", name: "Director", group: "Leadership", rank: 2 },
  { key: "manager", name: "Manager / Correspondent", group: "Leadership", rank: 3 },
  { key: "principal", name: "Principal", group: "Leadership", rank: 3 },
  { key: "vice_principal", name: "Vice Principal", group: "Leadership", rank: 4 },
  { key: "headmaster", name: "Headmaster / Head of School", group: "Leadership", rank: 4 },
  { key: "academic_coordinator", name: "Academic Coordinator", group: "Academic", rank: 5 },
  { key: "coordinator", name: "Coordinator", group: "Academic", rank: 5 },
  { key: "teacher", name: "Teacher", group: "Academic", rank: 7 },
  { key: "counsellor", name: "Counsellor", group: "Academic", rank: 7 },
  { key: "administrator", name: "Administrator", group: "Operations", rank: 6 },
  { key: "operations", name: "Operations", group: "Operations", rank: 6 },
  { key: "finance", name: "Finance / Accounts", group: "Operations", rank: 6 },
  { key: "it", name: "IT", group: "Operations", rank: 6 },
  { key: "front_office", name: "Front office / Reception", group: "Operations", rank: 8 },
  { key: "other", name: "Other", group: "Other", rank: 9 },
];
export const ROLE_GROUPS = ["Leadership", "Academic", "Operations", "Other"];
const RANK = Object.fromEntries(SCHOOL_ROLES.map((r) => [r.key, r.rank]));

export const schoolRoleName = (key?: string | null, custom?: string | null) =>
  // What the rep typed always wins over the dropdown.
  (custom?.trim())
  || SCHOOL_ROLES.find((r) => r.key === key)?.name
  || (key ? String(key).replace(/_/g, " ") : "Role not recorded");

/**
 * How they relate to MINTRIX. A different question from their school role, and the
 * two vocabularies deliberately share no key.
 */
export const RELATIONSHIPS: {
  key: string; name: string; short: string; what: string; exclusive?: boolean;
}[] = [
  { key: "decision_maker", name: "Decision Maker", short: "DM",
    what: "Can say yes. Observed, not assumed." },
  { key: "primary_poc", name: "Primary point of contact", short: "POC",
    what: "The one person we go to first.", exclusive: true },
  { key: "academic_poc", name: "Academic POC", short: "Acad",
    what: "Owns how learning is run." },
  { key: "commercial_poc", name: "Commercial POC", short: "Comm",
    what: "Pricing, procurement, paperwork." },
  { key: "operational_poc", name: "Operational POC", short: "Ops",
    what: "Runs the workflow we would actually touch." },
  { key: "technical_poc", name: "Technical POC", short: "Tech",
    what: "Owns the systems and the data." },
  { key: "implementation_owner", name: "Implementation owner", short: "Impl",
    what: "Named person on their side with freed time.", exclusive: true },
  { key: "champion", name: "Champion", short: "Champ",
    what: "Argues for us when we are not in the room." },
  { key: "blocker", name: "Blocker", short: "Block",
    what: "Argues against. Worth knowing early." },
  { key: "gatekeeper", name: "Gatekeeper", short: "Gate",
    what: "Controls access to somebody else." },
  { key: "podcast_guest", name: "Podcast guest", short: "Guest",
    what: "Has been, or will be, on the show." },
  { key: "influencer", name: "Influencer", short: "Infl",
    what: "Shapes the decision without making it." },
  { key: "other_relationship", name: "Other", short: "Other", what: "Anything else." },
];
export const relationshipMeta = (k: string) => RELATIONSHIPS.find((r) => r.key === k);

export const RELATIONSHIP_STATUSES: [string, string, string][] = [
  ["unknown", "Not yet known", "We have not formed a view."],
  ["neutral", "Neutral", "Polite, no lean either way."],
  ["warm", "Warm", "Engaged and helpful."],
  ["champion", "Champion", "Actively on our side."],
  ["blocker", "Blocker", "Actively against."],
];

export const DISCOVERY_ROUTES: [string, string][] = [
  ["research", "Found in research"],
  ["school_visit", "Met during a school visit"],
  ["introduced", "Introduced by another contact"],
  ["reception", "Found at reception"],
  ["recommended", "Recommended by someone"],
  ["inbound", "They contacted us"],
  ["podcast", "Met through the show"],
  ["event", "Met at an event"],
  ["other", "Other"],
];

// The two vocabularies must never collide, or the §12 distinction is cosmetic.
{
  const rel = new Set(RELATIONSHIPS.map((r) => r.key));
  for (const r of SCHOOL_ROLES) {
    if (r.key !== "other" && rel.has(r.key)) {
      throw new Error(`"${r.key}" is both a school role and a relationship type.`);
    }
  }
}

// --------------------------------------------------------------------------
export interface Association extends db.Row {
  school_id: string; school_name: string; account_id: string; account_name: string;
  role_label: string; relationships: string[];
}

/** "Priya Sharma — Principal — ABC International School (ABC Education Group)" */
export function identityLine(name: string, role?: string | null,
                             school?: string | null, account?: string | null): string {
  const tail = school
    ? [school, account && account !== school ? `(${account})` : null]
        .filter(Boolean).join(" ")
    : account ? `${account} (no school recorded)` : null;
  return [name, role, tail].filter(Boolean).join(" — ");
}

export async function associationsFor(personId: string, includeEnded = false):
  Promise<Association[]> {
  const rows = await db.many(
    `select r.*, s.name as school_name, s.account_id, a.name as account_name
       from public.person_roles r
       join public.schools s on s.id = r.school_id
       join public.accounts a on a.id = s.account_id
      where r.person_id = ?${includeEnded ? "" : " and r.ended_on is null"}
      order by (r.ended_on is not null), s.name`, [personId]);
  return rows.map((r) => ({
    ...r,
    role_label: schoolRoleName(r.school_role as string, r.custom_role as string),
    relationships: (r.relationship_types as string[]) ?? [],
  })) as Association[];
}

export interface PersonContext {
  person: db.Row; account: db.Row; associations: Association[]; past: Association[];
  identity: string; quality: { field: string; ok: boolean; label: string }[];
  opportunities: db.Row[]; podcast: db.Row | null;
}

export async function context(personId: string): Promise<PersonContext | null> {
  const person = await db.get("people", personId);
  if (!person) return null;
  const account = (await db.get("accounts", person.account_id as string))!;
  const all = await associationsFor(personId, true);
  const associations = all.filter((a) => !a.ended_on);
  const past = all.filter((a) => a.ended_on);
  const first = associations[0];
  const opportunities = await db.many(
    `select distinct o.* from public.opportunities o
       left join public.opportunity_stakeholders st on st.opportunity_id = o.id
      where o.primary_person_id = ? or st.person_id = ?
      order by o.updated_at desc`, [personId, personId]);
  const podcast = await db.one(
    "select * from public.podcast_relationships where guest_person_id = ? limit 1",
    [personId]);
  return {
    person, account, associations, past,
    identity: identityLine(person.name as string,
      first?.role_label ?? (person.title as string),
      first?.school_name ?? null, account.name as string),
    quality: dataQuality(person, associations), opportunities, podcast,
  };
}

/** What is incomplete, at a glance, without nagging. */
export function dataQuality(person: db.Row, assoc: Association[]) {
  const usable = (v: unknown) => {
    const s = String(v ?? "").trim().toLowerCase();
    return !!s && !["not found", "not publicly verified", "uncertain", "-", "n/a"]
      .some((b) => s.startsWith(b));
  };
  return [
    { field: "name", ok: !!String(person.name ?? "").trim(), label: "Name" },
    { field: "role", ok: assoc.some((a) => a.school_role || a.custom_role),
      label: "Role at the school" },
    { field: "school", ok: assoc.length > 0, label: "School" },
    { field: "phone", ok: usable(person.phone), label: "Phone" },
    { field: "email", ok: usable(person.email), label: "Email" },
    { field: "relationship", ok: assoc.some((a) => a.relationships.length > 0),
      label: "How they relate to us" },
  ];
}

export interface SchoolPeople {
  primaryPoc: db.Row | null;
  decisionMakers: db.Row[];
  operational: db.Row[];
  other: db.Row[];
  groupLevel: db.Row[];
  all: db.Row[];
}

const DM_REL = new Set(["decision_maker", "champion"]);
const OPS_ROLES = new Set(["administrator", "operations", "finance", "it",
                           "academic_coordinator", "coordinator", "front_office"]);

/** The school's people in the order a rep should read them. */
export async function atSchool(schoolId: string): Promise<SchoolPeople> {
  const school = await db.get("schools", schoolId);
  const rows: db.Row[] = (await db.many(
    `select p.*, r.id as association_id, r.school_role, r.custom_role,
            r.relationship_types, r.started_on, r.discovered_how
       from public.person_roles r join public.people p on p.id = r.person_id
      where r.school_id = ? and r.ended_on is null`, [schoolId]))
    .map((r) => ({
      ...r,
      role_label: schoolRoleName(r.school_role as string, r.custom_role as string),
      relationships: (r.relationship_types as string[]) ?? [],
    }));
  rows.sort((a, b) => (RANK[String(a.school_role)] ?? 99) - (RANK[String(b.school_role)] ?? 99)
    || String(a.name).localeCompare(String(b.name)));

  // Group-level people: attached to the account, not to any school. Shown on every
  // school page of that account rather than invented into one of them.
  const groupLevel: db.Row[] = school ? (await db.many(
    `select p.* from public.people p
      where p.account_id = ?
        and not exists (select 1 from public.person_roles r
                         where r.person_id = p.id and r.ended_on is null)
      order by p.name`, [school.account_id])).map((p) => ({
        ...p, role_label: (p.title as string) ?? "Role not recorded",
        relationships: [] as string[], group_level: true })) : [];

  const isDM = (p: db.Row) =>
    ((p.relationships as string[]) ?? []).some((r) => DM_REL.has(r))
    || (RANK[String(p.school_role)] ?? 99) <= 4;
  return {
    primaryPoc: rows.find((p) =>
      ((p.relationships as string[]) ?? []).includes("primary_poc")) ?? null,
    decisionMakers: rows.filter(isDM),
    operational: rows.filter((p) => !isDM(p) && OPS_ROLES.has(String(p.school_role))),
    other: rows.filter((p) => !isDM(p) && !OPS_ROLES.has(String(p.school_role))),
    groupLevel, all: rows,
  };
}

// --------------------------------------------------------------------------
// Duplicates — flagged, shown, NEVER merged on a guess
// --------------------------------------------------------------------------
export interface Match {
  person: db.Row; identity: string; reason: string; confidence: "HIGH" | "MEDIUM";
}

const normName = (s: string) =>
  s.toLowerCase().replace(/\b(mr|mrs|ms|dr|prof|shri|smt)\.?\b/g, "")
   .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export async function possibleDuplicates(name: string, opts: {
  accountId?: string | null; phone?: string | null; email?: string | null;
  excludeId?: string;
} = {}): Promise<Match[]> {
  const n = normName(name);
  if (!n) return [];
  const phone = String(opts.phone ?? "").replace(/\D/g, "").slice(-10);
  const email = String(opts.email ?? "").trim().toLowerCase();
  const out: Match[] = [];
  const seen = new Set<string>();

  const push = async (p: db.Row, reason: string, confidence: Match["confidence"]) => {
    if (p.id === opts.excludeId || seen.has(p.id as string)) return;
    seen.add(p.id as string);
    const assoc = await associationsFor(p.id as string);
    const acc = await db.get("accounts", p.account_id as string);
    out.push({ person: p, reason, confidence,
      identity: identityLine(p.name as string,
        assoc[0]?.role_label ?? (p.title as string),
        assoc[0]?.school_name ?? null, acc?.name as string) });
  };

  for (const p of await db.many(
    `select * from public.people where lower(name) = lower(?) limit 20`, [name])) {
    await push(p, opts.accountId && p.account_id === opts.accountId
      ? "Same name, and already in this account" : "Same name, different account",
      p.account_id === opts.accountId ? "HIGH" : "MEDIUM");
  }
  if (phone.length === 10) {
    for (const p of await db.many(
      `select * from public.people
        where regexp_replace(coalesce(phone,''), '\\D', '', 'g') like ? limit 10`,
      [`%${phone}`])) {
      await push(p, "Same phone number", "HIGH");
    }
  }
  if (email) {
    for (const p of await db.many(
      "select * from public.people where lower(email) = ? limit 10", [email])) {
      await push(p, "Same email address", "HIGH");
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Writes
// --------------------------------------------------------------------------
export interface AddPerson {
  accountId: string; schoolId?: string | null; name: string;
  schoolRole?: string | null; customRole?: string | null;
  relationshipTypes?: string[];
  phone?: string; whatsapp?: string; email?: string;
  relationshipStatus?: string; discoveredHow?: string | null;
  introducedBy?: string | null; notes?: string | null;
}

export async function add(input: AddPerson): Promise<{ personId: string }> {
  if (!input.name.trim()) throw new Error("A person needs a name.");
  return db.transaction(async () => {
    const personId = await db.insert("people", {
      account_id: input.accountId, name: input.name.trim(),
      title: input.customRole?.trim()
        || (input.schoolRole ? schoolRoleName(input.schoolRole) : null),
      phone: input.phone?.trim() || null,
      phone_confidence: input.phone?.trim() ? "UNVERIFIED" : null,
      whatsapp: input.whatsapp?.trim() || null,
      email: input.email?.trim() || null,
      email_confidence: input.email?.trim() ? "UNVERIFIED" : null,
      preferred_channel: input.phone?.trim() ? "phone"
        : input.email?.trim() ? "email" : null,
      relationship_status: input.relationshipStatus || "unknown",
      discovered_how: input.discoveredHow ?? null,
      notes: input.notes?.trim() || null,
    });
    if (input.schoolId) {
      await linkToSchool({
        personId, schoolId: input.schoolId, schoolRole: input.schoolRole,
        customRole: input.customRole, relationshipTypes: input.relationshipTypes,
        discoveredHow: input.discoveredHow, introducedBy: input.introducedBy,
        notes: input.notes,
      });
    }
    const school = input.schoolId ? await db.get("schools", input.schoolId) : null;
    const intro = input.introducedBy ? await db.get("people", input.introducedBy) : null;
    await activity.log({
      accountId: input.accountId, schoolId: input.schoolId ?? null, personId,
      type: "contact_discovered", direction: "inbound",
      outcomeKey: input.discoveredHow ?? "added", outcomeLabel: "New contact recorded",
      summary: `${input.name.trim()} added` +
        (input.customRole || input.schoolRole
          ? ` as ${schoolRoleName(input.schoolRole, input.customRole)}` : "") +
        (school ? ` at ${school.name}` : "") +
        (input.discoveredHow
          ? ` · ${(DISCOVERY_ROUTES.find(([k]) => k === input.discoveredHow)?.[1]
                   ?? input.discoveredHow).toLowerCase()}` : "") +
        (intro ? ` · introduced by ${intro.name}` : ""),
    });
    await audit.record({
      action: "PERSON_CREATED", objectType: "person", objectId: personId,
      accountId: input.accountId, schoolId: input.schoolId ?? null,
      after: { name: input.name.trim(), school: school?.name ?? null },
    });
    return { personId };
  });
}

export async function linkToSchool(i: {
  personId: string; schoolId: string; schoolRole?: string | null;
  customRole?: string | null; relationshipTypes?: string[];
  discoveredHow?: string | null; introducedBy?: string | null; notes?: string | null;
}): Promise<string> {
  const types = i.relationshipTypes ?? [];
  const existing = await db.one(
    `select id from public.person_roles
      where person_id = ? and school_id = ? and ended_on is null`,
    [i.personId, i.schoolId]);
  if (existing) return existing.id as string;

  const id = await db.insert("person_roles", {
    person_id: i.personId, school_id: i.schoolId,
    school_role: i.schoolRole || null, custom_role: i.customRole || null,
    relationship_types: types, started_on: db.today(),
    discovered_how: i.discoveredHow ?? null,
    introduced_by_person_id: i.introducedBy ?? null,
    notes: i.notes ?? null, created_by: db.currentUserId(),
  });
  await enforceExclusive(i.schoolId, i.personId, types);
  return id;
}

/** A school has exactly one primary point of contact, and one implementation owner. */
async function enforceExclusive(schoolId: string, keepPersonId: string, types: string[]) {
  for (const t of RELATIONSHIPS.filter((r) => r.exclusive).map((r) => r.key)) {
    if (!types.includes(t)) continue;
    await db.run(
      `update public.person_roles
          set relationship_types = array_remove(relationship_types, ?)
        where school_id = ? and person_id <> ? and ended_on is null
          and ? = any(relationship_types)`,
      [t, schoolId, keepPersonId, t]);
  }
}

export async function endAssociation(id: string, reason?: string | null) {
  const row = await db.get("person_roles", id);
  if (!row) throw new Error("That association no longer exists.");
  await db.update("person_roles", id, {
    ended_on: db.today(),
    notes: [row.notes, reason].filter(Boolean).join(" · ") || null,
  });
  await audit.record({
    action: "PERSON_ASSOCIATION_ENDED", objectType: "person",
    objectId: row.person_id as string, schoolId: row.school_id as string,
    before: { school_id: row.school_id }, after: { ended_on: db.today() },
    reason: reason ?? null,
  });
}

export async function update(id: string, patch: db.Row) {
  const before = await db.get("people", id);
  if (!before) throw new Error("That person no longer exists.");
  await db.update("people", id, patch);
  await audit.record({
    action: "USER_PROFILE_UPDATED", objectType: "person", objectId: id,
    accountId: before.account_id as string,
    before: { name: before.name, phone: before.phone, email: before.email },
    after: { name: patch.name, phone: patch.phone, email: patch.email },
  });
}

/** A controlled merge. History moves; nothing is deleted. */
export async function merge(dropId: string, keepId: string, reason: string) {
  if (dropId === keepId) throw new Error("A person cannot be merged into themselves.");
  if (!reason.trim()) throw new Error("Say why they are the same person.");
  const drop = await db.get("people", dropId);
  const keep = await db.get("people", keepId);
  if (!drop || !keep) throw new Error("One of those people no longer exists.");

  return db.transaction(async () => {
    // Fill blanks on the surviving record; never overwrite.
    const patch: db.Row = {};
    for (const f of ["title", "phone", "whatsapp", "email", "linkedin",
                     "preferred_channel", "background", "authority_evidence",
                     "decision_authority", "discovered_how"]) {
      if (!keep[f] && drop[f]) patch[f] = drop[f];
    }
    if (drop.notes) {
      patch.notes = [keep.notes, `Merged from a duplicate: ${drop.notes}`]
        .filter(Boolean).join("\n\n");
    }
    if (Object.keys(patch).length) await db.update("people", keepId, patch);

    const keepSchools = new Set((await db.many(
      "select school_id from public.person_roles where person_id = ? and ended_on is null",
      [keepId])).map((r) => r.school_id as string));
    let movedRoles = 0;
    for (const r of await db.many(
      "select * from public.person_roles where person_id = ?", [dropId])) {
      if (!r.ended_on && keepSchools.has(r.school_id as string)) {
        await db.run("delete from public.person_roles where id = ?", [r.id]);
        continue;
      }
      await db.run("update public.person_roles set person_id = ? where id = ?",
                   [keepId, r.id]);
      movedRoles++;
    }
    const moved = async (sql: string) => (await db.run(sql, [keepId, dropId])).changes;
    const movedActivities = await moved(
      "update public.activities set person_id = ? where person_id = ?");
    await moved("update public.work_items set person_id = ? where person_id = ?");
    await moved("update public.work_items set external_person_id = ? where external_person_id = ?");
    await moved("update public.opportunities set primary_person_id = ? where primary_person_id = ?");
    await moved("update public.podcast_relationships set guest_person_id = ? where guest_person_id = ?");
    await moved("update public.person_roles set introduced_by_person_id = ? where introduced_by_person_id = ?");

    for (const st of await db.many(
      "select * from public.opportunity_stakeholders where person_id = ?", [dropId])) {
      const clash = await db.one(
        `select id from public.opportunity_stakeholders
          where opportunity_id = ? and person_id = ? and capacity = ?`,
        [st.opportunity_id, keepId, st.capacity]);
      if (clash) await db.run("delete from public.opportunity_stakeholders where id = ?", [st.id]);
      else await db.run("update public.opportunity_stakeholders set person_id = ? where id = ?",
                        [keepId, st.id]);
    }

    await activity.log({
      accountId: keep.account_id as string, personId: keepId,
      type: "record_merged", direction: "internal",
      outcomeLabel: "Duplicate person merged",
      summary: `"${drop.name}" merged into "${keep.name}". ${reason.trim()} ` +
               `${movedActivities} activity record(s) moved across; nothing was deleted.`,
    });
    await audit.record({
      action: "PERSON_MERGED", objectType: "person", objectId: keepId,
      accountId: keep.account_id as string,
      before: { merged_id: dropId, merged_name: drop.name },
      after: { kept_id: keepId }, reason: reason.trim(),
    });
    await db.run("delete from public.people where id = ?", [dropId]);
    return { movedRoles, movedActivities };
  });
}
