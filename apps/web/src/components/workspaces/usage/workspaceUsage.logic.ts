import {
  isProviderDriverKind,
  ProviderDriverKind,
  type PeerUsageAgentRow,
  type PeerUsageDays,
  type PeerUsageGateway,
  type PeerUsageOverview,
  type PeerUsageOverviewAnswer,
  type PeerUsageScope,
  type PeerUsageSharing,
  type PeerUsageUserRow,
  type PeerWorkspaceRole,
} from "@t3tools/contracts";
import { formatCount, formatDayShort, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";

import { PROVIDER_PRESENTATION } from "../../usage/usageProviders";

/**
 * What the workspace usage page says, from what the Hub answers. `null` in an answer is not zero:
 * every number here is either read from a source or named as not measured, with why.
 */
export const NOT_MEASURED = "Not measured";

export const USAGE_WINDOWS: ReadonlyArray<{
  readonly days: PeerUsageDays;
  readonly label: string;
}> = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

export const DEFAULT_USAGE_DAYS: PeerUsageDays = 30;

export const ALL_USAGE_PROJECTS = "all";

/** The choice of all projects or one; a workspace with one project has nothing to choose. */
export function usageProjectChoices(
  projects: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  if (projects.length < 2) return [];
  return [
    { value: ALL_USAGE_PROJECTS, label: "All projects" },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ];
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

const inWords = (count: number) => NUMBER_WORDS[count] ?? formatCount(count);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

/** "34h 17m", "5m", "under a minute". */
export function formatAgentTime(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

/** "Oct 1 to Oct 30, UTC"; one day names that day. */
export function usageRangeText(overview: Pick<PeerUsageOverview, "from" | "to">): string {
  const from = formatDayShort(overview.from);
  return overview.from === overview.to
    ? `${from}, UTC`
    : `${from} to ${formatDayShort(overview.to)}, UTC`;
}

/** The scope before the Hub answers, from the person's role, so the title does not change. */
export const expectedUsageScope = (role: PeerWorkspaceRole | undefined): PeerUsageScope =>
  role === "owner" || role === "admin" ? "workspace" : "self";

export const usageTitle = (scope: PeerUsageScope, workspace: string) =>
  scope === "self" ? `Your usage in ${workspace}` : `${workspace} usage`;

/** Who the money and token totals speak for, and when a computer last reported. */
export function usageCoverageText(
  overview: Pick<PeerUsageOverview, "scope" | "coverage">,
  ago: (iso: string) => string,
): string {
  const { members, sharing, latestReportAt } = overview.coverage;
  const latest =
    latestReportAt === null ? "No report in these days." : `Latest report ${ago(latestReportAt)}.`;
  if (overview.scope === "self") {
    return `These are your own numbers. Owners and admins read the whole workspace. ${latest}`;
  }
  const who =
    sharing === 0
      ? "No one shares usage yet, so money and tokens are not measured."
      : sharing >= members
        ? members === 1
          ? "Money and token totals cover the one member of this workspace."
          : `Money and token totals cover all ${inWords(members)} people.`
        : `Money and token totals cover ${inWords(sharing)} of ${inWords(members)} people.`;
  return `${who} ${latest}`;
}

export type UsageTileId =
  | "tickets"
  | "implementations"
  | "apiSpend"
  | "tokenValue"
  | "code"
  | "tokens";

export type UsageTileValue =
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "lines"; readonly added: string; readonly deleted: string }
  | { readonly kind: "not-measured" };

export interface UsageTile {
  readonly id: UsageTileId;
  readonly label: string;
  readonly value: UsageTileValue;
  /** Quiet lines under the number; a tile that is not measured says why here. */
  readonly lines: ReadonlyArray<string>;
  /** The GitHub checks a workspace turns on in Settings, for a tile that needs them. */
  readonly needsGitHub?: boolean;
}

const notMeasured = { kind: "not-measured" } as const;
const counted = (text: string) => ({ kind: "number", text }) as const;

const PERIOD_WORDS = { day: "today", week: "this week", month: "this month" } as const;

/** The gateway's own running total, named as its budget period because it is not the window. */
export function gatewayText(gateway: PeerUsageGateway | null): string | null {
  if (gateway === null) return null;
  if (gateway.state === "unreachable" || gateway.spentUsd === undefined) {
    return "The gateway's total could not be read.";
  }
  const period = gateway.period === undefined ? "this budget period" : PERIOD_WORDS[gateway.period];
  const budget =
    gateway.budgetUsd === undefined ? "" : ` of ${formatUsd(gateway.budgetUsd)} budget`;
  return `Gateway ${period}: ${formatUsd(gateway.spentUsd)}${budget}`;
}

function unreportedReason({ scope, coverage }: PeerUsageOverview): string {
  if (coverage.sharing > 0) return "Nothing reported in these days.";
  return scope === "self" ? "Your sharing is off." : "No one shares usage yet.";
}

function apiSpendReason(overview: PeerUsageOverview): string {
  if (overview.coverage.sharing === 0) return unreportedReason(overview);
  return overview.scope === "self"
    ? "No priced usage of yours on shared capacity in these days."
    : "No priced usage on shared capacity in these days.";
}

function ticketsTile(tickets: NonNullable<PeerUsageOverview["tickets"]>): UsageTile {
  return {
    id: "tickets",
    label: "Tickets",
    value: counted(formatCount(tickets.total)),
    lines: [`${formatCount(tickets.open)} open · ${formatCount(tickets.completed)} completed`],
  };
}

function implementationsTile({ runs, agents, seconds }: PeerUsageOverview["implementations"]) {
  const across = `across ${plural(agents, "agent")}`;
  return {
    id: "implementations",
    label: "Implementations",
    value: counted(formatCount(runs)),
    lines: [
      runs === 0
        ? "No agent runs in these days"
        : seconds === 0
          ? across
          : `${across} · ${formatAgentTime(seconds)} of agent time`,
    ],
  } satisfies UsageTile;
}

function apiSpendTile(overview: PeerUsageOverview): UsageTile {
  const { usd, gateway } = overview.apiSpend;
  const gatewayLine = gatewayText(gateway);
  const others = gatewayLine === null ? [] : [gatewayLine];
  if (usd === null) {
    return {
      id: "apiSpend",
      label: "API spend",
      value: notMeasured,
      lines: [apiSpendReason(overview), ...others],
    };
  }
  return {
    id: "apiSpend",
    label: "API spend",
    value: counted(formatUsd(usd)),
    lines: [
      overview.tokenValue?.partial === true
        ? "Estimate on shared capacity. May be partial: a model has no known price."
        : "Estimate on shared capacity",
      ...others,
    ],
  };
}

function tokenValueTile(overview: PeerUsageOverview): UsageTile {
  const value = overview.tokenValue;
  if (value === null) {
    return {
      id: "tokenValue",
      label: "Token value",
      value: notMeasured,
      lines: [
        overview.tokens === null ? unreportedReason(overview) : "These models have no known price.",
      ],
    };
  }
  const plans =
    value.onPlansUsd >= value.usd && value.usd > 0
      ? "all on plans"
      : `${formatUsd(value.onPlansUsd)} on plans`;
  return {
    id: "tokenValue",
    label: "Token value",
    value: counted(formatUsd(value.usd)),
    lines: [
      `Estimate at list prices · ${plans}`,
      ...(value.partial ? ["Estimate is partial: a model has no known price."] : []),
    ],
  };
}

function codeTile(code: PeerUsageOverview["code"]): UsageTile {
  if (code === null) {
    return {
      id: "code",
      label: "Code changed",
      value: notMeasured,
      lines: ["Needs GitHub checks, which report merged pull requests to this workspace."],
      needsGitHub: true,
    };
  }
  const merged = `${plural(code.pullRequestsMerged, "pull request")} merged`;
  const nothingMerged = code.pullRequestsMerged === 0;
  if (!nothingMerged && (code.additions === null || code.deletions === null)) {
    return {
      id: "code",
      label: "Code changed",
      value: notMeasured,
      lines: [`${merged}, none with line counts`],
    };
  }
  return {
    id: "code",
    label: "Code changed",
    value: {
      kind: "lines",
      added: `+${formatTokens(code.additions ?? 0)}`,
      deleted: `-${formatTokens(code.deletions ?? 0)}`,
    },
    lines: [
      merged,
      ...(code.partial ? ["Line total is partial: some records have no line counts."] : []),
    ],
  };
}

function tokensTile(overview: PeerUsageOverview): UsageTile {
  const tokens = overview.tokens;
  if (tokens === null) {
    return {
      id: "tokens",
      label: "Tokens",
      value: notMeasured,
      lines: [unreportedReason(overview)],
    };
  }
  return {
    id: "tokens",
    label: "Tokens",
    value: counted(formatTokens(tokens.input + tokens.output + tokens.cached)),
    lines: [
      `${formatTokens(tokens.input)} in · ${formatTokens(tokens.output)} out · ${formatTokens(tokens.cached)} cached`,
    ],
  };
}

/** The tiles of the reference's order; a person's own view has no ticket or code tile. */
export function usageTiles(overview: PeerUsageOverview): ReadonlyArray<UsageTile> {
  const self = overview.scope === "self";
  return [
    ...(self || overview.tickets === null ? [] : [ticketsTile(overview.tickets)]),
    implementationsTile(overview.implementations),
    apiSpendTile(overview),
    tokenValueTile(overview),
    ...(self ? [] : [codeTile(overview.code)]),
    tokensTile(overview),
  ];
}

/** One row of By agent or By user. A null cell shows as not measured. */
export interface UsageRow {
  readonly id: string;
  readonly name: string;
  /** The row's second line: why it has no numbers, or that the person left. */
  readonly note: string | null;
  readonly runs: string;
  readonly tokens: string | null;
  readonly usd: string | null;
}

const money = (usd: number | null) => (usd === null ? null : formatUsd(usd));
const tokenCount = (tokens: number | null) => (tokens === null ? null : formatTokens(tokens));

function userNote(row: PeerUsageUserRow): string | null {
  const unmeasured = row.usd === null && row.tokens === null;
  const reason = !unmeasured ? null : row.sharing ? "Nothing reported" : "Sharing off";
  return row.former ? (reason === null ? "Former member" : `Former member · ${reason}`) : reason;
}

export const usageUserRows = (rows: ReadonlyArray<PeerUsageUserRow>): ReadonlyArray<UsageRow> =>
  rows.map((row) => ({
    id: row.email,
    name: row.name.trim() === "" ? row.email : row.name,
    note: userNote(row),
    runs: formatCount(row.runs),
    tokens: tokenCount(row.tokens),
    usd: money(row.usd),
  }));

/** The agent name a run or a report carries, as the app writes it, with its icon's driver. */
export function usageAgent(agent: string): {
  readonly label: string;
  readonly driverKind: ProviderDriverKind;
} {
  const known = agent === "claudeAgent" ? "claude" : agent;
  if (Object.hasOwn(PROVIDER_PRESENTATION, known)) {
    return PROVIDER_PRESENTATION[known as keyof typeof PROVIDER_PRESENTATION];
  }
  return {
    label: `${agent.charAt(0).toUpperCase()}${agent.slice(1)}`,
    driverKind: isProviderDriverKind(agent) ? agent : ProviderDriverKind.make("unknown"),
  };
}

export const usageAgentRows = (rows: ReadonlyArray<PeerUsageAgentRow>): ReadonlyArray<UsageRow> =>
  rows.map((row) => ({
    id: row.agent,
    name: usageAgent(row.agent).label,
    note: row.usd === null && row.tokens === null ? "No usage reported" : null,
    runs: formatCount(row.runs),
    tokens: tokenCount(row.tokens),
    usd: money(row.usd),
  }));

/** Whether nothing at all has happened in the window, which a page of zeros would hide. */
export function usageIsEmpty(overview: PeerUsageOverview): boolean {
  return (
    (overview.tickets?.total ?? 0) === 0 &&
    overview.implementations.runs === 0 &&
    overview.apiSpend.usd === null &&
    overview.apiSpend.gateway === null &&
    overview.tokenValue === null &&
    overview.tokens === null &&
    (overview.code?.pullRequestsMerged ?? 0) === 0 &&
    overview.byUser.every((row) => row.former === false && row.runs === 0 && row.usd === null)
  );
}

export const usageEmptyText = (scope: PeerUsageScope) =>
  scope === "self"
    ? "Nothing of yours in these days yet. Your agent runs show here as they start, and tokens and estimates once you turn on sharing."
    : "Nothing in these days yet. Tickets and agent runs show here as the team works, and tokens and estimates once people turn on sharing.";

export type UsagePageState =
  | { readonly kind: "signed-out" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "older-hub" }
  | { readonly kind: "empty"; readonly overview: PeerUsageOverview }
  | { readonly kind: "ready"; readonly overview: PeerUsageOverview };

/** What the page draws. A failed read wins over the last answer: those numbers are for an old ask. */
export function usagePageState(input: {
  readonly signedIn: boolean;
  readonly member: boolean;
  readonly answer: PeerUsageOverviewAnswer | null;
  readonly error: string | null;
}): UsagePageState {
  if (!input.signedIn) return { kind: "signed-out" };
  if (!input.member) return { kind: "unavailable" };
  if (input.error !== null) return { kind: "failed", message: input.error };
  if (input.answer === null) return { kind: "loading" };
  if ("unsupported" in input.answer) return { kind: "older-hub" };
  return { kind: usageIsEmpty(input.answer) ? "empty" : "ready", overview: input.answer };
}

export const USAGE_STATE_TEXT = {
  "signed-out": "Sign in to Peer Hub to see this workspace's usage.",
  unavailable: "This workspace is not available to you.",
  loading: "Reading usage…",
  "older-hub": "This Peer Hub has no usage page yet. It needs an update.",
} as const;

export const SHARING_TITLE = "Share my usage with this workspace";

/** What is sent, said the same way on and off, since turning it on is the consent. */
export const SHARING_SENT =
  "Your computers send daily counts for work in this workspace's repositories, on its shared capacity or on its tasks: agent, model, project, tokens, sessions, an estimated cost and the computer's id. Never prompts, paths, titles, branches or transcripts. Owners and admins see your numbers by name, and only you can change this.";

export const SHARING_OFF_NOTE =
  "Sharing is off, so your computers send nothing. Turning it on also sends up to the last 35 days.";

export const SHARING_ERASES = "Turning it off erases everything you reported to this workspace.";

export const SHARING_CONFIRM_TITLE = "Turn off sharing and erase your reports?";

export const SHARING_CONFIRM =
  "Everything you reported to this workspace is erased now, and your computers stop sending. What Peer keeps on your computers stays.";

/** While sharing is on: when the numbers show, which is only worth saying before they first do. */
export function sharingOnNote(reported: boolean): string {
  return reported
    ? "Sharing is on. Your computers report every 30 minutes while Peer is open."
    : "Sharing is on. First numbers appear within a few minutes while Peer is open on your computer.";
}

/** Whether the person's own row carries numbers yet. */
export function sharingHasReported(
  rows: ReadonlyArray<PeerUsageUserRow>,
  email: string | null | undefined,
): boolean {
  const own = rows.find((row) => row.email === email) ?? (rows.length === 1 ? rows[0] : undefined);
  return own !== undefined && (own.usd !== null || own.tokens !== null);
}

/** What the answer to turning sharing off says it erased. */
export function sharingErasedText(answer: PeerUsageSharing): string | null {
  if (answer.sharing || answer.removed === undefined) return null;
  return answer.removed === 0
    ? "Sharing is off. There was nothing to erase."
    : `Sharing is off. Erased ${plural(answer.removed, "report")}.`;
}
