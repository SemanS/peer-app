import type { ReportedChange } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { parkedRow, taskOfWorkspace } from "./parked.ts";

const tasks = [{ id: "create-the-shared-concurrency-contra-2f7c" }, { id: "t-9", key: "ORD-12" }];

describe("the task of a workspace", () => {
  it("reads the task out of the workspace's name", () => {
    expect(taskOfWorkspace("create-the-shared-concurrency-contra-2f7c-70d0ebc4", tasks)?.id).toBe(
      "create-the-shared-concurrency-contra-2f7c",
    );
    expect(taskOfWorkspace("t3-feature-ord-12-aa11", tasks)?.key).toBe("ORD-12");
  });

  it("takes no part of a word for a task", () => {
    expect(taskOfWorkspace("ord-123-aa11", tasks)).toBeUndefined();
    expect(taskOfWorkspace("default", tasks)).toBeUndefined();
  });
});

describe("a parked change", () => {
  it("names its task and says nobody works in it", () => {
    const change: ReportedChange = {
      changeId: "abc",
      commitId: "def",
      parents: [],
      subject: "",
      paths: ["a.ts"],
      bookmarks: [],
      conflict: false,
      empty: false,
      divergent: false,
      working: true,
      kind: "edit",
    };
    const row = parkedRow(change, {
      project: "p",
      task: "t",
      email: "a@b.c",
      agent: "claude",
      at: "2026-10-31T10:00:00Z",
    });
    expect(row).toMatchObject({ task: "t", working: false, sessions: [], source: "live" });
    expect(row).not.toHaveProperty("kind");
  });
});
