import { requireSession } from "../../../../../../lib/session";
import { privateStorage, repository, submissionStore } from "../../../../../../lib/repository";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ submissionId: string; fileId: string }> },
) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) return new Response("Not found", { status: 404 });
  await repository.requireAccess(session.userId, workspace.id, "submissions:read");
  const values = await params;
  const detail = await submissionStore().getSubmission(
    session.userId,
    workspace.id,
    values.submissionId,
  );
  const file = detail?.submission.files.find((item) => item.id === values.fileId);
  if (!file) return new Response("Not found", { status: 404 });
  if (file.scanState !== "clean" || file.quarantineState !== "released")
    return new Response("File remains quarantined", { status: 423 });
  let bytes: Uint8Array;
  try {
    bytes = await privateStorage().readAuthorized(file.storageKey);
  } catch {
    return new Response("Private file storage is unavailable", { status: 503 });
  }
  const filename =
    file.originalFilename.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "download";
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "content-type": file.detectedType,
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
