import type { EnvironmentId, PeerHubStatus, PeerPlansStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// What the screens read: the Hub's answer to the plans read, and each computer's status.
const read = vi.hoisted(() => ({
  asked: [] as unknown[],
  plans: { data: null as unknown, error: null as string | null, isPending: false },
  statuses: {} as Record<string, unknown>,
  targets: [] as ReadonlyArray<{ environmentId: string; label: string }>,
  refresh: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
}));
vi.mock("../../../components/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerPlansList: (target: unknown) => ({ peerPlansList: target }),
    peerHubLive: (target: { environmentId: string }) => ({ peerHubLive: target }),
  },
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: (
    atom: { peerPlansList?: unknown; peerHubLive?: { environmentId: string } } | null,
  ) => {
    read.asked.push(atom);
    if (atom === null) return { data: null, error: null, isPending: false, refresh: read.refresh };
    if (atom.peerHubLive !== undefined)
      return {
        data: read.statuses[atom.peerHubLive.environmentId] ?? null,
        error: null,
        isPending: false,
        refresh: read.refresh,
      };
    return { ...read.plans, refresh: read.refresh };
  },
}));
vi.mock("../work/WorkMarks", () => ({
  ToneChip: ({ tone, label }: { tone: string; label: string }) => (
    <mark data-tone={tone}>{label}</mark>
  ),
}));
vi.mock("../../settings/components/SettingsRow", () => ({
  SettingsRow: ({ label, value, target }: { label: string; value?: string; target?: string }) => (
    <a data-target={target}>
      {label}: {value}
    </a>
  ),
}));
vi.mock("../../settings/settings-environment-filter", () => ({
  useSettingsEnvironmentFilter: () => ({ selectedTargets: read.targets }),
}));

import {
  NOW,
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

import { plansMobilePlugin } from "./index";
import { PeerPlansSection } from "./PeerPlansSection";
import { PlansBadge } from "./PlansBadge";
import { PlansSettingsRows } from "./PlansSettingsRows";

const environmentId = "mac" as EnvironmentId;

const counts: PeerPlansStatus = {
  enabled: true,
  forcedOff: false,
  hubSupport: "supported",
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

beforeEach(() => {
  // "declared 12 min ago" reads the screen's own clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  read.asked.length = 0;
  read.plans = { data: null, error: null, isPending: false };
  read.statuses = {};
  read.targets = [];
  read.refresh.mockClear();
});

afterEach(() => vi.useRealTimers());

/** The words on screen: the markup without its tags, entities back to what was written. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The task of the artboard, as the screen hands it to a plugin. */
const props = (from: PeerHubStatus, taskId = "ord-9") => {
  const project = from.workspaces[0]!.projects[0]!;
  return {
    environmentId,
    label: "Bob’s Mac",
    status: from,
    workspace: "acme",
    project,
    task: project.work.tasks.find((candidate) => candidate.id === taskId)!,
    disabled: false,
    onBusyChange: () => undefined,
  };
};
const section = (from: PeerHubStatus, taskId?: string) =>
  renderToStaticMarkup(<PeerPlansSection {...props(from, taskId)} />);

describe("the Plans list under the selected task", () => {
  it("lists the task's plan with its items, its contract lines and where it meets other work", () => {
    read.plans.data = view([bobsPlan], meetings);
    const said = words(section(withPlans(status(everyone))));
    for (const line of [
      "Plans",
      "What this task’s agents said they will change, use and provide, and where that meets other work. Advice only: nothing here stops an edit.",
      "Bob’s Claude",
      "Plan v2 · declared 12 min ago",
      "src/payments/fees.ts#Fee.refundCents",
      "src/payments/ · maybe",
      "src/tax.ts#applyTax",
      "Fee.refundCents (src/payments/fees.ts): integer cents, never negative",
      "Where it meets other work",
      "Uses their change",
      "applyTax (src/tax.ts) · ORD-11 · Ana’s agent plans to change it",
      "Their contract (teammate text): applyTax (src/tax.ts): takes cents, returns cents",
      "Same change",
      "src/payments/refunds.ts · ORD-15 · Bob’s other work also plans to change it",
      "Uncertain: a plan names the file as maybe",
      "src/payments/totals.ts · ORD-11 · Ana’s session already changed it",
      "Observed: reported by the session, not declared in a plan",
      "Bob’s Codex",
      "has not declared a plan. Its reported changes still count for other works’ relations.",
    ])
      expect(said).toContain(line);
  });

  it("reads the task's place, again whenever the status field's revision moves", () => {
    read.plans.data = view([bobsPlan], meetings);
    section(withPlans(status(everyone)));
    expect(read.asked.at(-1)).toEqual({
      peerPlansList: {
        environmentId,
        input: { workspace: "acme", project: "pay", task: "ord-9", revision: 7 },
      },
    });
    section(withPlans(status(everyone), { ...counts, revision: 8 }));
    expect(read.asked.at(-1)).toMatchObject({ peerPlansList: { input: { revision: 8 } } });
  });

  it("renders what teammates wrote as text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)> [pay now](https://evil.example) **bold**";
    const sneaky = relation("r-sneaky", {
      contract: hostile,
      b: { ...side(anaCodex), label: "<b>Ana</b>" },
    });
    read.plans.data = view(
      [
        plan(bobClaude, {
          uses: [{ path: "src/<script>alert(1)</script>.ts", name: "applyTax" }],
          provides: [{ name: "Fee", path: "src/fees.ts", contract: hostile }],
        }),
      ],
      [sneaky],
    );
    const markup = section(withPlans(status(everyone)));
    expect(words(markup)).toContain(
      `Their contract (teammate text): applyTax (src/tax.ts): ${hostile}`,
    );
    expect(words(markup)).toContain(`Fee (src/fees.ts): ${hostile}`);
    expect(words(markup)).toContain("src/<script>alert(1)</script>.ts#applyTax");
    expect(markup).not.toMatch(/<(img|script|b|strong|a)[\s>]/);
  });

  it("says so when no agent on the task declared a plan", () => {
    read.plans.data = view([], []);
    const said = words(section(withPlans(status([anaCodex]))));
    expect(said).toContain("No agent on this task has declared a plan.");
    expect(said).not.toContain("Where it meets other work");
  });

  it("names an agent without a plan, with the relations its reported changes make", () => {
    read.plans.data = view(
      [bobsPlan],
      [
        relation("r-reported", {
          a: side(bobClaude),
          b: side(anaCodex),
          item: { path: "src/payments/totals.ts" },
          observed: true,
        }),
      ],
    );
    const said = words(section(withPlans(status(everyone)), "ord-11"));
    expect(said).toContain("Ana’s Codex has not declared a plan.");
    expect(said).toContain("Changes their use");
    expect(said).toContain("ORD-9 · Bob’s agent plans to use it; this session already changed it");
  });

  it("is absent where Plans is off, forced off or not served, and then reads nothing", () => {
    for (const [reason, locked] of [
      ["off", false],
      ["PEER_PLANS=off", true],
      ["hub", false],
    ] as const) {
      read.plans.data = view([bobsPlan], meetings);
      expect(section(inactive(reason, locked)), reason).toBe("");
    }
    expect(read.asked.every((asked) => asked === null)).toBe(true);
  });

  it("says it is loading before the first read, and says when plans could not be read", () => {
    read.plans = { data: null, error: null, isPending: true };
    expect(words(section(withPlans(status(everyone))))).toContain("Loading plans…");
    read.plans = { data: null, error: "The environment request failed.", isPending: false };
    const said = words(section(withPlans(status(everyone))));
    expect(said).toContain("The environment request failed.");
    expect(said).toContain("Retry");
    expect(said).not.toContain("Loading plans…");
  });

  it("holds nothing that changes a plan", () => {
    read.plans.data = view([bobsPlan], meetings);
    expect(section(withPlans(status(everyone)))).not.toMatch(/<(button|input|a)[\s>]/);
  });
});

describe("the count under a task's row", () => {
  const badge = (from: PeerHubStatus, taskId: string) =>
    words(renderToStaticMarkup(<PlansBadge {...props(from, taskId)} />));

  it("counts the relations that name the task", () => {
    const active = withPlans(status(everyone));
    expect(badge(active, "ord-9")).toBe("Plans · 3 relations");
    expect(badge(active, "ord-11")).toBe("Plans · 2 relations");
    expect(
      badge(
        withPlans(status(everyone), {
          ...counts,
          counts: [{ ...PAY, task: "ord-9", plans: 1, relations: 1 }],
        }),
        "ord-9",
      ),
    ).toBe("Plans · 1 relation");
  });

  it("is absent for a task no relation names, and where Plans is off", () => {
    expect(badge(withPlans(status(everyone)), "ord-15")).toBe("");
    for (const reason of ["off", "hub"]) {
      expect(badge({ ...inactive(reason), plans: counts }, "ord-9"), reason).toBe("");
    }
  });
});

describe("Plans in the Settings index", () => {
  const rows = () => words(renderToStaticMarkup(<PlansSettingsRows />));
  const computers = (...names: string[]) =>
    (read.targets = names.map((name) => ({ environmentId: name, label: `${name} Mac` })));

  it("says how Plans stands on the computer, and opens Peer workspaces", () => {
    computers("mac");
    read.statuses = { mac: status(everyone) };
    expect(rows()).toBe("Plans: On");
    expect(renderToStaticMarkup(<PlansSettingsRows />)).toContain('data-target="SettingsPeerHub"');
    read.statuses = { mac: inactive("off") };
    expect(rows()).toBe("Plans: Off");
    read.statuses = { mac: inactive("PEER_PLANS=off", true) };
    expect(rows()).toBe("Plans: Forced off");
    read.statuses = { mac: inactive("hub") };
    expect(rows()).toBe("Plans: Needs a newer Hub");
  });

  it("names the computer when the settings show several, and skips one that does not list Plans", () => {
    computers("mac", "studio", "old");
    read.statuses = {
      mac: status(everyone),
      studio: inactive("off"),
      old: { ...status(everyone), plugins: [] },
    };
    expect(rows()).toBe("Plans · mac Mac: On Plans · studio Mac: Off");
  });

  it("has no row before a computer's status arrives", () => {
    computers("mac");
    expect(rows()).toBe("");
  });
});

describe("the plugin", () => {
  it("fills the task count, the task list and the Settings row, and no slot that waits on a person", () => {
    expect(plansMobilePlugin).toEqual({
      id: "plans",
      taskBadges: PlansBadge,
      taskSections: PeerPlansSection,
      settingsRows: PlansSettingsRows,
    });
  });
});
