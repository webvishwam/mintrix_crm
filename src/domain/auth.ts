import { cookies } from "next/headers";
import * as db from "@/server/db";

/**
 * AUTHENTICATION — Supabase Auth.
 *
 * Three separate things, deliberately:
 *
 *   auth.users    the login. Supabase owns it. Email and password live there.
 *   profiles      what the user may edit about themselves.
 *   user_roles    the authority. The user cannot write to it at all.
 *
 * The access token is never trusted because it arrived in a cookie — a cookie can be
 * forged. It is verified against Supabase on the way in, and only the user id that
 * comes back is used to establish the database context.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const ACCESS = "mx_at";
const REFRESH = "mx_rt";

export interface Identity {
  id: string;
  email: string;
  full_name: string;
  display_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  designation: string | null;
  timezone: string;
  /** Authorisation. Read from user_roles, never from user metadata. */
  role: string;
  team: string | null;
  hats: string[];
  status: string;
  /** An email change that has been requested but not yet confirmed. */
  pending_email: string | null;
}

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

// --------------------------------------------------------------------------
// Sign in / out
// --------------------------------------------------------------------------
export async function signIn(email: string, password: string):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Never say which half was wrong — that confirms whether an address exists.
    return { ok: false, error: "That email and password do not match an account." };
  }
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(ACCESS, body.access_token, {
    httpOnly: true, sameSite: "lax", secure, path: "/",
    maxAge: body.expires_in ?? 3600,
  });
  jar.set(REFRESH, body.refresh_token, {
    httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(ACCESS)?.value;
  if (token) {
    await api("/auth/v1/logout", {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

/**
 * Exchange the refresh token when the access token has expired.
 *
 * Writing the new cookie is BEST EFFORT. A Server Component render is not allowed
 * to set cookies — only a Server Action, a Route Handler or the proxy may — and
 * throwing there turned an ordinary hour-old session into a 500 on the next page
 * view. So the write is attempted, its refusal is swallowed, and the fresh token is
 * returned anyway: this request proceeds, and `src/proxy.ts` persists the new
 * cookie on the next navigation, where it is permitted.
 */
async function refresh(): Promise<string | null> {
  const jar = await cookies();
  const rt = jar.get(REFRESH)?.value;
  if (!rt) return null;
  const res = await api("/auth/v1/token?grant_type=refresh_token", {
    method: "POST", body: JSON.stringify({ refresh_token: rt }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) return null;
  const secure = process.env.NODE_ENV === "production";
  try {
    jar.set(ACCESS, body.access_token, {
      httpOnly: true, sameSite: "lax", secure, path: "/",
      maxAge: body.expires_in ?? 3600,
    });
    if (body.refresh_token) {
      jar.set(REFRESH, body.refresh_token, {
        httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30,
      });
    }
  } catch {
    // Read-only cookie jar: a render, not an action. The token is still good.
  }
  return body.access_token as string;
}

/**
 * The VERIFIED auth user, or null.
 *
 * The token is checked with Supabase rather than decoded locally: a cookie can be
 * forged, and a locally-decoded JWT would let a forged `sub` impersonate anybody.
 * The round trip is the point.
 */
async function authUser(): Promise<Record<string, any> | null> {
  const jar = await cookies();
  let token = jar.get(ACCESS)?.value ?? null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      token = await refresh();
      if (!token) return null;
    }
    const res = await api("/auth/v1/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return await res.json().catch(() => null);
    token = null;   // expired or invalid: try the refresh token once
  }
  return null;
}

export async function currentUserId(): Promise<string | null> {
  return (await authUser())?.id ?? null;
}

/** The signed-in person, with their authority. Null when nobody is signed in. */
export async function currentIdentity(): Promise<Identity | null> {
  const u = await authUser();
  const id = u?.id as string | undefined;
  if (!id) return null;
  // Supabase reports a requested-but-unconfirmed address on the auth user itself.
  // Reading it from the API rather than the auth table means the application role
  // never needs access to the auth schema.
  const pending = (u?.new_email as string) || null;
  return db.withUser(id, async () => {
    const row = await db.one(
      `select p.id, p.full_name, p.display_name, p.email, p.phone, p.avatar_url,
              p.designation, p.timezone,
              r.role::text as role, r.team::text as team, r.hats, r.status
         from public.profiles p
         left join public.user_roles r on r.user_id = p.id
        where p.id = ?`, [id]);
    if (!row) return null;
    return {
      id: row.id, email: row.email ?? "", full_name: row.full_name ?? "",
      display_name: row.display_name, phone: row.phone, avatar_url: row.avatar_url,
      designation: row.designation, timezone: row.timezone ?? "Asia/Kolkata",
      role: row.role ?? "external", team: row.team, hats: row.hats ?? [],
      status: row.status ?? "invited", pending_email: pending,
    } satisfies Identity;
  });
}

export async function requireIdentity(): Promise<Identity> {
  const me = await currentIdentity();
  if (!me) throw new Error("NOT_AUTHENTICATED");
  if (me.status === "disabled") throw new Error("ACCOUNT_DISABLED");
  return me;
}

// --------------------------------------------------------------------------
// Self-service. The user may change these about themselves and nothing else.
// --------------------------------------------------------------------------
export async function changeEmail(newEmail: string):
  Promise<{ ok: true; pending: boolean } | { ok: false; error: string }> {
  const jar = await cookies();
  const token = jar.get(ACCESS)?.value;
  if (!token) return { ok: false, error: "Sign in again before changing your email." };
  const email = newEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "That does not look like an email address." };
  }
  // Supabase's own flow: it validates, checks the address is free, and (depending on
  // project settings) sends a confirmation. We never write auth tables directly.
  const res = await api("/auth/v1/user", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(body.msg ?? body.error_description ?? body.message ?? "");
    if (/already/i.test(msg)) {
      return { ok: false, error: "Another account already uses that address." };
    }
    return { ok: false, error: msg || "That email could not be changed." };
  }
  // If confirmation is required the address is pending, not changed — and the UI must
  // not pretend otherwise.
  const pending = String(body.new_email ?? body.email_change ?? "") !== ""
    && String(body.email ?? "").toLowerCase() !== email;
  return { ok: true, pending };
}

export async function changePassword(current: string, next: string):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await currentIdentity();
  if (!me) return { ok: false, error: "Sign in again." };
  if (next.length < 12) {
    return { ok: false, error: "Use at least 12 characters." };
  }
  // Re-authenticate first: a stolen session must not be enough to take the account.
  const check = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: me.email, password: current }),
  });
  if (!check.ok) return { ok: false, error: "Your current password is not right." };

  const jar = await cookies();
  const token = jar.get(ACCESS)?.value;
  const res = await api("/auth/v1/user", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password: next }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: String(body.msg ?? "That password was not accepted.") };
  }
  return { ok: true };
}
