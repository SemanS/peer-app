import { EnvironmentId, type PeerKnowledgeCandidate } from "@t3tools/contracts";
import { act, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  related: { data: null as unknown, error: null, refresh: vi.fn() },
  draft: vi.fn(async (_input: unknown): Promise<unknown> => ({ _tag: "Failure" })),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerKnowledgeRelated: (input: unknown) => input,
    peerKnowledgePreview: { label: "preview" },
  },
}));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => state.related }));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => state.draft }));
vi.mock("../WorkspaceAccess", () => ({
  hubFailure: (result: { _tag: string; message?: string }) =>
    result._tag === "Failure" ? { message: result.message ?? "failed" } : null,
}));
vi.mock("../../ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("../../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));

import { KeepOperations, type KeepChoice } from "./KeepOperations";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  state.related = { data: null, error: null, refresh: vi.fn() };
  state.draft.mockReset();
});

const textOf = (node: unknown): string =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : typeof node === "object" && node !== null && "children" in node
        ? textOf(node.children)
        : "";
const buttons = () => renderer!.root.findAllByType("button").map((one) => textOf(one.children));
const button = (label: string) =>
  renderer!.root.findAllByType("button").find((one) => textOf(one.children) === label)!;
const page = () => textOf(renderer!.toJSON());

const candidate: PeerKnowledgeCandidate = {
  id: "c1",
  project: "app",
  text: "Engines report their capabilities at startup.",
  sources: [
    {
      finding: "f1",
      email: "ana@acme.test",
      session: "sess-1234567890",
      task: "t1",
      text: "Engines report capabilities.",
      tagged: true,
      independent: true,
      at: "2026-10-29T00:00:00Z",
      check: { command: "cargo test relay", passed: true },
    },
  ],
  finders: 2,
  status: "proposed",
  firstAt: "2026-10-29T00:00:00Z",
  lastAt: "2026-10-29T00:00:00Z",
};
const learning = {
  entry: "engines",
  title: "Engines are capability-typed backends",
  relation: "extends",
  reason: "governs the same paths (libs/engines/**)",
  kind: "learning",
  revision: "r1",
};
const decision = {
  entry: "worker-only",
  title: "Worker-only is the server default",
  relation: "extends",
  reason: "",
  kind: "decision",
  revision: "r9",
};
const added = {
  operation: "add",
  entry: {
    id: "engines",
    title: learning.title,
    kind: "learning",
    path: ".ai/learnings/engines.md",
  },
  oldBody: "Engines are typed by capability.",
  body: "Engines are typed by capability.\n\n## Added 2026-10-29\n\nThey report them at startup.",
  links: [],
  asWritten: "no llm adapter",
  words: 460,
};

async function mount(onKeep: (choice: KeepChoice) => Promise<"kept" | "stale" | "failed">) {
  const card = () => (
    <KeepOperations
      environmentId={EnvironmentId.make("local")}
      workspace="acme"
      project="app"
      candidate={candidate}
      busy={false}
      taskName={(task) => (task === "t1" ? "Relay" : "work outside tasks")}
      onKeep={onKeep}
      onDismiss={() => undefined}
    />
  );
  await act(async () => {
    renderer = create(card());
  });
  return card;
}

it("offers adding to the learning first, shows its diff once drafted, and applies that draft", async () => {
  state.related.data = { relations: [learning], unavailable: null };
  state.draft.mockResolvedValue({ _tag: "Success", value: added });
  const onKeep = vi.fn(async (_choice: KeepChoice) => "kept" as const);
  const card = await mount(onKeep);
  expect(buttons().slice(0, 2)).toEqual([
    "Add to “Engines are capability-typed backends”",
    "Keep as a new entry",
  ]);
  expect(state.draft).toHaveBeenCalledTimes(1);
  expect(state.draft.mock.calls[0]![0]).toMatchObject({
    input: { id: "c1", operation: "add", entry: { entry: "engines", revision: "r1" } },
  });
  await act(async () => renderer!.update(card()));
  expect(state.draft).toHaveBeenCalledTimes(1);
  const marked = renderer!.root
    .findAll((node) => node.props["data-diff"] === "added")
    .map((node) => textOf(node.children));
  expect(marked).toContain("+ ## Added 2026-10-29");
  expect(page()).toContain("It will be added as written (no llm adapter).");
  expect(page()).toContain("This entry is already long (460 words)");
  expect(page()).toContain("its agent ran `cargo test relay` and it passed");
  expect(page()).not.toMatch(/verified/i);
  await act(async () => button("Apply").props.onClick());
  expect(onKeep).toHaveBeenCalledWith({
    text: undefined,
    into: { entry: "engines", revision: "r1" },
  });
});

it("keeps a finding that extends a decision as a new entry linked to it, never adding", async () => {
  state.related.data = { relations: [decision], unavailable: null };
  state.draft.mockResolvedValue({
    _tag: "Success",
    value: {
      ...added,
      operation: "new",
      entry: { id: null, title: candidate.text, kind: "convention", path: null },
      oldBody: null,
      links: [{ entry: "worker-only", title: decision.title }],
      asWritten: null,
      words: 8,
    },
  });
  const onKeep = vi.fn(async (_choice: KeepChoice) => "kept" as const);
  await mount(onKeep);
  expect(buttons()[0]).toBe("Keep as a new entry");
  expect(buttons().some((label) => label.startsWith("Add to"))).toBe(false);
  expect(page()).toContain("Linked to “Worker-only is the server default”");
  expect(page()).toContain("Links to “Worker-only is the server default”");
  await act(async () => button("Apply").props.onClick());
  expect(onKeep).toHaveBeenCalledWith({ text: undefined, extends: ["worker-only"] });
});

it("says a stale entry inline and asks its relation again", async () => {
  state.related.data = { relations: [learning], unavailable: null };
  state.draft.mockResolvedValue({ _tag: "Success", value: added });
  await mount(async () => "stale");
  await act(async () => button("Apply").props.onClick());
  expect(page()).toContain("This entry changed since it was compared; compare again");
  expect(state.related.refresh).toHaveBeenCalledTimes(1);
});
