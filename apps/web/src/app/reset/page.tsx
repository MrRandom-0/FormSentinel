import { completeReset, requestReset } from "../auth-actions";
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string; token?: string }>;
}) {
  const query = await searchParams;
  return (
    <div className="container page">
      <div className="card auth-card">
        <h1>Reset password</h1>
        <p>
          External email is unavailable unless configured. Development reset tokens are shown here;
          no delivery is simulated.
        </p>
        <form action={requestReset}>
          <label className="field">
            Email
            <input name="email" type="email" required />
          </label>
          <button className="button">Create reset token</button>
        </form>
        {query.requested ? (
          <div className="notice">
            <p>
              If the account exists, a reset was created.
              {query.token ? (
                <>
                  {" "}
                  Development token: <code>{query.token}</code>
                </>
              ) : null}
            </p>
            {query.token ? (
              <form action={completeReset}>
                <input type="hidden" name="token" value={query.token} />
                <label className="field">
                  New password
                  <input name="password" type="password" minLength={12} required />
                </label>
                <button className="button">Set new password</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
