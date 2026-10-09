import { assert, describe, it } from "@effect/vitest";

import { taskNamed } from "./report.ts";

describe("working context", () => {
  it("names a task by its key as a whole token", () => {
    const tasks = [
      { id: "krk-335", key: "KRK-335" },
      { id: "krk-33", key: "KRK-33" },
    ];
    assert.strictEqual(taskNamed(tasks, ["fix/krk-335-dns", undefined]), "krk-335");
    assert.isUndefined(taskNamed(tasks, ["KRK-3350"]));
  });
});
