export interface SpamContext {
  payload: Readonly<Record<string, unknown>>;
  honeypotField: string;
  now?: number;
  signedStartedAt?: number | null;
  timestampValid?: boolean;
  originMismatch?: boolean;
  sourceVelocity?: number;
  repeatedFingerprint?: boolean;
  userAgent?: string | null;
  captchaValid?: boolean | null;
  blockedPhrases?: readonly string[];
  disposableEmail?: boolean;
}
export interface SpamDecision {
  verdict: "allow" | "review" | "block";
  score: number;
  reasons: readonly string[];
}
export interface SpamEvaluator {
  evaluate(context: SpamContext): Promise<SpamDecision>;
}

export function deterministicSpam(context: SpamContext): SpamDecision {
  const reasons: string[] = [];
  let score = 0;
  const values = Object.values(context.payload).filter(
    (value): value is string => typeof value === "string",
  );
  const combined = values.join(" ").toLowerCase();
  const signal = (condition: boolean, reason: string, weight: number) => {
    if (condition) {
      reasons.push(reason);
      score += weight;
    }
  };
  signal(Boolean(context.payload[context.honeypotField]), "honeypot_filled", 100);
  signal(context.timestampValid === false, "invalid_start_timestamp", 35);
  signal(
    Boolean(
      context.signedStartedAt && (context.now ?? Date.now()) - context.signedStartedAt < 1_500,
    ),
    "submitted_too_fast",
    30,
  );
  signal((combined.match(/https?:\/\//g) ?? []).length > 4, "excessive_links", 30);
  signal(
    values.some((value) => /(.)\1{11,}/i.test(value)),
    "repeated_characters",
    20,
  );
  signal(
    values.length > 1 && new Set(values.map((value) => value.trim().toLowerCase())).size === 1,
    "repeated_content",
    15,
  );
  signal(
    (context.blockedPhrases ?? []).some(
      (phrase) => phrase && combined.includes(phrase.toLowerCase()),
    ),
    "blocked_phrase",
    60,
  );
  signal(context.disposableEmail === true, "disposable_email", 20);
  signal(context.originMismatch === true, "origin_mismatch", 40);
  signal((context.sourceVelocity ?? 0) > 10, "source_velocity", 35);
  signal(context.repeatedFingerprint === true, "repeated_fingerprint", 20);
  signal(
    !context.userAgent || /curl|wget|python|scrapy|bot/i.test(context.userAgent),
    "suspicious_user_agent",
    10,
  );
  signal(context.captchaValid === false, "invalid_captcha", 80);
  score = Math.min(100, score);
  return { verdict: score >= 80 ? "block" : score >= 30 ? "review" : "allow", score, reasons };
}

export class HoneypotEvaluator implements SpamEvaluator {
  async evaluate(context: SpamContext): Promise<SpamDecision> {
    return deterministicSpam(context);
  }
}
