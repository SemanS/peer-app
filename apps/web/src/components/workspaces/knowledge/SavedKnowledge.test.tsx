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
  search: { data: null as unknown, isPending: false, error: null, refresh: vi.fn() },
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerKnowledgeEntry: state.read,
    peerKnowledgeChallenges: (input: unknown) => ({ search: input }),
  },
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) =>
    typeof query === "object" && query !== null && "search" in query ? state.search : state.query,
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

import { SavedKnowledge } from "./SavedKnowledge";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  state.read.mockClear();
  state.query = { data: null, isSuccess: false, error: null, refresh: vi.fn() };
  state.search = { data: null, isPending: false, error: null, refresh: vi.fn() };
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  onConfirm: vi.fn(),
};

it("reads only the opened entry, then preserves the reason after a failed review", async () => {
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
  expect(button("Review accuracy")).toBeUndefined();
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
  await act(async () => button("Review accuracy").props.onClick());
  await act(async () => button("Mark as outdated").props.onClick());
  const reason = () => renderer!.root.findByType("textarea");
  expect(button("Send for review").props.disabled).toBe(true);
  await act(async () =>
    reason().props.onChange({ target: { value: "  Prices now use decimals.  " } }),
  );
  await act(async () => button("Send for review").props.onClick());
  expect(challenge).toHaveBeenLastCalledWith("prices", "Outdated: Prices now use decimals.");
  expect(reason().props.value).toBe("  Prices now use decimals.  ");
  await act(async () => button("Send for review").props.onClick());
  expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  expect(challenge).toHaveBeenCalledTimes(2);
});

it("filters saved titles and never offers a challenge for a missing entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  state.query.isSuccess = true;
  state.search.data = { entries: [props.entries[1]] };
  await act(async () => {
    renderer = create(<SavedKnowledge {...props} onChallenge={vi.fn()} />);
  });
  await act(async () =>
    renderer!.root.findByType("input").props.onChange({ target: { value: "focused" } }),
  );
  await act(async () => vi.advanceTimersByTime(250));
  expect(button("Prices are integer cents")).toBeUndefined();
  await act(async () => button("Run focused tests").props.onClick());
  expect(button("Review accuracy")).toBeUndefined();
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
  expect(button("Review accuracy").props.disabled).toBe(true);
  expect(
    renderer!.root.findAllByType("p").some((p) => textOf(p.children).includes("Integer cents.")),
  ).toBe(true);
  state.query.error = "The environment disconnected.";
  await act(async () =>
    renderer!.update(<SavedKnowledge {...props} canChallenge={false} onChallenge={vi.fn()} />),
  );
  expect(button("Review accuracy")).toBeUndefined();
  await act(async () => button("Retry").props.onClick());
  expect(state.query.refresh).toHaveBeenCalledOnce();
});

const ledger = (kind: "read" | "agent" | "bulk" | "verify", passed: boolean | null = null) => ({
  at: "2026-10-25T08:00:00Z",
  kind,
  commit: "4b33342".padEnd(40, "0"),
  by: null,
  because: null,
  passed,
});

it("counts stamps apart from verified entries and names the proof instead of a date", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const entries = [
    { ...props.entries[0]!, checked: "2026-10-25", verification: ledger("agent") },
    {
      ...props.entries[1]!,
      checked: "2026-10-25",
      verification: ledger("verify", true),
      since: { commits: 3, head: "f".repeat(40), paths: ["src/x.ts"] },
    },
  ];
  await act(async () => {
    renderer = create(<SavedKnowledge {...props} entries={entries} onChallenge={vi.fn()} />);
  });
  const tile = (label: string) =>
    renderer!.root.findAllByType("button").find((one) => textOf(one.children).startsWith(label))!;
  expect(textOf(tile("Stamped").children)).toContain("Stamped1");
  expect(textOf(tile("Needs review").children)).toContain("Needs review1");
  expect(textOf(tile("Verified").children)).toContain("Verified0");
  await act(async () => tile("Stamped").props.onClick());
  const text = textOf(renderer!.toJSON());
  expect(text).toContain("Stamped by an agent at 4b33342");
  expect(text).not.toContain("Run focused tests");
  await act(async () => tile("Needs review").props.onClick());
  expect(textOf(renderer!.toJSON())).toContain(
    "Verified by its test at 4b333423 commits on its paths since",
  );
});

it("runs an entry's check, shows its outcome and reads the entry again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish: (value: unknown) => void = () => undefined;
  const verify = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  state.query = {
    ...state.query,
    isSuccess: true,
    data: {
      title: "Prices are integer cents",
      kind: "decision",
      file: ".ai/decisions/prices.md",
      summary: "Cents",
      body: "Integer cents.",
      verify: "cargo test cents",
      premises: [{ id: "old-prices", status: "superseded" }],
    },
  };
  await act(async () => {
    renderer = create(
      <SavedKnowledge {...props} onChallenge={vi.fn()} onVerify={verify as never} />,
    );
  });
  await act(async () => button("Prices are integer cents").props.onClick());
  expect(textOf(renderer!.toJSON())).toContain(
    "Builds on old-prices, which is superseded: review whether this still holds.",
  );
  await act(async () => button("Run check").props.onClick());
  expect(verify).toHaveBeenCalledWith("prices");
  expect(button("Running check…").props.disabled).toBe(true);
  await act(async () =>
    finish({
      available: true,
      passed: false,
      exitCode: 101,
      outputTail: "test cents ... FAILED",
      at: "2026-10-27T10:00:00Z",
      commit: "a7450a5".padEnd(40, "0"),
    }),
  );
  const text = textOf(renderer!.toJSON());
  expect(text).toContain("Failed (exit code 101) at a7450a5");
  expect(renderer!.root.findByType("pre").children).toEqual(["test cents ... FAILED"]);
  expect(state.query.refresh).toHaveBeenCalledOnce();
});

it("sends an optional reason with It still holds", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const confirm = vi.fn().mockResolvedValue(true);
  state.query = {
    ...state.query,
    isSuccess: true,
    data: {
      title: "Prices are integer cents",
      kind: "decision",
      file: ".ai/decisions/prices.md",
      summary: "Cents",
      body: "Integer cents.",
      since: { commits: 1, head: "f".repeat(40), paths: ["src/pricing/total.ts"] },
    },
  };
  await act(async () => {
    renderer = create(<SavedKnowledge {...props} onChallenge={vi.fn()} onConfirm={confirm} />);
  });
  await act(async () => button("Prices are integer cents").props.onClick());
  await act(async () => button("Review accuracy").props.onClick());
  expect(textOf(renderer!.toJSON())).toContain("src/pricing/total.ts");
  const why = () =>
    renderer!.root.findAllByType("input").find((input) => input.props.type !== "search")!;
  await act(async () => why().props.onChange({ target: { value: "  Totals still use cents. " } }));
  await act(async () => button("It still holds").props.onClick());
  expect(confirm).toHaveBeenLastCalledWith("prices", "Totals still use cents.");
});
