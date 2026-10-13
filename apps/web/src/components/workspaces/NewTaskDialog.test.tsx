import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  startThread: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../state/server", () => ({ serverEnvironment: { peerHubCreateTask: null } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.create }));
vi.mock("./useWorkActions", () => ({ useWorkActions: () => ({ startThread: mocks.startThread }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("./WorkspaceAccess", () => ({
  failureMessage: (result: { _tag: string; message?: string }) =>
    result._tag === "Failure" ? (result.message ?? "failed") : null,
}));
vi.mock("../ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogPopup: Part,
    DialogHeader: Part,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: Part,
    DialogPanel: Part,
    DialogFooter: Part,
  };
});
vi.mock("../ui/combobox", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Combobox: Part,
    ComboboxTrigger: Part,
    ComboboxPopup: Part,
    ComboboxList: Part,
    ComboboxItem: Part,
    ComboboxSearchInput: () => null,
  };
});
vi.mock("../ui/popover", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Popover: Part, PopoverTrigger: Part, PopoverPopup: () => null };
});
vi.mock("../ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));

import { NewTaskDialog } from "./NewTaskDialog";
import type { WorkProjectNode } from "./workTree.logic";

const ENV = "env-1" as EnvironmentId;
const PROJECT = {
  workspace: "webinson",
  workspaceName: "Webinson",
  projectId: "ordering",
  name: "Ordering demo",
  areas: [],
  unsorted: [],
  context: undefined,
  candidates: 0,
  tasks: [{ id: "ord-1", title: "Menu" }],
} as unknown as WorkProjectNode;

/** The Hub's answer to a creation: its status, with the project's tasks as they are now. */
const answer = (tasks: ReadonlyArray<{ id: string; title: string }>) => ({
  _tag: "Success",
  value: {
    workspaces: [
      { slug: "webinson", projects: [{ project: { id: "ordering" }, work: { tasks } }] },
    ],
  },
});

let renderer: ReactTestRenderer | null = null;
let closed = 0;

function open(t3ProjectId?: string) {
  act(() => {
    renderer = create(
      <NewTaskDialog
        environmentId={ENV}
        project={PROJECT}
        t3ProjectId={t3ProjectId as ProjectId | undefined}
        onClose={() => (closed += 1)}
      />,
    );
  });
  return renderer!.root;
}

const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const titleField = (root: ReactTestInstance) => root.findByType("textarea");

function type(root: ReactTestInstance, text: string) {
  act(() => titleField(root).props.onChange({ currentTarget: { value: text } }));
}

async function enter(root: ReactTestInstance, withMeta = false) {
  await act(async () => {
    titleField(root).props.onKeyDown({
      key: "Enter",
      metaKey: withMeta,
      ctrlKey: false,
      nativeEvent: { isComposing: false },
      preventDefault: () => {},
    });
  });
}

beforeEach(() => {
  closed = 0;
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe("the new task composer", () => {
  it("creates the task on Enter and closes", async () => {
    mocks.create.mockResolvedValue(
      answer([
        { id: "ord-1", title: "Menu" },
        { id: "split-payments", title: "Split payments" },
      ]),
    );
    const root = open();
    type(root, "Split payments");
    await enter(root);
    expect(mocks.create).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { workspace: "webinson", projectId: "ordering", title: "Split payments" },
    });
    expect(closed).toBe(1);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Task created", description: "Split payments" }),
    );
  });

  it("creates nothing without a title", async () => {
    const root = open();
    type(root, "   ");
    await enter(root);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps the composer open for the next task with Create more", async () => {
    mocks.create.mockResolvedValue(answer([{ id: "split-payments", title: "Split payments" }]));
    const root = open();
    act(() => root.findByProps({ role: "switch" }).props.onClick());
    type(root, "Split payments");
    await enter(root);
    expect(closed).toBe(0);
    expect(titleField(root).props.value).toBe("");
    expect(words(root)).toContain("Created “Split payments”. Name the next one.");
  });

  it("says why the Hub refused, and stays open", async () => {
    mocks.create.mockResolvedValue({ _tag: "Failure", message: "KRK-812 is already a task here" });
    const root = open();
    type(root, "Split payments");
    await enter(root);
    expect(closed).toBe(0);
    expect(words(root)).toContain("KRK-812 is already a task here");
  });

  it("starts a chat on the new task with ⌘ Enter where the project is open here", async () => {
    mocks.create.mockResolvedValue(
      answer([
        { id: "ord-1", title: "Menu" },
        { id: "split-payments", title: "Split payments" },
      ]),
    );
    const root = open("t3-project");
    type(root, "Split payments");
    await enter(root, true);
    expect(mocks.startThread).toHaveBeenCalledWith(
      { workspace: "webinson", projectId: "ordering" },
      "split-payments",
      "t3-project",
    );
    expect(closed).toBe(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("offers a chat only where the project is open on this computer", () => {
    expect(words(open())).not.toContain("Create and start chat");
    act(() => renderer?.unmount());
    expect(words(open("t3-project"))).toContain("Create and start chat");
  });
});
