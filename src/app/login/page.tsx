import { redirect } from "next/navigation";
import { currentIdentity } from "@/domain/auth";
import { signInAction } from "@/app/actions";
import { Flash } from "@/ui/primitives";
import { flash, type SP } from "@/ui/page";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  if (await currentIdentity()) redirect("/");
  const { msg, err } = await flash(searchParams);
  return (
    <div className="login">
      <div className="card">
        <div className="hd">MINTRIX <span className="muted">Sales OS</span></div>
        <div className="bd">
          <Flash msg={msg} err={err} />
          <form action={signInAction}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoFocus
                   autoComplete="username" />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required
                   autoComplete="current-password" />
            <div className="btns" style={{ marginTop: 14 }}>
              <button className="btn" type="submit">Sign in</button>
            </div>
          </form>
          <p className="help" style={{ marginTop: 14 }}>
            Human-led, system-guided. There is no AI anywhere in this build.
          </p>
        </div>
      </div>
    </div>
  );
}
