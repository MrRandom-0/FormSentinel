import Link from "next/link";
import { signup } from "../auth-actions";
export const metadata = { title: "Create account" };
export default function Signup() {
  return (
    <div className="container page">
      <div className="card auth-card">
        <p className="eyebrow">Start locally</p>
        <h1>Create account</h1>
        <form action={signup}>
          <label className="field">
            Name
            <input name="name" autoComplete="name" minLength={2} required />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
            <small>At least 12 characters.</small>
          </label>
          <button className="button" type="submit">
            Create account
          </button>
        </form>
        <p>
          Already registered? <Link href="/login">Log in</Link>.
        </p>
      </div>
    </div>
  );
}
