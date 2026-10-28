import { EnvironmentId, type PeerKnowledgeChallenges } from "@t3tools/contracts";
import {
  act,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ComponentProps,
} from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  read: vi.fn((input: unknown) => input),
  /** What each opened entry's query answers, by entry id. */
  answers: new Map<string, { data: unknown; isSuccess: boolean; error: string | null }>(),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerKnowledgeEntry: state.read,
    peerKnowledgeChallenges: (input: unknown) => ({ search: input }),
  },
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => {
    const entry =
      typeof query === "object" && query !== null && "input" in query
        ? (query as { input: { entry: string } }).input.entry
        : null;
    const answer = entry === null ? undefined : state.answers.get(entry);
    return {
      data: answer?.data ?? null,
      isSuccess: answer?.isSuccess ?? false,
      error: answer?.error ?? null,
      isPending: false,
      refresh: vi.fn(),
    };
  },
}));
vi.mock("../../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("../../ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("../../ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("../../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));

import { KnowledgeFlows } from "./Flows";
import type { SavedKnowledgeProps } from "./SavedKnowledge";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  state.read.mockClear();
  state.answers.clear();
  vi.unstubAllGlobals();
});

const textOf = (node: unknown): string =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : typeof node === "object" && node !== null && "children" in node
        ? textOf(node.children)
        : "";
const buttons = () => renderer!.root.findAllByType("button");
const button = (label: string) => buttons().find((one) => textOf(one.children).includes(label))!;
const text = () => textOf(renderer!.root.children);

const entries: PeerKnowledgeChallenges["entries"] = [
  {
    id: "flow-read",
    title: "Flow: a read, from the request to the cache",
    kind: "architecture",
    summary: "Starts at the request and ends in the cache.",
    paths: ["src/**"],
    tags: ["flow", "cache"],
  },
  { id: "mod-cache", title: "src/cache", kind: "architecture", tags: ["module"] },
  {
    id: "use-cache",
    title: "Use cache",
    kind: "decision",
    verification: {
      at: "2026-10-20",
      kind: "read",
      commit: "abc",
      by: null,
      because: null,
      passed: null,
    },
  },
  { id: "cache-warms-late", title: "The cache warms late", kind: "learning" },
];

const props: SavedKnowledgeProps = {
  environmentId: EnvironmentId.make("local"),
  workspace: "acme",
  project: "app",
  entries,
  challenged: new Set<string>(["cache-warms-late"]),
  busy: false,
  canChallenge: true,
  onChallenge: vi.fn(),
  onConfirm: vi.fn(),
};

it("lists only the flows, and says how to make one when there is none", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    renderer = create(<KnowledgeFlows {...props} />);
  });
  expect(text()).toContain("1 flow");
  expect(button("A read, from the request to the cache")).toBeDefined();
  expect(text()).not.toContain("src/cache");
  expect(state.read).not.toHaveBeenCalled();
  await act(async () => renderer!.update(<KnowledgeFlows {...props} entries={entries.slice(1)} />));
  expect(text()).toContain("No flows yet");
  expect(text()).toContain("kontext-flows");
});

it("opens a flow as its trail with each step's health, and a step as its entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    renderer = create(<KnowledgeFlows {...props} />);
  });
  await act(async () => button("A read, from the request to the cache").props.onClick());
  expect(state.read).toHaveBeenCalledWith({
    environmentId: props.environmentId,
    input: { workspace: "acme", project: "app", entry: "flow-read" },
  });
  expect(text()).toContain("Loading the trail…");
  state.answers.set("flow-read", {
    isSuccess: true,
    error: null,
    data: {
      title: "Flow: a read, from the request to the cache",
      kind: "architecture",
      file: ".ai/architecture/flows/flow-read.md",
      summary: "Starts at the request and ends in the cache.",
      body: "A read passes the cache.\n\n## Trail\n\n### Request\n1. [[use-cache]] — Settles that reads are cached.\n",
      trail: [
        { stage: "Request", entry: "use-cache", text: "Settles that reads are cached." },
        { stage: "Request", entry: "cache-warms-late", text: "Bites on the first read." },
        { stage: "Answer", entry: "gone", text: "Was superseded." },
      ],
    },
  });
  await act(async () => renderer!.update(<KnowledgeFlows {...props} />));
  const page = text();
  expect(page).toContain("A read passes the cache.");
  expect(page).toContain("3 steps · 1 verified · 1 needs review · 1 not in the saved knowledge");
  expect(page).toContain("Request");
  expect(page).toContain("Answer");
  expect(page).toContain("gone is not in the saved knowledge");
  expect(
    renderer!.root.findAll(
      (node) => node.type === "svg" && node.props["aria-label"] === "Verified",
    ),
  ).toHaveLength(1);
  expect(button("gone")).toBeUndefined();

  // A step opens its entry, read once, as the Knowledge tab reads it.
  await act(async () => button("Use cache").props.onClick());
  expect(state.read).toHaveBeenLastCalledWith({
    environmentId: props.environmentId,
    input: { workspace: "acme", project: "app", entry: "use-cache" },
  });
  state.answers.set("use-cache", {
    isSuccess: true,
    error: null,
    data: {
      title: "Use cache",
      kind: "decision",
      file: ".ai/decisions/use-cache.md",
      summary: "Cache reads.",
      body: "Cache reads. Every read goes through the cache first.",
    },
  });
  await act(async () => renderer!.update(<KnowledgeFlows {...props} />));
  expect(text()).toContain("Every read goes through the cache first.");
});
