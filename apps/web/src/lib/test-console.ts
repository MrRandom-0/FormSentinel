import { DevelopmentTestConsole } from "@formsentinel/test-console";
const globalConsole = globalThis as unknown as { formSentinelConsole?: DevelopmentTestConsole };
function getConsole(): DevelopmentTestConsole {
  if (!globalConsole.formSentinelConsole)
    globalConsole.formSentinelConsole = new DevelopmentTestConsole(
      process.env.NODE_ENV === "production"
        ? "production"
        : process.env.NODE_ENV === "test"
          ? "test"
          : "development",
    );
  return globalConsole.formSentinelConsole;
}
export const testConsole = new Proxy({} as DevelopmentTestConsole, {
  get(_target, property) {
    const instance = getConsole();
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
