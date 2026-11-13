import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  integrationCopilotPrompt,
  integrationPlatforms,
  integrationSnippets,
  publicEndpoint,
} from "@formsentinel/forms";
import {
  createWorkspace,
  logoutAll,
  logoutCurrent,
  requestDeletion,
  revokeDeviceSession,
  selectWorkspace,
} from "../auth-actions";
import { resolveAppRoute, resolvePublicRoute, type FormRoute } from "../../lib/route-resolution";
import { MAX_EXPORT_SUBMISSIONS } from "../../lib/submission-export";
import { addSubmissionTag, retrySubmission, updateSubmission } from "../submission-actions";
import { requireSession } from "../../lib/session";
import { repository, submissionStore } from "../../lib/repository";

type Content = { title: string; intro: string; points: readonly [string, string][] };
const publicContent: Record<string, Content> = {
  product: {
    title: "Form infrastructure without a redesign",
    intro:
      "Phase 3 runs durable validation, acceptance, queueing, and asynchronous processing while preserving complete control of the frontend.",
    points: [
      ["Expected fields", "Define what your form should send before accepting traffic."],
      [
        "Operational trail",
        "Inspect durable submission, processing, and delivery events without pretending unavailable providers delivered.",
      ],
      ["Team controls", "Scope forms, members, and permissions to a workspace."],
    ],
  },
  features: {
    title: "Focused tools for dependable forms",
    intro:
      "Phase 3 organizes local schema, spam controls, integration analysis, health, routing, analytics, and reports around each form.",
    points: [
      ["Form schemas", "Persist expected field names, types, and requirements locally."],
      ["Spam protection", "Use honeypots and explicit decisions."],
      [
        "Durable records",
        "Inspect persisted submissions, events, jobs, and independent delivery states.",
      ],
    ],
  },
  "ai-builders": {
    title: "Connect forms built with AI tools",
    intro:
      "Give your coding agent a prompt containing the endpoint, fields, domains, accessibility constraints, and verification steps it actually needs.",
    points: [
      ["Real configuration", "Prompts use your endpoint and expected fields."],
      ["Platform context", "Guidance respects each builder's workflow."],
      ["Reviewable changes", "Prompts require tests and preserve existing design."],
    ],
  },
  "form-builders": {
    title: "Connect visual form builders",
    intro:
      "Use Phase 3 local integration guidance for visual builders while preserving their published markup and design.",
    points: [
      ["Framer", "Use a code component or fetch override with the configured development origin."],
      ["Webflow", "Add progressive enhancement without replacing accessible native form markup."],
      [
        "Local durable runtime",
        "Use the same endpoint and inbox locally without external credentials.",
      ],
    ],
  },
  guides: {
    title: "Form integration and monitoring guides",
    intro:
      "Explore Phase 3 integration, static scanning, monitoring, MCP, and report guidance for frameworks and static sites.",
    points: [
      ["Frameworks", "Next.js and React integration foundations."],
      ["Static sites", "GitHub Pages and static HTML guidance."],
      ["Operations", "Endpoint schema and monitoring foundations without invented runtime claims."],
    ],
  },
  "form-health-monitoring": {
    title: "Know whether your form is ready",
    intro:
      "Health monitoring foundations record checks and outcomes without claiming monitoring is active in Phase 3.",
    points: [
      ["Clear state", "Separate configured, ready, and unavailable."],
      ["Run history", "The schema supports inspectable health runs."],
      [
        "Honest coverage",
        "Static schedules run locally; browser checks stay unavailable without isolation.",
      ],
    ],
  },
  "schema-drift": {
    title: "Catch form changes before they become missing leads",
    intro:
      "Deterministic additions, removals, rename candidates, type, required, validation, file, and nesting drift is persisted with evidence and explicit decisions.",
    points: [
      ["Current definition", "Persist the current expected schema in the local form record."],
      [
        "Immutable history",
        "Accept and rollback create new schema versions without deleting old observations.",
      ],
      ["No guesswork", "Phase 3 never invents drift events."],
    ],
  },
  "spam-protection": {
    title: "Block obvious noise with explainable decisions",
    intro:
      "Deterministic scoring combines honeypot, velocity, content, origin, CAPTCHA, fingerprint, and client signals with persisted reasons.",
    points: [
      ["Honeypot", "Use an unfocusable field real visitors leave empty."],
      ["Local response", "Return an explicit spam rejection without exposing simulated stages."],
      ["Future privacy", "Durable source metadata should use hashes rather than raw addresses."],
    ],
  },
  "file-uploads": {
    title: "A safe foundation for submission files",
    intro:
      "Multipart upload transport, private quarantine, magic-byte validation, checksums, and explicit scan states are active in the local durable runtime.",
    points: [
      ["Separate metadata", "Track filename, type, size, and storage key."],
      ["Private access", "Only authorized clean, released files can be downloaded."],
      ["Retention ready", "Deletion workflows can include associated files."],
    ],
  },
  integrations: {
    title: "Integrations with explicit availability",
    intro:
      "Signed webhook delivery and durable local captures are implemented. Transactional email and OAuth providers remain explicitly unavailable without adapters.",
    points: [
      ["No pretend delivery", "Unavailable providers throw rather than return fake ids."],
      ["Signed webhooks", "Contracts define timestamped signatures."],
      ["Connection state", "Workspace connections retain status and configuration."],
    ],
  },
  agencies: {
    title: "Keep client forms in separate workspaces",
    intro:
      "Use workspace boundaries and centralized roles to avoid mixing clients, forms, and submission access.",
    points: [
      ["Tenant boundaries", "Every repository query requires a workspace."],
      ["Five roles", "Assign owner, administrator, developer, analyst, or viewer."],
      ["Portable setup", "Generate a platform-aware implementation prompt per form."],
    ],
  },
  developers: {
    title: "Typed contracts from endpoint to event",
    intro:
      "Use schema definitions, SDK contracts, operational endpoints, and an OpenAPI foundation without hiding Phase 3 limitations.",
    points: [
      ["Opaque endpoints", "Public endpoint keys reveal no workspace id."],
      ["Health surfaces", "Ingest and worker expose health, readiness, and version."],
      [
        "Local testing",
        "Submit through the canonical durable ingest endpoint and inspect the inbox.",
      ],
    ],
  },
  pricing: {
    title: "Start with transparent limits",
    intro:
      "The versioned catalog defines Free, Starter, Pro, and Agency limits and list prices. Hosted production remains unavailable until every required adapter genuinely probes.",
    points: [
      ["Free", "Evaluate the full local setup flow."],
      ["Central limits", "Entitlements live in one plan module."],
      [
        "No surprise checkout",
        "Billing controls stay disabled until a payment adapter is implemented.",
      ],
    ],
  },
  security: {
    title: "Security is a server-side boundary",
    intro:
      "Passwords use scrypt, durable records contain token hashes, cookies are HTTP-only, and authorization is deny-by-default.",
    points: [
      ["Session control", "Review and revoke device sessions."],
      ["Tenant isolation", "Workspace scope is enforced before form access."],
      ["Production gate", "The JSON adapter refuses to start in production."],
    ],
  },
  docs: {
    title: "Phase 3 developer guide",
    intro:
      "Create a workspace and form, copy its generated endpoint and prompt, then verify behavior in the labeled development console.",
    points: [
      ["1. Define", "Choose platform, URL, domains, fields, and notification intent."],
      ["2. Integrate", "Apply the generated prompt in your project."],
      ["3. Verify", "Run the local test, worker, and inspect the durable processing timeline."],
    ],
  },
  status: {
    title: "Phase 3 service status",
    intro:
      "Web setup, external ingest, durable queueing, worker processing, and the tenant inbox are operational. Unconfigured external providers remain unavailable.",
    points: [
      ["Web", "Operational for durable local Phase 3 workflows."],
      ["Ingest", "Hono accepts JSON, URL-encoded, and multipart submissions."],
      ["Worker", "Lease-based polling and protected manual drain are operational."],
    ],
  },
  contact: {
    title: "Contact FormSentinel",
    intro:
      "For project questions, email support@formsentinel.example. This placeholder domain must be replaced before production.",
    points: [
      ["Product", "Ask about your framework or setup."],
      ["Security", "Report issues privately and include reproduction details."],
      ["Privacy", "Do not send submission content in support messages."],
    ],
  },
  privacy: {
    title: "Privacy notice",
    intro:
      "Phase 3 local data stays in the configured development JSON file. Production collection and subprocessors are not active.",
    points: [
      ["Local control", "Delete the local file to reset development data."],
      ["Data minimization", "Source addresses are represented as hashes."],
      ["Requests", "Export and deletion request foundations are included."],
    ],
  },
  terms: {
    title: "Terms",
    intro:
      "This Phase 3 software is a development preview, not a production submission service or service-level commitment.",
    points: [
      ["Preview", "External delivery is unavailable."],
      ["Your forms", "You remain responsible for lawful form content and consent."],
      ["No abuse", "Do not use the service for harmful or deceptive collection."],
    ],
  },
  dpa: {
    title: "Data processing addendum",
    intro:
      "A production DPA is not yet offered because Phase 3 has no hosted production processing service.",
    points: [
      ["Current scope", "Development-only local adapter."],
      ["Before launch", "Document subprocessors, retention, regions, and incident terms."],
      ["Contact", "Discuss future requirements without sharing personal data."],
    ],
  },
};
const builderContent: Record<string, [string, string]> = {
  "ai-builders/lovable": [
    "Lovable forms",
    "Preserve Lovable's generated React design while adding explicit pending, error, and success state.",
  ],
  "ai-builders/bolt": [
    "Bolt forms",
    "Connect the framework Bolt selected without replacing its routes or generated component system.",
  ],
  "ai-builders/v0": [
    "v0 forms",
    "Keep shadcn/ui semantics and make the smallest correct client boundary for submission state.",
  ],
  "ai-builders/cursor": [
    "Cursor form integration",
    "Let Cursor inspect your existing stack, then give it exact fields and a verification checklist.",
  ],
  "ai-builders/replit": [
    "Replit forms",
    "Keep secrets server-side and verify the form with the Replit project's run and deployment commands.",
  ],
  "form-builders/framer": [
    "Framer forms",
    "Use a code component or fetch override while preserving the canvas design and published domain.",
  ],
  "form-builders/webflow": [
    "Webflow forms",
    "Preserve Webflow's semantic form markup and add progressive enhancement before the closing body tag.",
  ],
  "guides/github-pages": [
    "GitHub Pages forms",
    "Use static HTML and browser fetch with no embedded secrets, then allow the published pages domain.",
  ],
  "guides/nextjs": [
    "Next.js forms",
    "Respect App Router server/client boundaries and add a client component only for interactive submission state.",
  ],
  "guides/react": [
    "React forms",
    "Use the project's established form state conventions and cover pending, success, validation, and network failures.",
  ],
  "guides/static-html": [
    "Static HTML forms",
    "Use native labels and validation with a minimal progressive-enhancement script.",
  ],
  "guides/form-endpoint-api": [
    "Form endpoint API",
    "Post only configured field names to an opaque endpoint and handle non-success responses honestly.",
  ],
  "guides/form-monitoring": [
    "Form monitoring",
    "Define expected fields and readiness before enabling scheduled external checks in a later phase.",
  ],
  "guides/broken-form-monitoring": [
    "Broken form monitoring",
    "Use schema versions and health outcomes to distinguish frontend drift from delivery failures.",
  ],
};
function PublicPage({ content }: { content: Content }) {
  return (
    <div className="container page">
      <p className="eyebrow">FormSentinel</p>
      <h1>{content.title}</h1>
      <p className="lead">{content.intro}</p>
      <section className="grid">
        {content.points.map(([title, body]) => (
          <article className="card" key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
      {content.title === "Connect forms built with AI tools" ? (
        <nav className="card" aria-label="AI builder guides">
          <Link href="/ai-builders/lovable">Lovable</Link> ·{" "}
          <Link href="/ai-builders/bolt">Bolt</Link> · <Link href="/ai-builders/v0">v0</Link> ·{" "}
          <Link href="/ai-builders/cursor">Cursor</Link> ·{" "}
          <Link href="/ai-builders/replit">Replit</Link>
        </nav>
      ) : null}
      {content.title === "Connect visual form builders" ? (
        <nav className="card" aria-label="Visual form builder guides">
          <Link href="/form-builders/framer">Framer</Link> ·{" "}
          <Link href="/form-builders/webflow">Webflow</Link>
        </nav>
      ) : null}
      <Link className="button" href="/signup">
        Start with Phase 3
      </Link>
    </div>
  );
}
function AppNavigation({
  workspaces,
  currentWorkspaceId,
}: {
  workspaces: readonly { id: string; name: string }[];
  currentWorkspaceId: string;
}) {
  return (
    <aside className="sidebar" aria-label="Application">
      <form action={selectWorkspace}>
        <label>
          Workspace
          <select name="workspaceId" defaultValue={currentWorkspaceId}>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary">Switch</button>
      </form>
      <form action={createWorkspace}>
        <label>
          New workspace
          <input name="name" minLength={2} required />
        </label>
        <button className="button secondary">Create</button>
      </form>
      <Link href="/app">Overview</Link>
      <Link href="/app/forms">Forms</Link>
      <Link href="/app/submissions">Submissions</Link>
      <Link href="/app/team">Team</Link>
      <Link href="/app/settings/security">Security</Link>
      <form action={logoutCurrent}>
        <button className="button secondary">Log out</button>
      </form>
      <form action={logoutAll}>
        <button className="button secondary">Log out all devices</button>
      </form>
      <form action={requestDeletion}>
        <button className="button secondary">Request account deletion</button>
      </form>
    </aside>
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const parts = (await params).slug ?? [];
  const key = resolvePublicRoute(parts);
  const content = key
    ? (publicContent[key] ??
      (builderContent[key]
        ? { title: builderContent[key][0], intro: builderContent[key][1], points: [] }
        : undefined))
    : undefined;
  return { title: content?.title ?? "Application", description: content?.intro };
}

function FormNavigation({ formId }: { formId: string }) {
  const routes: readonly [FormRoute, string][] = [
    ["overview", "Overview"],
    ["setup", "Setup"],
    ["submissions", "Submissions"],
    ["schema", "Schema"],
    ["protection", "Protection"],
    ["notifications", "Notifications"],
  ];
  return (
    <nav className="form-nav" aria-label="Form">
      {routes.map(([route, label]) => (
        <Link key={route} href={`/app/forms/${formId}${route === "overview" ? "" : `/${route}`}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

function FormRouteContent({
  route,
  form,
  endpoint,
  prompt,
}: {
  route: FormRoute;
  form: {
    id: string;
    name: string;
    platform: string;
    template: string;
    sourceUrl: string | null;
    successRedirect: string | null;
    allowedOrigins: readonly string[];
    honeypotField: string;
    notificationEmail: string | null;
    fields: readonly { name: string; type: string; required: boolean }[];
  };
  endpoint: string;
  prompt: string;
}) {
  if (route === "overview")
    return (
      <div className="card">
        <h2>Phase 3 overview</h2>
        <p>
          {form.platform} / {form.template} with {form.fields.length} persisted schema fields. The
          canonical ingest endpoint durably validates, accepts, and queues this form.
        </p>
      </div>
    );
  if (route === "setup") {
    const snippets = integrationSnippets({
      endpoint,
      fields: form.fields,
      allowedDomains: form.allowedOrigins,
      successRedirect: form.successRedirect,
      honeypotField: form.honeypotField,
    });
    return (
      <>
        <div className="card">
          <h2>Canonical ingest endpoint</h2>
          <code>{endpoint}</code>
          <p className="notice">
            Local execution is durable and credential-free. Origin restrictions are an
            abuse-reduction layer, not authentication; non-browser tools follow the form's no-Origin
            policy.
          </p>
        </div>
        <h2>Integration Copilot prompt</h2>
        <textarea readOnly rows={22} value={prompt} aria-label="Integration Copilot prompt" />
        <h2>Framework snippets</h2>
        {Object.entries(snippets).map(([platform, snippet]) => (
          <details className="card" key={platform}>
            <summary>{platform}</summary>
            <pre>{snippet}</pre>
          </details>
        ))}
        <p>
          <Link className="button" href={`/app/forms/${form.id}/test`}>
            Open development test console
          </Link>
        </p>
      </>
    );
  }
  if (route === "submissions")
    return (
      <div className="card">
        <h2>Durable submissions</h2>
        <p>Submission records for this form load from the shared tenant-scoped durable store.</p>
      </div>
    );
  if (route === "schema")
    return (
      <div className="card">
        <h2>Persisted expected fields</h2>
        <ul>
          {form.fields.map((field) => (
            <li key={field.name}>
              <code>{field.name}</code> — {field.type}, {field.required ? "required" : "optional"}
            </li>
          ))}
        </ul>
      </div>
    );
  if (route === "protection")
    return (
      <div className="card">
        <h2>Development abuse controls</h2>
        <p>
          Honeypot: <code>{form.honeypotField}</code>
        </p>
        <p>
          Allowed browser origins:{" "}
          {form.allowedOrigins.length ? form.allowedOrigins.join(", ") : "any"}. CORS/origin checks
          reduce browser abuse but do not authenticate requests.
        </p>
      </div>
    );
  if (route === "notifications")
    return (
      <div className="card">
        <h2>Notification state</h2>
        <p>{form.notificationEmail || "No notification recipient configured."}</p>
        <p>
          Local messages are durable captures. External email remains unavailable without a provider
          adapter.
        </p>
      </div>
    );
  const unavailable: Record<
    Exclude<
      FormRoute,
      "overview" | "setup" | "submissions" | "schema" | "protection" | "notifications"
    >,
    [string, string]
  > = {
    automations: [
      "No automations",
      "Automation execution requires Phase 3 worker and provider implementations.",
    ],
    health: [
      "No scheduled health checks",
      "Phase 3 stores monitoring foundations but does not run external checks.",
    ],
    analytics: [
      "No submission analytics",
      "There is no durable hosted submission stream to aggregate in Phase 3.",
    ],
    settings: [
      "Form settings",
      `Source: ${form.sourceUrl || "not set"}. Success redirect: ${form.successRedirect || "inline confirmation"}. Editing is not available in Phase 3.`,
    ],
  };
  const [title, body] = unavailable[route];
  return (
    <div className="card">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function FormList({
  forms,
}: {
  forms: readonly { id: string; name: string; platform: string; fields: readonly unknown[] }[];
}) {
  return (
    <>
      <p className="lead">
        Configure and verify local endpoints without claiming external processing is live.
      </p>
      <p>
        <Link className="button" href="/app/forms/new">
          Create form
        </Link>
      </p>
      <div className="grid">
        {forms.map((item) => (
          <article className="card" key={item.id}>
            <h2>{item.name}</h2>
            <p>
              {item.platform} · {item.fields.length} expected fields
            </p>
            <Link href={`/app/forms/${item.id}`}>Open form</Link>
          </article>
        ))}
      </div>
      {!forms.length ? (
        <div className="card">
          <h2>No forms yet</h2>
          <p>Create a form to generate an opaque local development endpoint.</p>
        </div>
      ) : null}
    </>
  );
}

function SubmissionList({
  items,
  nextCursor,
  forms,
  exportQuery,
}: {
  items: readonly {
    id: string;
    formId: string;
    status: string;
    spamStatus: string;
    processingState: string;
    payload: Record<string, unknown>;
    createdAt: string;
    probableDuplicate: boolean;
  }[];
  nextCursor: string | null;
  forms: readonly { id: string; name: string }[];
  /** Serialized list filters for the bulk export endpoint; omit to hide export. */
  exportQuery?: string;
}) {
  return (
    <>
      <form className="card" method="get">
        <label>
          Search <input name="search" />
        </label>
        <label>
          Form{" "}
          <select name="formId">
            <option value="">All forms</option>
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status{" "}
          <select name="status">
            <option value="">All statuses</option>
            {["new", "viewed", "resolved", "spam", "deleted"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          Spam{" "}
          <select name="spam">
            <option value="">Any</option>
            {["allowed", "review", "blocked"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          From <input type="date" name="from" />
        </label>
        <label>
          To <input type="date" name="to" />
        </label>
        <button className="button">Filter</button>
      </form>
      {exportQuery !== undefined ? (
        <p>
          <a
            className="button secondary"
            href={`/app/submissions/export${exportQuery ? `?${exportQuery}` : ""}`}
          >
            Export CSV
          </a>{" "}
          <a
            className="button secondary"
            href={`/app/submissions/export?format=json${exportQuery ? `&${exportQuery}` : ""}`}
          >
            Export JSON
          </a>{" "}
          <small>
            Exports up to {MAX_EXPORT_SUBMISSIONS.toLocaleString("en-US")} submissions matching the
            current filters.
          </small>
        </p>
      ) : null}
      <div className="grid">
        {items.map((item) => (
          <article className="card" key={item.id}>
            <h2>
              <Link href={`/app/submissions/${item.id}`}>
                {new Date(item.createdAt).toLocaleString()}
              </Link>
            </h2>
            <p>
              {forms.find((form) => form.id === item.formId)?.name ?? "Form"} · {item.status} ·{" "}
              {item.processingState}
            </p>
            <p>
              Spam: {item.spamStatus}
              {item.probableDuplicate ? " · probable duplicate" : ""}
            </p>
            <pre>{JSON.stringify(item.payload, null, 2).slice(0, 500)}</pre>
          </article>
        ))}
      </div>
      {!items.length ? (
        <div className="card">
          <h2>No submissions</h2>
          <p>No durable records match these filters.</p>
        </div>
      ) : null}
      {nextCursor ? (
        <Link
          className="button secondary"
          href={`/app/submissions?cursor=${encodeURIComponent(nextCursor)}`}
        >
          Next page
        </Link>
      ) : null}
    </>
  );
}
function SubmissionDetail({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<ReturnType<typeof submissionStore>["getSubmission"]>>>;
}) {
  if (!detail) return null;
  const { submission, events, deliveries } = detail;
  const availableActions =
    submission.status === "deleted"
      ? ["restore"]
      : [
          ...(submission.status === "new" ? ["view"] : []),
          ...(submission.status !== "resolved" ? ["resolve"] : []),
          ...(submission.spamStatus !== "blocked" ? ["spam"] : []),
          ...(submission.spamStatus !== "allowed" ? ["legitimate"] : []),
          "delete",
        ];
  return (
    <>
      <div className="card">
        <h2>Submission fields</h2>
        <p>
          Status: {submission.status} · Spam: {submission.spamStatus} ({submission.spamScore}) ·
          Processing: {submission.processingState}
        </p>
        {submission.probableDuplicate ? (
          <p className="notice">Probable duplicate of {submission.duplicateOfId}.</p>
        ) : null}
        <dl>
          {Object.entries(submission.payload).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                <pre>{String(value)}</pre>
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Origin: {submission.origin || "not supplied"}
          <br />
          Referrer: {submission.referrer || "not supplied"}
          <br />
          UTM: {JSON.stringify(submission.utm)}
          <br />
          Schema version: {submission.schemaVersion}
        </p>
        <p>Spam signals: {submission.spamReasons.join(", ") || "none"}</p>
        <p>Tags: {submission.tags.join(", ") || "none"}</p>
      </div>
      <div className="card">
        <h2>Authorized actions</h2>
        {availableActions.map((action) => (
          <form action={updateSubmission} key={action} style={{ display: "inline" }}>
            <input type="hidden" name="submissionId" value={submission.id} />
            <input type="hidden" name="action" value={action} />
            <button className="button secondary">{action}</button>
          </form>
        ))}
        <form action={addSubmissionTag}>
          <input type="hidden" name="submissionId" value={submission.id} />
          <label>
            Add tag <input name="tag" maxLength={40} required />
          </label>
          <button className="button secondary">Add</button>
        </form>
        {submission.status !== "deleted" ? (
          <form action={retrySubmission}>
            <input type="hidden" name="submissionId" value={submission.id} />
            <p className="notice">
              Retry may duplicate side effects at destinations that ignore idempotency keys.
            </p>
            <button className="button secondary">Replay processing</button>
          </form>
        ) : null}
        <p>
          <a href={`/app/submissions/${submission.id}/download`}>Download sanitized JSON</a> ·{" "}
          <a href={`/app/submissions/${submission.id}/csv`}>Export CSV</a>
        </p>
      </div>
      <div className="card">
        <h2>Files</h2>
        {submission.files.length ? (
          <ul>
            {submission.files.map((file) => (
              <li key={file.id}>
                {file.scanState === "clean" && file.quarantineState === "released" ? (
                  <a href={`/app/submissions/${submission.id}/files/${file.id}`}>
                    {file.originalFilename}
                  </a>
                ) : (
                  file.originalFilename
                )}{" "}
                · {file.detectedType} · {file.byteSize} bytes · {file.scanState}/
                {file.quarantineState}
              </li>
            ))}
          </ul>
        ) : (
          <p>No files.</p>
        )}
      </div>
      <div className="card">
        <h2>Processing timeline</h2>
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              {new Date(event.createdAt).toLocaleString()} — {event.type}{" "}
              <code>{JSON.stringify(event.metadata)}</code>
            </li>
          ))}
        </ol>
      </div>
      <div className="card">
        <h2>Deliveries and retries</h2>
        {deliveries.length ? (
          <ul>
            {deliveries.map((delivery) => (
              <li key={delivery.id}>
                {delivery.destinationType}: {delivery.status}, attempts {delivery.attempts}/
                {delivery.maxAttempts}
                {delivery.lastError ? ` — ${delivery.lastError}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p>No deliveries configured.</p>
        )}
      </div>
    </>
  );
}

export default async function CatchAllPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parts = (await params).slug ?? [];
  if (parts[0] !== "app") {
    const key = resolvePublicRoute(parts);
    if (!key) notFound();
    const content = publicContent[key];
    if (content) return <PublicPage content={content} />;
    const builder = builderContent[key];
    if (!builder) notFound();
    return (
      <PublicPage
        content={{
          title: builder[0],
          intro: builder[1],
          points: [
            [
              "Configuration-aware",
              "Generated prompts include the actual local endpoint, fields, origin, and success behavior.",
            ],
            [
              "Accessible",
              "Guidance requires labels, keyboard operation, status announcements, and focus management.",
            ],
            [
              "Phase 3 scope",
              "Test validation and network failure through the local durable ingest path; hosted production ingestion is not bundled.",
            ],
          ],
        }}
      />
    );
  }

  const resolved = resolveAppRoute(parts);
  if (!resolved) notFound();
  const session = await requireSession();
  const workspaces = await repository.listWorkspaces(session.userId);
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace)
    return (
      <div className="container page">
        <h1>Create a workspace</h1>
        <p>Your account has no workspace yet.</p>
      </div>
    );
  const forms = await repository.listForms(session.userId, workspace.id);

  if (resolved.kind === "submission") {
    const detail = await submissionStore().getSubmission(
      session.userId,
      workspace.id,
      resolved.submissionId,
    );
    if (!detail) notFound();
    return (
      <div className="container shell">
        <AppNavigation workspaces={workspaces} currentWorkspaceId={workspace.id} />
        <section>
          <p className="eyebrow">{workspace.name} / Submissions</p>
          <h1>Submission detail</h1>
          <SubmissionDetail detail={detail} />
        </section>
      </div>
    );
  }

  if (resolved.kind === "form") {
    const form = await repository.getForm(session.userId, workspace.id, resolved.formId);
    if (!form) notFound();
    const endpoint = publicEndpoint(
      process.env.NEXT_PUBLIC_INGEST_URL || "http://localhost:3001",
      form.endpointKey,
    );
    const selectedPlatform = integrationPlatforms.includes(
      form.platform as (typeof integrationPlatforms)[number],
    )
      ? (form.platform as (typeof integrationPlatforms)[number])
      : "html";
    const prompt = integrationCopilotPrompt(selectedPlatform, {
      endpoint,
      fields: form.fields,
      allowedDomains: form.allowedOrigins,
      successRedirect: form.successRedirect,
      honeypotField: form.honeypotField,
    });
    const formSubmissions =
      resolved.route === "submissions"
        ? await submissionStore().listSubmissions(session.userId, workspace.id, { formId: form.id })
        : null;
    return (
      <div className="container shell">
        <AppNavigation workspaces={workspaces} currentWorkspaceId={workspace.id} />
        <section>
          <p className="eyebrow">{workspace.name} / Forms</p>
          <h1>{form.name}</h1>
          <FormNavigation formId={form.id} />
          {formSubmissions ? (
            <SubmissionList
              items={formSubmissions.items}
              nextCursor={formSubmissions.nextCursor}
              forms={forms}
              exportQuery={new URLSearchParams({ formId: form.id }).toString()}
            />
          ) : (
            <FormRouteContent
              route={resolved.route}
              form={form}
              endpoint={endpoint}
              prompt={prompt}
            />
          )}
        </section>
      </div>
    );
  }

  const route = resolved.route;
  let content: React.ReactNode;
  if (route === "app" || route === "app/forms") content = <FormList forms={forms} />;
  else if (route === "app/submissions") {
    const query = await searchParams;
    const first = (value: string | string[] | undefined) =>
      typeof value === "string" ? value : undefined;
    const page = await submissionStore().listSubmissions(session.userId, workspace.id, {
      ...(first(query.formId) ? { formId: first(query.formId)! } : {}),
      ...(first(query.status)
        ? { status: first(query.status) as "new" | "viewed" | "resolved" | "spam" | "deleted" }
        : {}),
      ...(first(query.spam)
        ? { spamStatus: first(query.spam) as "allowed" | "review" | "blocked" }
        : {}),
      ...(first(query.search) ? { search: first(query.search)! } : {}),
      ...(first(query.from) ? { from: new Date(`${first(query.from)}T00:00:00.000Z`) } : {}),
      ...(first(query.to) ? { to: new Date(`${first(query.to)}T23:59:59.999Z`) } : {}),
      ...(first(query.cursor) ? { cursor: first(query.cursor)! } : {}),
    });
    const exportParams = new URLSearchParams();
    for (const key of ["formId", "status", "spam", "search", "from", "to"] as const) {
      const value = first(query[key]);
      if (value) exportParams.set(key, value);
    }
    content = (
      <SubmissionList
        items={page.items}
        nextCursor={page.nextCursor}
        forms={forms}
        exportQuery={exportParams.toString()}
      />
    );
  } else if (route === "app/settings/security") {
    const sessions = await repository.listSessions(session.userId);
    content = (
      <div className="card">
        <h2>Device sessions</h2>
        {sessions.map((device) => (
          <div key={device.id} className="session-row">
            <p>
              <strong>{device.deviceLabel}</strong>
              {device.id === session.sessionId ? " (current)" : ""}
              <br />
              <small>Last active {new Date(device.lastSeenAt).toLocaleString()}</small>
            </p>
            <form action={revokeDeviceSession}>
              <input type="hidden" name="sessionId" value={device.id} />
              <button className="button secondary" type="submit">
                Revoke
              </button>
            </form>
          </div>
        ))}
      </div>
    );
  } else {
    const states: Record<
      Exclude<typeof route, "app" | "app/forms" | "app/settings/security">,
      [string, string]
    > = {
      "app/health": [
        "Health",
        "Operational endpoints exist, but scheduled external form monitoring is unavailable.",
      ],
      "app/integrations": [
        "Integrations",
        "Signed webhooks and durable local captures are implemented. Transactional email, OAuth, and hosted provider adapters remain unavailable.",
      ],
      "app/team": [
        "Team",
        "Workspace membership foundations are active. Invitation delivery is unavailable without an email adapter.",
      ],
      "app/usage": [
        "Usage",
        "Plan limits are defined, but hosted submission metering does not run in Phase 3.",
      ],
      "app/billing": [
        "Billing",
        "Checkout, invoices, and payment-provider operations are unavailable in Phase 3.",
      ],
      "app/settings": [
        "Settings",
        "Account, security, API-key, and audit foundations are separated into explicit settings routes.",
      ],
      "app/settings/api-keys": [
        "API keys",
        "API-key storage foundations exist, but issuance and hosted API authentication are unavailable.",
      ],
      "app/settings/audit-log": [
        "Audit log",
        "No durable application audit events are produced by the local Phase 3 adapter.",
      ],
    };
    const [title, body] = states[route];
    content = (
      <div className="card">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    );
  }
  return (
    <div className="container shell">
      <AppNavigation workspaces={workspaces} currentWorkspaceId={workspace.id} />
      <section>
        <p className="eyebrow">{workspace.name}</p>
        <h1>{route === "app" ? "Overview" : route.split("/").at(-1)?.replaceAll("-", " ")}</h1>
        {content}
      </section>
    </div>
  );
}
