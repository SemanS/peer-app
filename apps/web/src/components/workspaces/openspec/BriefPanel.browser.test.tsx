import {
  EnvironmentId,
  type PeerHubStatus,
  type PeerOpenSpecReadResult,
  type PeerProjectState,
  type PeerTaskBrief,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "~/index.css";

const mocks = vi.hoisted(() => ({ call: vi.fn(), refresh: vi.fn(), query: {} }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerHubUpdateTask: "updateTask",
    peerOpenSpec: { read: () => null, link: "link", unlink: "unlink", saveBrief: "saveBrief" },
  },
}));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => mocks.query }));
vi.mock("../../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (value: unknown) => mocks.call(command, value),
}));
vi.mock("../../ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

import { OpenSpecPreparation } from "./OpenSpecPreparation";

const environmentId = EnvironmentId.make("local");
const project = {
  project: { id: "app", name: "App" },
  repositories: [{ id: "repo", path: "/app", state: "ready", vcs: "git", branch: "main" }],
} as unknown as PeerProjectState;
const status = { signedIn: true, email: "you@example.test" } as unknown as PeerHubStatus;
const brief: PeerTaskBrief = {
  project: "app",
  task: "one",
  goal: "Tell programs' voices apart.",
  checklist: [
    { text: "Split voices", done: true },
    { text: "Label programs", done: false },
  ],
  source: { kind: "openspec", repository: "repo", change: "voices", fingerprint: "a" },
  savedBy: "ana@example.test",
  savedAt: "2026-10-24T10:00:00Z",
  revision: 2,
};
let root: Root;
let container: HTMLDivElement;
async function render(data: PeerOpenSpecReadResult) {
  mocks.query = { data, error: null, isPending: false, refresh: mocks.refresh };
  await act(async () =>
    root.render(
      <OpenSpecPreparation
        environmentId={environmentId}
        status={status}
        workspace="team"
        project={project}
        taskId="one"
      />,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.call.mockReset().mockResolvedValue(AsyncResult.success({}));
  mocks.refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows the saved brief of an archived change and keeps it as the task's own", async () => {
  await render({
    state: "brief",
    repositoryId: "repo",
    reason: "This task is linked to voices, which was archived.",
    prompt: "Work on one",
    link: {
      state: "archived",
      served: true,
      brief,
      archivedAs: "2026-10-24-voices",
      changes: ["voices-v2"],
    },
  });
  await expect.element(page.getByText("Tell programs' voices apart.")).toBeVisible();
  await expect
    .element(page.getByText(/openspec\/changes\/archive\/2026-10-24-voices/))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Close task" })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Keep as own brief" }));
  expect(mocks.call).toHaveBeenCalledWith("unlink", {
    environmentId,
    input: { workspace: "team", projectId: "app", taskId: "one", expectedRevision: 2 },
  });
  expect(mocks.refresh).toHaveBeenCalled();
});

it("links another change chosen from the repository", async () => {
  await render({
    state: "brief",
    repositoryId: "repo",
    reason: "gone",
    prompt: "Work on one",
    link: { state: "missing", served: true, brief, changes: ["voices", "voices-v2"] },
  });
  await userEvent.click(page.getByRole("button", { name: "Link another change" }));
  await userEvent.click(page.getByRole("combobox", { name: "Link another change" }));
  await userEvent.click(page.getByRole("option", { name: "voices-v2" }));
  expect(mocks.call).toHaveBeenCalledWith("link", {
    environmentId,
    input: {
      workspace: "team",
      projectId: "app",
      taskId: "one",
      expectedRevision: 2,
      change: "voices-v2",
    },
  });
});

it("lists what changed in OpenSpec before a person updates the brief", async () => {
  await render({
    state: "ready",
    repositoryId: "repo",
    changeId: "voices",
    sourcePath: "openspec/changes/voices",
    proposal: "## Why\nTell programs' voices apart.",
    tasks: "- [x] Split voices\n- [ ] Show a legend",
    design: null,
    prompt: "Work on one",
    completed: 1,
    total: 2,
    snapshot: {
      goal: "Tell programs' voices apart.",
      fingerprint: "b",
      checklist: [
        { text: "Split voices", done: true },
        { text: "Show a legend", done: false },
      ],
    },
    link: { state: "changed", served: true, brief },
  });
  await expect.element(page.getByText("Added: Show a legend")).toBeVisible();
  await expect.element(page.getByText("Removed: Label programs")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Update from OpenSpec" }));
  expect(mocks.call).toHaveBeenCalledWith("link", {
    environmentId,
    input: { workspace: "team", projectId: "app", taskId: "one", expectedRevision: 2 },
  });
});

it("offers no brief actions on a Hub that does not keep briefs", async () => {
  await render({
    state: "unavailable",
    code: "not-linked",
    reason: "This task is not linked to an OpenSpec change.",
    link: { state: "none", served: false, brief: null },
  });
  await expect.element(page.getByText(/not linked to an OpenSpec change/)).toBeVisible();
  expect(page.getByRole("button", { name: "Write a brief" }).query()).toBeNull();
});
