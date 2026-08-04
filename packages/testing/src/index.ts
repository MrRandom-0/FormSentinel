export function uniqueTestEmail(prefix = "user"): string {
  return `${prefix}-${crypto.randomUUID()}@example.test`;
}
export class FixedClock {
  constructor(readonly value: Date) {}
  now(): Date {
    return new Date(this.value);
  }
}
