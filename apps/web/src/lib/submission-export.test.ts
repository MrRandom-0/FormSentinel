import type { SubmissionFilter, SubmissionPage, SubmissionRecord } from "@formsentinel/submissions";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_EXPORT_SUBMISSIONS,
  buildSubmissionsCsv,
  buildSubmissionsJsonExport,
  collectSubmissionsForExport,
  parseSubmissionExportFilter,
} from "./submission-export";

const forms = [
  { id: "form-1", name: "Contact" },
  { id: "form-2", name: "Waitlist" },
];

function record(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id: "sub-1",
    requestId: "req-1",
    formId: "form-1",
    workspaceId: "ws-1",
    payload: { email: "ada@example.com", message: "Hello" },
    contentType: "application/json",
    payloadBytes: 128,
    schemaVersion: 1,
    sourceIpHash: "hash",
    userAgent: null,
    origin: null,
    referrer: null,
    utm: {},
    status: "new",
    previousStatus: null,
    spamStatus: "allowed",
    spamScore: 0,
    spamReasons: [],
    test: false,
    processingState: "processed",
    notificationState: "captured_local",
    webhookState: "captured_local",
    idempotencyKey: null,
    requestFingerprint: "fp",
    probableDuplicate: false,
    duplicateOfId: null,
    retentionUntil: null,
    tags: [],
    files: [],
    createdAt: "2026-11-10T10:00:00.000Z",
    updatedAt: "2026-11-10T10:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("parseSubmissionExportFilter", () => {
  it("maps inbox parameters to a store filter", () => {
    const filter = parseSubmissionExportFilter(
      new URLSearchParams(
        "formId=form-2&status=spam&spam=blocked&search=ada&from=2026-11-01&to=2026-11-30",
      ),
    );
    expect(filter).toEqual({
      formId: "form-2",
      status: "spam",
      spamStatus: "blocked",
      search: "ada",
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-11-30T23:59:59.999Z"),
    });
  });

  it("ignores unknown statuses and unparseable dates instead of failing", () => {
    const filter = parseSubmissionExportFilter(
      new URLSearchParams("status=bogus&spam=maybe&from=not-a-date&search=%20%20"),
    );
    expect(filter).toEqual({});
  });
});

describe("buildSubmissionsCsv", () => {
  it("emits metadata columns then the union of payload keys in first-seen order", () => {
    const csv = buildSubmissionsCsv(
      [
        record(),
        record({
          id: "sub-2",
          formId: "form-2",
          createdAt: "2026-11-11T09:30:00.000Z",
          status: "spam",
          spamStatus: "blocked",
          spamScore: 87,
          probableDuplicate: true,
          payload: { email: "bot@example.net", topics: ["pricing", "demo"] },
        }),
      ],
      forms,
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      '"submitted_at","form","status","spam_status","spam_score","processing_state","probable_duplicate","email","message","topics"',
    );
    expect(lines[1]).toBe(
      '"2026-11-10T10:00:00.000Z","Contact","new","allowed","0","processed","no","ada@example.com","Hello",""',
    );
    expect(lines[2]).toBe(
      '"2026-11-11T09:30:00.000Z","Waitlist","spam","blocked","87","processed","yes","bot@example.net","","pricing; demo"',
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("guards spreadsheet formula injection in payload values and field names", () => {
    const csv = buildSubmissionsCsv(
      [record({ payload: { "=cmd": "=2+2", note: "@SUM(1+1)" } })],
      forms,
    );
    expect(csv).toContain('"\'=cmd"');
    expect(csv).toContain('"\'=2+2"');
    expect(csv).toContain('"\'@SUM(1+1)"');
  });

  it("falls back to the form id when the form is unknown", () => {
    const csv = buildSubmissionsCsv([record({ formId: "gone" })], forms);
    expect(csv.split("\r\n")[1]).toContain('"gone"');
  });
});

describe("buildSubmissionsJsonExport", () => {
  it("keeps payloads intact and reports truncation honestly", () => {
    const body = buildSubmissionsJsonExport([record()], forms, {
      exportedAt: "2026-11-13T00:00:00.000Z",
      truncated: true,
    });
    expect(body.count).toBe(1);
    expect(body.truncated).toBe(true);
    expect(body.truncatedNote).toContain(String(MAX_EXPORT_SUBMISSIONS));
    expect(body.submissions[0]).toMatchObject({
      form: "Contact",
      payload: { email: "ada@example.com", message: "Hello" },
    });
  });
});

describe("collectSubmissionsForExport", () => {
  function pagedSource(pages: SubmissionPage[]) {
    let index = 0;
    return {
      listSubmissions: vi.fn(async (): Promise<SubmissionPage> => pages[index++]!),
    };
  }

  it("walks cursors until the filter is exhausted", async () => {
    const source = pagedSource([
      { items: [record({ id: "a" }), record({ id: "b" })], nextCursor: "cursor-2" },
      { items: [record({ id: "c" })], nextCursor: null },
    ]);
    const filter: SubmissionFilter = { formId: "form-1" };
    const result = await collectSubmissionsForExport(source, "user", "ws", filter);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(false);
    expect(source.listSubmissions).toHaveBeenCalledTimes(2);
    expect(source.listSubmissions).toHaveBeenLastCalledWith(
      "user",
      "ws",
      expect.objectContaining({ formId: "form-1", cursor: "cursor-2", limit: 100 }),
    );
  });

  it("stops at the cap and reports truncation", async () => {
    const source = pagedSource([
      {
        items: [record({ id: "a" }), record({ id: "b" }), record({ id: "c" })],
        nextCursor: "more",
      },
    ]);
    const result = await collectSubmissionsForExport(source, "user", "ws", {}, 2);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.truncated).toBe(true);
  });
});
