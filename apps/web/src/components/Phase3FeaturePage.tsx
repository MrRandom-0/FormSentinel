import Link from "next/link";
export interface Phase3FeaturePageProps {
  title: string;
  description: string;
  status: "preview" | "unavailable";
  evidence: readonly string[];
  empty: string;
}
export function Phase3FeaturePage({
  title,
  description,
  status,
  evidence,
  empty,
}: Phase3FeaturePageProps) {
  return (
    <div className="container page">
      <p>
        <Link href="/app">Dashboard</Link> / Phase 3
      </p>
      <h1>{title}</h1>
      <p className="lead">{description}</p>
      <section className="card" aria-labelledby="runtime-state">
        <h2 id="runtime-state">Runtime state</h2>
        <p>
          <strong>{status === "preview" ? "Local preview" : "Unavailable"}</strong>
        </p>
        <p>
          {status === "preview"
            ? "Tested local library capability only; this page is not a live repository-backed control plane. Production remains unavailable until its PostgreSQL adapter is wired."
            : "This capability needs a configured isolated runtime or official provider credentials."}
        </p>
      </section>
      <section className="card" aria-labelledby="evidence">
        <h2 id="evidence">Evidence and coverage</h2>
        {evidence.length ? (
          <ul>
            {evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>{empty}</p>
        )}
      </section>
    </div>
  );
}
