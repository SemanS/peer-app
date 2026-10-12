import type {
  PeerGitHubStatus,
  PeerSlackAdminResult,
  PeerWebhook,
  PeerWebhookList,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  GITHUB_DESCRIPTION,
  coveredRepositories,
  githubCardView,
  githubConnection,
  githubFactConnection,
  linkedText,
  memberDisconnected,
  slackCardState,
  slackCardStatus,
  webhookCountText,
  webhookRows,
  webhookStatusOf,
} from "./integrations.logic";
import { CHECKING, failedFact, readyFact } from "../../settings/connectionFacts";
import { readHook, savedHooks } from "./webhookForm.logic";

const github = (extra: Partial<PeerGitHubStatus> = {}): PeerGitHubStatus => ({
  configured: true,
  webhookPath: "/v1/workspaces/acme/github/webhook",
  lastPingAt: "2026-10-11T09:00:00Z",
  lastVerifiedAt: "2026-10-11T09:05:00Z",
  repositories: [
    { project: "booking", repository: "booking-api", github: "acme/booking-api" },
    { project: "booking", repository: "booking-web", github: "acme/booking-web" },
    { project: "peer", repository: "opera-bridge", github: "acme/opera-bridge" },
    { project: "peer", repository: "peer-hub", github: "Acme/Peer-Hub" },
    { project: "camp", repository: "peer-hub", github: "acme/peer-hub" },
    { project: "camp", repository: "legacy", github: null },
  ],
  secret: "present",
  ...extra,
});
describe("the GitHub PR checks card", () => {
  it("is connected from the first ping, with what it covers and when GitHub last pinged", () => {
    expect(githubCardView(github())).toEqual({
      connection: {
        state: "connected",
        detail: "4 repositories",
        checkedAt: "2026-10-11T09:00:00Z",
      },
      description: GITHUB_DESCRIPTION,
      canSetUp: true,
      setupLabel: "Manage",
      canTurnOff: true,
      secretMissing: false,
    });
    expect(GITHUB_DESCRIPTION).toBe(
      "When GitHub reports a pull request, its word counts over the agent’s report.",
    );
  });

  it("counts a repository once however GitHub spells it, and none outside github.com", () => {
    expect(coveredRepositories(github())).toBe(4);
    expect(coveredRepositories(github({ repositories: [] }))).toBe(0);
  });

  it("says one repository in the singular", () => {
    const view = githubCardView(
      github({ repositories: [{ project: "a", repository: "a", github: "acme/a" }] }),
    );
    expect(view.connection.detail).toBe("1 repository");
  });

  it("needs setup, at the step the wizard is on, until GitHub's first ping arrives", () => {
    const view = githubCardView(github({ lastPingAt: null }));
    expect(view.connection).toEqual({
      state: "setup",
      step: { n: 2, of: 3, title: "add the webhook in GitHub, then wait for its ping" },
    });
    expect(view).toMatchObject({ setupLabel: "Continue setup", canTurnOff: true });
  });

  it("is a problem when GitHub pinged before and the secret that signs its deliveries is gone", () => {
    const view = githubCardView(github({ secret: "missing" }));
    expect(view.connection).toEqual({
      state: "problem",
      detail: "Its secret is not stored, so GitHub’s deliveries are refused.",
    });
    expect(view).toMatchObject({ setupLabel: "Fix", secretMissing: true });
  });

  it("still warns of the missing secret while the checks wait for their first ping", () => {
    const view = githubCardView(github({ secret: "missing", lastPingAt: null }));
    expect(view.connection.state).toBe("setup");
    expect(view.secretMissing).toBe(true);
  });

  it("is off before the checks are set up, and offers setup but no turning off", () => {
    const view = githubCardView(github({ configured: false, lastPingAt: null }));
    expect(view).toMatchObject({
      connection: { state: "off", detail: "Agents can’t prove a merge yet." },
      canSetUp: true,
      setupLabel: "Set up",
      canTurnOff: false,
      secretMissing: false,
    });
  });

  it("is not available on a Hub that does not check pull requests, and offers nothing", () => {
    expect(githubCardView(github({ unsupported: true, configured: false }))).toMatchObject({
      connection: {
        state: "unavailable",
        detail: "This Hub does not verify pull requests with GitHub.",
      },
      description: "This Hub does not verify pull requests with GitHub.",
      canSetUp: false,
      canTurnOff: false,
    });
  });

  it("tells the same connection to every page that shows it", () => {
    expect(githubConnection(github({ configured: false })).state).toBe("off");
    expect(githubConnection(github()).state).toBe("connected");
    expect(githubFactConnection(readyFact(github()))).toEqual(githubConnection(github()));
  });

  it("says Checking… until the status is read, and a problem only when the read failed", () => {
    expect(githubFactConnection({ kind: "loading" })).toBe(CHECKING);
    expect(githubFactConnection(failedFact("The Hub refused."))).toEqual({
      state: "problem",
      detail: "The Hub refused.",
    });
  });
});

const admin = (extra: Partial<PeerSlackAdminResult> = {}): PeerSlackAdminResult => ({
  state: "connected",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer" },
  verifiedAt: "2026-10-11T09:00:00Z",
  auth: null,
  default: { id: "C1", name: "agents", private: false },
  projects: [],
  lastPostAt: null,
  lastFailure: null,
  linkedMembers: 3,
  openAsks: 0,
  hubUrl: "https://hub.acme.dev",
  manifest: { eventsUrl: "https://hub/e", actionsUrl: "https://hub/a" },
  ...extra,
});
const link = (name: string) => ({ slackUser: "U1", name, linkedAt: "2026-10-01T09:00:00Z" });

describe("the Slack card", () => {
  it("waits for the connection, and tells a Hub without Slack from a failure", () => {
    expect(slackCardState({ data: null, error: null }, null)).toEqual({ kind: "loading" });
    expect(slackCardState({ data: null, error: "Slack needs a newer Peer Hub." }, null)).toEqual({
      kind: "older-hub",
    });
    expect(slackCardState({ data: null, error: "boom" }, null)).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("leaves a connection that is not done to the admin's setup, with what the Hub says of it", () => {
    const pending = admin({ state: "needs-setup", team: null, verifiedAt: null });
    expect(slackCardState({ data: pending, error: null }, null)).toEqual({
      kind: "setup",
      admin: pending,
    });
    const noPlace = admin({ default: null });
    expect(slackCardState({ data: noPlace, error: null }, null)).toEqual({
      kind: "setup",
      admin: noPlace,
    });
  });

  it("is connected to the Slack workspace, with the count when the Hub does not list who linked", () => {
    const connected = admin();
    expect(slackCardState({ data: connected, error: null }, "slavo@acme.dev")).toEqual({
      kind: "connected",
      admin: connected,
      team: "Acme",
      linked: 3,
      members: [],
    });
  });

  it("lists who linked with their Slack name, the signed-in person first", () => {
    const state = slackCardState(
      {
        data: admin({
          members: [
            { email: "eva@acme.dev", name: "Eva", link: link("eva") },
            { email: "ana@acme.dev", name: "Ana", link: link("@ana.k") },
            { email: "slavo@acme.dev", name: "Slavo", link: link("slavo") },
          ],
        }),
        error: null,
      },
      "Slavo@acme.dev",
    );
    expect(state).toMatchObject({ kind: "connected" });
    expect(state.kind === "connected" ? state.members : []).toEqual([
      { email: "slavo@acme.dev", name: "Slavo", handle: "@slavo", you: true },
      { email: "ana@acme.dev", name: "Ana", handle: "@ana.k", you: false },
      { email: "eva@acme.dev", name: "Eva", handle: "@eva", you: false },
    ]);
  });

  it("falls back to the address for a member without a name", () => {
    const state = slackCardState(
      {
        data: admin({ members: [{ email: "eva@acme.dev", name: "", link: link("") }] }),
        error: null,
      },
      null,
    );
    expect(state.kind === "connected" ? state.members : []).toEqual([
      { email: "eva@acme.dev", name: "eva@acme.dev", handle: "eva@acme.dev", you: false },
    ]);
  });

  it("reads Needs setup with its step, never Off, while the values are saved and not verified", () => {
    const saved = admin({ state: "off", team: null, bot: null, verifiedAt: null, default: null });
    expect(slackCardStatus(slackCardState({ data: saved, error: null }, null))).toEqual({
      state: "setup",
      step: { n: 3, of: 4, title: "verify" },
    });
    const empty = admin({
      state: "off",
      secrets: { botToken: "missing", signingSecret: "missing" },
      team: null,
      bot: null,
      verifiedAt: null,
      default: null,
    });
    expect(slackCardStatus(slackCardState({ data: empty, error: null }, null))).toMatchObject({
      state: "setup",
      step: { n: 1, of: 4 },
    });
  });

  it("reads Connected with the Slack workspace, the bot and when Slack last confirmed it", () => {
    expect(
      slackCardStatus(
        slackCardState({ data: admin({ bot: { name: "peer" } }), error: null }, null),
      ),
    ).toEqual({
      state: "connected",
      detail: "Acme as @peer",
      checkedAt: "2026-10-11T09:00:00Z",
    });
  });

  it("reads Problem when a channel fails, though the connection still lists its members", () => {
    const state = slackCardState(
      {
        data: admin({
          projects: [
            {
              id: "x",
              name: "Client X",
              restricted: false,
              channel: null,
              mode: "thread",
              problem: { code: "not_in_channel", at: "2026-10-11T09:10:00Z" },
            },
          ],
        }),
        error: null,
      },
      null,
    );
    expect(state.kind).toBe("connected");
    expect(slackCardStatus(state)).toEqual({
      state: "problem",
      detail: "Client X: Invite @Peer to the channel.",
    });
  });

  it("reads Not available on a Hub without Slack, Checking while it reads, Problem when it failed", () => {
    expect(slackCardStatus({ kind: "older-hub" })).toMatchObject({ state: "unavailable" });
    expect(slackCardStatus({ kind: "loading" })).toEqual({ state: "off", label: "Checking…" });
    expect(slackCardStatus({ kind: "error", message: "boom" })).toEqual({
      state: "problem",
      detail: "Could not read Slack: boom",
    });
  });

  it("says how many linked, and what disconnecting one does", () => {
    expect(linkedText(0)).toBe("No one has linked a Slack account yet.");
    expect(linkedText(1)).toBe("1 member has linked a Slack account.");
    expect(linkedText(3)).toBe("3 members have linked a Slack account.");
    expect(memberDisconnected("Eva")).toBe(
      "Eva is disconnected. Their agent threads in Slack stop; they can link again in Me › Slack.",
    );
  });
});

const entry = (id: string, extra: Partial<PeerWebhook> = {}): PeerWebhook => ({
  id,
  format: "slack",
  events: ["task.review", "task.done"],
  projects: null,
  enabled: true,
  destination: { state: "ok", host: "hooks.slack.com" },
  signing: "derived",
  health: { pending: 0, failed: 0, lastDeliveredAt: "2026-10-11T08:00:00Z", lastFailure: null },
  ...extra,
});

describe("what a webhook's status says", () => {
  it("is Delivering while all is well", () => {
    expect(webhookStatusOf(entry("a"))).toEqual({ text: "Delivering", tone: "ok" });
  });

  it("says why a webhook that needs setup is off", () => {
    expect(webhookStatusOf(entry("a", { destination: { state: "missing" } }))).toEqual({
      text: "Off · its URL secret is missing",
      tone: "warn",
    });
    expect(webhookStatusOf(entry("a", { destination: { state: "invalid" } })).text).toBe(
      "Off · its URL secret is not an https address",
    );
    expect(webhookStatusOf(entry("a", { signing: "missing" })).text).toBe(
      "Off · its signing secret is missing",
    );
  });

  it("counts the failed deliveries, in the right number", () => {
    const failing = (failed: number) =>
      entry("a", { health: { pending: 0, failed, lastDeliveredAt: null, lastFailure: null } });
    expect(webhookStatusOf(failing(2))).toEqual({ text: "2 failed deliveries", tone: "warn" });
    expect(webhookStatusOf(failing(1)).text).toBe("1 failed delivery");
  });

  it("says a paused webhook is paused, whatever else is wrong with it", () => {
    expect(
      webhookStatusOf(entry("a", { enabled: false, destination: { state: "missing" } })),
    ).toEqual({ text: "Paused", tone: "quiet" });
  });

  it("says a webhook that waits to retry is retrying", () => {
    expect(
      webhookStatusOf(
        entry("a", {
          health: {
            pending: 2,
            failed: 0,
            lastDeliveredAt: "2026-10-11T08:00:00Z",
            lastFailure: { at: "2026-10-11T09:00:00Z", class: "timeout" },
          },
        }),
      ),
    ).toEqual({ text: "Retrying", tone: "warn" });
  });
});

describe("the webhook rows", () => {
  const names: Record<string, string> = { booking: "Booking", "peer-hub": "Peer Hub" };
  const projectName = (id: string) => names[id] ?? id;
  const list = (...webhooks: PeerWebhook[]): PeerWebhookList => ({ revision: "r1", webhooks });
  const rows = (
    input: {
      readonly saved?: Record<string, unknown>;
      readonly list?: PeerWebhookList | null;
      readonly listFailed?: boolean;
    } = {},
  ) =>
    webhookRows({
      saved: savedHooks({ webhooks: input.saved ?? {} }),
      list: input.list ?? null,
      listFailed: input.listFailed ?? false,
      workspaceName: "Acme",
      projectName,
    });

  const teamSlack = entry("team-slack");
  const teamsAlerts = entry("teams-alerts", {
    format: "teams",
    events: ["task.review", "overlap.ask"],
    projects: ["booking"],
    destination: { state: "missing" },
  });
  const opsEntry = entry("ops", {
    format: "generic",
    events: ["task.done", "task.review", "overlap.ask"],
    projects: ["booking", "peer-hub"],
    signing: "secret",
    health: {
      pending: 0,
      failed: 2,
      lastDeliveredAt: "2026-10-11T08:00:00Z",
      lastFailure: { at: "2026-10-11T09:00:00Z", class: "status", status: 500 },
    },
  });

  it("read as the design's three: name, format, signing, events and projects, status", () => {
    const view = rows({ list: list(teamSlack, teamsAlerts, opsEntry) });
    expect(
      view.map(({ id, title, meta, status, requeue }) => ({ id, title, meta, status, requeue })),
    ).toEqual([
      {
        id: "ops",
        title: "Ops",
        meta: "Generic · signed · 3 events · Booking, Peer Hub",
        status: { text: "2 failed deliveries", tone: "warn" },
        requeue: 2,
      },
      {
        id: "teams-alerts",
        title: "Teams alerts",
        meta: "Teams · 2 events · Booking",
        status: { text: "Off · its URL secret is missing", tone: "warn" },
        requeue: 0,
      },
      {
        id: "team-slack",
        title: "Team slack",
        meta: "Slack · 2 events · projects open to all of Acme",
        status: { text: "Delivering", tone: "ok" },
        requeue: 0,
      },
    ]);
  });

  it("offers no Requeue for failures a paused or unset webhook could not send anyway", () => {
    const paused = entry("ops", {
      enabled: false,
      health: { pending: 0, failed: 3, lastDeliveredAt: null, lastFailure: null },
    });
    expect(rows({ list: list(paused) })[0]?.requeue).toBe(0);
  });

  it("are editable where the document holds the webhook, and not where only the plugin lists it", () => {
    const view = rows({
      list: list(teamSlack, opsEntry),
      saved: {
        ops: {
          format: "generic",
          url: "x",
          events: ["task.done"],
          signingSecret: ["y"],
          enabled: true,
        },
      },
    });
    expect(view.find((row) => row.id === "ops")?.editable).toBe(true);
    expect(view.find((row) => row.id === "team-slack")?.editable).toBe(false);
  });

  it("list a saved webhook the plugin does not list yet after those it does, as not applied", () => {
    const view = rows({
      list: list(teamSlack),
      saved: {
        zeta: { format: "slack", url: "x", events: ["task.done"], enabled: true },
        alpha: { format: "teams", url: "x", events: ["task.done", "task.review"], enabled: true },
      },
    });
    expect(view.map((row) => row.id)).toEqual(["team-slack", "alpha", "zeta"]);
    expect(view[1]).toMatchObject({
      meta: "Teams · 2 events · projects open to all of Acme",
      status: { text: "Saved · not applied yet", tone: "quiet" },
      entry: null,
      editable: true,
    });
  });

  it("say the status is being read, or could not be, for webhooks the plugin has not listed", () => {
    const saved = { ops: { format: "slack", url: "x", events: ["task.done"], enabled: true } };
    expect(rows({ saved })[0]?.status.text).toBe("Checking…");
    expect(rows({ saved, listFailed: true })[0]?.status.text).toBe("Status unknown");
  });

  it("name a saved webhook's signing and projects from the document", () => {
    const view = rows({
      saved: {
        ops: {
          format: "generic",
          url: "x",
          events: ["task.done"],
          projects: ["booking"],
          signingSecret: ["y"],
          enabled: true,
        },
      },
    });
    expect(view[0]?.meta).toBe("Generic · signed · 1 event · Booking");
  });

  it("are none for a workspace without webhooks", () => {
    expect(rows({ list: list() })).toEqual([]);
  });

  it("counts the webhooks against the limit", () => {
    expect(webhookCountText(3, 20)).toBe("3 of 20");
    expect(readHook({})).not.toBeNull();
  });
});
