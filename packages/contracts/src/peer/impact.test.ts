import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PeerImpactView, PeerImpactFootprint } from "./impact.ts";
describe("impact Hub wire contract", () => {
  it("decodes an authoritative view without exposing uses or source data", () => {
    const side = {
      session: "claude:a",
      email: "ana@test",
      environment: "laptop",
      label: "Task A",
      task: "a",
    };
    const input = {
      records: [
        {
          id: "abcd12345678",
          project: "app",
          sides: [side, { ...side, session: "codex:b", email: "bob@test", task: "b" }],
          items: [
            {
              name: "formatPrice",
              path: "src/money.ts",
              change: "signature",
              changer: "claude:a",
              from: [{ name: "receiptLine", path: "src/receipt.ts" }],
            },
          ],
          state: "open",
          reopened: false,
          openedAt: "2026-10-09T12:00:00Z",
          updatedAt: "2026-10-09T12:00:00Z",
          live: true,
        },
      ],
      provided: [
        {
          project: "app",
          side,
          name: "formatPrice",
          path: "src/money.ts",
          change: "signature",
          rev: 2,
          changedAt: "2026-10-09T12:00:00Z",
        },
      ],
    } as const;
    const value = Schema.decodeSync(PeerImpactView)(input);
    expect(Schema.encodeSync(PeerImpactView)(value)).toEqual(input);
    expect(JSON.stringify(value)).not.toMatch(/uses|source|startLine|endLine/);
  });
  it("enforces symbol budgets without adding source metadata", () => {
    const footprint = {
      session: "claude:a",
      project: "app",
      changed: [{ name: "price", path: "src/money.ts", change: "body", rev: 1, provided: false }],
      uses: [],
    } as const;
    expect(Schema.decodeSync(PeerImpactFootprint)(footprint)).toEqual(footprint);
    expect(() =>
      Schema.decodeSync(PeerImpactFootprint)({
        ...footprint,
        changed: Array.from({ length: 41 }, () => footprint.changed[0]!),
      }),
    ).toThrow();
  });
});
