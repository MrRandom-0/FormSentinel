import {
  safeCsvCell,
  type SubmissionFilter,
  type SubmissionPage,
  type SubmissionRecord,
  type SubmissionStatus,
} from "@formsentinel/submissions";

/**
 * Bulk submission export. The inbox only offered per-submission CSV/JSON
 * downloads; this module backs the filtered export endpoint so a tenant can
 * take every submission matching the current inbox filters out of the local
 * durable store in one file. The export is deliberately capped — a single
 * request must stay bounded — and reports when the cap cut results short.
 */
export const MAX_EXPORT_SUBMISSIONS = 1000;
const EXPORT_PAGE_SIZE = 100;

export interface SubmissionPageSource {
  listSubmissions(
    userId: string,
    workspaceId: string,
    filter?: SubmissionFilter,
  ): Promise<SubmissionPage>;
}

const STATUSES = ["new", "viewed", "resolved", "spam", "deleted"] as const;
const SPAM_STATUSES = ["allowed", "review", "blocked"] as const;

/** Parse the inbox filter query parameters for an export request. Mirrors the
 * submissions list page parsing; unparseable dates are ignored rather than
 * turning a download into an error. */
export function parseSubmissionExportFilter(params: URLSearchParams): SubmissionFilter {
  const filter: SubmissionFilter = {};
  const formId = params.get("formId");
  if (formId) filter.formId = formId;
  const status = params.get("status");
  if (status && (STATUSES as readonly string[]).includes(status))
    filter.status = status as SubmissionStatus;
  const spam = params.get("spam");
  if (spam && (SPAM_STATUSES as readonly string[]).includes(spam))
    filter.spamStatus = spam as SubmissionRecord["spamStatus"];
  const search = params.get("search")?.trim();
  if (search) filter.search = search;
  const from = params.get("from");
  if (from) {
    const date = new Date(`${from}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) filter.from = date;
  }
  const to = params.get("to");
  if (to) {
    const date = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(date.getTime())) filter.to = date;
  }
  return filter;
}

/** Page through the durable store until the filter is exhausted or the export
 * cap is reached. `truncated` is true when more matches exist beyond the cap. */
export async function collectSubmissionsForExport(
  source: SubmissionPageSource,
  userId: string,
  workspaceId: string,
  filter: SubmissionFilter,
  max: number = MAX_EXPORT_SUBMISSIONS,
): Promise<{ items: SubmissionRecord[]; truncated: boolean }> {
  const items: SubmissionRecord[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await source.listSubmissions(userId, workspaceId, {
      ...filter,
      ...(cursor ? { cursor } : {}),
      limit: EXPORT_PAGE_SIZE,
    });
    for (const item of page.items) {
      if (items.length >= max) return { items, truncated: true };
      items.push(item);
    }
    if (!page.nextCursor) return { items, truncated: false };
    if (items.length >= max) return { items, truncated: true };
    cursor = page.nextCursor;
  }
}

function payloadCell(value: string | number | boolean | string[] | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  return String(value);
}

const META_COLUMNS = [
  "submitted_at",
  "form",
  "status",
  "spam_status",
  "spam_score",
  "processing_state",
  "probable_duplicate",
] as const;

/** CSV with one row per submission: fixed metadata columns, then the union of
 * payload field names across the exported set (first-seen order). Every cell
 * goes through the same spreadsheet-formula guard as the single-submission
 * CSV export. */
export function buildSubmissionsCsv(
  items: readonly SubmissionRecord[],
  forms: readonly { id: string; name: string }[],
): string {
  const formName = (formId: string) => forms.find((form) => form.id === formId)?.name ?? formId;
  const payloadKeys: string[] = [];
  const seen = new Set<string>();
  for (const item of items)
    for (const key of Object.keys(item.payload))
      if (!seen.has(key)) {
        seen.add(key);
        payloadKeys.push(key);
      }
  const header = [...META_COLUMNS, ...payloadKeys];
  const rows = items.map((item) => [
    item.createdAt,
    formName(item.formId),
    item.status,
    item.spamStatus,
    String(item.spamScore),
    item.processingState,
    item.probableDuplicate ? "yes" : "no",
    ...payloadKeys.map((key) => payloadCell(item.payload[key])),
  ]);
  return [header, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
}

/** Structured JSON export object: the same records, with payloads intact. */
export function buildSubmissionsJsonExport(
  items: readonly SubmissionRecord[],
  forms: readonly { id: string; name: string }[],
  meta: { exportedAt: string; truncated: boolean },
) {
  const formName = (formId: string) => forms.find((form) => form.id === formId)?.name ?? formId;
  return {
    exportedAt: meta.exportedAt,
    count: items.length,
    truncated: meta.truncated,
    ...(meta.truncated
      ? { truncatedNote: `Export capped at ${MAX_EXPORT_SUBMISSIONS} submissions.` }
      : {}),
    submissions: items.map((item) => ({
      id: item.id,
      formId: item.formId,
      form: formName(item.formId),
      submittedAt: item.createdAt,
      status: item.status,
      spamStatus: item.spamStatus,
      spamScore: item.spamScore,
      processingState: item.processingState,
      probableDuplicate: item.probableDuplicate,
      payload: item.payload,
    })),
  };
}
