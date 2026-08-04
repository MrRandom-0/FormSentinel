import {
  LocalPrivateStorage,
  UnavailablePrivateStorage,
  type PrivateStorage,
} from "@formsentinel/storage";
import {
  createLocalDurableSubmissionStore,
  PostgresDurableSubmissionStore,
  type DurableSubmissionStore,
} from "@formsentinel/submissions";
import {
  createLocalDevelopmentRepository,
  type LocalDevelopmentRepository,
} from "@formsentinel/database";
const globalRepository = globalThis as unknown as {
  formSentinelRepository?: LocalDevelopmentRepository;
  formSentinelSubmissionStore?: DurableSubmissionStore;
  formSentinelPrivateStorage?: PrivateStorage;
};
function getRepository(): LocalDevelopmentRepository {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Production web auth/control-plane adapter is unavailable; local JSON fallback is forbidden.",
    );
  if (!globalRepository.formSentinelRepository)
    globalRepository.formSentinelRepository = createLocalDevelopmentRepository();
  return globalRepository.formSentinelRepository;
}
export const repository = new Proxy({} as LocalDevelopmentRepository, {
  get(_target, property) {
    const instance = getRepository();
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
export function privateStorage(): PrivateStorage {
  if (!globalRepository.formSentinelPrivateStorage) {
    const environment = process.env.NODE_ENV || "development";
    globalRepository.formSentinelPrivateStorage =
      environment === "production"
        ? new UnavailablePrivateStorage()
        : new LocalPrivateStorage(
            process.env.FORMSENTINEL_LOCAL_STORAGE_DIR || ".formsentinel/files",
            environment as "development" | "test",
          );
  }
  return globalRepository.formSentinelPrivateStorage;
}

export function submissionStore(): DurableSubmissionStore {
  if (!globalRepository.formSentinelSubmissionStore) {
    const adapter = process.env.FORMSENTINEL_DATA_ADAPTER ?? "local";
    if (adapter === "postgres") {
      if (!process.env.DATABASE_URL)
        throw new Error("DATABASE_URL is required for PostgreSQL submissions.");
      globalRepository.formSentinelSubmissionStore = new PostgresDurableSubmissionStore(
        process.env.DATABASE_URL,
      );
    } else globalRepository.formSentinelSubmissionStore = createLocalDurableSubmissionStore();
  }
  return globalRepository.formSentinelSubmissionStore;
}
