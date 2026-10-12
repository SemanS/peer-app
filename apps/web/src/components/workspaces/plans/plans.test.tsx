// @vitest-environment jsdom

import { EnvironmentId, type PeerHubStatus, type PeerPlansStatus } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The Hub's answer to the one read the section makes, and what the page asked for.
const read = vi.hoisted(() => ({
  asked: [] as unknown[],
  result: { data: null as unknown, error: null as string | null, isPending: false },
  refresh: vi.fn(),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerPlansList: (target: unknown) => ({ peerPlansList: target }) },
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => {
    read.asked.push(atom);
    return atom === null
      ? { data: null, error: null, isPending: false, refresh: read.refresh }
      : { ...read.result, refresh: read.refresh };
  },
}));
vi.mock("../../settings/settingsLayout", async () => {
  const { NOW } = await import("@t3tools/client-runtime/testing/peer-plans");
  return {
    useRelativeTimeTick: () => NOW,
    SettingsRow: ({
      title,
      description,
      status,
    }: {
      title: ReactNode;
      description?: ReactNode;
      status?: ReactNode;
    }) => (
      <section aria-label="settings row">
        <h3>{title}</h3>
        <p>{description}</p>
        <div>{status}</div>
      </section>
    ),
  };
});
vi.mock("../PeerPageHeader", () => ({
  PeerSectionLabel: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? "")} {...props}>
      {children}
    </a>
  ),
}));

import {
  PAY,
  anaCodex,
  bobClaude,
  bobsPlan,
  everyone,
  meetings,
  plan,
  relation,
  side,
  status,
  view,
} from "@t3tools/client-runtime/testing/peer-plans";

import { PlansBadge } from "./PlansBadge";
import { PlansSection } from "./PlansSection";
import { PlansSettings } from "./PlansSettings";

const environmentId = EnvironmentId.make("mac");

const counts: PeerPlansStatus = {
  enabled: true,
  forcedOff: false,
  hubSupport: "supported",
  lastContact: "2026-10-12T20:11:00Z",
  revision: 7,
  counts: [
    { ...PAY, task: "ord-9", plans: 1, relations: 3 },
    { ...PAY, task: "ord-11", plans: 0, relations: 2 },
  ],
};
const withPlans = (from: PeerHubStatus, plans: PeerPlansStatus | undefined = counts) =>
  ({ ...from, ...(plans === undefined ? {} : { plans }) }) as PeerHubStatus;
const inactive = (reason: string, locked = false): PeerHubStatus => ({
  ...status(everyone),
  plugins: [
    { id: "plans", title: "Plans", enabled: reason === "hub", active: false, reason, locked },
  ],
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  read.asked.length = 0;
  read.result = { data: null, error: null, isPending: false };
  read.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const show = (ui: ReactNode) => act(async () => root.render(ui));
const text = () => container.textContent ?? "";
const sectionOf = (over: Partial<Parameters<typeof PlansSection>[0]> = {}) => (
  <PlansSection
    environmentId={environmentId}
    status={withPlans(status(everyone))}
    workspace="acme"
    project="pay"
    scope="task:ord-9"
    contextText={null}
    {...over}
  />
);
const links = () =>
  [...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);

describe("the Plans section of a task's context page", () => {
  it("lists the task's plan with its items, its contract lines and where it meets other work", async () => {
    read.result.data = view([bobsPlan], meetings);
    await show(sectionOf());
    const said = text();
    for (const line of [
      "Plans",
      "What this task’s agents said they will change, use and provide, and where that meets other work. Advice only: nothing here stops an edit.",
      "Bob’s Claude",
      "Plan v2 · declared 12 min ago",
      "src/payments/fees.ts#Fee.refundCents",
      "src/payments/",
      "maybe",
      "src/tax.ts#applyTax",
      "Fee.refundCents (src/payments/fees.ts): integer cents, never negative",
      "Where it meets other work",
      "Uses their change",
      "ORD-11 · Ana’s agent plans to change it",
      "Their contract (teammate text): applyTax (src/tax.ts): takes cents, returns cents",
      "Same change",
      "ORD-15 · Bob’s other work also plans to change it",
      "Uncertain: a plan names the file as maybe",
      "ORD-11 · Ana’s session already changed it",
      "Observed: reported by the session, not declared in a plan",
      "Bob’s Codex",
      "has not declared a plan. Its reported changes still count for other works’ relations.",
    ])
      expect(said).toContain(line);
    expect(links()).toEqual([
      ["Open ORD-11", "/task/acme/pay/ord-11"],
      ["Open ORD-11", "/task/acme/pay/ord-11"],
      ["Open ORD-15", "/task/acme/pay/ord-15"],
    ]);
  });

  it("reads the task's place, again whenever the status field's revision moves", async () => {
    read.result.data = view([bobsPlan], meetings);
    await show(sectionOf());
    expect(read.asked.at(-1)).toEqual({
      peerPlansList: {
        environmentId,
        input: { workspace: "acme", project: "pay", task: "ord-9", revision: 7 },
      },
    });
    await show(sectionOf({ status: withPlans(status(everyone), { ...counts, revision: 8 }) }));
    expect(read.asked.at(-1)).toMatchObject({ peerPlansList: { input: { revision: 8 } } });
  });

  it("only shows plans: nothing in it edits one", async () => {
    read.result.data = view([bobsPlan], meetings);
    await show(sectionOf());
    expect(container.querySelectorAll("button, input, textarea, select")).toHaveLength(0);
  });

  it("renders what teammates wrote as text, never as markup or a link of its own", async () => {
    const hostile = "<img src=x onerror=alert(1)> [pay now](https://evil.example) **bold**";
    const sneaky = relation("r-sneaky", {
      contract: hostile,
      b: { ...side(anaCodex), label: "<b>Ana</b>" },
    });
    const shown = plan(bobClaude, {
      uses: [{ path: "src/<script>alert(1)</script>.ts", name: "applyTax" }],
      provides: [{ name: "Fee", path: "src/fees.ts", contract: hostile }],
    });
    read.result.data = view([shown], [sneaky]);
    await show(sectionOf());
    expect(text()).toContain(`Their contract (teammate text): applyTax (src/tax.ts): ${hostile}`);
    expect(text()).toContain(`Fee (src/fees.ts): ${hostile}`);
    expect(text()).toContain("src/<script>alert(1)</script>.ts#applyTax");
    expect(container.querySelector("img, script, b, strong")).toBeNull();
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/task/acme/pay/ord-11",
    ]);
  });

  it("says so when no agent on the task declared a plan, and names no agent of another task", async () => {
    read.result.data = view([], []);
    await show(sectionOf({ status: withPlans(status([anaCodex])) }));
    expect(text()).toContain("No agent on this task has declared a plan.");
    expect(container.querySelector("article")).toBeNull();
  });

  it("names an agent without a plan, with the relations its reported changes make", async () => {
    const reported = relation("r-reported", {
      a: side(bobClaude),
      b: side(anaCodex),
      item: { path: "src/payments/totals.ts" },
      observed: true,
    });
    read.result.data = view([bobsPlan], [reported]);
    await show(sectionOf({ scope: "task:ord-11", status: withPlans(status(everyone)) }));
    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(text()).toContain("Ana’s Codex");
    expect(text()).toContain("has not declared a plan.");
    expect(text()).toContain("Changes their use");
    expect(text()).toContain(
      "ORD-9 · Bob’s agent plans to use it; this session already changed it",
    );
    expect(links()).toEqual([["Open ORD-9", "/task/acme/pay/ord-9"]]);
  });

  it("is absent where Plans is off, forced off or not served, and then reads nothing", async () => {
    for (const [reason, locked] of [
      ["off", false],
      ["PEER_PLANS=off", true],
      ["hub", false],
    ] as const) {
      read.result.data = view([bobsPlan], meetings);
      await show(sectionOf({ status: inactive(reason, locked) }));
      expect(container.innerHTML, reason).toBe("");
    }
    expect(read.asked.every((asked) => asked === null)).toBe(true);
  });

  it("is absent on the project's shared context, which no task owns", async () => {
    read.result.data = view([bobsPlan], meetings);
    await show(sectionOf({ scope: "project" }));
    expect(container.innerHTML).toBe("");
    expect(read.asked.every((asked) => asked === null)).toBe(true);
  });

  it("holds the plan on screen while the next read arrives, and never another task's", async () => {
    read.result.data = view([bobsPlan], meetings);
    await show(sectionOf());
    read.result = { data: null, error: null, isPending: true };
    await show(sectionOf({ status: withPlans(status(everyone), { ...counts, revision: 8 }) }));
    expect(text()).toContain("Bob’s Claude");
    expect(text()).not.toContain("Loading plans…");
    await show(sectionOf({ scope: "task:ord-15" }));
    expect(text()).toContain("Loading plans…");
    expect(text()).not.toContain("Bob’s Claude");
  });

  it("says it is loading before the first read arrives", async () => {
    read.result = { data: null, error: null, isPending: true };
    await show(sectionOf());
    expect(container.querySelector("[role=status]")?.textContent).toBe("Loading plans…");
  });

  it("says when plans could not be read, and reads again on Retry", async () => {
    read.result = { data: null, error: "The environment request failed.", isPending: false };
    await show(sectionOf());
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "The environment request failed.",
    );
    expect(text()).not.toContain("Loading plans…");
    const retry = [...container.querySelectorAll("button")].find((b) => b.textContent === "Retry");
    await act(async () => retry?.click());
    expect(read.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("the count on a task's page", () => {
  const badge = (from: PeerHubStatus, taskId: string, listed = true) => (
    <PlansBadge
      environmentId={environmentId}
      status={from}
      workspace="acme"
      project={listed ? from.workspaces[0]!.projects[0] : undefined}
      task={{ id: taskId } as never}
    />
  );

  it("counts the relations that name the task and opens the task's context page", async () => {
    await show(badge(withPlans(status(everyone)), "ord-9"));
    expect(links()).toEqual([["Plans · 3 relations", "/context/acme/pay/task:ord-9"]]);
    await show(
      badge(
        withPlans(status(everyone), {
          ...counts,
          counts: [{ ...PAY, task: "ord-9", plans: 1, relations: 1 }],
        }),
        "ord-9",
      ),
    );
    expect(links()).toEqual([["Plans · 1 relation", "/context/acme/pay/task:ord-9"]]);
  });

  it("is absent for a task no relation names, for an unlisted project, and where Plans is off", async () => {
    const active = withPlans(status(everyone));
    await show(badge(active, "ord-15"));
    expect(container.innerHTML).toBe("");
    await show(badge(active, "ord-9", false));
    expect(container.innerHTML).toBe("");
    for (const reason of ["off", "hub"]) {
      await show(badge({ ...inactive(reason), plans: counts }, "ord-9"));
      expect(container.innerHTML, reason).toBe("");
    }
  });
});

describe("the Plans row in Settings", () => {
  const row = (from: PeerHubStatus) => (
    <PlansSettings environmentId={environmentId} status={from} />
  );

  it("says what Plans is for and what it holds, where it is on", async () => {
    await show(row(withPlans(status(everyone))));
    expect(container.querySelector("h3")?.textContent).toBe("Plans");
    expect(text()).toContain(
      "Before editing, agents say what they will change, use and provide; Peer says whose work meets theirs.",
    );
    expect(text()).toContain(
      "1 live plan on 1 task. The Hub serves plans; last contact 2 min ago.",
    );
  });

  it("says what being inactive means, whichever way Plans is off, and brings no switch of its own", async () => {
    const said = new Set<string>();
    for (const [reason, locked] of [
      ["off", false],
      ["PEER_PLANS=off", true],
      ["hub", false],
    ] as const) {
      await show(row(inactive(reason, locked)));
      said.add(container.querySelector("div")?.textContent ?? "");
      expect(container.querySelectorAll("button, [role=switch], input")).toHaveLength(0);
    }
    expect([...said]).toEqual([
      "While it is inactive, this computer’s agents are not asked for plans, and task pages show no Plans section.",
    ]);
  });

  it("has no row on an environment that does not list Plans", async () => {
    await show(row({ ...status(everyone), plugins: [] }));
    expect(container.innerHTML).toBe("");
  });
});
