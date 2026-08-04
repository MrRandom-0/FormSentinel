import { safeCsvCell } from "@formsentinel/submissions";
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
  const names = Object.keys(detail.submission.payload);
  const csv = `${names.map(safeCsvCell).join(",")}\r\n${names.map((name) => safeCsvCell(detail.submission.payload[name])).join(",")}\r\n`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="submission-${detail.submission.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
