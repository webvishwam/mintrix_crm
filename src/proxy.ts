import { NextResponse, type NextRequest } from "next/server";

/**
 * KEEPING A SESSION ALIVE.
 *
 * The access token lives for an hour and its cookie is set to expire with it, so
 * the cookie simply being absent — while the refresh token is still there — is the
 * signal that it has expired.
 *
 * This runs in the proxy (formerly middleware): one of the few places Next.js
 * permits a cookie to be written. A Server Component render cannot, which is why
 * refreshing during a render used to throw and hand the user a 500 an hour after
 * they signed in.
 *
 * Nothing here decides authority. It moves a token along; every page still verifies
 * that token with Supabase, and the database still decides what the user may see.
 */
const ACCESS = "mx_at";
const REFRESH = "mx_rt";

export async function proxy(req: NextRequest) {
  const at = req.cookies.get(ACCESS)?.value;
  const rt = req.cookies.get(REFRESH)?.value;
  if (at || !rt) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
           ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) return NextResponse.next();

  let body: Record<string, any> = {};
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
      cache: "no-store",
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      // The refresh token is spent or revoked. Clear it rather than retrying on
      // every request; the user is sent to sign in by the page itself.
      const out = NextResponse.next();
      out.cookies.delete(REFRESH);
      return out;
    }
  } catch {
    return NextResponse.next();   // Supabase unreachable: let the page report it.
  }

  const secure = process.env.NODE_ENV === "production";
  const res = NextResponse.next();
  const common = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
  res.cookies.set(ACCESS, body.access_token, {
    ...common, maxAge: body.expires_in ?? 3600 });
  if (body.refresh_token) {
    res.cookies.set(REFRESH, body.refresh_token, {
      ...common, maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}

export const config = {
  // Everything except static assets and the sign-in page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"],
};
