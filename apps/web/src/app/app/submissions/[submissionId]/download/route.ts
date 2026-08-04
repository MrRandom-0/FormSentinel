import { requireSession } from "../../../../../lib/session";
import { repository, submissionStore } from "../../../../../lib/repository";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) return new Response("Not found", { status: 404 });
  await repository.requireAccess(session.userId, workspace.id, "submissions:export");
  const detail = await submissionStore().getSubmission(
    session.userId,
    workspace.id,
    (await params).submissionId,
  );
  if (!detail) return new Response("Not found", { status: 404 });
  const { submission, events, deliveries } = detail;
  const body = JSON.stringify(
    {
      id: submission.id,
      form_id: submission.formId,
      fields: submission.payload,
      status: submission.status,
      spam: {
        status: submission.spamStatus,
        score: submission.spamScore,
        reasons: submission.spamReasons,
      },
      source: { origin: submission.origin, referrer: submission.referrer, utm: submission.utm },
      schema_version: submission.schemaVersion,
      files: submission.files.map((file) => ({
        id: file.id,
        field: file.fieldName,
        filename: file.originalFilename,
        type: file.detectedType,
        size: file.byteSize,
        scan_status: file.scanState,
      })),
      events: events.map((event) => ({ type: event.type, at: event.createdAt })),
      deliveries: deliveries.map((delivery) => ({
        type: delivery.destinationType,
        status: delivery.status,
        attempts: delivery.attempts,
      })),
      created_at: submission.createdAt,
    },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="submission-${submission.id}.json"`,
      "cache-control": "no-store",
    },
  });
}
