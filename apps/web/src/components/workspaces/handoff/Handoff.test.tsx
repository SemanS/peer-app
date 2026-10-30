import {
  PeerHandoffPackage,
  type PeerHandoffOutcome,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ANA, ENV, hubTask, statusFor } from "../ownership/ownership.testkit";

const hub = vi.hoisted(() => ({
  withdraw: vi.fn(),
  packages: [] as unknown[],
}));

vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerHandoffHandOff: "handOff",
    peerHandoffWithdraw: "withdraw",
    peerHandoffSetTarget: "setTarget",
    peerHandoffRead: (query: unknown) => query,
    peerAcceptanceAccept: { permissionAtom: () => "acceptance-permission" },
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../../../state/use-atom-command", () => ({
  useAtomCommand: (atom: string) => (atom === "withdraw" ? hub.withdraw : vi.fn()),
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) =>
    query === null
      ? { data: undefined, error: null, isPending: false }
      : { data: hub.packages, error: null, isPending: false },
}));
vi.mock("../../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: async () => true } }),
}));
vi.mock("../../../browser/useOpenLink", () => ({ useOpenLink: () => vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../review/HandoffChat", async () => {
  const { createContext } = await import("react");
  return { HandoffChatContext: createContext(null) };
});

import { HandoffSection } from "./Handoff";

const PULL = "https://github.com/acme/shop/pull/7";
const decodePackage = Schema.decodeUnknownSync(PeerHandoffPackage);
const WITHDRAWN: PeerHandoffOutcome = {
  workspace: "acme",
  project: "ordering",
  task: "vl7",
  number: null,
  changed: false,
  contextVersion: null,
  stored: false,
  targets: [{ url: PULL, kind: "removed", reason: "comment removed" }],
  notices: ["Own handoff package withdrawn; task status unchanged."],
};
const PACKAGE: PeerHandoffPackage = {
  number: 2,
  project: "ordering",
  task: "vl7",
  title: "Receipt totals in cents",
  author: ANA,
  source: "person",
  composedAt: "2026-10-12T20:00:00Z",
  context: {
    version: 7,
    updatedAt: "2026-10-12T19:00:00Z",
    gist: "Totals are cents.",
    sections: [],
    projectLines: [],
  },
  inputs: [],
  overlaps: [],
  pullRequests: [PULL],
};

/** Ana's Peer on a task she handed off, with what the Hub keeps and what this computer wrote last. */
function status(coordination: boolean, deliveries: PeerHandoffOutcome[] = []): PeerHubStatus {
  const base = statusFor(ANA, {
    coordination,
    tasks: [hubTask("vl7", { title: "Receipt totals in cents", status: "review" })],
    threads: [{ id: "peer:a1", task: "vl7", email: ANA }] as never,
  });
  return {
    ...base,
    handoff: {
      target: "comment",
      projectTargets: {},
      summaries: [
        {
          workspace: "acme",
          project: "ordering",
          task: "vl7",
          author: ANA,
          number: 2,
          composedAt: PACKAGE.composedAt,
          contextVersion: 7,
          pullRequests: 1,
          source: "person",
        },
      ],
      deliveries,
    },
  } as unknown as PeerHubStatus;
}

let renderer: ReactTestRenderer | null = null;
const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const button = (label: string) =>
  renderer!.root.findAllByType("button").find((candidate) => words(candidate) === label);
const alerts = () =>
  renderer!.root.findAll((node) => node.type === "p" && node.props.role === "alert").map(words);

async function show(coordination: boolean, deliveries: PeerHandoffOutcome[] = []) {
  await act(async () => {
    renderer = create(
      <HandoffSection
        environmentId={ENV}
        status={status(coordination, deliveries)}
        workspace="acme"
        project="ordering"
        scope="task:vl7"
        contextText={null}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hub.withdraw.mockReset();
  hub.packages = [PACKAGE];
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("withdrawing a handoff", () => {
  it("leaves the outcome to the section's delivery lines and does not repeat it as an alert", async () => {
    hub.withdraw.mockResolvedValue(AsyncResult.success(WITHDRAWN));
    await show(true, [WITHDRAWN]);
    await act(async () => button("Withdraw")!.props.onClick());
    expect(hub.withdraw).toHaveBeenCalledOnce();
    expect(alerts()).toEqual([]);
    expect(words(renderer!.root)).toContain(
      "Own handoff package withdrawn; task status unchanged.",
    );
  });

  it("says why when Peer could not withdraw", async () => {
    hub.withdraw.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new Error("No handoff package of yours to withdraw."))),
    );
    await show(true);
    await act(async () => button("Withdraw")!.props.onClick());
    expect(alerts()).toEqual(["No handoff package of yours to withdraw."]);
  });
});

describe("a handoff built from a task context that has since changed", () => {
  it("is not said to have lost its context where this computer cannot see contexts", async () => {
    await show(false);
    expect(words(renderer!.root)).not.toContain("The task context changed after this handoff");
  });

  it("says the context no longer exists when this computer sees contexts and finds none", async () => {
    await show(true);
    expect(words(renderer!.root)).toContain("The task context changed after this handoff");
    expect(words(renderer!.root)).toContain("the task context no longer exists");
  });
});

describe("the test report in a handoff", () => {
  const section = () =>
    renderer!.root.find(
      (node) => node.type === "section" && node.props["aria-label"] === "Test report",
    );

  it("shows the newest report apart from the author's own account", async () => {
    hub.packages = [
      {
        ...PACKAGE,
        report: {
          number: 1,
          result: "mixed",
          author: ANA,
          role: "author",
          at: "2026-10-12T19:30:00Z",
          passed: 1,
          failed: 0,
          unverified: 1,
          unowned: ["iPhone layout"],
        },
      },
    ];
    await show(true);
    const words_ = words(section());
    expect(words_).toContain(
      "Tests: mixed, 1 passed, 0 failed, 1 unverified · 'iPhone layout' needs an owner",
    );
    expect(words_).toContain("Report 1 by Ana");
    expect(words_).not.toContain("No test report was filed");
  });

  it("says no test report was filed when the package carries none", async () => {
    await show(true);
    expect(words(section())).toContain("No test report was filed.");
  });

  it("reads a package from before reports as one without a report", async () => {
    const { report: _none, ...older } = PACKAGE as PeerHandoffPackage & { report?: unknown };
    hub.packages = [decodePackage(JSON.parse(JSON.stringify(older)))];
    await show(true);
    expect(words(renderer!.root)).toContain("Receipt totals in cents");
    expect(words(section())).toContain("No test report was filed.");
  });
});

describe("the decision on a handoff", () => {
  const section = (label: string) =>
    renderer!.root.find((node) => node.type === "section" && node.props["aria-label"] === label);

  it("opens with the decision and the policy's signals, the agent's blockers folded under its notes", async () => {
    hub.packages = [
      {
        ...PACKAGE,
        key: "VL7",
        source: "agent",
        policy: { mode: "ask", version: 2, signals: ["not-delivered"], accepted: false },
        context: {
          ...PACKAGE.context!,
          sections: [{ name: "Blockers", shortened: false, lines: ["VL8 is a separate task"] }],
        },
      },
    ];
    await show(true);
    expect(words(section("Decision"))).toBe("Accept VL7? 1 signal: not-delivered");
    expect(words(section("Needs attention"))).toContain(
      "The change is not shared: delivery absent, none or local",
    );
    expect(words(section("Needs attention"))).not.toContain("VL8 is a separate task");
    expect(words(section("Delivered"))).toContain("not observed");
    expect(button("The agent’s notes")).toBeDefined();
  });
});
