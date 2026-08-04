import Link from "next/link";
import { login } from "../auth-actions";
export const metadata = { title: "Log in" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const query = await searchParams;
  return (
    <div className="container page">
      <div className="card auth-card">
        <p className="eyebrow">Welcome back</p>
        <h1>Log in</h1>
        {query.error ? (
          <p className="notice" role="alert">
            The email or password was incorrect.
          </p>
        ) : null}
        {query.deleted ? (
          <p className="notice">
            Your account deletion request was recorded and sessions were revoked.
          </p>
        ) : null}
        <form action={login}>
          <label className="field">
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={12}
              required
            />
          </label>
          <button className="button" type="submit">
            Log in
          </button>
        </form>
        <p>
          <Link href="/magic-link">Use a magic link</Link> ·{" "}
          <Link href="/reset">Reset password</Link>
        </p>
        <p>
          Need an account? <Link href="/signup">Sign up</Link>.
        </p>
      </div>
    </div>
  );
}
