"use client";

import Link from "next/link";
import { useEffect } from "react";

/** A rep is never shown a stack trace or a raw database message. */
export default function ErrorBoundary({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="login">
      <div className="card">
        <div className="hd">That did not work</div>
        <div className="bd">
          <p>
            Something went wrong on our side. Nothing you were looking at has been
            changed.
          </p>
          <p className="help">
            If it keeps happening, tell the founder and quote{" "}
            <code>{error?.digest ?? "no reference"}</code>.
          </p>
          <div className="btns" style={{ marginTop: 14 }}>
            <button className="btn" type="button" onClick={() => reset()}>Try again</button>
            <Link className="btn grey" href="/">Back to my day</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
