import { EnvironmentId, type PeerHubStatus, type PeerProjectState } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

import type { TaskLauncherProps } from "../slots.types";

const mocks = vi.hoisted(() => ({ start: vi.fn(), refresh: vi.fn(), query: {} }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerHubStartAgent: null },
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
let container: HTMLDivElement;
let root: Root;
async function render(taskId = "one", inline = true, overrides: Partial<TaskLauncherProps> = {}) {
  mocks.query = { data: null, error: null, isPending: false, refresh: mocks.refresh };
  await act(async () =>
    root.render(
      <StartTaskAgent
        environmentId={environmentId}
        workspace="test"
        project={project}
        taskId={taskId}
        taskLabel={taskId}
        status={{ ...status }}
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("starting an agent on a task", () => {
  it("cancels the direct launch dialog without starting an agent", async () => {
    await render("one", false);
    await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
    expect(mocks.start).not.toHaveBeenCalled();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not substitute another checkout if the chosen repository becomes unavailable", async () => {
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
