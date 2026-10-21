// @vitest-environment jsdom
import type { PeerOpenSpecReadResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { TaskLauncherProps } from "../slotTypes";

const state = vi.hoisted(() => ({
  read: {
    data: null as PeerOpenSpecReadResult | null,
    error: null as string | null,
    isPending: true,
    refresh: vi.fn(),
  },
  asked: [] as unknown[],
  start: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children?: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    editable,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (text: string) => void;
    editable: boolean;
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onInput={(event) => onChangeText(event.currentTarget.value)}
    />
  ),
  Linking: { openURL: vi.fn() },
}));
vi.mock("../../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../../components/ui/SegmentedControl", () => ({ SegmentedControl: () => null }));
vi.mock("../../settings/components/SettingsSection", () => ({
  SettingsSection: ({ children, title }: { children?: ReactNode; title?: string }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));
vi.mock("../../../state/server", () => ({ serverEnvironment: { peerHubStartAgent: "start" } }));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => state.start }));
vi.mock("@t3tools/client-runtime/peer/herdr", () => ({
  peerLaunchBlocker: () => null,
  herdrNeedsInstall: () => false,
}));
vi.mock("./atoms", () => ({
  openSpecAtoms: {
    read: (target: unknown) => {
      state.asked.push(target);
      return target;
    },
  },
}));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => state.read }));

import { PeerTaskLaunch } from "../herdr/PeerTaskLaunch";
import { OpenSpecTaskPreparation } from "./OpenSpecTaskPreparation";

const ready: Extract<PeerOpenSpecReadResult, { state: "ready" }> = {
  state: "ready",
  repositoryId: "app",
  changeId: "live-task-brief",
  sourcePath: "openspec/changes/live-task-brief",
  proposal: "# Why\nShow the current task brief.",
  tasks: "- [x] Read source\n- [ ] Implement UI",
  design: "Keep plugin boundaries.",
  prompt: "  Implement live-task-brief.\nRead proposal.md and tasks.md.  ",
  completed: 1,
  total: 2,
};
const props = {
  environmentId: "desktop",
  label: "Desktop",
  workspace: "peer",
  status: { email: "ana@example.test" },
  project: {
    project: { id: "app" },
    repositories: [
      { id: "app", state: "ready", path: "/app" },
      { id: "hub", state: "ready", path: "/hub" },
    ],
  },
  task: { id: "task-1", key: "PEER-1", title: "Current brief" },
  disabled: false,
  onBusyChange: vi.fn(),
  taskPreparation: OpenSpecTaskPreparation,
} as unknown as TaskLauncherProps;

let root: Root;
let container: HTMLDivElement;
async function render(overrides: Partial<TaskLauncherProps> = {}) {
  await act(async () => root.render(<PeerTaskLaunch {...props} {...overrides} />));
}
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  )!;
const prompt = () => container.querySelector("textarea")!;
async function press(label: string) {
  await act(async () => button(label).click());
}
async function edit(value: string) {
  await act(async () => {
    prompt().value = value;
    prompt().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.read = { data: null, error: null, isPending: true, refresh: vi.fn() };
  state.asked = [];
  state.start.mockReset();
  state.start.mockResolvedValue(AsyncResult.success({ promptError: null }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("native OpenSpec launch preparation", () => {
  it("shows live source and editable prefill, then sends exact edited text only after Start", async () => {
    await render();
    expect(button("Start agent").disabled).toBe(true);
    state.read = { ...state.read, data: ready, isPending: false };
    await render();
    expect(container.textContent).toContain("Show the current task brief.");
    expect(container.textContent).not.toContain(ready.tasks);
    await press("▸ Full proposal");
    await press("▸ Checklist");
    expect(container.textContent).toContain(ready.proposal);
    expect(container.textContent).toContain(ready.tasks);
    expect(container.textContent).toContain("1 of 2 tasks complete");
    expect(prompt().value).toBe(ready.prompt);
    expect(state.start).not.toHaveBeenCalled();
    const edited = "  My instruction\nKeep keyboard shortcuts.  ";
    await edit(edited);
    state.read = { ...state.read, data: { ...ready, prompt: "New source prompt" } };
    await render();
    expect(prompt().value).toBe(edited);
    await press("Start agent");
    expect(state.start).toHaveBeenCalledWith({
      environmentId: "desktop",
      input: {
        workspace: "peer",
        projectId: "app",
        taskId: "task-1",
        repositoryId: "app",
        harness: "claude",
        prompt: edited,
      },
    });
  });

  it("rereads the chosen repository and does not send edits from another checkout", async () => {
    state.read = { ...state.read, data: ready, isPending: false };
    await render();
    await edit("Keep my edits");
    await press("hub");
    expect(button("Start agent").disabled).toBe(true);
    expect(state.asked.at(-1)).toMatchObject({
      environmentId: "desktop",
      person: "ana@example.test",
      input: { repositoryId: "hub" },
    });
    state.read = {
      ...state.read,
      data: { ...ready, repositoryId: "hub", prompt: "Hub instructions" },
    };
    await render();
    expect(prompt().value).toBe("Hub instructions");
    await press("Start agent");
    expect(state.start.mock.calls[0]?.[0].input).toMatchObject({
      repositoryId: "hub",
      prompt: "Hub instructions",
    });
  });

  it("requires explicit manual fallback when the mapped source is unavailable", async () => {
    state.read = {
      ...state.read,
      data: { state: "unavailable", code: "source-unavailable", reason: "Checkout is offline." },
      isPending: false,
    };
    await render();
    expect(container.textContent).toContain("Checkout is offline.");
    expect(prompt().value).toBe("");
    expect(button("Start agent").disabled).toBe(true);
    await press("Write a prompt manually");
    await edit("Manual task instruction");
    expect(state.start).not.toHaveBeenCalled();
    await press("Start agent");
    expect(state.start.mock.calls[0]?.[0].input.prompt).toBe("Manual task instruction");
  });

  it("shows refresh failures instead of presenting cached source as current", async () => {
    state.read = {
      ...state.read,
      data: ready,
      error: "Unable to read the checkout.",
      isPending: false,
    };
    await render();
    expect(container.textContent).toContain("Unable to read the checkout.");
    expect(container.textContent).not.toContain("1 of 2 tasks complete");
    expect(button("Start agent").disabled).toBe(true);
    expect(state.start).not.toHaveBeenCalled();
  });

  it("resets manual fallback and edits when the signed-in person changes", async () => {
    state.read = {
      ...state.read,
      data: { state: "unavailable", code: "not-linked", reason: "No mapped change." },
      isPending: false,
    };
    await render();
    await press("Write a prompt manually");
    await edit("Ana's instruction");
    await render({ status: { ...props.status, email: "bob@example.test" } });
    expect(prompt().value).toBe("");
    expect(button("Start agent").disabled).toBe(true);
    expect(state.asked.at(-1)).toMatchObject({ person: "bob@example.test" });
    expect(state.start).not.toHaveBeenCalled();
  });

  it("keeps legacy title prompts when no preparation capability is active", async () => {
    await render({ taskPreparation: undefined });
    expect(prompt().value).toBe("PEER-1: Current brief");
    expect(state.asked).toEqual([]);
  });

  it("keeps request instructions separate from automatic spec prompts", async () => {
    await render({
      request: {
        id: "request-1",
        sender: "bob@example.test",
        title: "Please help",
        prompt: "Sender instructions",
      } as TaskLauncherProps["request"],
    });
    expect(state.asked).toEqual([]);
    expect(prompt().value).toBe("PEER-1: Current brief.");
    await edit("  My response  ");
    await press("Accept & start");
    expect(state.start.mock.calls[0]?.[0].input).toMatchObject({
      requestId: "request-1",
      instruction: "My response",
    });
    expect(state.start.mock.calls[0]?.[0].input).not.toHaveProperty("prompt");
  });
});
