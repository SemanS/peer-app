import { describe, expect, it } from "@effect/vitest";
import { leaseSeconds, resourceName } from "./cli.ts";
describe("resource CLI input", () => {
  it("normalizes names without accepting paths or malformed scope names", () => {
    expect(resourceName("resource:DEPLOY:Staging")).toBe("deploy:staging");
    for (const bad of [
      "resource:",
      "resource:/a",
      "resource:_a",
      "resource:a b",
      "resource:" + "a".repeat(65),
    ])
      expect(() => resourceName(bad)).toThrow();
  });
  it("accepts whole seconds, minutes and hours only within lease bounds", () => {
    for (const [input, seconds] of [
      [undefined, 1800],
      ["60s", 60],
      ["30m", 1800],
      ["8h", 28800],
    ] as const)
      expect(leaseSeconds(input)).toBe(seconds);
    for (const bad of ["59s", "9h", "1.5h", "60", "-1m", "1d", "0m", "1hfoo"])
      expect(() => leaseSeconds(bad)).toThrow();
  });
});
