"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Card as SchoolCard } from "@/domain/schools";

/**
 * THE SCHOOL PIPELINE.
 *
 * One board. A card is a school — never an account, never a ticket — because four
 * campuses under one trust routinely sit in four different columns.
 *
 * A drop never writes. It opens the same gate the Move button opens and the bulk
 * action opens. One transition path, three ways in.
 */
const PER_COLUMN = 40;

export default function Board({ columns, cards, digits }: {
  columns: { key: string; name: string; num: number }[];
  cards: SchoolCard[];
  digits: Record<string, string>;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState<SchoolCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const state = (col: string): "" | "ok" | "warn" | "far" | "here" => {
    if (!dragging) return "";
    if (dragging.stageKey === col) return "here";
    if (dragging.nextStageKey !== col) return "far";
    return dragging.ready ? "ok" : "warn";
  };
  const hint = (col: string) => ({
    here: "Already here", far: "Not the next stage", ok: "Ready",
    warn: `${dragging?.missing} still to do`, "": "",
  }[state(col)]);

  const drop = (col: string) => {
    const c = dragging;
    setDragging(null); setOver(null);
    if (!c || c.stageKey === col || c.nextStageKey !== col) return;
    router.push(`/schools/${c.id}/advance?to=${col}`);
  };

  const chosen = cards.filter((c) => picked.has(c.id));
  const targets = new Set(chosen.map((c) => c.nextStageKey ?? ""));
  const bulkTarget = targets.size === 1 ? [...targets][0] : "";

  return (
    <>
      {picked.size > 0 && (
        <div className="bulkbar">
          <span><b>{picked.size}</b> selected</span>
          {bulkTarget ? (
            <form action="/schools/bulk" method="get">
              <input type="hidden" name="to" value={bulkTarget} />
              {chosen.map((c) => <input key={c.id} type="hidden" name="id" value={c.id} />)}
              <button className="btn sm" type="submit">
                Move to {chosen[0]?.nextStageName}
              </button>
            </form>
          ) : (
            <span className="s">
              They are not all at the same stage, so they cannot move together.
            </span>
          )}
          <button className="btn sm grey" type="button"
                  onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      <div className="kan">
        {columns.map((col) => {
          const all = cards.filter((c) => c.stageKey === col.key);
          const shown = all.slice(0, PER_COLUMN);
          const s = state(col.key);
          return (
            <div key={col.key}
                 className={`kan-col ${s}${over === col.key ? " over" : ""}`}
                 onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.key); } }}
                 onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
                 onDrop={(e) => { e.preventDefault(); drop(col.key); }}>
              <div className="kan-h">
                <span>{col.num}. {col.name}</span>
                <span className="n">{all.length}</span>
              </div>
              {dragging && s && <div className={`kan-hint ${s}`}>{hint(col.key)}</div>}

              {shown.map((c) => (
                <article key={c.id}
                         className={`kan-card${dragging?.id === c.id ? " dragging" : ""}`}
                         draggable
                         onDragStart={() => setDragging(c)}
                         onDragEnd={() => { setDragging(null); setOver(null); }}>
                  <div className="ktop">
                    <input type="checkbox" checked={picked.has(c.id)}
                           aria-label={`Select ${c.name}`}
                           onChange={() => setPicked((p) => {
                             const n = new Set(p);
                             n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                             return n;
                           })} />
                    <div className="kt">{c.name}</div>
                  </div>
                  <div className="ks">{c.accountName}</div>
                  {c.location && <div className="ks">{c.location}</div>}

                  <div className="kmeta">
                    <span className={`kp ${c.slaState}`}>{c.slaText}</span>
                    <span className="kp slate">{c.owner}</span>
                    {c.total > 0 && (
                      <span className={`kp ${c.done === c.total ? "ok" : ""}`}>
                        {c.done}/{c.total} done
                      </span>
                    )}
                    {c.overdue > 0 && <span className="kp red">{c.overdue} overdue</span>}
                    {c.stale && <span className="kp amber">stale {c.staleDays}d</span>}
                  </div>

                  {/* The other states, alongside — never competing with the stage. */}
                  {(c.podcast || c.commercial) && (
                    <div className="ks" style={{ marginTop: 5 }}>
                      {c.podcast && <>Show: {c.podcast}</>}
                      {c.podcast && c.commercial && " · "}
                      {c.commercial && <>Deal: {c.commercial}</>}
                    </div>
                  )}

                  <div className="ks" style={{ marginTop: 5 }}>
                    {c.poc ? `${c.poc.name}${c.poc.role ? ` — ${c.poc.role}` : ""}`
                           : "No point of contact yet"}
                  </div>

                  <div className="knext">
                    <b>Next:</b>{" "}
                    {c.next ?? (c.noNextAction
                      ? <span className="warnish">nothing written down</span>
                      : "nothing required yet")}
                  </div>

                  <div className="kbtns">
                    {c.poc && digits[c.poc.id] && (
                      <>
                        <a href={`tel:+${digits[c.poc.id]}`}>Call</a>
                        <a target="_blank" rel="noopener"
                           href={`https://wa.me/${digits[c.poc.id]}`}>WhatsApp</a>
                      </>
                    )}
                    <a className="p" href={`/schools/${c.id}`}>Open</a>
                    {c.nextStageKey && (
                      <a href={`/schools/${c.id}/advance?to=${c.nextStageKey}`}>Advance</a>
                    )}
                  </div>
                </article>
              ))}
              {all.length === 0 && <div className="kan-empty">—</div>}
              {all.length > shown.length && (
                <div className="kan-empty">
                  Showing {shown.length} of {all.length}. Narrow the filters.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
