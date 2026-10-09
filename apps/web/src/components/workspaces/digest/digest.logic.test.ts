import { expect, it } from "@effect/vitest";
import { digestViewRows } from "./digest.logic";
it("maps bounded generic rows without losing full counts or unsafe links", () => {
  const entry = {
    kind: "task.closed",
    at: "time",
    by: ["ana"],
    subject: "Task",
    ref: { type: "task", id: "t" },
  };
  const rows = digestViewRows(
    {
      project: "app",
      since: "start",
      until: "end",
      coverage: { complete: true },
      sections: [{ id: "tasks", title: "Tasks", total: 5, entries: [entry, entry, entry, entry] }],
    },
    () => "you",
  );
  expect(rows[0]?.rows).toHaveLength(3);
  expect(rows[0]?.remaining).toBe(2);
  expect(rows[0]?.rows[0]).toMatchObject({
    text: "Task closed by you",
    target: { kind: "context", scope: "task:t" },
  });
});
