export interface FormSentinelClientOptions {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export interface SubmitOptions {
  idempotencyKey?: string;
  requestId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface SubmissionSuccess {
  success: true;
  submission_id: string;
  request_id: string;
  message: string;
}
export interface SubmissionErrorBody {
  success: false;
  request_id: string;
  error: { code: string; message: string; fields?: Record<string, string> };
}
export class FormSentinelError extends Error {
  constructor(
    readonly status: number,
    readonly response: SubmissionErrorBody,
  ) {
    super(response.error.message);
    this.name = "FormSentinelError";
  }
}
export class FormSentinelClient {
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: FormSentinelClientOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async submit(
    fields: Readonly<Record<string, string | number | boolean>> | FormData,
    options: SubmitOptions = {},
  ): Promise<SubmissionSuccess> {
    const headers = new Headers();
    let body: BodyInit;
    if (fields instanceof FormData) body = fields;
    else {
      headers.set("content-type", "application/json");
      body = JSON.stringify(fields);
    }
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
    if (options.requestId) headers.set("x-request-id", options.requestId);
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.options.timeoutMs ?? 10_000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await this.fetcher(this.options.endpoint, {
      method: "POST",
      headers,
      body,
      signal,
    });
    let payload: SubmissionSuccess | SubmissionErrorBody;
    try {
      payload = (await response.json()) as SubmissionSuccess | SubmissionErrorBody;
    } catch {
      payload = {
        success: false,
        request_id: response.headers.get("x-request-id") ?? "unknown",
        error: {
          code: "invalid_response",
          message: "The submission service returned an invalid response.",
        },
      };
    }
    if (!response.ok) {
      const errorPayload: SubmissionErrorBody = payload.success
        ? {
            success: false,
            request_id: payload.request_id,
            error: { code: "http_error", message: "The submission request failed." },
          }
        : payload;
      throw new FormSentinelError(response.status, errorPayload);
    }
    if (!payload.success) throw new FormSentinelError(response.status, payload);
    return payload;
  }
}
