import { redirect } from "next/navigation";
import { currentIdentity, type Identity } from "@/domain/auth";
import * as db from "@/server/db";

export type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Every page starts here. It establishes who is asking and opens the database with
 * that identity, so row level security applies to the page's own queries.
 */
export async function page<T>(fn: (me: Identity) => Promise<T>):
  Promise<{ me: Identity; data: T }> {
  const me = await currentIdentity();
  if (!me) redirect("/login");
  if (me.status === "disabled") redirect("/login?err=" +
    encodeURIComponent("That account has been disabled."));
  const data = await db.withUser(me.id, () => fn(me));
  return { me, data };
}

export async function flash(sp: SP) {
  const p = await sp;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { msg: one(p.msg), err: one(p.err) };
}

export const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

export const isStaff = (me: Identity) => me.role !== "external";
export const isFounder = (me: Identity) => me.role === "founder";
