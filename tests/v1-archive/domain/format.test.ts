import { describe, expect, it } from "vitest";
import { formatMoney, formatMinutes, formatUtc } from "@/lib/format";
describe("financial display boundaries", () => {
  it("formats integer cents without dropping partial dollars", () => {
    expect(formatMoney(3_000_000)).toBe("$30,000");
    expect(formatMoney(62_500)).toBe("$625");
    expect(formatMoney(62_501)).toBe("$625.01");
    expect(formatMoney(-500)).toBe("-$5");
    expect(() => formatMoney(1.1)).toThrow();
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it("shows explicit UTC regardless of machine timezone", () => {
    expect(formatUtc(Date.UTC(2026, 0, 12))).toBe("12 Jan 2026, 00:00 UTC");
    expect(() => formatUtc(NaN)).toThrow();
  });
  it("preserves minutes and rejects invalid durations", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(() => formatMinutes(-1)).toThrow();
    expect(() => formatMinutes(1.5)).toThrow();
  });
});
