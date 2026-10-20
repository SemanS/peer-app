import { EnvironmentId } from "@t3tools/contracts";
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
  query: {
    data: null as unknown,
    isSuccess: false,
    error: null as string | null,
    refresh: vi.fn(),
  },
}));
vi.mock("../../../state/server", () => ({ serverEnvironment: { peerKnowledgeEntry: state.read } }));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => state.query }));
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

import { SavedKnowledge } from "./SavedKnowledge";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  state.read.mockClear();
  state.query = { data: null, isSuccess: false, error: null, refresh: vi.fn() };
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
const button = (label: string) =>
  renderer!.root.findAllByType("button").find((one) => textOf(one.children) === label)!;
const props = {
  environmentId: EnvironmentId.make("local"),
  workspace: "acme",
  project: "app",
  entries: [
    { id: "prices", title: "Prices are integer cents", kind: "decision" },
    { id: "tests", title: "Run focused tests", kind: "convention" },
  ],
  challenged: new Set<string>(),
  busy: false,
  canChallenge: true,
};

it("reads only the opened entry, then preserves the reason after a failed challenge", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const challenge = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await act(async () => {
    renderer = create(<SavedKnowledge {...props} onChallenge={challenge} />);
  });
  expect(state.read).not.toHaveBeenCalled();
  await act(async () => button("Prices are integer cents").props.onClick());
  expect(state.read).toHaveBeenCalledWith({
    environmentId: props.environmentId,
    input: { workspace: "acme", project: "app", entry: "prices" },
  });
  expect(button("Challenge this entry")).toBeUndefined();
  state.query = {
    ...state.query,
    isSuccess: true,
    data: {
      title: "Prices are integer cents",
      kind: "decision",
      file: ".ai/decisions/prices.md",
      summary: "Cents",
      body: "Use integer cents in all calculations.",
    },
  };
  await act(async () => renderer!.update(<SavedKnowledge {...props} onChallenge={challenge} />));
  expect(
    renderer!.root.findAllByType("p").some((p) => textOf(p.children).includes("Use integer cents")),
  ).toBe(true);
  await act(async () => button("Challenge this entry").props.onClick());
  const reason = () => renderer!.root.findByType("textarea");
  expect(button("Submit challenge").props.disabled).toBe(true);
  await act(async () =>
    reason().props.onChange({ target: { value: "  Prices now use decimals.  " } }),
  );
  await act(async () => button("Submit challenge").props.onClick());
  expect(challenge).toHaveBeenLastCalledWith("prices", "Prices now use decimals.");
  expect(reason().props.value).toBe("  Prices now use decimals.  ");
  await act(async () => button("Submit challenge").props.onClick());
  expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  expect(challenge).toHaveBeenCalledTimes(2);
});

it("filters saved titles and never offers a challenge for a missing entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.query.isSuccess = true;
  await act(async () => {
    renderer = create(<SavedKnowledge {...props} onChallenge={vi.fn()} />);
  });
  await act(async () =>
    renderer!.root.findByType("input").props.onChange({ target: { value: "focused" } }),
  );
  expect(button("Prices are integer cents")).toBeUndefined();
  await act(async () => button("Run focused tests").props.onClick());
  expect(button("Challenge this entry")).toBeUndefined();
  expect(
    renderer!.root
      .findAllByType("p")
      .some((p) => textOf(p.children).includes("no longer available")),
  ).toBe(true);
});

it("keeps read-only entries readable and offers retry instead of a challenge after a read failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.query = {
    ...state.query,
    isSuccess: true,
    data: {
      title: "Prices",
      kind: "decision",
      file: ".ai/prices.md",
      summary: "Cents",
      body: "Integer cents.",
    },
  };
  await act(async () => {
    renderer = create(<SavedKnowledge {...props} canChallenge={false} onChallenge={vi.fn()} />);
  });
  await act(async () => button("Prices are integer cents").props.onClick());
  expect(button("Challenge this entry").props.disabled).toBe(true);
  expect(
    renderer!.root.findAllByType("p").some((p) => textOf(p.children).includes("Integer cents.")),
  ).toBe(true);
  state.query.error = "The environment disconnected.";
  await act(async () =>
    renderer!.update(<SavedKnowledge {...props} canChallenge={false} onChallenge={vi.fn()} />),
  );
  expect(button("Challenge this entry")).toBeUndefined();
  await act(async () => button("Retry").props.onClick());
  expect(state.query.refresh).toHaveBeenCalledOnce();
});
