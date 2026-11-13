import { repository, submissionStore } from "../../../../lib/repository";
import { requireSession } from "../../../../lib/session";
import {
  buildSubmissionsCsv,
  buildSubmissionsJsonExport,
  collectSubmissionsForExport,
  parseSubmissionExportFilter,
} from "../../../../lib/submission-export";

/**
 * Filtered bulk export of the submissions inbox (CSV by default, JSON with
 * ?format=json). Accepts the same filter parameters as the submissions list
 * page and requires the same `submissions:export` permission as the
 * single-submission downloads.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) return new Response("Not found", { status: 404 });
  await repository.requireAccess(session.userId, workspace.id, "submissions:export");
  const url = new URL(request.url);
  const filter = parseSubmissionExportFilter(url.searchParams);
  const { items, truncated } = await collectSubmissionsForExport(
    submissionStore(),
    session.userId,
    workspace.id,
    filter,
  );
  const forms = await repository.listForms(session.userId, workspace.id);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (truncated) headers["x-export-truncated"] = "true";
  if (url.searchParams.get("format") === "json") {
    const body = buildSubmissionsJsonExport(items, forms, {
      exportedAt: new Date().toISOString(),
      truncated,
    });
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="submissions-${stamp}.json"`,
      },
    });
  }
  return new Response(buildSubmissionsCsv(items, forms), {
    headers: {
      ...headers,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="submissions-${stamp}.csv"`,
    },
  });
}
