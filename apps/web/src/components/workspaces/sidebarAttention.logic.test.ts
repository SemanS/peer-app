import { describe, expect, it } from "vite-plus/test";

import { sidebarAttention } from "./sidebarAttention.logic";
import type { TaskCard } from "./workBoard.logic";

const base = { key: "k", column: "needs", project: {}, task: undefined };

describe("sidebarAttention", () => {
  it("sends a task to what it asks and says it in the state's words", () => {
    const target = { kind: "review", workspace: "w", project: "p", task: "t" };
    const row = sidebarAttention({
      ...base,
      kind: "task",
      task: { id: "t", key: "1.1", title: "Contract" },
      state: { label: "Ready for review" },
      action: { label: "Review", target },
    } as unknown as TaskCard);
    expect(row).toEqual({
      key: "k",
      taskKey: "1.1",
      title: "Contract",
      ask: "Ready for review",
      target,
    });
  });

  it("leaves what is decided in the queue to the queue", () => {
    const row = sidebarAttention({
      ...base,
      kind: "owner-call",
      item: { title: "Edit billing" },
    } as unknown as TaskCard);
    expect(row).toMatchObject({ ask: "Your call", target: undefined });
  });
});
