import { describe, expect, it } from "vite-plus/test";
import { createOutbox, type Declaration } from "./hub.ts";

const declaration = (path: string): Declaration => ({
  mode: "replace",
  items: { changes: [{ path }], maybes: [], uses: [], provides: [] },
});
const live = new Set(["agent"]);
const queued = (outbox: ReturnType<typeof createOutbox>, now: number, path: string) => {
  const prepared = outbox.prepare("agent", now, declaration(path));
  outbox.hold(
    "agent",
    { ...prepared.declaration, seq: prepared.seq, workspace: "acme", project: "app" },
    now,
  );
  return outbox.due(now + 10_000, live)[0]![1];
};

describe("plan declaration outbox", () => {
  it.each(["success", "failure"] as const)(
    "keeps a newer queued declaration when an older retry ends with %s",
    (outcome) => {
      const outbox = createOutbox();
      const old = queued(outbox, 1_000, "src/old.ts");
      const newer = queued(outbox, 11_001, "src/new.ts");
      if (outcome === "success") outbox.drop("agent", old.seq);
      else outbox.later("agent", old, 12_000);
      expect(outbox.due(30_000, live)).toEqual([["agent", newer]]);
    },
  );

  it("ignores a late foreground failure after a newer declaration was queued", () => {
    const outbox = createOutbox();
    const old = outbox.prepare("agent", 1_000, declaration("src/old.ts"));
    const newer = queued(outbox, 2_000, "src/new.ts");
    outbox.hold(
      "agent",
      { ...old.declaration, seq: old.seq, workspace: "acme", project: "app" },
      3_000,
    );
    expect(outbox.due(30_000, live)).toEqual([["agent", newer]]);
  });

  it("acknowledges an older queued declaration included in the latest amendment", () => {
    const outbox = createOutbox();
    queued(outbox, 1_000, "src/old.ts");
    const newer = outbox.prepare("agent", 2_000, { ...declaration("src/new.ts"), mode: "amend" });
    expect(newer.declaration.items.changes).toEqual([
      { path: "src/old.ts" },
      { path: "src/new.ts" },
    ]);
    outbox.drop("agent", newer.seq);
    expect(outbox.due(30_000, live)).toEqual([]);
  });
});
