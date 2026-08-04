export type ProviderAvailability = { available: true } | { available: false; reason: string };

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  availability(): ProviderAvailability;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export interface OAuthIdentity {
  providerAccountId: string;
  email: string;
  displayName: string | null;
}

export interface OAuthProvider {
  readonly id: "github" | "google";
  availability(): ProviderAvailability;
  authorizationUrl(state: string, redirectUri: string): Promise<string>;
  exchange(code: string, redirectUri: string): Promise<OAuthIdentity>;
}

export interface SubmissionDeliveryProvider {
  readonly channel: "email" | "webhook";
  availability(): ProviderAvailability;
  deliver(payload: unknown, destination: string): Promise<{ deliveryId: string }>;
}

export class UnavailableEmailProvider implements EmailProvider {
  readonly name = "unconfigured";
  availability(): ProviderAvailability {
    return { available: false, reason: "No transactional email provider adapter is configured." };
  }
  async send(_message: EmailMessage): Promise<{ messageId: string }> {
    throw new Error("Email delivery is unavailable because no provider adapter is implemented.");
  }
}

export function oauthAvailability(
  provider: "github" | "google",
  _environment: Record<string, string | undefined>,
): ProviderAvailability {
  return {
    available: false,
    reason: `${provider} OAuth credentials are reserved; no OAuth adapter is configured.`,
  };
}
