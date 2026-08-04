import { repository } from "../../../../../../../lib/repository";
import { testConsole } from "../../../../../../../lib/test-console";
import { handleDevelopmentSubmission } from "../../../../../../../lib/development-submission";

const dependencies = {
  environment: process.env.NODE_ENV as "development" | "test" | "production",
  getForm: (publicFormId: string) => repository.getFormByEndpoint(publicFormId),
  capture: (input: Parameters<typeof testConsole.capture>[0]) => testConsole.capture(input),
};

async function handle(request: Request, { params }: { params: Promise<{ publicFormId: string }> }) {
  return handleDevelopmentSubmission(request, (await params).publicFormId, dependencies);
}

export const POST = handle;
export const OPTIONS = handle;
