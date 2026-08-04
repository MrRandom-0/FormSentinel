import { notFound } from "next/navigation";
import { publicEndpoint } from "@formsentinel/forms";
import { requireSession } from "../../../../../lib/session";
import { repository } from "../../../../../lib/repository";
import { TestForm } from "./TestForm";
export default async function TestConsolePage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) notFound();
  const form = await repository.getForm(session.userId, workspace.id, (await params).formId);
  if (!form) notFound();
  const endpoint = publicEndpoint(
    process.env.NEXT_PUBLIC_INGEST_URL || "http://localhost:3001",
    form.endpointKey,
  );
  return (
    <div className="container page">
      <p className="eyebrow">Durable local ingest</p>
      <h1>Test {form.name}</h1>
      <p className="notice">
        This posts to the same durable ingest endpoint used by integrations. Local notification and
        webhook providers are captured explicitly rather than reported as delivered.
      </p>
      <TestForm endpoint={endpoint} fields={form.fields} />
    </div>
  );
}
