import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { PeerResourcesList, PeerHeldResource } from "./resources.ts";
import { PeerIntentVerdict } from "../peerHub.ts";
const decodeList = Schema.decodeUnknownSync(PeerResourcesList);
const decodeHold = Schema.decodeUnknownSync(PeerHeldResource);
const decodeVerdict = Schema.decodeUnknownSync(PeerIntentVerdict);
const hold = {
  project: "app",
  kind: "resource",
  name: "deploy:staging",
  holder: { session: "claude:x", email: "ana@example.test", environment: "laptop" },
  intent: "deploying v1.4",
  expiresAt: "2026-10-09T12:30:00Z",
};
describe("leased scope contracts", () => {
  it("decodes the Hub list with required lease expiry and discards future fields", () => {
    const list = {
      held: [hold],
      patterns: { app: [{ pattern: "migrations/**", policy: "exclusive" }] },
      at: "2026-10-09T12:00:00Z",
    };
    expect(decodeList({ ...list, future: true })).toEqual(list);
    const { expiresAt: _, ...missing } = hold;
    expect(() => decodeHold(missing)).toThrow();
  });
  it("keeps older verdicts unchanged and reads the optional leased pattern detail", () => {
    const old = {
      path: "migrations/001.sql",
      verdict: "held",
      with: ["claude:x"],
      overlaps: [],
      holder: "claude:x",
    };
    expect(decodeVerdict({ ...old, future: true })).toEqual(old);
    const current = {
      ...old,
      pattern: "migrations/**",
      policy: "exclusive",
      hold: { ...hold.holder, intent: hold.intent, expiresAt: hold.expiresAt },
    };
    expect(decodeVerdict(current)).toEqual(current);
  });
});
