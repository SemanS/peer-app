import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type PeerHubAssignThreadInput,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { startThreadWithWorkTask } from "./startThreadWithWorkTask";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";

const workTask = { workspace: "team", projectId: "project", taskId: "task" };
const remote = EnvironmentId.make("remote");

function launchHost() {
  const assignments = new Map<string, string>();
  const started: Array<{ thread: string; task: string | undefined }> = [];
  return {
    assignments,
    started,
    assign: async (request: { environmentId: EnvironmentId; input: PeerHubAssignThreadInput }) => {
      assignments.set(`${request.environmentId}:${request.input.thread}`, request.input.taskId!);
      return AsyncResult.success(undefined);
    },
    start: async (thread: string) => {
      started.push({ thread, task: assignments.get(`${remote}:peer:${thread}`) });
      return AsyncResult.success(thread);
    },
  };
}

describe("startThreadWithWorkTask", () => {
  it("launches rotated and fanout thread ids with their task on the selected host", async () => {
    const host = launchHost();
    const store = useComposerDraftStore.getState();
    const draftId = DraftId.make("work-task-launch-regression");
    const projectRef = scopeProjectRef(
      EnvironmentId.make("origin"),
      ProjectId.make("origin-project"),
    );
    store.setProjectDraftThreadId(projectRef, draftId, { threadId: ThreadId.make("initial-id") });
    store.setDraftThreadContext(draftId, { workTask });
    store.setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(remote, ProjectId.make("remote-project")),
      environmentSelection: "manual",
    });
    store.setLogicalProjectDraftThreadId(
      scopedProjectKey(projectRef),
      scopeProjectRef(remote, ProjectId.make("remote-project")),
      draftId,
      { threadId: ThreadId.make("rotated-thread") },
    );
    const draft = store.getDraftSession(draftId)!;
    for (const thread of [draft.threadId, "fanout-a", "fanout-b"]) {
      await startThreadWithWorkTask({
        workTask: draft.workTask,
        threadRef: scopeThreadRef(draft.environmentId, ThreadId.make(thread)),
        assign: host.assign,
        start: () => host.start(thread),
      });
    }
    store.clearDraftThread(draftId);

    expect(host.started).toEqual([
      { thread: "rotated-thread", task: "task" },
      { thread: "fanout-a", task: "task" },
      { thread: "fanout-b", task: "task" },
    ]);
    expect([...host.assignments.keys()]).toEqual([
      "remote:peer:rotated-thread",
      "remote:peer:fanout-a",
      "remote:peer:fanout-b",
    ]);
  });

  it("does not launch or charge a turn when task placement fails", async () => {
    const host = launchHost();
    const placementError = new Error("Task project is unavailable on this host");
    const result = await startThreadWithWorkTask({
      workTask,
      threadRef: scopeThreadRef(remote, ThreadId.make("blocked")),
      assign: async (): Promise<AtomCommandResult<unknown, Error>> =>
        AsyncResult.failure(Cause.fail(placementError)),
      start: () => host.start("blocked"),
    });

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.cause).toEqual(Cause.fail(placementError));
    expect(host.started).toEqual([]);
    expect(host.assignments.size).toBe(0);
  });

  it("starts unrelated work without creating a task assignment", async () => {
    const host = launchHost();
    await startThreadWithWorkTask({
      workTask: null,
      threadRef: scopeThreadRef(remote, ThreadId.make("unrelated")),
      assign: host.assign,
      start: () => host.start("unrelated"),
    });

    expect(host.started).toEqual([{ thread: "unrelated", task: undefined }]);
    expect(host.assignments.size).toBe(0);
  });
});
