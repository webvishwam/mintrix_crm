import Link from "next/link";
import * as db from "@/server/db";
import * as audit from "@/domain/audit";
import { teamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Flash, KV, Notice, Pill, Top, shortDate } from "@/ui/primitives";
import { updateProfile, requestEmailChange, changePasswordAction } from "@/app/actions";
import { page, flash, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York",
                   "Asia/Singapore", "UTC"];

/**
 * MY ACCOUNT.
 *
 * The user controls their own identity and nothing about their authority. That split
 * is enforced in the database, not in this form: there is no policy that lets anybody
 * write their own role, team or scope, so a crafted request fails at Postgres.
 */
export default async function MyAccount({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const { me, data } = await page(async (u) => ({
    grants: await db.many(
      `select * from public.access_grants where user_id = ? order by created_at`, [u.id]),
    recent: await audit.search({ objectType: "user", objectId: u.id, limit: 12 }),
    legacy: await db.one(
      "select legacy_id, legacy_email, note from public.legacy_user_map where user_id = ?",
      [u.id]),
    owns: Number((await db.one(
      "select count(*) c from public.schools where owner_id = ?", [u.id]))!.c),
    workCount: Number((await db.one(
      `select count(*) c from public.work_items where owner_id = ?
         and status in ('open','in_progress','waiting','blocked')`, [u.id]))!.c),
  }));

  return (
    <Shell me={me} path="/account">
      <Flash msg={msg} err={err} />
      <Top title="My account"
           sub="What you can change about yourself, and what only an administrator can." />

      {me.pending_email && (
        <Notice kind="warn" title="An email change is waiting for confirmation.">
          You asked to change to <b>{me.pending_email}</b>. Until you click the link in
          that message your sign-in address is still <b>{me.email}</b>.
        </Notice>
      )}

      {data.legacy?.note && (
        <Notice kind="info" title="This account was corrected during the migration.">
          It used to be <b>{data.legacy.legacy_email as string}</b>. The user id did not
          change, so everything you owned before is still yours —{" "}
          {data.owns} school{data.owns === 1 ? "" : "s"} and {data.workCount} open
          work item{data.workCount === 1 ? "" : "s"} still point at you.
        </Notice>
      )}

      <div className="grid g-main">
        <div>
          <Card title="Who you are">
            <form action={updateProfile} className="form tight">
              <label>Full name
                <input name="full_name" defaultValue={me.full_name} required /></label>
              <label>What people call you
                <input name="display_name" defaultValue={me.display_name ?? ""}
                       placeholder="Shrey" /></label>
              <label>Phone
                <input name="phone" defaultValue={me.phone ?? ""} /></label>
              <label>Designation
                <input name="designation" defaultValue={me.designation ?? ""}
                       placeholder="Founding Account Executive" /></label>
              <label>Avatar URL
                <input name="avatar_url" defaultValue={me.avatar_url ?? ""} /></label>
              <label>Timezone
                <select name="timezone" defaultValue={me.timezone}>
                  {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div className="btns"><button className="btn" type="submit">Save</button></div>
            </form>
          </Card>

          <Card title="Email address">
            <KV rows={[
              ["Signing in as", me.email],
              ...(me.pending_email
                ? [["Waiting for confirmation", me.pending_email]] as
                    [string, React.ReactNode][] : []),
            ]} />
            <form action={requestEmailChange} className="form tight">
              <label>Change it to
                <input name="email" type="email" required
                       placeholder="you@mintrix.ai" /></label>
              <div className="btns">
                <button className="btn grey" type="submit">Request the change</button>
              </div>
              <p className="help">
                The change goes through the authentication provider, not by editing a
                row. Depending on how the project is configured you may need to confirm
                it by email — until then this page will keep showing the old address as
                the one that signs you in.
              </p>
            </form>
          </Card>

          <Card title="Password">
            <form action={changePasswordAction} className="form tight">
              <label>Current password
                <input name="current" type="password" required
                       autoComplete="current-password" /></label>
              <label>New password
                <input name="next" type="password" required minLength={12}
                       autoComplete="new-password" /></label>
              <div className="btns">
                <button className="btn grey" type="submit">Change password</button>
              </div>
              <p className="help">
                At least 12 characters. Your current password is checked first, so a
                borrowed session is not enough to take the account.
              </p>
            </form>
          </Card>
        </div>

        <div>
          <Card title="What you are allowed to do">
            <KV rows={[
              ["Role", <Pill key="r" colour={me.role === "founder" ? "plum" : "slate"}>
                {me.role}</Pill>],
              ["Team", teamName(me.team)],
              ["Status", me.status],
              ...(me.hats.length
                ? [["Hats", me.hats.join(", ")]] as [string, React.ReactNode][] : []),
            ]} />
            <Notice kind="info">
              Role, team and access are set by an administrator. They are deliberately
              not on this page — and the database would refuse them even if they were.
            </Notice>
          </Card>

          {data.grants.length > 0 && (
            <Card title="What you can see">
              <div className="rows">
                {data.grants.map((g) => (
                  <div className="row" key={g.id as string}>
                    <div className="grow">
                      <div className="t">{g.scope_type as string}: {g.scope_id as string}</div>
                      <div className="s">
                        {g.can_edit ? "can edit" : "read only"}
                        {g.expires_at ? ` · until ${shortDate(g.expires_at as string)}` : ""}
                      </div>
                    </div>
                  </div>))}
              </div>
            </Card>
          )}

          <Card title="Recent changes to this account">
            {data.recent.length === 0
              ? <p className="s" style={{ margin: 0 }}>Nothing yet.</p>
              : (
                <ul className="tl">
                  {data.recent.map((a) => (
                    <li key={String(a.id)}>
                      <span className="d">{shortDate(a.occurred_at as string)}</span>
                      <div className="grow">
                        <div>{String(a.action).replace(/_/g, " ").toLowerCase()}</div>
                        <div className="s muted">{a.actor_name as string}</div>
                      </div>
                    </li>))}
                </ul>
              )}
            <p className="help" style={{ marginTop: 8 }}>
              Passwords are never recorded here — only that one was changed.
            </p>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
