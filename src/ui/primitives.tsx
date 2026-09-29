import Link from "next/link";
import type { ReactNode } from "react";

export function Pill({ children, colour = "slate" }:
  { children: ReactNode; colour?: string }) {
  return <span className={`pill ${colour}`}>{children}</span>;
}

export function Card({ title, extra, children }:
  { title?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="card">
      {(title || extra) && (
        <div className="hd">{title}{extra && <span className="x">{extra}</span>}</div>
      )}
      <div className="bd">{children}</div>
    </div>
  );
}

export function Top({ title, sub, right }:
  { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="top">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

export function Notice({ kind, title, children, items }: {
  kind: "err" | "warn" | "ok" | "info";
  title?: string; children?: ReactNode; items?: string[];
}) {
  return (
    <div className={`note ${kind}`}>
      {title && <b>{title}</b>}{title && children ? " " : ""}{children}
      {items?.length ? <ul>{items.map((i, n) => <li key={n}>{i}</li>)}</ul> : null}
    </div>
  );
}

/** Every empty state says what to do about it, never just "none". */
export function Empty({ what, action }: { what: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{what}</p>
      {action}
    </div>
  );
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return <div className={`note ${err ? "err" : "ok"}`}>{err ?? msg}</div>;
}

// ---- formatting ---------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateOnly(ts?: string | Date | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortDate(ts?: string | Date | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

/** "3h 20m left", "2d overdue" — the reading a rep actually needs. */
export function dueText(ts?: string | Date | null): string {
  if (!ts) return "no date";
  const ms = new Date(ts).getTime() - Date.now();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, "0")}m`
                                     : `${Math.max(m, 1)}m`;
  return ms < 0 ? `${span} overdue` : `${span} left`;
}

export function slaState(due?: string | Date | null, hours = 48):
  "on_track" | "at_risk" | "overdue" | "none" {
  if (!due) return "none";
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) return "overdue";
  return ms / 3_600_000 <= hours * 0.25 ? "at_risk" : "on_track";
}

export const digits = (v?: string | null) => {
  const d = String(v ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `91${d}` : "";
};

/** The chain a rep must never lose: account › school › opportunity. */
export function Breadcrumb({ account, school, opportunity }: {
  account?: { id: string; name: string } | null;
  school?: { id: string; name: string } | null;
  opportunity?: { id: string; name: string } | null;
}) {
  if (!account && !school) return null;
  return (
    <nav className="crumb">
      {account && <Link href={`/accounts/${account.id}`}>{account.name}</Link>}
      {school && <><span>›</span><Link href={`/schools/${school.id}`}>{school.name}</Link></>}
      {opportunity && (
        <><span>›</span>
         <Link href={`/opportunities/${opportunity.id}`}>{opportunity.name}</Link></>
      )}
    </nav>
  );
}

/** Contact routes that work from anywhere a person appears. */
export function ContactButtons({ person, sm }: { person: any; sm?: boolean }) {
  const c = sm ? "btn sm" : "btn";
  const tel = digits(person?.phone);
  const wa = digits(person?.whatsapp ?? person?.phone);
  if (person?.do_not_contact) {
    return <Pill colour="red">Do not contact</Pill>;
  }
  if (!tel && !wa && !person?.email) {
    return <span className="s muted">No verified contact route</span>;
  }
  return (
    <span className="btns">
      {tel && <a className={c} href={`tel:+${tel}`}>Call</a>}
      {wa && <a className={`${c} ghost`} target="_blank" rel="noopener"
                href={`https://wa.me/${wa}`}>WhatsApp</a>}
      {person?.email && <a className={`${c} ghost`} href={`mailto:${person.email}`}>Email</a>}
    </span>
  );
}
