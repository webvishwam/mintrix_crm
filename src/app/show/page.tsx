import Link from "next/link";
import * as show from "@/domain/show";
import { stageName, stageColour } from "@/domain/journey";
import Shell from "@/ui/Shell";
import { Card, Empty, Flash, Notice, Pill, Top, dateOnly } from "@/ui/primitives";
import { page, flash, first, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", name: "Everything" },
  { key: "mine", name: "Mine" },
  { key: "overdue", name: "Overdue" },
  { key: "no_signals", name: "Published, nothing recorded" },
  { key: "no_path", name: "Published, no path" },
];

const phaseColour = (p: string) =>
  p === "Planning" ? "slate" : p === "Production" ? "amber"
  : p === "Execution" ? "green" : "plum";

/**
 * THE SHOW, ALL OF IT.
 *
 * Grouped by where each episode is, with the school's own stage printed next to it
 * so the two are visibly different things. This is a workstream board. It is not a
 * funnel and nothing on it can be dragged into one.
 */
export default async function ShowBoard({ searchParams }: { searchParams: SP }) {
  const { msg, err } = await flash(searchParams);
  const sp = await searchParams;
  const only = first(sp.only);

  const { me, data } = await page(async (u) => ({
    cards: await show.board({ only, viewerId: u.id }),
    mix: await show.pathMix(),
  }));
  const { cards, mix } = data;

  const groups = show.SHOW_STATUSES.map((s) => ({
    def: s, cards: cards.filter((c) => c.status === s.key),
  })).filter((g) => g.cards.length > 0);

  const overdue = cards.reduce((n, c) => n + c.overdue, 0);

  return (
    <Shell me={me} path="/show">
      <Flash msg={msg} err={err} />
      <Top title="Beyond the Classroom"
           sub="A workstream that runs alongside the school journey — never instead of it." />

      <Notice kind="info" title="This is not a second pipeline">
        Every school here is also somewhere on the one ladder, printed beside it.
        Moving an episode along changes nothing about the relationship; a recorded
        signal does.
      </Notice>

      <div className="searchrow">
        {FILTERS.map((f) => (
          <Link key={f.key} className={`btn ${only === f.key ? "" : "ghost"}`}
                href={f.key ? `/show?only=${f.key}` : "/show"}>{f.name}</Link>))}
      </div>

      <div className="states">
        <div className="st"><div className="k">Episodes</div>
          <div className="v">{cards.length}</div></div>
        <div className="st"><div className="k">Overdue work</div>
          <div className="v">{overdue
            ? <Pill colour="red">{overdue}</Pill> : <Pill colour="green">none</Pill>}</div></div>
        <div className="st"><div className="k">Published</div>
          <div className="v">{cards.filter((c) => c.status === "published").length}</div></div>
        <div className="st"><div className="k">Signals recorded</div>
          <div className="v">{cards.reduce((n, c) => n + c.signals, 0)}</div></div>
      </div>

      {mix.drifting && (
        <Notice kind="warn" title="The show is drifting towards being a sales instrument">
          More than a fifth of episodes are landing on Path E or F. The healthy shape
          is a wide base of A and B. Either the paths are being chosen hopefully, or
          the show has started selling.
        </Notice>
      )}

      {cards.length === 0 ? (
        <Card title="Nothing on the show yet">
          <Empty what="No school has been put on Beyond the Classroom."
                 action={<Link className="btn" href="/pipeline">Open the pipeline</Link>} />
        </Card>
      ) : groups.map((g) => (
        <Card key={g.def.key}
              title={`${g.def.name} — ${g.cards.length}`}
              extra={<Pill colour={phaseColour(g.def.phase)}>{g.def.phase}</Pill>}>
          <p className="lede">{g.def.meaning}</p>
          <table className="tbl">
            <thead>
              <tr>
                <th>School</th><th>Guest</th><th>On the ladder</th>
                <th>Work</th><th>Signals</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {g.cards.map((c) => (
                <tr key={c.podcastId}>
                  <td>
                    <Link href={`/schools/${c.schoolId}/show`}>{c.school}</Link>
                    <div className="muted sm">{c.account}</div>
                    {c.question && (
                      <div className="muted sm">&ldquo;{c.question}&rdquo;</div>)}
                  </td>
                  <td className="sm">{c.guest ?? <span className="muted">not named</span>}
                    <div className="muted sm">{c.owner ?? "unassigned"}</div></td>
                  <td>
                    <Link href={`/schools/${c.schoolId}`}>
                      <Pill colour={stageColour(c.journeyStage)}>
                        {stageName(c.journeyStage)}
                      </Pill>
                    </Link>
                  </td>
                  <td>
                    {c.overdue > 0 && <Pill colour="red">{c.overdue} overdue</Pill>}
                    {c.overdue === 0 && c.blocking > 0 &&
                      <Pill colour="amber">{c.blocking} blocking</Pill>}
                    {c.overdue === 0 && c.blocking === 0 && c.open > 0 &&
                      <Pill colour="slate">{c.open} alongside</Pill>}
                    {c.open === 0 && <span className="muted sm">clear</span>}
                  </td>
                  <td>{c.signals > 0
                    ? <Pill colour="plum">{c.signals}</Pill>
                    : <span className="muted sm">none</span>}
                    {c.path && <div className="muted sm">Path {c.path}</div>}</td>
                  <td className="muted sm">
                    {c.publishedOn ? `published ${dateOnly(c.publishedOn)}`
                     : c.recordingDate ? `recording ${dateOnly(c.recordingDate)}`
                     : dateOnly(c.since)}
                  </td>
                </tr>))}
            </tbody>
          </table>
        </Card>
      ))}

      {mix.total > 0 && (
        <Card title="Where episodes are landing"
              extra={<Pill colour={mix.drifting ? "red" : "green"}>
                {mix.total} decided</Pill>}>
          <p className="lede">
            The distribution matters as much as the paths. A wide base of A and B is
            the healthy shape.
          </p>
          <table className="tbl">
            <tbody>
              {mix.rows.map((r) => (
                <tr key={r.key}>
                  <td><b>{r.key}</b> — {r.name}</td>
                  <td className="muted sm">{r.when}</td>
                  <td>{r.actual} ({r.pct}%)</td>
                  <td className="muted sm">expected ~{r.share}%</td>
                </tr>))}
            </tbody>
          </table>
        </Card>
      )}
    </Shell>
  );
}
