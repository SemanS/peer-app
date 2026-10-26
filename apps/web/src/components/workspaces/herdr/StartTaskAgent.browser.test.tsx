import {
  EnvironmentId,
  type PeerAgentRequest,
  type PeerHubStatus,
  type PeerProjectState,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import type { TaskLauncherProps, TaskPreparationState } from "../slots.types";

const mocks = vi.hoisted(() => ({ start: vi.fn(), refresh: vi.fn(), read: vi.fn(), query: {} }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerHubStartAgent: null, peerOpenSpec: { read: mocks.read } },
}));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => mocks.query }));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.start }));
vi.mock("../../../state/entities", () => ({ useThreadShells: () => [] }));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => 0 }));
vi.mock("../slots", () => ({ usePeerPlugins: () => [] }));
vi.mock("../../ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

import { StartTaskAgent } from "./StartTaskAgent";
import { OpenSpecPreparation } from "../openspec/OpenSpecPreparation";

const environmentId = EnvironmentId.make("local");
const project = {
  project: { id: "app", name: "App", members: [], capacity: { personal: "any" } },
  repositories: [{ id: "repo", path: "/app", state: "ready", vcs: "git", branch: "main" }],
  work: {
    tasks: [
      { id: "one", title: "First task" },
      { id: "two", title: "Second task" },
    ],
  },
} as unknown as PeerProjectState;
const status = {
  signedIn: true,
  email: "you@example.test",
  agents: { herdr: "running" },
  workspaces: [],
} as unknown as PeerHubStatus;
let preparation: TaskPreparationState;
let container: HTMLDivElement;
let root: Root;
async function render(taskId = "one", inline = true, overrides: Partial<TaskLauncherProps> = {}) {
  mocks.query = {
    data:
      preparation.state === "loading"
        ? null
        : preparation.state === "unavailable"
          ? { ...preparation, code: "source-unavailable" }
          : {
              ...preparation,
              changeId: "real-change",
              sourcePath: "openspec/changes/real-change",
              proposal: "Actual proposal goal",
              tasks: "- [ ] Actual first step",
              design: null,
              completed: 0,
              total: 1,
            },
    error: null,
    isPending: preparation.state === "loading",
    refresh: mocks.refresh,
  };
  await act(async () =>
    root.render(
      <StartTaskAgent
        environmentId={environmentId}
        workspace="test"
        project={project}
        taskId={taskId}
        taskLabel={taskId}
        status={{ ...status }}
        preparation={OpenSpecPreparation}
        inline={inline}
        initialOpen={!inline}
        {...overrides}
      />,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.start.mockReset().mockResolvedValue(AsyncResult.success({}));
  mocks.refresh.mockReset();
  mocks.read.mockReset().mockReturnValue(null);
  preparation = { state: "loading" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("task preparation before launch", () => {
  it("waits for the source, preserves edits through refresh, and sends the exact edited prompt", async () => {
    await render();
    await expect
      .element(page.getByRole("button", { name: "Start agent", exact: true }))
      .toBeDisabled();
    preparation = { state: "ready", prompt: "Implement the live proposal.", repositoryId: "repo" };
    await render();
    const input = page.getByRole("textbox", { name: "First prompt" });
    await expect.element(input).toHaveValue("Implement the live proposal.");
    await expect.element(page.getByText("Actual proposal goal").first()).toBeVisible();
    await userEvent.click(page.getByText("Checklist · 0/1 complete"));
    await expect.element(page.getByText("- [ ] Actual first step").first()).toBeVisible();
    await input.fill("  My exact edited prompt.\nKeep this newline.  ");
    preparation = { ...preparation, prompt: "A refreshed source prompt" };
    await render();
    await expect.element(input).toHaveValue("  My exact edited prompt.\nKeep this newline.  ");
    await userEvent.click(page.getByRole("button", { name: "Start agent", exact: true }));
    expect(mocks.start).toHaveBeenCalledWith({
      environmentId,
      input: {
        workspace: "test",
        projectId: "app",
        taskId: "one",
        repositoryId: "repo",
        harness: "claude",
        prompt: "  My exact edited prompt.\nKeep this newline.  ",
      },
    });
  });

  it("does not carry an edited prompt to another task or launch an unavailable source", async () => {
    preparation = { state: "ready", prompt: "First source", repositoryId: "repo" };
    await render();
    await page.getByRole("textbox", { name: "First prompt" }).fill("Private first draft");
    preparation = { state: "unavailable", reason: "The mapped source is missing." };
    await render("two");
    await expect.element(page.getByRole("textbox", { name: "First prompt" })).toHaveValue("");
    await expect
      .element(page.getByRole("button", { name: "Start agent", exact: true }))
      .toBeDisabled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("cancels the direct launch dialog without starting an agent", async () => {
    preparation = { state: "ready", prompt: "Source", repositoryId: "repo" };
    await render("one", false);
    await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
    expect(mocks.start).not.toHaveBeenCalled();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a deliberate manual fallback when a source is unavailable and can retry without launching", async () => {
    preparation = { state: "unavailable", reason: "The mapped source is missing." };
    await render();
    await userEvent.click(page.getByRole("button", { name: "Retry", exact: true }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: "Write a prompt manually" }));
    await page
      .getByRole("textbox", { name: "First prompt" })
      .fill("My deliberate manual instructions");
    await userEvent.click(page.getByRole("button", { name: "Start agent", exact: true }));
    expect(mocks.start.mock.calls[0]?.[0].input.prompt).toBe("My deliberate manual instructions");
  });

  it("preselects the visible repository and isolates a manual draft when the repository changes", async () => {
    const multiple = {
      ...project,
      repositories: [
        ...project.repositories,
        { ...project.repositories[0]!, id: "second", path: "/second" },
      ],
    };
    preparation = { state: "unavailable", reason: "First repository source is missing." };
    await render("one", true, { project: multiple });
    expect(mocks.read.mock.lastCall?.[0].input.repositoryId).toBe("repo");
    await userEvent.click(page.getByRole("button", { name: "Write a prompt manually" }));
    await page.getByRole("textbox", { name: "First prompt" }).fill("Only for the first checkout");
    await userEvent.click(page.getByText("Run configuration · repo · Claude Code"));
    await userEvent.click(page.getByRole("combobox", { name: "Runs in" }));
    await userEvent.click(page.getByRole("option", { name: "second", exact: true }));
    expect(mocks.read.mock.lastCall?.[0].input.repositoryId).toBe("second");
    await expect.element(page.getByRole("textbox", { name: "First prompt" })).toHaveValue("");
    await expect
      .element(page.getByRole("button", { name: "Start agent", exact: true }))
      .toBeDisabled();
    preparation = { state: "ready", prompt: "Second repository source", repositoryId: "second" };
    await render("one", true, { project: multiple });
    await expect
      .element(page.getByRole("textbox", { name: "First prompt" }))
      .toHaveValue("Second repository source");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("keeps a teammate request's explicit instruction separate and does not load a replacement prompt", async () => {
    const request = {
      id: "request-1",
      task: "one",
      title: "Please check this",
      prompt: "The teammate's original words",
      sender: "ana@example.test",
      createdAt: "2026-10-21T10:00:00Z",
    } as PeerAgentRequest;
    await render("one", false, { request });
    expect(mocks.read).not.toHaveBeenCalled();
    await page.getByRole("textbox", { name: "Your instruction" }).fill("Use my own instruction");
    await userEvent.click(page.getByRole("button", { name: "Accept & start" }));
    expect(mocks.start.mock.calls[0]?.[0].input).toEqual({
      workspace: "test",
      projectId: "app",
      taskId: "one",
      repositoryId: "repo",
      harness: "claude",
      requestId: "request-1",
      instruction: "Use my own instruction",
    });
  });

  it("keeps the edited prompt after a failed launch and retries only on another explicit Start", async () => {
    mocks.start.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Launch unavailable"))),
    );
    preparation = { state: "ready", prompt: "Source", repositoryId: "repo" };
    await render();
    await page.getByRole("textbox", { name: "First prompt" }).fill("Keep my launch draft");
    await userEvent.click(page.getByRole("button", { name: "Start agent", exact: true }));
    await expect.element(page.getByText("Launch unavailable")).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "First prompt" }))
      .toHaveValue("Keep my launch draft");
    expect(mocks.start).toHaveBeenCalledOnce();
    await userEvent.click(page.getByRole("button", { name: "Start agent", exact: true }));
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start.mock.calls[1]?.[0].input.prompt).toBe("Keep my launch draft");
  });

  it("does not substitute another checkout if the prepared repository becomes unavailable", async () => {
    preparation = { state: "ready", prompt: "For the first checkout", repositoryId: "repo" };
    await render();
    await render("one", true, {
      project: {
        ...project,
        repositories: [{ ...project.repositories[0]!, id: "second", path: "/second" }],
      },
    });
    await expect
      .element(page.getByText("The selected repository is not ready on this computer."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Start agent", exact: true }))
      .toBeDisabled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
