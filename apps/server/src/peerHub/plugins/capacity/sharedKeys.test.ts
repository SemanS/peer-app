import { describe, expect, it } from "vite-plus/test";
import { planSharedKeys } from "./sharedKeys.ts";
const now = Date.parse("2026-10-09T00:00:00Z");
const key = (project: string, keyRef: string, expiresAt?: string) => ({
  project,
  environment: "laptop",
  keyRef,
  issuedAt: "2026-09-20",
  ...(expiresAt ? { expiresAt } : {}),
});
describe("shared key reconciliation", () => {
  it("rotates at seven days or sooner, never keys from an older Hub", () => {
    const plan = planSharedKeys(
      { pay: { keyRef: "a" }, ops: { keyRef: "b" }, legacy: { keyRef: "c" } },
      [
        key("pay", "a", "2026-10-16T00:00:00Z"),
        key("ops", "b", "2026-10-17T00:00:00Z"),
        key("legacy", "c"),
      ],
      "laptop",
      now,
    );
    expect(plan.rotate).toEqual(["pay"]);
    expect(plan.drop).toEqual([]);
    expect(planSharedKeys({ pay: { keyRef: "a" } }, undefined, "laptop", now)).toEqual({
      rotate: [],
      drop: [],
      adopt: {},
    });
  });
  it("drops revoked references without silently adopting another environment's key", () => {
    expect(
      planSharedKeys(
        { pay: { keyRef: "old" }, ops: {} },
        [key("pay", "new"), { ...key("ops", "b"), environment: "phone" }],
        "laptop",
        now,
      ).drop,
    ).toEqual(["pay", "ops"]);
  });
  it("adopts an existing provider's matching environment key and can rotate it", () => {
    const plan = planSharedKeys(
      { pay: {} },
      [key("pay", "a", "2026-10-10T00:00:00Z")],
      "laptop",
      now,
    );
    expect(plan.adopt.pay).toEqual({ keyRef: "a", expiresAt: "2026-10-10T00:00:00Z" });
    expect(plan.rotate).toEqual(["pay"]);
  });
  it("malformed expiry never triggers a rotation loop", () => {
    expect(
      planSharedKeys({ pay: { keyRef: "a" } }, [key("pay", "a", "invalid")], "laptop", now).rotate,
    ).toEqual([]);
  });
});
