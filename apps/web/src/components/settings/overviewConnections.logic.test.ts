import {
  ProviderDriverKind,
  ProviderInstanceId,
  type PeerSlackMe,
  type PeerWebhook,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CHECKING, failedFact, readyFact } from "./connectionFacts";
import {
  detectedPlanCount,
  deviceHubConnection,
  providerConnection,
} from "./overviewComputer.logic";
import {
  gatewayConnection,
  plansConnection,
  slackAccountConnection,
  webhooksConnection,
  type GatewayFact,
} from "./overviewWorkspace.logic";

const hook = (extra: Partial<PeerWebhook> = {}): PeerWebhook => ({
  id: "ops",
  format: "slack",
  events: ["task.done"],
  projects: null,
  enabled: true,
  destination: { state: "ok", host: "hooks.slack.com" },
  signing: "derived",
  health: { pending: 0, failed: 0, lastDeliveredAt: "2026-10-12T09:00:00Z", lastFailure: null },
  ...extra,
});
const list = (...webhooks: PeerWebhook[]) => ({ revision: null, webhooks });

describe("the webhooks", () => {
  it("are Off before any is added", () => {
    expect(webhooksConnection(list()).state).toBe("off");
  });

  it("are Connected, saying how many deliver and where to", () => {
    expect(
      webhooksConnection(list(hook(), hook({ id: "teams", format: "teams" }), hook({ id: "a" }))),
    ).toEqual({ state: "connected", detail: "3 delivering to Slack and Teams" });
    expect(webhooksConnection(list(hook())).detail).toBe("1 delivering to Slack");
  });

  it("count a paused one apart, and are Off when all are paused", () => {
    expect(webhooksConnection(list(hook(), hook({ id: "p", enabled: false }))).detail).toBe(
      "1 delivering to Slack · 1 paused",
    );
    expect(webhooksConnection(list(hook({ enabled: false }))).state).toBe("off");
  });

  it("are a Problem while one fails to deliver, ahead of one that needs setup", () => {
    const failing = hook({
      id: "f",
      health: { pending: 0, failed: 2, lastDeliveredAt: null, lastFailure: null },
    });
    const missingUrl = hook({ id: "m", destination: { state: "missing" } });
    expect(webhooksConnection(list(hook(), failing, missingUrl))).toEqual({
      state: "problem",
      detail: "1 webhook is failing to deliver.",
    });
    expect(webhooksConnection(list(hook(), missingUrl))).toEqual({
      state: "setup",
      detail: "1 webhook needs its address or signing key.",
    });
  });
});

describe("the gateway behind shared capacity", () => {
  const gateway = (
    extra: Partial<GatewayFact["view"]> = {},
    pools: number | null = 2,
  ): GatewayFact => ({
    view: {
      configured: true,
      url: "https://llm.acme.dev",
      adminUrl: null,
      currency: "EUR",
      masterKey: { stored: true, at: "2026-10-01T09:00:00Z" },
      sync: { at: "2026-10-12T10:00:00Z", ok: true, lastOkAt: "2026-10-12T10:00:00Z" },
      ...extra,
    },
    pools,
  });

  it("is Off without an address, Needs setup without its key or a first sync", () => {
    expect(gatewayConnection(gateway({ configured: false })).state).toBe("off");
    expect(gatewayConnection(gateway({ masterKey: { stored: false, at: null } }))).toEqual({
      state: "setup",
      detail: "Store the gateway’s master key.",
    });
    expect(gatewayConnection(gateway({ sync: null }))).toEqual({
      state: "setup",
      detail: "Sync the gateway.",
    });
  });

  it("is a Problem when the last sync failed, with what the gateway said", () => {
    expect(
      gatewayConnection(
        gateway({ sync: { at: "2026-10-12T10:00:00Z", ok: false, error: "401", lastOkAt: null } }),
      ),
    ).toEqual({ state: "problem", detail: "The last sync with the gateway failed: 401" });
  });

  it("is Connected as of the sync, with the pools it holds when they were read", () => {
    expect(gatewayConnection(gateway())).toEqual({
      state: "connected",
      detail: "Gateway synced · 2 model pools",
      checkedAt: "2026-10-12T10:00:00Z",
    });
    expect(gatewayConnection(gateway({}, 1)).detail).toBe("Gateway synced · 1 model pool");
    expect(gatewayConnection(gateway({}, null)).detail).toBe("Gateway synced");
  });
});

describe("the person's Slack account", () => {
  const me = (extra: Partial<PeerSlackMe> = {}): PeerSlackMe => ({
    connected: true,
    team: { id: "T1", name: "Acme" },
    bot: { name: "peer" },
    link: null,
    pending: null,
    settings: { enabled: false, delayMinutes: 2, place: "thread", kinds: [] },
    projects: [],
    ...extra,
  });
  const link = { slackUser: "U1", name: "slavo", linkedAt: "2026-10-01T09:00:00Z" };

  it("waits for the workspace to connect Slack, which is not the person's to do", () => {
    expect(slackAccountConnection(readyFact(me({ connected: false })))).toEqual({
      state: "off",
      label: "Waiting",
      detail: "For the workspace to connect Slack.",
    });
  });

  it("needs setup until linked, and says what the link waits for", () => {
    expect(slackAccountConnection(readyFact(me())).state).toBe("setup");
    expect(
      slackAccountConnection(
        readyFact(
          me({ pending: { kind: "code", code: "A1B2", expiresAt: "2026-10-12T10:30:00Z" } }),
        ),
      ).detail,
    ).toContain("A1B2");
  });

  it("is Connected once linked, and says whether the agents' questions go there", () => {
    expect(slackAccountConnection(readyFact(me({ link }))).detail).toBe(
      "Linked as slavo. Your agents’ questions stay in Peer until you turn Slack on.",
    );
    expect(
      slackAccountConnection(
        readyFact(
          me({ link, settings: { enabled: true, delayMinutes: 2, place: "thread", kinds: [] } }),
        ),
      ),
    ).toEqual({ state: "connected", detail: "Linked as slavo. Your agents ask you in Slack." });
  });

  it("says Checking… until read, Not available on an older Hub, Problem on a failure", () => {
    expect(slackAccountConnection({ kind: "loading" })).toBe(CHECKING);
    expect(slackAccountConnection(failedFact("Slack needs a newer Peer Hub.")).state).toBe(
      "unavailable",
    );
    expect(slackAccountConnection(failedFact("boom"))).toEqual({
      state: "problem",
      detail: "boom",
    });
  });
});

describe("the AI subscriptions", () => {
  it("need setup while plans the providers detected are not added", () => {
    expect(plansConnection({ kind: "ready", added: [], detected: 2 })).toEqual({
      state: "setup",
      detail: "2 plans detected on this computer, none added.",
    });
    expect(plansConnection({ kind: "ready", added: ["Claude Max"], detected: 1 }).detail).toBe(
      "1 plan detected on this computer, 1 added.",
    );
  });

  it("are Added once the person added theirs, and Off with none at all", () => {
    expect(
      plansConnection({ kind: "ready", added: ["Claude Max", "Codex Pro"], detected: 0 }),
    ).toEqual({
      state: "connected",
      label: "Added",
      detail: "Claude Max, Codex Pro",
    });
    expect(plansConnection({ kind: "ready", added: [], detected: 0 })).toEqual({
      state: "off",
      detail: "No plan added yet.",
    });
  });

  it("are Checking… while read, and Not available on a Hub that cannot show them", () => {
    expect(plansConnection({ kind: "loading" })).toBe(CHECKING);
    expect(plansConnection({ kind: "unavailable" }).state).toBe("unavailable");
  });
});

describe("an agent provider", () => {
  const provider = (extra: Partial<ServerProvider> = {}): ServerProvider => ({
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "0.47.0",
    status: "ready",
    auth: { status: "authenticated", label: "ChatGPT Pro" },
    checkedAt: "2026-10-12T10:15:00Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...extra,
  });

  it("is Connected with its plan and version, as of its last check", () => {
    expect(providerConnection(provider())).toEqual({
      state: "connected",
      detail: "ChatGPT Pro · v0.47.0",
      checkedAt: "2026-10-12T10:15:00Z",
    });
  });

  it("needs setup when signed out, and has a Problem when it failed its checks", () => {
    expect(providerConnection(provider({ auth: { status: "unauthenticated" } }))?.state).toBe(
      "setup",
    );
    expect(
      providerConnection(provider({ status: "error", message: "Binary crashed." })),
    ).toMatchObject({ state: "problem", detail: "Binary crashed." });
  });

  it("is not listed when it is not installed or turned off: that is not a connection", () => {
    expect(providerConnection(provider({ installed: false }))).toBeNull();
    expect(providerConnection(provider({ enabled: false }))).toBeNull();
    expect(providerConnection(provider({ status: "disabled" }))).toBeNull();
  });
});

describe("the device hub", () => {
  it("is Off until it is turned on, whatever it reports", () => {
    expect(deviceHubConnection({ enabled: false, status: "ready", detail: null }).state).toBe(
      "off",
    );
  });

  it("follows what the hub reports once it is on", () => {
    const hub = (
      status: Parameters<typeof deviceHubConnection>[0]["status"],
      detail: string | null = null,
    ) => deviceHubConnection({ enabled: true, status, detail });
    expect(hub(null)).toBe(CHECKING);
    expect(hub("starting").state).toBe("setup");
    expect(hub("ready").state).toBe("connected");
    expect(hub("failed", "No Xcode.")).toEqual({ state: "problem", detail: "No Xcode." });
  });
});

describe("the plans the providers detect", () => {
  const signedIn = (driver: string, label: string, extra: Partial<ServerProvider> = {}) =>
    ({
      instanceId: ProviderInstanceId.make(driver),
      driver: ProviderDriverKind.make(driver),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated", label },
      checkedAt: "2026-10-12T10:15:00Z",
      models: [],
      slashCommands: [],
      skills: [],
      ...extra,
    }) satisfies ServerProvider;
  const codex = signedIn("codex", "ChatGPT Pro 20x Subscription");
  const claude = signedIn("claudeAgent", "Claude Max Subscription");

  it("counts the plans AI subscriptions would offer: reported, not added, not dismissed", () => {
    expect(detectedPlanCount([codex, claude], [])).toBe(2);
    expect(detectedPlanCount([codex, claude], [{ harness: "claude", plan: "max" }])).toBe(1);
    expect(
      detectedPlanCount(
        [codex, claude],
        [
          { harness: "claude", plan: "max" },
          { harness: "codex", plan: "pro" },
        ],
      ),
    ).toBe(0);
    expect(detectedPlanCount([codex, claude], [], ["claude:max"])).toBe(1);
  });

  it("counts a plan once however many instances report it", () => {
    expect(detectedPlanCount([codex, signedIn("codex", "ChatGPT Pro 5x Subscription")], [])).toBe(
      1,
    );
  });

  it("does not count a provider that is signed out, not installed, or no agent of Peer's", () => {
    expect(
      detectedPlanCount(
        [{ ...codex, auth: { status: "unauthenticated", label: "x Subscription" } }],
        [],
      ),
    ).toBe(0);
    expect(detectedPlanCount([{ ...claude, installed: false }], [])).toBe(0);
    expect(detectedPlanCount([signedIn("cursor", "Cursor Pro Subscription")], [])).toBe(0);
  });
});
