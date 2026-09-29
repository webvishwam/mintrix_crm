import Link from "next/link";

export default function NotFound() {
  return (
    <div className="login">
      <div className="card">
        <div className="hd">Not here</div>
        <div className="bd">
          <p>
            That record does not exist, or it is not one your access covers. Those look
            the same from here on purpose.
          </p>
          <div className="btns" style={{ marginTop: 14 }}>
            <Link className="btn" href="/">Back to my day</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
