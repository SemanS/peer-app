import type { PeerUsageOverview, PeerUsageUserRow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_USAGE_PROJECTS,
  expectedUsageScope,
  formatAgentTime,
  gatewayText,
  sharingErasedText,
  sharingHasReported,
  SHARING_SENT,
  sharingOnNote,
  usageAgent,
  usageAgentRows,
  usageCoverageText,
  usageIsEmpty,
  usagePageState,
  usageProjectChoices,
  usageRangeText,
  usageTiles,
  usageTitle,
  usageUserRows,
  type UsageTile,
  type UsageTileId,
} from "./workspaceUsage.logic";

const overview = (over: Partial<PeerUsageOverview> = {}): PeerUsageOverview => ({
  workspace: "acme",
  days: 30,
  from: "2026-10-01",
  to: "2026-10-30",
  project: null,
  scope: "workspace",
  tickets: { total: 12, open: 9, completed: 3 },
  implementations: { runs: 40, agents: 2, seconds: 123456 },
  apiSpend: {
    usd: 12.5,
    gateway: { state: "ok", spentUsd: 30, budgetUsd: 100, period: "month" },
  },
  tokenValue: { usd: 250, onPlansUsd: 230, partial: false },
  code: { additions: 5000, deletions: 120, partial: false, pullRequestsMerged: 4 },
  tokens: { input: 9000, output: 100, cached: 4000 },
  byAgent: [{ agent: "claude", runs: 30, usd: 180, tokens: 12000 }],
  byUser: [user()],
  coverage: { members: 3, sharing: 2, latestReportAt: "2026-10-30T12:00:00Z" },
  ...over,
});

function user(over: Partial<PeerUsageUserRow> = {}): PeerUsageUserRow {
  return {
    email: "ana@acme.test",
    name: "Ana",
    runs: 12,
    usd: 73.81,
    tokens: 9000,
    sharing: true,
    former: false,
    ...over,
  };
}

const nothing = overview({
  tickets: { total: 0, open: 0, completed: 0 },
  implementations: { runs: 0, agents: 0, seconds: 0 },
  apiSpend: { usd: null, gateway: null },
  tokenValue: null,
  code: null,
  tokens: null,
  byAgent: [],
  byUser: [user({ runs: 0, usd: null, tokens: null, sharing: false })],
  coverage: { members: 1, sharing: 0, latestReportAt: null },
});

const tile = (from: PeerUsageOverview, id: UsageTileId): UsageTile => {
  const found = usageTiles(from).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no ${id} tile`);
  return found;
};

describe("the tiles", () => {
  it("are six in the order of the page, with agent time under Implementations", () => {
    expect(usageTiles(overview()).map(({ id }) => id)).toEqual([
      "tickets",
      "implementations",
      "apiSpend",
      "tokenValue",
      "code",
      "tokens",
    ]);
    expect(tile(overview(), "implementations").lines).toEqual([
      "across 2 agents · 34h 17m of agent time",
    ]);
    expect(tile(overview(), "apiSpend").lines.join(" ")).not.toContain("34h");
  });

  it("drop tickets and code for a person's own view", () => {
    const own = overview({ scope: "self", tickets: null, code: null });
    expect(usageTiles(own).map(({ id }) => id)).toEqual([
      "implementations",
      "apiSpend",
      "tokenValue",
      "tokens",
    ]);
  });

  it("read null as not measured with a reason, never as zero", () => {
    const empty = overview({
      apiSpend: { usd: null, gateway: null },
      tokenValue: null,
      tokens: null,
      coverage: { members: 3, sharing: 0, latestReportAt: null },
    });
    for (const id of ["apiSpend", "tokenValue", "tokens"] as const) {
      const shown = tile(empty, id);
      expect(shown.value).toEqual({ kind: "not-measured" });
      expect(shown.lines).toEqual(["No one shares usage yet."]);
      expect(JSON.stringify(shown)).not.toContain("$0");
    }
  });

  it("keep a real zero as a number", () => {
    const zero = overview({
      apiSpend: { usd: 0, gateway: null },
      tokenValue: { usd: 0, onPlansUsd: 0, partial: false },
    });
    expect(tile(zero, "apiSpend").value).toEqual({ kind: "number", text: "$0.00" });
    expect(tile(zero, "tokenValue").value).toEqual({ kind: "number", text: "$0.00" });
  });

  it("name work on plans only: token value whole, API spend not measured with why", () => {
    const plans = overview({
      apiSpend: { usd: null, gateway: null },
      tokenValue: { usd: 80, onPlansUsd: 80, partial: false },
    });
    expect(tile(plans, "tokenValue").lines).toEqual(["Estimate at list prices · all on plans"]);
    expect(tile(plans, "apiSpend").lines).toEqual([
      "No priced usage on shared capacity in these days.",
    ]);
  });

  it("say tokens with no price have none, not that nothing was reported", () => {
    const unpriced = overview({
      apiSpend: { usd: null, gateway: null },
      tokenValue: null,
      tokens: { input: 900, output: 100, cached: 0 },
    });
    expect(tile(unpriced, "tokenValue").value).toEqual({ kind: "not-measured" });
    expect(tile(unpriced, "tokenValue").lines).toEqual(["These models have no known price."]);
    expect(tile(unpriced, "apiSpend").lines).toEqual([
      "No priced usage on shared capacity in these days.",
    ]);
  });

  it("read both money tiles as estimates, and say when one is partial", () => {
    const partial = overview({ tokenValue: { usd: 250, onPlansUsd: 230, partial: true } });
    expect(tile(overview(), "tokenValue").lines[0]).toContain("Estimate");
    expect(tile(overview(), "apiSpend").lines[0]).toContain("Estimate");
    expect(tile(partial, "tokenValue").lines).toContain(
      "Estimate is partial: a model has no known price.",
    );
    expect(tile(partial, "apiSpend").lines[0]).toContain("May be partial");
  });

  it("tell the person why their own tiles are empty", () => {
    const own = overview({
      scope: "self",
      tickets: null,
      code: null,
      apiSpend: { usd: null, gateway: null },
      tokenValue: null,
      tokens: null,
      coverage: { members: 1, sharing: 0, latestReportAt: null },
    });
    expect(tile(own, "tokens").lines).toEqual(["Your sharing is off."]);
    expect(tile({ ...own, coverage: { ...own.coverage, sharing: 1 } }, "apiSpend").lines).toEqual([
      "No priced usage of yours on shared capacity in these days.",
    ]);
  });
});

describe("what sharing sends", () => {
  it("names every kind of work a report covers, and the computer's id", () => {
    for (const words of ["repositories", "shared capacity", "tasks", "the computer's id"])
      expect(SHARING_SENT).toContain(words);
  });
});

describe("the gateway's figure", () => {
  it("is named as its budget period", () => {
    expect(gatewayText({ state: "ok", spentUsd: 30, budgetUsd: 100, period: "month" })).toBe(
      "Gateway this month: $30.00 of $100.00 budget",
    );
    expect(gatewayText({ state: "ok", spentUsd: 3, period: "day" })).toBe("Gateway today: $3.00");
  });

  it("says when it could not be read, and the rest of the tile stands", () => {
    const down = overview({ apiSpend: { usd: 12.5, gateway: { state: "unreachable" } } });
    expect(tile(down, "apiSpend").value).toEqual({ kind: "number", text: "$12.50" });
    expect(tile(down, "apiSpend").lines).toContain("The gateway's total could not be read.");
  });

  it("shows beside an API spend that is not measured", () => {
    const apart = overview({
      apiSpend: { usd: null, gateway: { state: "ok", spentUsd: 30, period: "week" } },
    });
    expect(tile(apart, "apiSpend").value).toEqual({ kind: "not-measured" });
    expect(tile(apart, "apiSpend").lines).toContain("Gateway this week: $30.00");
  });

  it("is absent without a gateway team", () => {
    expect(gatewayText(null)).toBeNull();
  });
});

describe("Code changed", () => {
  it("shows lines and merged pull requests", () => {
    expect(tile(overview(), "code").value).toEqual({
      kind: "lines",
      added: "+5K",
      deleted: "-120",
    });
    expect(tile(overview(), "code").lines).toEqual(["4 pull requests merged"]);
  });

  it("says a line total is partial", () => {
    const partial = overview({
      code: { additions: 120, deletions: 8, partial: true, pullRequestsMerged: 2 },
    });
    expect(tile(partial, "code").lines).toContain(
      "Line total is partial: some records have no line counts.",
    );
  });

  it("counts pull requests whose records have no lines, without inventing lines", () => {
    const noLines = overview({
      code: { additions: null, deletions: null, partial: true, pullRequestsMerged: 1 },
    });
    expect(tile(noLines, "code").value).toEqual({ kind: "not-measured" });
    expect(tile(noLines, "code").lines).toEqual(["1 pull request merged, none with line counts"]);
  });

  it("without the github block asks for GitHub checks and shows no YAML", () => {
    const shown = tile(overview({ code: null }), "code");
    expect(shown.value).toEqual({ kind: "not-measured" });
    expect(shown.needsGitHub).toBe(true);
    expect(shown.lines.join(" ").toLowerCase()).not.toContain("yaml");
  });
});

describe("coverage in words", () => {
  const ago = () => "5 min ago";
  const covering = (members: number, sharing: number, latest: string | null = "t") =>
    usageCoverageText(overview({ coverage: { members, sharing, latestReportAt: latest } }), ago);

  it("says how many people the totals cover and when a report came", () => {
    expect(covering(3, 1)).toBe(
      "Money and token totals cover one of three people. Latest report 5 min ago.",
    );
    expect(covering(12, 11)).toContain("cover 11 of 12 people");
    expect(covering(3, 3)).toContain("cover all three people");
    expect(covering(1, 1)).toContain("the one member");
  });

  it("says when no one shares and no report came", () => {
    expect(covering(3, 0, null)).toBe(
      "No one shares usage yet, so money and tokens are not measured. No report in these days.",
    );
  });

  it("names a person's own view as their own", () => {
    const own = overview({
      scope: "self",
      coverage: { members: 1, sharing: 1, latestReportAt: null },
    });
    expect(usageCoverageText(own, ago)).toContain("your own numbers");
  });
});

describe("the rows", () => {
  it("show a non-sharing person's runs and no money", () => {
    const [row] = usageUserRows([user({ usd: null, tokens: null, sharing: false })]);
    expect(row).toMatchObject({ runs: "12", usd: null, tokens: null, note: "Sharing off" });
  });

  it("mark former members, keeping their numbers", () => {
    const [row] = usageUserRows([user({ former: true, sharing: false })]);
    expect(row).toMatchObject({ note: "Former member", usd: "$73.81" });
    const [gone] = usageUserRows([user({ former: true, sharing: false, usd: null, tokens: null })]);
    expect(gone?.note).toBe("Former member · Sharing off");
  });

  it("fall back to the address for a person without a name", () => {
    expect(usageUserRows([user({ name: " " })])[0]?.name).toBe("ana@acme.test");
  });

  it("show an agent with no reported usage by its runs", () => {
    const [row] = usageAgentRows([{ agent: "cursor", runs: 3, usd: null, tokens: null }]);
    expect(row).toMatchObject({ name: "Cursor", runs: "3", usd: null, note: "No usage reported" });
  });

  it("name known agents as the app does, and any other plainly", () => {
    expect(usageAgent("claude").label).toBe("Claude Code");
    expect(usageAgent("claude").driverKind).toBe("claudeAgent");
    expect(usageAgent("mystery").label).toBe("Mystery");
  });
});

describe("formats", () => {
  it("write agent time", () => {
    expect(formatAgentTime(30)).toBe("under a minute");
    expect(formatAgentTime(300)).toBe("5m");
    expect(formatAgentTime(7200)).toBe("2h");
    expect(formatAgentTime(123456)).toBe("34h 17m");
  });

  it("write the days in UTC", () => {
    expect(usageRangeText(overview())).toBe("Oct 1 to Oct 30, UTC");
    expect(usageRangeText({ from: "2026-10-30", to: "2026-10-30" })).toBe("Oct 30, UTC");
  });

  it("title the page by scope", () => {
    expect(usageTitle("workspace", "Acme")).toBe("Acme usage");
    expect(usageTitle("self", "Acme")).toBe("Your usage in Acme");
    expect(expectedUsageScope("admin")).toBe("workspace");
    expect(expectedUsageScope("member")).toBe("self");
  });
});

describe("the project choice", () => {
  it("offers all projects or one, and nothing with a single project", () => {
    expect(usageProjectChoices([{ id: "a", name: "A" }])).toEqual([]);
    expect(
      usageProjectChoices([
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ]).map(({ value }) => value),
    ).toEqual([ALL_USAGE_PROJECTS, "a", "b"]);
  });
});

describe("the page's state", () => {
  const state = (over: Partial<Parameters<typeof usagePageState>[0]>) =>
    usagePageState({ signedIn: true, member: true, answer: null, error: null, ...over });

  it("loads until the Hub answers", () => {
    expect(state({}).kind).toBe("loading");
  });

  it("shows a failure, over any earlier answer", () => {
    expect(state({ error: "Hub unreachable", answer: overview() })).toEqual({
      kind: "failed",
      message: "Hub unreachable",
    });
  });

  it("tells an older Hub from a real answer", () => {
    expect(state({ answer: { unsupported: true } }).kind).toBe("older-hub");
    expect(state({ answer: overview() }).kind).toBe("ready");
  });

  it("names a workspace with nothing yet", () => {
    expect(state({ answer: nothing }).kind).toBe("empty");
  });

  it("does not call a window with a former member's runs empty", () => {
    expect(usageIsEmpty(nothing)).toBe(true);
    expect(usageIsEmpty({ ...nothing, byUser: [user({ former: true, usd: null })] })).toBe(false);
    expect(
      usageIsEmpty({
        ...nothing,
        apiSpend: { usd: null, gateway: { state: "unreachable" } },
      }),
    ).toBe(false);
  });

  it("says who cannot read it", () => {
    expect(state({ signedIn: false }).kind).toBe("signed-out");
    expect(state({ member: false }).kind).toBe("unavailable");
  });
});

describe("sharing", () => {
  it("says when first numbers appear, until they have", () => {
    expect(sharingOnNote(false)).toContain("First numbers appear within a few minutes");
    expect(sharingOnNote(true)).toContain("every 30 minutes");
  });

  it("finds the person's own row, or the one row of their own view", () => {
    const rows = [user({ email: "b@acme.test", usd: null, tokens: null }), user()];
    expect(sharingHasReported(rows, "ana@acme.test")).toBe(true);
    expect(sharingHasReported(rows, "b@acme.test")).toBe(false);
    expect(sharingHasReported([user()], undefined)).toBe(true);
    expect(sharingHasReported([], "ana@acme.test")).toBe(false);
  });

  it("says what turning it off erased", () => {
    expect(sharingErasedText({ sharing: false, at: null, removed: 3 })).toBe(
      "Sharing is off. Erased 3 reports.",
    );
    expect(sharingErasedText({ sharing: false, at: null, removed: 0 })).toContain("nothing");
    expect(sharingErasedText({ sharing: true, at: "t" })).toBeNull();
  });
});
