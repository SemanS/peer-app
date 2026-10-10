import { describe, expect, it } from "@effect/vitest";
import {
  PEER_SLACK_DELAYS,
  PEER_SLACK_KINDS,
  PEER_SLACK_MODES,
  PEER_SLACK_PLACES,
  type PeerSlackAdmin,
} from "@t3tools/contracts";

import {
  slackCreateAppUrl,
  slackDelayLabel,
  slackKindLabel,
  slackManifest,
  slackModeLabel,
  slackPlaceLabel,
  slackProblemSentence,
  slackSetupStep,
  slackStateLabel,
} from "./slack.ts";

describe("the Slack app manifest", () => {
  const manifest = slackManifest("https://hub.example.com", "acme");

  it("names this workspace's addresses on the Hub, with Socket Mode off", () => {
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      "https://hub.example.com/v1/workspaces/acme/slack/events",
    );
    expect(manifest.settings.interactivity).toEqual({
      is_enabled: true,
      request_url: "https://hub.example.com/v1/workspaces/acme/slack/actions",
    });
    expect(manifest.settings).toMatchObject({
      socket_mode_enabled: false,
      org_deploy_enabled: false,
      token_rotation_enabled: false,
    });
  });

  it("asks for exactly the scopes and events the feature uses, and lets people message the bot", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual([
      "chat:write",
      "channels:read",
      "channels:join",
      "channels:history",
      "groups:read",
      "groups:history",
      "im:write",
      "im:history",
      "reactions:write",
      "users:read",
      "users:read.email",
    ]);
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([
      "message.channels",
      "message.groups",
      "message.im",
    ]);
    expect(manifest.features).toEqual({
      bot_user: { display_name: "Peer", always_online: true },
      app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    });
    expect(manifest.display_information.name).toBe("Peer");
  });

  it("builds the same addresses whatever way the Hub address was written", () => {
    const events = (hub: string, slug = "acme") =>
      slackManifest(hub, slug).settings.event_subscriptions.request_url;
    const expected = "https://hub.example.com/v1/workspaces/acme/slack/events";
    expect(events("https://hub.example.com/")).toBe(expected);
    expect(events("https://hub.example.com///")).toBe(expected);
    expect(events("  https://hub.example.com \n")).toBe(expected);
    // A Hub served below a path keeps it.
    expect(events("https://example.com/peer/")).toBe(
      "https://example.com/peer/v1/workspaces/acme/slack/events",
    );
    // A slug is one path segment, whatever it holds.
    expect(events("https://hub.example.com", "a/b?c")).toBe(
      "https://hub.example.com/v1/workspaces/a%2Fb%3Fc/slack/events",
    );
  });

  it("makes a link that opens Slack's app creation with the same manifest", () => {
    const link = new URL(slackCreateAppUrl(manifest));
    expect(`${link.origin}${link.pathname}`).toBe("https://api.slack.com/apps");
    expect(link.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(link.searchParams.get("manifest_json") ?? "")).toEqual(manifest);
    // The manifest travels encoded, so no quote, brace or space ends the query early.
    expect(slackCreateAppUrl(manifest).split("manifest_json=")[1]).toBe(
      encodeURIComponent(JSON.stringify(manifest)),
    );
  });
});

const channel = { id: "C0", name: "peer", private: false };
const admin = (changes: Partial<PeerSlackAdmin> = {}): PeerSlackAdmin => ({
  state: "connected",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: { id: "T1", name: "Acme" },
  bot: { user: "U9", app: "A1", name: "Peer" },
  verifiedAt: "2026-10-10T08:00:00Z",
  auth: null,
  default: channel,
  projects: [],
  lastPostAt: null,
  lastFailure: null,
  linkedMembers: 0,
  openAsks: 0,
  ...changes,
});
const project = (changes: Partial<PeerSlackAdmin["projects"][number]> = {}) => ({
  id: "webshop",
  name: "Webshop",
  restricted: false,
  channel: null,
  mode: "thread",
  problem: null,
  ...changes,
});
const missing = { botToken: "missing", signingSecret: "missing" };

describe("Slack setup steps", () => {
  it("starts with creating the app while no secret is stored", () => {
    const view = admin({
      state: "off",
      secrets: missing,
      team: null,
      bot: null,
      verifiedAt: null,
      default: null,
    });
    expect(slackSetupStep(view)).toEqual({ step: "create", problems: [] });
  });

  it("asks for the other secret when only one is stored", () => {
    for (const secrets of [
      { botToken: "stored", signingSecret: "missing" },
      { botToken: "missing", signingSecret: "stored" },
    ]) {
      expect(
        slackSetupStep(admin({ state: "needs-setup", secrets, team: null, verifiedAt: null })).step,
      ).toBe("secrets");
    }
  });

  it("asks to verify once both are stored but Slack has not accepted them", () => {
    const stored = { state: "off", team: null, bot: null, verifiedAt: null, default: null };
    expect(slackSetupStep(admin(stored)).step).toBe("verify");
    expect(slackSetupStep(admin({ ...stored, state: "needs-setup" })).step).toBe("verify");
  });

  it("sends a revoked token back to verify and says why", () => {
    const view = admin({
      state: "needs-setup",
      auth: { code: "token_revoked", at: "2026-10-10T09:00:00Z" },
    });
    const { step, problems } = slackSetupStep(view);
    expect(step).toBe("verify");
    expect(problems).toEqual([
      {
        code: "token_revoked",
        sentence: slackProblemSentence("token_revoked"),
        at: "2026-10-10T09:00:00Z",
      },
    ]);
    expect(problems[0]?.project).toBeUndefined();
  });

  it("sends a disconnected workspace back to verify, however much it still holds", () => {
    expect(slackSetupStep(admin({ state: "off" })).step).toBe("verify");
    expect(slackSetupStep(admin({ state: "future-state" })).step).toBe("verify");
  });

  it("asks for a place to post once verified", () => {
    const view = admin({ default: null, projects: [project({ mode: "unset" })] });
    expect(slackSetupStep(view).step).toBe("channels");
  });

  it("is connected once there is a default channel, a project's own channel, or direct messages", () => {
    expect(slackSetupStep(admin()).step).toBe("connected");
    expect(slackSetupStep(admin({ default: null, projects: [project({ channel })] })).step).toBe(
      "connected",
    );
    expect(
      slackSetupStep(admin({ default: null, projects: [project({ mode: "direct" })] })).step,
    ).toBe("connected");
  });

  it("names the project of a channel problem beside the problems of the app", () => {
    const view = admin({
      projects: [
        project({ id: "ok", channel }),
        project({
          id: "client-x",
          restricted: true,
          channel: { id: "G1", name: "client-x", private: true },
          mode: "unset",
          problem: { code: "not_in_channel", at: "2026-10-10T09:05:00Z" },
        }),
      ],
    });
    const { step, problems } = slackSetupStep(view);
    expect(step).toBe("connected");
    expect(problems).toEqual([
      {
        code: "not_in_channel",
        sentence: "Invite @Peer to the channel.",
        at: "2026-10-10T09:05:00Z",
        project: "client-x",
      },
    ]);
  });
});

describe("Slack labels", () => {
  it("describe every value this build sends in words", () => {
    for (const kind of PEER_SLACK_KINDS) expect(slackKindLabel(kind)).not.toBe(kind);
    for (const mode of [...PEER_SLACK_MODES, "unset"]) expect(slackModeLabel(mode)).not.toBe(mode);
    for (const place of PEER_SLACK_PLACES) expect(slackPlaceLabel(place)).not.toBe(place);
    for (const state of ["off", "needs-setup", "connected"]) {
      expect(slackStateLabel(state)).not.toBe(state);
    }
    expect(PEER_SLACK_DELAYS.map(slackDelayLabel)).toEqual([
      "Right away",
      "After 2 minutes",
      "After 5 minutes",
      "After 15 minutes",
    ]);
  });

  it("show a value from a newer Hub as the text it sent", () => {
    expect(slackKindLabel("digest")).toBe("digest");
    expect(slackModeLabel("quiet")).toBe("quiet");
    expect(slackPlaceLabel("channel")).toBe("channel");
    expect(slackStateLabel("paused")).toBe("paused");
    expect(slackProblemSentence("some_new_error")).toBe("some_new_error");
    expect(slackDelayLabel(30)).toBe("After 30 minutes");
    expect(slackDelayLabel(1)).toBe("After 1 minute");
  });

  it("turn the codes the Hub records into one sentence each", () => {
    for (const code of [
      "invalid_auth",
      "not_authed",
      "token_revoked",
      "token_expired",
      "account_inactive",
      "missing_scope",
      "channel_not_found",
      "not_in_channel",
      "is_archived",
      "ratelimited",
    ]) {
      const sentence = slackProblemSentence(code);
      expect(sentence).not.toBe(code);
      expect(sentence).toMatch(/[.]$/);
      expect(sentence.match(/[.]/g)).toHaveLength(1);
    }
    expect(slackProblemSentence("not_in_channel")).toBe("Invite @Peer to the channel.");
  });
});
