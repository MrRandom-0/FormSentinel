export const developmentPipelineStages = [
  "received",
  "validated",
  "spam-passed",
  "saved",
  "notification-queued",
  "delivered",
] as const;
export type DevelopmentPipelineStage = (typeof developmentPipelineStages)[number];
export interface CapturedMessage {
  id: string;
  kind: "email" | "webhook" | "submission";
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
  stages: readonly DevelopmentPipelineStage[];
  adapter: "development";
}
export interface TestConsoleAdapter {
  capture(
    message: Omit<CapturedMessage, "id" | "createdAt" | "stages" | "adapter">,
  ): Promise<CapturedMessage>;
  list(): Promise<readonly CapturedMessage[]>;
  clear(): Promise<void>;
}
export class DevelopmentTestConsole implements TestConsoleAdapter {
  private readonly messages: CapturedMessage[] = [];
  constructor(environment: "development" | "test" | "production") {
    if (environment === "production")
      throw new Error("The development test console is disabled in production.");
  }
  async capture(
    message: Omit<CapturedMessage, "id" | "createdAt" | "stages" | "adapter">,
  ): Promise<CapturedMessage> {
    const captured: CapturedMessage = {
      ...message,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      stages: developmentPipelineStages,
      adapter: "development",
    };
    this.messages.unshift(captured);
    return captured;
  }
  async list(): Promise<readonly CapturedMessage[]> {
    return this.messages;
  }
  async clear(): Promise<void> {
    this.messages.length = 0;
  }
}
