import Link from "next/link";
import { redirect } from "next/navigation";
import * as db from "@/server/db";
import { TEAMS, teamName } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Flash, Notice, Pill, Top, shortDate } from "@/ui/primitives";
import { setUserRole, grantScope, revokeScope } from "@/app/actions";
import { page, flash, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

const ROLES = [
  ["founder", "Founder", "Everything, including overrides and the audit log."],
  ["ae", "Account Executive", "Owns the relationship and the sale."],
  ["ba", "Business Administrator", "Sees all work."],
  ["ra", "Research Analyst", "Research and qualification."],
  ["designer", "Designer", "Assets and publication."],
  ["eng", "Engineer", "Implementation and delivery."],
  ["csm", "Customer Success", "After go-live."],
  ["external", "External collaborator", "ONLY what they are explicitly granted."],
] as const;

/** Team and access. Authority is granted here and nowhere else. */
export default async function Admin({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const { me, data } = await page(async (u) => {
    if (u.role !== "founder") redirect("/?err=" +
      encodeURIComponent("Team and access are the founder's."));
    return {
      users: await db.asService("administrator listing the team", async () =>
        db.many(
          `select p.id, p.full_name, p.email, p.designation,
                  r.role::text as role, r.team::text as team, r.status, r.hats,
                  m.legacy_id, m.legacy_email,
                  (select count(*) from public.schools s where s.owner_id = p.id) as schools,
                  (select count(*) from public.work_items w where w.owner_id = p.id
                     and w.status in ('open','in_progress','waiting','blocked')) as work
             from public.profiles p
             left join public.user_roles r on r.user_id = p.id
             left join public.legacy_user_map m on m.user_id = p.id
            order by r.role, p.full_name`)),
      grants: await db.asService("administrator listing grants", async () =>
        db.many(
          `select g.*, p.full_name, s.name as school_name, a.name as account_name
             from public.access_grants g
             join public.profiles p on p.id = g.user_id
             left join public.schools s on s.id = g.scope_id
             left join public.accounts a on a.id = g.scope_id
            order by p.full_name`)),
      schools: await db.many(
        "select id, name from public.schools order by name limit 400"),
    };
  });

  return (
    <Shell me={me} path="/admin">
      <Flash msg={msg} err={err} />
      <Top title="Team and access"
           sub="Who is in the system, what they may do, and which records they may see." />

      <Notice kind="info" title="Least privilege.">
        An account starts with no authority at all. Role says what a person may do;
        a grant says which records they may do it to. Both are enforced by the
        database, so hiding a link in the interface is never the security boundary.
      </Notice>

      <Card title={`People (${data.users.length})`}>
        <div className="rows">
          {data.users.map((u) => (
            <div className="row" key={u.id as string}>
              <div className="grow">
                <div className="t">
                  {u.full_name as string}{" "}
                  <Pill colour={u.role === "founder" ? "plum"
                    : u.role === "external" ? "amber" : "slate"}>
                    {(u.role as string) ?? "none"}
                  </Pill>
                  {u.status !== "active" && <> <Pill colour="red">{u.status as string}</Pill></>}
                </div>
                <div className="s">
                  {u.email as string} · {teamName(u.team as string)}
                  {u.legacy_email && u.legacy_email !== u.email
                    ? ` · was ${u.legacy_email as string}` : ""}
                </div>
                <div className="s">
                  Owns {u.schools as number} school(s) · {u.work as number} open item(s)
                </div>
                <details>
                  <summary className="lk">Change access</summary>
                  <form action={setUserRole} className="form tight">
                    <input type="hidden" name="user_id" value={u.id as string} />
                    <label>Role
                      <select name="role" defaultValue={(u.role as string) ?? "external"}>
                        {ROLES.map(([k, name, what]) => (
                          <option key={k} value={k}>{name} — {what}</option>))}
                      </select>
                    </label>
                    <label>Team
                      <select name="team" defaultValue={(u.team as string) ?? ""}>
                        <option value="">none</option>
                        {TEAMS.map((t) => (
                          <option key={t.key} value={t.key}>{t.name}</option>))}
                      </select>
                    </label>
                    <label>Status
                      <select name="status" defaultValue={(u.status as string) ?? "active"}>
                        <option value="active">Active</option>
                        <option value="invited">Invited</option>
                        <option value="disabled">Disabled — keeps their history</option>
                      </select>
                    </label>
                    <label>Why<input name="reason" placeholder="Joined the production team" /></label>
                    <div className="btns">
                      <button className="btn grey" type="submit">Save access</button>
                    </div>
                    <p className="help">
                      Disabling keeps every record they own and every audit row they
                      generated. Nothing is reassigned automatically.
                    </p>
                  </form>
                </details>
              </div>
            </div>))}
        </div>
      </Card>

      <Card title="Record-level access"
            extra={<Pill colour="slate">{data.grants.length}</Pill>}>
        <p style={{ marginTop: 0 }}>
          An external collaborator sees the schools granted here and nothing else. Not
          hidden — absent from their query results.
        </p>
        {data.grants.length > 0 && (
          <div className="rows">
            {data.grants.map((g) => (
              <div className="row" key={g.id as string}>
                <div className="grow">
                  <div className="t">{g.full_name as string}</div>
                  <div className="s">
                    {g.scope_type as string}:{" "}
                    {(g.school_name as string) ?? (g.account_name as string)
                      ?? (g.scope_id as string)}
                    {g.can_edit ? " · can edit" : " · read only"}
                    {g.expires_at ? ` · until ${shortDate(g.expires_at as string)}` : ""}
                  </div>
                </div>
                <div className="rt">
                  <form action={revokeScope} className="inline">
                    <input type="hidden" name="grant_id" value={g.id as string} />
                    <input type="hidden" name="user_id" value={g.user_id as string} />
                    <button className="btn sm grey" type="submit">Revoke</button>
                  </form>
                </div>
              </div>))}
          </div>
        )}
        <details style={{ marginTop: 10 }}>
          <summary className="lk">Grant access to a school</summary>
          <form action={grantScope} className="form tight">
            <label>Person
              <select name="user_id" required>
                <option value="">— choose —</option>
                {data.users.map((u) => (
                  <option key={u.id as string} value={u.id as string}>
                    {u.full_name as string} ({(u.role as string) ?? "none"})
                  </option>))}
              </select>
            </label>
            <input type="hidden" name="scope_type" value="school" />
            <label>School
              <select name="scope_id" required>
                <option value="">— choose —</option>
                {data.schools.map((s) => (
                  <option key={s.id as string} value={s.id as string}>
                    {s.name as string}</option>))}
              </select>
            </label>
            <label className="cb">
              <input type="checkbox" name="can_edit" value="yes" />
              <span>They may update the work assigned to them</span>
            </label>
            <label>Access ends on (optional)
              <input type="date" name="expires_at" /></label>
            <label>Why<input name="reason" placeholder="Editing the Sunbeam episode" /></label>
            <div className="btns">
              <button className="btn" type="submit">Grant</button>
            </div>
            <p className="help">
              They will see that school, its people and its production work. Not
              pricing, not opportunities, not any other school.
            </p>
          </form>
        </details>
      </Card>

      <Card title="Adding somebody new">
        <p style={{ marginTop: 0 }}>
          Create the person in Supabase Authentication (Dashboard → Authentication →
          Add user). They appear here immediately with <b>no authority at all</b> —
          role <code>external</code>, status <code>invited</code> — and stay that way
          until you grant something above.
        </p>
        <p className="help">
          That default is deliberate: signing up must never confer access.
        </p>
      </Card>
    </Shell>
  );
}
