export interface CaptchaVerification {
  success: boolean;
  errorCodes: readonly string[];
}

export interface CaptchaVerifier {
  readonly provider: string;
  verify(token: string, remoteAddress?: string): Promise<CaptchaVerification>;
}

export class TurnstileVerifier implements CaptchaVerifier {
  readonly provider = "turnstile";
  constructor(
    private readonly secret: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly timeoutMs = 3_000,
  ) {}

  async verify(token: string, remoteAddress?: string): Promise<CaptchaVerification> {
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteAddress) body.set("remoteip", remoteAddress);
    try {
      const response = await this.fetcher(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!response.ok) return { success: false, errorCodes: ["provider_unavailable"] };
      const result = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
      return { success: result.success === true, errorCodes: result["error-codes"] ?? [] };
    } catch {
      return { success: false, errorCodes: ["provider_unavailable"] };
    }
  }
}

export class DevelopmentCaptchaVerifier implements CaptchaVerifier {
  readonly provider = "development";
  constructor(environment: "development" | "test" | "production") {
    if (environment === "production")
      throw new Error("Development CAPTCHA verifier is forbidden in production.");
  }
  async verify(token: string): Promise<CaptchaVerification> {
    return token === "formsentinel-test-pass"
      ? { success: true, errorCodes: [] }
      : { success: false, errorCodes: ["invalid_test_token"] };
  }
}
