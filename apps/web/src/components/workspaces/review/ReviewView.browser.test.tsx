import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { WorkTaskNode, WorkThreadNode } from "../workTree.logic";

const state = vi.hoisted(() => ({
  threads: [] as Array<{
    environmentId: string;
    id: string;
    runtimeMode: string;
    interactionMode: string;
  }>,
  updateTask: vi.fn(),
  startTurn: vi.fn(),
  promptAgent: vi.fn(),
}));

vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerHubUpdateTask: "updateTask", peerHubPromptAgent: "promptAgent" },
}));
vi.mock("../../../state/threads", () => ({ threadEnvironment: { startTurn: "startTurn" } }));
vi.mock("../../../state/use-atom-command", () => ({
  useAtomCommand: (command: "updateTask" | "startTurn" | "promptAgent") => state[command],
}));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: vi.fn() }));
vi.mock("../useWorkData", () => ({ useWorkData: () => ({ threads: state.threads }) }));
vi.mock("../SharedInputs", () => ({ useCoordinationRefresh: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

import { ReviewActions } from "./ReviewView";

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("review-agent");
const agent: WorkThreadNode = {
  key: "agent",
  title: "Review fixes",
  person: "You",
  mine: true,
  status: "done",
  delivery: "review",
  localEnvironment: true,
  harness: undefined,
  branch: undefined,
  source: "peer",
  stale: false,
  open: { kind: "thread", environmentId, threadId },
  placeable: true,
  concerns: undefined,
  observable: false,
  agent: undefined,
  activeAt: "2026-10-21T18:00:00Z",
  keepsContext: false,
};
const task: WorkTaskNode = {
  id: "task-1",
  key: "PEER-1",
  title: "Review task",
  done: false,
  status: "idle",
  threads: [],
  removable: false,
  context: undefined,
};

let root: Root;
let container: HTMLDivElement;

async function render(agents: ReadonlyArray<WorkThreadNode>) {
  await act(async () =>
    root.render(
      <ReviewActions
        environmentId={environmentId}
        workspace="test"
        project="app"
        task={{ ...task, threads: agents }}
        chat={null}
        done={false}
      />,
    ),
  );
}
async function click(name: string) {
  await act(async () => userEvent.click(page.getByRole("button", { name, exact: true })));
}
async function writeNote() {
  await click("Reopen with a note…");
  await act(async () =>
    userEvent.fill(
      page.getByRole("textbox", { name: "What should change?" }),
      "Please check keyboard focus.",
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.threads = [
    { environmentId, id: threadId, runtimeMode: "approval-required", interactionMode: "default" },
  ];
  for (const command of [state.updateTask, state.startTurn, state.promptAgent]) {
    command.mockReset();
    command.mockResolvedValue(AsyncResult.success(undefined));
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("review reopening", () => {
  it("reopens without requesting or pretending to send a note when no own recipient exists", async () => {
    await render([{ ...agent, mine: false }]);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain(
      "Reopening only changes its status; no message will be sent.",
    );
    await click("Reopen task");
    expect(state.updateTask).toHaveBeenCalledWith({
      environmentId,
      input: { workspace: "test", projectId: "app", taskId: "task-1", status: "open" },
    });
    expect(state.startTurn).not.toHaveBeenCalled();
    expect(state.promptAgent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Reopened. No message was sent.");
  });

  it("reopens and sends the note to the available own thread", async () => {
    await render([agent]);
    await writeNote();
    expect(container.textContent).toContain(
      "Your agent “Review fixes” gets this as your next message.",
    );
    await click("Reopen and send");
    expect(state.startTurn).toHaveBeenCalledWith({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: expect.any(String),
          role: "user",
          text: "Please check keyboard focus.",
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        dispatchMode: "auto",
      },
    });
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("got the note.");
  });

  it("preserves the note and prevents reopening when the recipient becomes stale before submission", async () => {
    await render([agent]);
    await writeNote();
    await render([{ ...agent, stale: true }]);
    await expect.element(page.getByRole("button", { name: "Reopen and send" })).toBeDisabled();
    expect(container.querySelector("textarea")!.value).toBe("Please check keyboard focus.");
    expect(container.textContent).toContain("Your note is kept here");
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(state.updateTask).not.toHaveBeenCalled();
    expect(state.startTurn).not.toHaveBeenCalled();
    await render([agent]);
    await click("Reopen and send");
    expect(state.startTurn).toHaveBeenCalledOnce();
  });

  it("treats a removed local shell as no recipient before changing the task", async () => {
    await render([agent]);
    await writeNote();
    state.threads = [];
    await render([agent]);
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(state.updateTask).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")!.value).toBe("Please check keyboard focus.");
  });

  it("keeps the note for retry when delivery fails after reopening commits", async () => {
    state.startTurn.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new Error("Thread no longer exists."))),
    );
    await render([agent]);
    await writeNote();
    await click("Reopen and send");
    expect(state.updateTask).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Reopened, but the note did not reach your thread");
    expect(container.querySelector("textarea")!.value).toBe("Please check keyboard focus.");
    state.startTurn.mockResolvedValue(AsyncResult.success(undefined));
    await click("Reopen and send");
    expect(state.startTurn).toHaveBeenCalledTimes(2);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("keeps the own herdr agent delivery path", async () => {
    await render([
      { ...agent, source: "herdr", open: { kind: "herdr", agentId: "agent-1", paneId: "pane-1" } },
    ]);
    await writeNote();
    await click("Reopen and send");
    expect(state.promptAgent).toHaveBeenCalledWith({
      environmentId,
      input: { agentId: "agent-1", text: "Please check keyboard focus." },
    });
    expect(state.startTurn).not.toHaveBeenCalled();
  });

  it.each(["Mark task done", "Reopen task"])(
    "does not claim a status change when %s is interrupted",
    async (action) => {
      state.updateTask.mockResolvedValue(AsyncResult.failure(Cause.interrupt()));
      await render([]);
      await click(action);
      expect(container.textContent).toContain(
        "Task update was interrupted. Its status could not be confirmed.",
      );
      expect(container.textContent).not.toContain("Marked done.");
      expect(container.textContent).not.toContain("Reopened.");
      expect(state.startTurn).not.toHaveBeenCalled();
      expect(state.promptAgent).not.toHaveBeenCalled();
      await expect.element(page.getByRole("button", { name: action, exact: true })).toBeEnabled();
    },
  );

  it("preserves the note and skips delivery when the reopening status command is interrupted", async () => {
    state.updateTask.mockResolvedValue(AsyncResult.failure(Cause.interrupt()));
    await render([agent]);
    await writeNote();
    await click("Reopen and send");
    expect(container.textContent).toContain("Task update was interrupted");
    expect(container.querySelector("textarea")!.value).toBe("Please check keyboard focus.");
    expect(state.startTurn).not.toHaveBeenCalled();
    expect(state.promptAgent).not.toHaveBeenCalled();
    state.updateTask.mockResolvedValue(AsyncResult.success(undefined));
    await click("Reopen and send");
    expect(state.startTurn).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it.each(["thread", "herdr"] as const)(
    "keeps the note without a delivery claim when %s delivery is interrupted",
    async (kind) => {
      const command = kind === "thread" ? state.startTurn : state.promptAgent;
      command.mockResolvedValue(AsyncResult.failure(Cause.interrupt()));
      await render([
        kind === "thread"
          ? agent
          : {
              ...agent,
              source: "herdr",
              open: { kind: "herdr", agentId: "agent-1", paneId: "pane-1" },
            },
      ]);
      await writeNote();
      await click("Reopen and send");
      expect(state.updateTask).toHaveBeenCalledOnce();
      expect(container.textContent).toContain(
        "note delivery was interrupted and could not be confirmed",
      );
      expect(container.textContent).not.toContain("got the note.");
      expect(container.querySelector("textarea")!.value).toBe("Please check keyboard focus.");
      command.mockResolvedValue(AsyncResult.success(undefined));
      await click("Reopen and send");
      expect(command).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("got the note.");
      expect(container.querySelector("textarea")).toBeNull();
    },
  );
});
