import { readServerEnvironment } from "@formsentinel/config";
import { LocalDevelopmentRepository } from "./index";
const environment = readServerEnvironment();
if (environment.NODE_ENV === "production" || environment.FORMSENTINEL_DATA_ADAPTER !== "local")
  throw new Error("Seed is available only with the local development adapter.");
const repository = new LocalDevelopmentRepository(
  environment.FORMSENTINEL_LOCAL_DATA_FILE,
  environment.NODE_ENV,
);
const email = `developer-${Date.now()}@example.test`;
const registration = await repository.register({
  name: "Local Developer",
  email,
  password: "development-password-only",
});
await repository.verifyEmail(registration.verificationToken);
const workspace = await repository.createWorkspace(registration.userId, "Local Demo");
await repository.saveOnboarding(registration.userId, {
  workspaceId: workspace.id,
  useCase: "local evaluation",
  currentStep: 2,
});
console.log(`Seeded local account ${email} in ${environment.FORMSENTINEL_LOCAL_DATA_FILE}`);
