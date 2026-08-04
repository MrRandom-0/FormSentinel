import Link from "next/link";
import { verifyEmail } from "../auth-actions";

export default async function Verify({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return (
    <div className="container page">
      <div className="card auth-card">
        <h1>Verify your email</h1>
        {error ? (
          <div className="notice" role="alert">
            <p>This verification link is invalid, expired, or already used.</p>
            <p>
              Use a newer verification link if you have one. If the account is already verified,
              return to <Link href="/login">log in</Link>. Email resend is unavailable until a real
              provider adapter is implemented.
            </p>
          </div>
        ) : token ? (
          <>
            <p>Confirm this development verification link to activate your account.</p>
            <form action={verifyEmail}>
              <input type="hidden" name="token" value={token} />
              <button className="button" type="submit">
                Verify and continue
              </button>
            </form>
          </>
        ) : (
          <p>
            Email credentials are reserved and do not activate delivery in Phase 1. In development,
            signup places a verification token in this page URL.
          </p>
        )}
        {!token ? <Link href="/login">Return to login</Link> : null}
      </div>
    </div>
  );
}
