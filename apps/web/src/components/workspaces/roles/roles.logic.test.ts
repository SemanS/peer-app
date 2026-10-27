import { describe, expect, it } from "vite-plus/test";

import { reviewLaunch } from "./roles.logic";

type Props = Parameters<typeof reviewLaunch>[0];

const props = (
  over: {
    active?: boolean;
    done?: boolean;
    ready?: boolean;
    harnesses?: Array<string | undefined>;
    project?: boolean;
  } = {},
): Props =>
  ({
    status: { plugins: [{ id: "roles", active: over.active ?? true }] },
    workspace: "acme",
    project:
      over.project === false
        ? undefined
        : {
            project: { id: "web" },
            repositories: [
              { id: "app", state: over.ready === false ? "cloning" : "ready" },
              { id: "docs", state: "ready" },
            ],
          },
    task: {
      id: "t7",
      key: "VL7",
      title: "Checkout totals",
      done: over.done ?? false,
      threads: (over.harnesses ?? []).map((harness) => ({ harness })),
    },
  }) as unknown as Props;

describe("Start a review", () => {
  it("starts on an open task in the first ready checkout and the harness it was built in", () => {
    expect(reviewLaunch(props({ harnesses: ["codex", "cursor"] }))).toEqual({
      input: {
        workspace: "acme",
        projectId: "web",
        taskId: "t7",
        repositoryId: "app",
        harness: "codex",
      },
      label: expect.stringContaining("VL7"),
    });
    expect(reviewLaunch(props({ ready: false }))?.input.repositoryId).toBe("docs");
    expect(reviewLaunch(props())?.input.harness).toBe("claude");
  });

  it("is not offered on a done task, while the plugin is inactive, or without the project", () => {
    expect(reviewLaunch(props({ done: true }))).toBeNull();
    expect(reviewLaunch(props({ active: false }))).toBeNull();
    expect(reviewLaunch(props({ project: false }))).toBeNull();
  });
});
