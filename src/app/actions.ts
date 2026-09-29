"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as db from "@/server/db";
import * as auth from "@/domain/auth";
import * as audit from "@/domain/audit";
import * as activity from "@/domain/activity";
import * as work from "@/domain/work";
import * as stage from "@/domain/stage";
import * as people from "@/domain/people";
import * as commercial from "@/domain/commercial";
import * as show from "@/domain/show";

/**
 * Every mutation in the application. One file, so the set of things that can change
 * data is knowable by reading one screen of imports.
 *
 * Each action: establish the user -> check authority -> call a DOMAIN function ->
 * redirect with a human message. No business logic lives here; it lives in
 * src/domain, which is what stops five screens inventing five versions of a rule.
 */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (f: FormData, k: string) => f.getAll(k).map(String).filter(Boolean);

function back(path: string, msg?: string, err?: string): never {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.toString() ? `?${q}` : ""}`);
}

/** Run inside the caller's database identity, turning failures into human messages. */
async function act<T>(onError: string, fn: (me: auth.Identity) => Promise<T>): Promise<T> {
  const me = await auth.currentIdentity();
  if (!me) redirect("/login");
  if (me.status === "disabled") {
    back("/login", undefined, "That account has been disabled.");
  }
  try {
    return await db.withUser(me.id, () => fn(me));
  } catch (e) {
    const err = e as Error;
    if (err.message === "NEXT_REDIRECT"
        || (e as any)?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    // A rep is never shown a driver string.
    const message = /violates|constraint|syntax|relation|column|permission denied/i
      .test(err.message)
      ? "That could not be saved. Nothing was changed."
      : err.message;
    console.error("action failed:", err.message);
    back(onError, undefined, message);
  }
}

const founderOnly = (me: auth.Identity) => {
  if (me.role !== "founder") throw new Error("That is the founder's to change.");
};
const staffOnly = (me: auth.Identity) => {
  if (me.role === "external") {
    throw new Error("Your access covers the work assigned to you, nothing wider.");
  }
};

// ==========================================================================
// SESSION
// ==========================================================================
export async function signInAction(f: FormData) {
  const res = await auth.signIn(str(f, "email"), String(f.get("password") ?? ""));
  if (!res.ok) back("/login", undefined, res.error);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOutAction() {
  await auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

// ==========================================================================
// THE SCHOOL JOURNEY — one transition path, used by every route into a move
// ==========================================================================
export async function moveStage(f: FormData) {
  const id = str(f, "school_id");
  const to = str(f, "to");
  await act(`/schools/${id}/advance?to=${to}`, async (me) => {
    staffOnly(me);
    const school = await db.get("schools", id);
    if (!school) throw new Error("That school no longer exists.");
    const res = await stage.move(id, to, {
      overrideReason: str(f, "override") || null,
      note: str(f, "note") || null,
      isFounder: me.role === "founder",
    });
    const parts = [
      `${school.name} is now at ${stage.stageName(res.to)}.`,
      res.created.length
        ? `${res.created.length} piece${res.created.length === 1 ? "" : "s"} of work created.`
        : "",
      res.carried ? `${res.carried} non-blocking item(s) carried over.` : "",
      res.overridden ? "Recorded as an override." : "",
      "You can put this back from the school's history.",
    ].filter(Boolean);
    revalidatePath("/", "layout");
    back(`/schools/${id}`, parts.join(" "));
  });
}

export async function revertStage(f: FormData) {
  const id = str(f, "school_id");
  await act(`/schools/${id}`, async (me) => {
    staffOnly(me);
    const res = await stage.revert(str(f, "transition_id"), str(f, "why"),
                                  me.role === "founder");
    revalidatePath("/", "layout");
    back(`/schools/${id}`,
         `Put back to ${stage.stageName(res.back)}.` +
         (res.cancelled ? ` ${res.cancelled} unstarted item(s) cancelled.` : ""));
  });
}

export async function bulkMove(f: FormData) {
  const ids = list(f, "id");
  const to = str(f, "to");
  await act("/pipeline", async (me) => {
    staffOnly(me);
    let moved = 0;
    const refused: string[] = [];
    for (const id of ids) {
      const school = await db.get("schools", id);
      if (!school) continue;
      try {
        await stage.move(id, to, { isFounder: me.role === "founder" });
        moved++;
      } catch (e) {
        refused.push(`${school.name}: ${(e as Error).message}`);
      }
    }
    revalidatePath("/", "layout");
    // Never silently half-succeed.
    back("/pipeline",
         `${moved} moved to ${stage.stageName(to)}.` +
         (refused.length ? ` ${refused.length} could not: ${refused[0]}` : ""));
  });
}

export async function assignSchool(f: FormData) {
  const id = str(f, "school_id");
  await act(`/schools/${id}`, async (me) => {
    staffOnly(me);
    const school = await db.get("schools", id);
    if (!school) throw new Error("That school no longer exists.");
    const ownerId = str(f, "owner_id") || null;
    await db.transaction(async () => {
      await db.update("schools", id, { owner_id: ownerId });
      await audit.record({
        action: "SCHOOL_OWNER_CHANGED", objectType: "school", objectId: id,
        accountId: school.account_id as string, schoolId: id,
        before: { owner_id: school.owner_id }, after: { owner_id: ownerId },
        reason: str(f, "reason") || null,
      });
    });
    revalidatePath("/", "layout");
    back(`/schools/${id}`, ownerId ? "Reassigned." : "Owner cleared — now orphaned.");
  });
}

export async function updateSchool(f: FormData) {
  const id = str(f, "school_id");
  await act(`/schools/${id}`, async (me) => {
    staffOnly(me);
    const before = await db.get("schools", id);
    if (!before) throw new Error("That school no longer exists.");
    // The stage is NOT editable here. A stage change goes through the gate, which
    // evaluates entry checks and blocking work and writes a handoff. An edit form
    // that could set it silently would make the gate decorative.
    const patch = {
      board: str(f, "board") || before.board,
      locality: str(f, "locality") || before.locality,
      official_phone: str(f, "official_phone") || before.official_phone,
      official_email: str(f, "official_email") || before.official_email,
      website: str(f, "website") || before.website,
      udise_code: str(f, "udise_code") || before.udise_code,
      enrolled_student_count: parseInt(str(f, "enrolled_student_count"), 10)
        || before.enrolled_student_count,
      context_note: str(f, "context_note") || null,
    };
    await db.transaction(async () => {
      await db.update("schools", id, patch);
      await audit.record({
        action: "SCHOOL_STAGE_CHANGED", objectType: "school", objectId: id,
        accountId: before.account_id as string, schoolId: id,
        before: { board: before.board, locality: before.locality },
        after: { board: patch.board, locality: patch.locality },
        reason: "Record corrected",
      });
    });
    revalidatePath("/", "layout");
    back(`/schools/${id}`, "School updated.");
  });
}

// ==========================================================================
// WORK
// ==========================================================================
export async function createWork(f: FormData) {
  const schoolId = str(f, "school_id") || null;
  const accountId = str(f, "account_id");
  const backTo = schoolId ? `/schools/${schoolId}` : `/accounts/${accountId}`;
  await act(backTo, async (me) => {
    staffOnly(me);
    const id = await work.create({
      accountId, schoolId,
      title: str(f, "title"), reason: str(f, "reason"),
      requiredOutcome: str(f, "required_outcome") || null,
      team: str(f, "team") || "sales",
      workstream: str(f, "workstream") || "acquisition",
      taskType: str(f, "task_type") || "call",
      ownerId: str(f, "owner_id") || me.id,
      externalPersonId: str(f, "external_person_id") || null,
      personId: str(f, "external_person_id") || null,
      dependsOn: str(f, "depends_on") || null,
      slaHours: parseInt(str(f, "sla_hours"), 10) || 48,
      priority: str(f, "priority") || "normal",
    });
    revalidatePath("/", "layout");
    back(`/work/${id}`, "Work created.");
  });
}

export async function resolveWork(f: FormData) {
  const id = str(f, "work_id");
  await act(`/work/${id}`, async () => {
    const t = await db.get("work_items", id);
    await work.resolve(id, { kind: str(f, "kind") || "completed", note: str(f, "note") });
    let follow = "";
    if (str(f, "follow_up_title") && t) {
      try {
        await work.create({
          accountId: t.account_id as string, schoolId: t.school_id as string | null,
          title: str(f, "follow_up_title"),
          reason: str(f, "follow_up_reason") || `Came out of "${t.title}".`,
          team: (t.team as string) || "sales",
          workstream: (t.workstream as string) || "acquisition",
          taskType: (t.task_type as string) || "call",
          ownerId: str(f, "follow_up_owner") || (t.owner_id as string) || null,
          slaHours: 48,
        });
        follow = " The follow-up was created.";
      } catch (e) { follow = ` The follow-up was not created: ${(e as Error).message}`; }
    }
    revalidatePath("/", "layout");
    back(t?.school_id ? `/schools/${t.school_id}` : "/work", `Resolved.${follow}`);
  });
}

export async function setWorkStatus(f: FormData) {
  const id = str(f, "work_id");
  await act(`/work/${id}`, async () => {
    await work.setStatus(id, {
      status: str(f, "status") as never,
      waitingOn: str(f, "waiting_on") || null,
      followUpOn: str(f, "follow_up_on") || null,
      reason: str(f, "reason") || null,
    });
    revalidatePath("/", "layout");
    back(`/work/${id}`, `Marked ${str(f, "status").replace("_", " ")}.`);
  });
}

export async function assignWork(f: FormData) {
  const id = str(f, "work_id");
  await act(`/work/${id}`, async (me) => {
    staffOnly(me);
    await work.assign(id, str(f, "owner_id") || null, str(f, "reason") || undefined);
    revalidatePath("/", "layout");
    back(`/work/${id}`, "Reassigned. It now appears in their work.");
  });
}

// ==========================================================================
// PEOPLE
// ==========================================================================
export async function addPerson(f: FormData) {
  const schoolId = str(f, "school_id");
  const accountId = str(f, "account_id");
  const backTo = schoolId ? `/schools/${schoolId}/people/new` : `/accounts/${accountId}`;
  await act(backTo, async (me) => {
    staffOnly(me);
    const name = str(f, "name");
    // Duplicate detection: flag, never merge. If the rep has not been shown the
    // lookalikes yet, show them and make them choose.
    if (str(f, "confirmed") !== "yes") {
      const matches = await people.possibleDuplicates(name, {
        accountId, phone: str(f, "phone"), email: str(f, "email") });
      if (matches.length) {
        const q = new URLSearchParams({
          name, school_id: schoolId, account_id: accountId,
          school_role: str(f, "school_role"), custom_role: str(f, "custom_role"),
          phone: str(f, "phone"), email: str(f, "email"),
          whatsapp: str(f, "whatsapp"), discovered_how: str(f, "discovered_how"),
          notes: str(f, "notes"),
          relationships: list(f, "relationships").join(","),
        });
        redirect(`/people/resolve?${q}`);
      }
    }
    const { personId } = await people.add({
      accountId, schoolId: schoolId || null, name,
      schoolRole: str(f, "school_role") || null,
      customRole: str(f, "custom_role") || null,
      relationshipTypes: list(f, "relationships"),
      phone: str(f, "phone"), whatsapp: str(f, "whatsapp"), email: str(f, "email"),
      relationshipStatus: str(f, "relationship_status") || "unknown",
      discoveredHow: str(f, "discovered_how") || null,
      introducedBy: str(f, "introduced_by") || null,
      notes: str(f, "notes") || null,
    });
    revalidatePath("/", "layout");
    back(`/people/${personId}`, `${name} added. What would you like to do with them?`);
  });
}

export async function linkPerson(f: FormData) {
  const personId = str(f, "person_id");
  await act(`/people/${personId}`, async (me) => {
    staffOnly(me);
    await people.linkToSchool({
      personId, schoolId: str(f, "school_id"),
      schoolRole: str(f, "school_role") || null,
      customRole: str(f, "custom_role") || null,
      relationshipTypes: list(f, "relationships"),
      notes: str(f, "notes") || null,
    });
    revalidatePath("/", "layout");
    back(`/people/${personId}`, "School added to this person. Nothing was duplicated.");
  });
}

export async function endAssociation(f: FormData) {
  const personId = str(f, "person_id");
  await act(`/people/${personId}`, async (me) => {
    staffOnly(me);
    await people.endAssociation(str(f, "association_id"), str(f, "reason") || null);
    revalidatePath("/", "layout");
    back(`/people/${personId}`,
         "Ended. The history stays — they simply stop appearing as current there.");
  });
}

export async function updatePerson(f: FormData) {
  const id = str(f, "person_id");
  await act(`/people/${id}`, async (me) => {
    staffOnly(me);
    await people.update(id, {
      name: str(f, "name") || undefined,
      phone: str(f, "phone") || null, whatsapp: str(f, "whatsapp") || null,
      email: str(f, "email") || null, linkedin: str(f, "linkedin") || null,
      preferred_channel: str(f, "preferred_channel") || null,
      relationship_status: str(f, "relationship_status") || "unknown",
      notes: str(f, "notes") || null,
      do_not_contact: f.get("do_not_contact") === "yes",
    });
    revalidatePath("/", "layout");
    back(`/people/${id}`, "Saved.");
  });
}

export async function mergePeople(f: FormData) {
  const keep = str(f, "keep_id");
  await act(`/people/merge?keep=${keep}&drop=${str(f, "drop_id")}`, async (me) => {
    founderOnly(me);
    const res = await people.merge(str(f, "drop_id"), keep, str(f, "reason"));
    revalidatePath("/", "layout");
    back(`/people/${keep}`,
         `Merged. ${res.movedActivities} activity record(s) and ${res.movedRoles} ` +
         "school association(s) moved across. Nothing was deleted.");
  });
}

// ==========================================================================
// PODCAST — a workstream, not a funnel. It never opens an opportunity by itself.
// ==========================================================================
/**
 * BEYOND THE CLASSROOM — one way the show moves, used by every button.
 *
 * It creates the work that status requires and it does NOT move the school. The
 * relationship moves when a signal is recorded and somebody acts on it.
 */
export async function setPodcastStatus(f: FormData) {
  const schoolId = str(f, "school_id");
  const to = str(f, "status");
  const res = await act(`/schools/${schoolId}/show`, async (me) => {
    staffOnly(me);
    return show.move(schoolId, to, {
      note: str(f, "note") || null,
      overrideReason: str(f, "override_reason") || null,
      isFounder: me.role === "founder",
      episodeQuestion: str(f, "episode_question") || null,
      guestPersonId: str(f, "guest_person_id") || null,
      recordingDate: str(f, "recording_date") || null,
      recordingLocation: str(f, "recording_location") || null,
      episodeUrl: str(f, "episode_url") || null,
    });
  });
  revalidatePath("/", "layout");
  back(`/schools/${schoolId}/show`,
       `The show is now ${show.showStatusName(to)}. `
       + (res.created ? `${res.created} piece(s) of work created. ` : "")
       + "This has not moved the school — a recorded signal does that.");
}

/** Facts about the episode, without moving it along. */
export async function updateEpisode(f: FormData) {
  const schoolId = str(f, "school_id");
  await act(`/schools/${schoolId}/show`, async (me) => {
    staffOnly(me);
    const pod = await db.one(
      "select * from public.podcast_relationships where school_id = ?", [schoolId]);
    if (!pod) throw new Error("This school is not on the show yet.");
    const fields: db.Row = {};
    for (const [form, col] of [
      ["episode_question", "episode_question"], ["do_not_ask", "do_not_ask"],
      ["recording_date", "recording_date"], ["recording_location", "recording_location"],
      ["episode_url", "episode_url"], ["guest_person_id", "guest_person_id"],
    ] as const) {
      const v = str(f, form);
      if (v) fields[col] = v;
    }
    // The two checks only a person can make. Ticking one puts their name on it.
    for (const [box, col, by, at] of [
      ["invisibility_test_passed", "invisibility_test_passed",
       "invisibility_confirmed_by", "invisibility_confirmed_at"],
      ["no_deck_confirmed", "no_deck_confirmed",
       "no_deck_confirmed_by", "no_deck_confirmed_at"],
    ] as const) {
      const ticked = !!f.get(box);
      if (ticked !== !!pod[col]) {
        fields[col] = ticked;
        fields[by] = ticked ? me.id : null;
        fields[at] = ticked ? db.now() : null;
      }
    }
    if (str(f, "cut_requests")) fields.cut_requests = Number(str(f, "cut_requests"));
    if (str(f, "cut_requests_refused")) {
      fields.cut_requests_refused = Number(str(f, "cut_requests_refused"));
    }
    if (Object.keys(fields).length === 0) throw new Error("Nothing was changed.");
    await db.update("podcast_relationships", pod.id as string, fields);
    await audit.record({
      action: "PODCAST_STATUS_CHANGED", objectType: "podcast",
      objectId: pod.id as string, accountId: pod.account_id as string, schoolId,
      before: Object.fromEntries(Object.keys(fields).map((k) => [k, pod[k]])),
      after: fields, reason: str(f, "reason") || "Episode details corrected.",
    });
  });
  revalidatePath(`/schools/${schoolId}/show`);
  back(`/schools/${schoolId}/show`, "Saved.");
}

/** The six paths. E and F are gated on the seven-point handoff check. */
export async function setShowPath(f: FormData) {
  const schoolId = str(f, "school_id");
  await act(`/schools/${schoolId}/show`, async (me) => {
    staffOnly(me);
    await show.setPath(schoolId, str(f, "path"), str(f, "reason"));
  });
  revalidatePath(`/schools/${schoolId}/show`);
  back(`/schools/${schoolId}/show`, "Path recorded.");
}

export async function recordSignal(f: FormData) {
  const schoolId = str(f, "school_id");
  await act(`/schools/${schoolId}`, async (me) => {
    staffOnly(me);
    const quote = str(f, "verbatim_quote");
    const speaker = str(f, "speaker");
    if (!quote) throw new Error("A signal needs their exact words, not a summary.");
    if (!speaker) throw new Error("A signal needs a named speaker.");
    const school = await db.get("schools", schoolId);
    if (!school) throw new Error("That school no longer exists.");
    const pod = await db.one(
      "select id from public.podcast_relationships where school_id = ?", [schoolId]);
    const type = str(f, "signal_type") || "named_a_problem";
    if (!show.SIGNAL_TYPES.some((t) => t.key === type)) {
      throw new Error("That is not one of the nine things a signal can be.");
    }
    await db.transaction(async () => {
      const id = await db.insert("podcast_signals", {
        podcast_id: pod?.id ?? null, account_id: school.account_id, school_id: schoolId,
        signal_type: type,
        verbatim_quote: quote, speaker, speaker_role: str(f, "speaker_role") || null,
        timecode: str(f, "timecode") || null, logged_by: me.id,
      });
      await audit.record({
        action: "SIGNAL_RECORDED", objectType: "signal", objectId: id,
        accountId: school.account_id as string, schoolId,
        after: { quote, speaker },
      });
      await activity.log({
        accountId: school.account_id as string, schoolId,
        podcastId: (pod?.id as string) ?? null,
        type: "signal", direction: "inbound",
        outcomeKey: type, outcomeLabel: "They said something",
        summary: `${speaker}: "${quote}"`,
      });
    });
    revalidatePath("/", "layout");
    back(str(f, "return_to") || `/schools/${schoolId}`,
         "Signal recorded. Discovery is now open to this school if you judge it real.");
  });
}

// ==========================================================================
// MY ACCOUNT — self-service. Never authority.
// ==========================================================================
export async function updateProfile(f: FormData) {
  await act("/account", async (me) => {
    const before = { full_name: me.full_name, display_name: me.display_name,
                     phone: me.phone, designation: me.designation };
    const after = {
      full_name: str(f, "full_name") || me.full_name,
      display_name: str(f, "display_name") || null,
      phone: str(f, "phone") || null,
      avatar_url: str(f, "avatar_url") || null,
      designation: str(f, "designation") || null,
      bio: str(f, "bio") || null,
      timezone: str(f, "timezone") || me.timezone,
    };
    // Role, team and scope are deliberately absent. They are not self-service, and
    // the database would refuse them even if this form tried.
    await db.update("profiles", me.id, after);
    await audit.record({
      action: "USER_PROFILE_UPDATED", objectType: "user", objectId: me.id,
      before, after,
    });
    revalidatePath("/", "layout");
    back("/account", "Saved.");
  });
}

export async function requestEmailChange(f: FormData) {
  const me = await auth.currentIdentity();
  if (!me) redirect("/login");
  const next = str(f, "email");
  const res = await auth.changeEmail(next);
  if (!res.ok) back("/account", undefined, res.error);
  await db.withUser(me.id, () => audit.record({
    action: res.pending ? "USER_EMAIL_CHANGE_REQUESTED" : "USER_EMAIL_CHANGED",
    objectType: "user", objectId: me.id,
    before: { email: me.email }, after: { email: next },
  }));
  revalidatePath("/", "layout");
  back("/account", res.pending
    ? `A confirmation was sent to ${next}. Your sign-in address is still ` +
      `${me.email} until you confirm it.`
    : `Your address is now ${next}.`);
}

export async function changePasswordAction(f: FormData) {
  const me = await auth.currentIdentity();
  if (!me) redirect("/login");
  const res = await auth.changePassword(
    String(f.get("current") ?? ""), String(f.get("next") ?? ""));
  if (!res.ok) back("/account", undefined, res.error);
  await db.withUser(me.id, () => audit.record({
    action: "USER_PASSWORD_CHANGED", objectType: "user", objectId: me.id,
  }));
  back("/account", "Password changed.");
}

// ==========================================================================
// ADMIN — authority. Founder only, and every change is recorded.
// ==========================================================================
export async function setUserRole(f: FormData) {
  const target = str(f, "user_id");
  await act("/admin", async (me) => {
    founderOnly(me);
    if (target === me.id) {
      throw new Error("You cannot change your own authority. Ask the other founder.");
    }
    const before = await db.asService("read role before change", async () =>
      db.one("select role::text, team::text, status from public.user_roles where user_id = ?",
             [target]));
    const role = str(f, "role");
    const team = str(f, "team") || null;
    const status = str(f, "status") || "active";
    if (role === "founder" ? false : before?.role === "founder") {
      const founders = await db.asService("count founders", async () =>
        db.one("select count(*) n from public.user_roles where role='founder' and status='active'"));
      if (Number(founders?.n ?? 0) <= 1) {
        throw new Error("That is the only active founder. Promote somebody else first.");
      }
    }
    // Writing authority needs the service role: no policy lets a user write user_roles.
    await db.asService("administrator changing a role", async () => {
      await db.run(
        `update public.user_roles set role = ?::mintrix_role, team = ?::mintrix_team,
                status = ?, granted_by = ?, updated_at = now() where user_id = ?`,
        [role, team, status, me.id, target]);
    });
    await audit.record({
      action: "USER_ROLE_CHANGED", objectType: "user", objectId: target,
      before, after: { role, team, status }, reason: str(f, "reason") || null,
    });
    revalidatePath("/", "layout");
    back("/admin", "Access updated.");
  });
}

export async function grantScope(f: FormData) {
  const target = str(f, "user_id");
  await act("/admin", async (me) => {
    founderOnly(me);
    const scopeType = str(f, "scope_type");
    const scopeId = str(f, "scope_id");
    if (!scopeId) throw new Error("Choose what they should be able to see.");
    await db.asService("administrator granting scope", async () => {
      await db.run(
        `insert into public.access_grants (user_id, scope_type, scope_id, can_edit,
                                           expires_at, granted_by)
         values (?, ?, ?, ?, ?, ?)
         on conflict (user_id, scope_type, scope_id) do update
           set can_edit = excluded.can_edit, expires_at = excluded.expires_at`,
        [target, scopeType, scopeId, f.get("can_edit") === "yes",
         str(f, "expires_at") || null, me.id]);
    });
    await audit.record({
      action: "USER_SCOPE_GRANTED", objectType: "user", objectId: target,
      after: { scope_type: scopeType, scope_id: scopeId },
      reason: str(f, "reason") || null,
    });
    revalidatePath("/", "layout");
    back("/admin", "Access granted. They can see that and nothing wider.");
  });
}

export async function revokeScope(f: FormData) {
  const target = str(f, "user_id");
  await act("/admin", async (me) => {
    founderOnly(me);
    const grantId = str(f, "grant_id");
    const before = await db.asService("read grant", async () =>
      db.one("select * from public.access_grants where id = ?", [grantId]));
    await db.asService("administrator revoking scope", async () => {
      await db.run("delete from public.access_grants where id = ?", [grantId]);
    });
    await audit.record({
      action: "USER_SCOPE_REVOKED", objectType: "user", objectId: target,
      before, after: null,
    });
    revalidatePath("/", "layout");
    back("/admin", "Access revoked.");
  });
}

// ==========================================================================
// THE COMMERCIAL WORKSTREAM
//
// Opening a deal is a decision somebody makes and signs their name to. Nothing in
// this file opens one as a side effect of anything else.
// ==========================================================================
export async function openOpportunity(f: FormData) {
  const schoolId = str(f, "school_id");
  const res = await act(`/schools/${schoolId}`, async (me) => {
    staffOnly(me);
    return commercial.open({
      schoolId,
      route: str(f, "route"),
      reason: str(f, "reason"),
      feeQuoted: str(f, "fee") ? Number(str(f, "fee")) : null,
      expectedDecision: str(f, "expected_decision") || null,
      primaryPersonId: str(f, "primary_person_id") || null,
      fromSignalId: str(f, "signal_id") || null,
    });
  });
  revalidatePath(`/schools/${schoolId}`);
  back(`/opportunities/${res.id}`, "Opportunity opened.");
}

export async function addStakeholder(f: FormData) {
  const id = str(f, "opportunity_id");
  await act(`/opportunities/${id}`, async (me) => {
    staffOnly(me);
    await commercial.addStakeholder({
      opportunityId: id,
      personId: str(f, "person_id"),
      capacity: str(f, "capacity"),
      note: str(f, "note") || null,
    });
  });
  revalidatePath(`/opportunities/${id}`);
  back(`/opportunities/${id}`, "Stakeholder recorded.");
}

export async function closeOpportunity(f: FormData) {
  const id = str(f, "opportunity_id");
  const state = str(f, "state") as "won" | "parked";
  await act(`/opportunities/${id}`, async (me) => {
    staffOnly(me);
    await commercial.close(id, state, str(f, "reason"));
  });
  revalidatePath(`/opportunities/${id}`);
  back(`/opportunities/${id}`,
       state === "won"
         ? "Opportunity won. Move the school to Contract when the paperwork is real."
         : "Opportunity parked. The school stays where it is on the ladder — "
           + "move it to nurture or lost yourself if that is what you mean.");
}
