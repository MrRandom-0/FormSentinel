import { consumeMagicLink, requestMagicLink } from "../auth-actions";
export default async function MagicLink({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string; token?: string }>;
}) {
  const query = await searchParams;
  return (
    <div className="container page">
      <div className="card auth-card">
        <h1>Magic link</h1>
        <p>
          External email is unavailable unless configured. Development links are shown here and are
          never presented as delivered email.
        </p>
        <form action={requestMagicLink}>
          <label className="field">
            Email
            <input name="email" type="email" required />
          </label>
          <button className="button">Create development link</button>
        </form>
        {query.requested ? (
          <div className="notice">
            <p>
              If the account exists, a link was created.
              {query.token ? (
                <>
                  {" "}
                  Development token: <code>{query.token}</code>
                </>
              ) : null}
            </p>
            {query.token ? (
              <form action={consumeMagicLink}>
                <input type="hidden" name="token" value={query.token} />
                <button className="button">Use development magic link</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
