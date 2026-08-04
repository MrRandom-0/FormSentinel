import Image from "next/image";
import Link from "next/link";
export default function Home() {
  return (
    <>
      <section className="container hero">
        <div>
          <p className="eyebrow">Durable form infrastructure</p>
          <h1>Receive and process forms without redesigning them.</h1>
          <p className="lead">
            Keep your design and stack while the local preview validates submissions, persists jobs
            and events, and exposes a tenant-scoped inbox. Hosted production is not ready.
          </p>
          <p>
            <Link className="button" href="/signup">
              Create your first endpoint
            </Link>{" "}
            <Link className="button secondary" href="/docs">
              Read the docs
            </Link>
          </p>
        </div>
        <Image
          className="illustration"
          src="/form-shield.svg"
          width={520}
          height={400}
          priority
          alt="A contact form passing through a shield into labeled local simulation stages"
        />
      </section>
      <section className="container grid">
        <article className="card">
          <h2>Own the frontend</h2>
          <p>
            Connect HTML or framework forms with the field names and success behavior you choose.
          </p>
        </article>
        <article className="card">
          <h2>See configuration drift</h2>
          <p>
            Phase 3 compares immutable schema observations, explains changes, and records explicit
            accept, map, ignore, reject, and rollback decisions.
          </p>
        </article>
        <article className="card">
          <h2>Start honestly</h2>
          <p>
            Local execution is durable and credential-free; external providers stay explicitly
            unavailable until configured.
          </p>
        </article>
      </section>
    </>
  );
}
