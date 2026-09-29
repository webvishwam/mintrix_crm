import Link from "next/link";
import * as db from "@/server/db";
import { board } from "@/domain/schools";
import { LADDER, HOLDING, stageName, stageColour } from "@/domain/journey";
import Shell from "@/ui/Shell";
import Board from "@/ui/Board";
import { Card, Empty, Flash, Notice, Pill, Top, digits } from "@/ui/primitives";
import { page, flash, first, isStaff, type SP } from "@/ui/page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const FILTERS: [string, string][] = [
  ["mine", "My schools"], ["all", "All schools"], ["overdue", "Overdue"],
  ["no_next_action", "No next action"], ["waiting", "Waiting"], ["stale", "Stale"],
];
const SORTS: [string, string][] = [
  ["sla", "SLA"], ["updated", "Recently moved"], ["owner", "Owner"], ["name", "Name"],
];

/**
 * THE pipeline. One board, one journey.
 *
 * There is no Trust Engine board and no Delivery board, because those were never
 * separate funnels — the show is a workstream and implementation is a post-sale
 * lifecycle. Both appear on the school, alongside the stage, not instead of it.
 */
export default async function Pipeline({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;

  const { me, data } = await page(async (u) => {
    if (u.role === "external") redirect("/work");
    const only = (FILTERS.some(([k]) => k === first(sp.only)) ? first(sp.only)
      : (u.role === "founder" || u.role === "ba" ? "all" : "mine")) as never;
    const sort = (SORTS.some(([k]) => k === first(sp.sort)) ? first(sp.sort)
      : "sla") as never;
    const accountId = first(sp.account) || null;
    const cards = await board({
      only, sort, ownerId: first(sp.owner) || null, accountId,
      city: first(sp.city) || null, viewerId: u.id,
    });
    const owners = await db.many(
      `select p.id, p.full_name from public.profiles p
         join public.user_roles r on r.user_id = p.id
        where r.status = 'active' and r.role <> 'external' order by p.full_name`);
    const account = accountId ? await db.get("accounts", accountId) : null;
    return { cards, owners, only, sort, accountId, account };
  });

  const { cards, owners, only, sort, accountId, account } = data;
  const held = cards.filter((c) => HOLDING.some((h) => h.key === c.stageKey));
  const live = cards.filter((c) => !held.includes(c));

  const phones: Record<string, string> = {};
  for (const c of cards) {
    if (c.poc?.phone) {
      const d = digits(c.poc.phone);
      if (d) phones[c.poc.id] = d;
    }
  }
  const q = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ only: only ?? "all", sort: sort ?? "sla",
      ...(accountId ? { account: accountId } : {}), ...patch });
    return `/pipeline?${p}`;
  };

  return (
    <Shell me={me} path="/pipeline">
      <Flash msg={msg} err={err} />
      <Top
        title={account ? `School pipeline — ${account.name as string}` : "School pipeline"}
        sub="One journey. The show, production, the deal and delivery run alongside it as workstreams — they are not separate funnels."
        right={account
          ? <Link className="btn grey" href="/pipeline">Show every school</Link> : undefined}
      />

      <div className="tabs">
        {FILTERS.map(([k, label]) => (
          <Link key={k} className={only === k ? "on" : ""} href={q({ only: k })}>{label}</Link>
        ))}
      </div>
      <div className="tabs">
        <span className="s" style={{ alignSelf: "center", marginRight: 4 }}>Sort</span>
        {SORTS.map(([k, label]) => (
          <Link key={k} className={sort === k ? "on" : ""} href={q({ sort: k })}>{label}</Link>
        ))}
        {isStaff(me) && owners.map((o) => (
          <Link key={o.id as string} href={q({ only: "all", owner: o.id as string })}>
            {o.full_name as string}
          </Link>
        ))}
      </div>

      {cards.length === 0 ? (
        <Card title="Nothing on this board">
          <Empty what={only === "mine"
            ? "No school is assigned to you yet."
            : "No school matches that filter."}
            action={<Link className="btn" href="/pipeline?only=all">Show every school</Link>} />
        </Card>
      ) : (
        <>
          <Board
            columns={LADDER.map((s) => ({ key: s.key, name: s.name, num: s.num }))}
            cards={live} digits={phones} />

          {held.length > 0 && (
            <Card title="Holding and closed"
                  extra={<Pill colour="slate">{held.length}</Pill>}>
              <div className="rows">
                {held.map((c) => (
                  <div className="row" key={c.id}>
                    <div className="grow">
                      <div className="t"><Link href={`/schools/${c.id}`}>{c.name}</Link></div>
                      <div className="s">{c.accountName} · {c.location}</div>
                    </div>
                    <div className="rt">
                      <Pill colour={stageColour(c.stageKey)}>{c.stage}</Pill>
                    </div>
                  </div>
                ))}
              </div>
              <p className="help" style={{ marginTop: 8 }}>
                Nurture, disqualified and lost are decisions about a relationship, not
                failures of the board. Any of them can be picked back up.
              </p>
            </Card>
          )}

          <Notice kind="info">
            A card can only be dropped on the stage that follows its own — skipping
            stages would mean the gates in between were never evaluated.
          </Notice>
        </>
      )}
    </Shell>
  );
}
