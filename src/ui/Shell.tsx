import Link from "next/link";
import type { ReactNode } from "react";
import type { Identity } from "@/domain/auth";
import { signOutAction } from "@/app/actions";

/**
 * One shell. The navigation answers the operating questions in the order a rep asks
 * them — what do I do now, where are the schools, who are the people — rather than
 * mirroring the database.
 */
const NAV = [
  ["/", "My day"],
  ["/work", "My work"],
  ["/pipeline", "School pipeline"],
  ["/show", "The show"],
  ["/accounts", "Accounts"],
  ["/people", "People"],
] as const;

const MANAGE = [
  ["/health", "CRM health", "staff"],
  ["/audit", "Audit log", "founder"],
  ["/admin", "Team & access", "founder"],
  ["/settings", "Process settings", "founder"],
] as const;

export default function Shell({ me, path, children }: {
  me: Identity; path: string; children: ReactNode;
}) {
  const isFounder = me.role === "founder";
  const isStaff = me.role !== "external";
  const on = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");

  // An external collaborator gets a deliberately tiny shell: their work, and nothing
  // that would let them browse the CRM.
  const nav = isStaff ? NAV : ([["/work", "My work"]] as const);
  const manage = MANAGE.filter(([, , need]) =>
    need === "founder" ? isFounder : isStaff);

  return (
    <>
      <div className="shell">
        <aside className="side">
          <Link href={isStaff ? "/" : "/work"} className="brand">
            <b>MINTRIX</b><span>Sales OS</span>
          </Link>
          {isStaff && (
            <form method="get" action="/search" className="searchbox">
              <input name="q" placeholder="Search schools, people, numbers"
                     aria-label="Search" />
            </form>
          )}
          <nav className="nav">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className={on(href) ? "on" : ""}>{label}</Link>
            ))}
            {manage.length > 0 && (
              <>
                <div className="sep">Manage</div>
                {manage.map(([href, label]) => (
                  <Link key={href} href={href} className={on(href) ? "on" : ""}>
                    {label}
                  </Link>
                ))}
              </>
            )}
          </nav>
          <div className="who">
            <b>{me.display_name || me.full_name || me.email}</b><br />
            <span className="s">{me.designation || me.role}</span><br />
            <Link href="/account">My account</Link>{" · "}
            <form action={signOutAction} className="inline">
              <button className="linkish" type="submit">Sign out</button>
            </form>
          </div>
        </aside>
        <main className="main">
          <div className="mobile-top">
            <b>MINTRIX <span className="muted">Sales OS</span></b>
            <div className="mtr">
              <Link className="btn grey sm" href="/account">Account</Link>
              <form action={signOutAction}>
                <button className="btn grey sm" type="submit">Sign out</button>
              </form>
            </div>
          </div>
          {/* The sidebar is hidden on a phone, and its search box with it. */}
          {isStaff && (
            <form method="get" action="/search" className="searchbox mobile-search">
              <input name="q" placeholder="Search schools, people, numbers"
                     aria-label="Search" />
            </form>
          )}
          {children}
        </main>
      </div>
      <nav className="tabbar">
        {nav.slice(0, 4).map(([href, label]) => (
          <Link key={href} href={href} className={on(href) ? "on" : ""}>{label}</Link>
        ))}
      </nav>
    </>
  );
}
