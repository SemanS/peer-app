import { describe, expect, it } from "vite-plus/test";
import { sessionView, impactView } from "./fixtures.test.ts";
import { tell, resetTold } from "./tell.ts";
const side = {
  session: "claude:a",
  email: "ana@test",
  environment: "a",
  label: "Work A",
  task: "a",
};

describe("impact advice once", () => {
  it("keeps absent explicit-read baselines in Hub time even when the device is ten hours ahead", () => {
    const reader = sessionView({
        id: "codex:b",
        agent: "codex",
        project: "p",
        contextReads: [
          {
            scope: "task:a",
            version: 1,
            text: "## Provides\n- `price` (money.ts): values in cents",
          },
        ],
      }),
      deviceNow = Date.parse("2026-10-09T22:00:00Z"),
      provided = {
        project: "p",
        side,
        name: "price",
        path: "money.ts",
        change: "signature" as const,
        rev: 1,
        changedAt: "2026-10-09T12:01:00Z",
      };
    expect(tell(reader, { records: [], provided: [] }, "ready", deviceNow, false)).toBeNull();
    expect(
      tell(reader, { records: [], provided: [provided] }, "ready", deviceNow, false),
    ).toContain("values in cents");
    expect(
      tell(reader, { records: [], provided: [provided] }, "ready", deviceNow, false),
    ).toBeNull();
  });
  it("tells both sides once, stronger severity again, compact resets, and is silent for inactive facts and wakes", () => {
    const a = sessionView({ id: "claude:a", project: "p" }),
      b = sessionView({ id: "codex:b", project: "p", agent: "codex" });
    expect(tell(a, impactView, "ready", 0, false)).toContain("record its contract");
    expect(tell(b, impactView, "ready", 0, false)).toContain("Check your use");
    expect(tell(a, impactView, "ready", 1, false)).toBeNull();
    const stronger = {
      ...impactView,
      records: impactView.records.map((r) => ({
        ...r,
        items: r.items.map((i) => ({ ...i, change: "removed" as const })),
      })),
    };
    expect(tell(a, stronger, "ready", 2, false)).toContain("removed");
    resetTold(a);
    expect(tell(a, stronger, "ready", 3, false)).not.toBeNull();
    resetTold(a);
    for (const records of [
      impactView.records.map((r) => ({ ...r, live: false })),
      impactView.records.map((r) => ({ ...r, state: "dismissed" as const })),
    ])
      expect(tell(a, { ...impactView, records }, "ready", 4, false)).toBeNull();
    expect(tell(a, impactView, "ready", 4, true)).toBeNull();
    expect(tell({ ...a, adapter: "mcp" }, impactView, "ready", 4, false)).toBeNull();
    expect(tell({ ...a, agent: "cursor" }, impactView, "ready", 4, false)).toBeNull();
  });
  it("teaches only a keeping usable session and gives reader notices only after the explicit read baseline", () => {
    const keeper = sessionView({ id: "claude:a", keeps: true, project: "p" });
    expect(tell(keeper, { records: [], provided: [] }, "uninitialized", 0, false)).toBeNull();
    expect(tell(keeper, { records: [], provided: [] }, "ready", 0, false)).toContain(
      "list interfaces",
    );
    expect(tell(keeper, { records: [], provided: [] }, "ready", 1, false)).toBeNull();
    const reader = sessionView({
        id: "codex:b",
        agent: "codex",
        project: "p",
        contextReads: [
          {
            scope: "task:a",
            version: 1,
            text: "## Provides\n- `price` (money.ts): values in cents",
          },
        ],
      }),
      provided = {
        project: "p",
        side,
        name: "price",
        path: "money.ts",
        change: "signature" as const,
        rev: 1,
        changedAt: "2026-10-09T12:00:00Z",
      };
    expect(
      tell(
        reader,
        { records: [], provided: [provided] },
        "missing",
        Date.parse(provided.changedAt),
        false,
      ),
    ).toBeNull();
    const next = { ...provided, rev: 2, changedAt: "2026-10-09T12:01:00Z" };
    expect(
      tell(reader, { records: [], provided: [next] }, "missing", Date.parse(next.changedAt), false),
    ).toContain("values in cents");
    expect(
      tell(reader, { records: [], provided: [next] }, "missing", Date.parse(next.changedAt), false),
    ).toBeNull();
  });
});
