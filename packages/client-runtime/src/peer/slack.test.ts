import { describe, expect, it } from "@effect/vitest";
import {
  PEER_SLACK_DELAYS,
  PEER_SLACK_KINDS,
  PEER_SLACK_MODES,
  PEER_SLACK_PLACES,
  type PeerSlackAdmin,
  type PeerSlackMe,
} from "@t3tools/contracts";

import {
  SLACK_LINK_FIRST,
  isSlackAdmin,
  slackCreateAppUrl,
  slackDelayChoices,
  slackDelayOf,
  slackDelayLabel,
  slackActivityRows,
  slackConnectionRows,
  slackKindLabel,
  slackKindsWith,
  slackLinkView,
  slackLoad,
  slackManifest,
  slackMemberPart,
  slackMemberView,
  slackModeLabel,
  slackOlderHub,
  slackPlaceChoices,
  slackPlaceOf,
  slackPlaceLabel,
  slackProblemSentence,
  slackSetupStep,
  slackStateLabel,
  type SlackFormat,
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

describe("Slack roles and older Hubs", () => {
  it("lets owners and admins connect Slack, and nobody else", () => {
    expect(isSlackAdmin("owner")).toBe(true);
    expect(isSlackAdmin("admin")).toBe(true);
    expect(isSlackAdmin("member")).toBe(false);
  });

  it("recognizes the refusals that say the Hub has no Slack support", () => {
    expect(slackOlderHub("Slack needs a newer Peer Hub.")).toBe(true);
    expect(slackOlderHub("The Hub must be updated before Slack works.")).toBe(true);
    expect(slackOlderHub("This Peer Hub has no Slack support yet; it must be updated.")).toBe(true);
  });

  it("leaves every other failure to be retried", () => {
    expect(slackOlderHub("Could not reach the hub at https://hub.example.com.")).toBe(false);
    expect(slackOlderHub("Only owners and admins can change Slack.")).toBe(false);
    expect(slackOlderHub("Slack is turned off on this environment.")).toBe(false);
    expect(slackOlderHub("The environment request failed.")).toBe(false);
  });
});

const me = (changes: Partial<PeerSlackMe> = {}): PeerSlackMe => ({
  connected: true,
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer" },
  link: null,
  pending: null,
  settings: {
    enabled: false,
    delayMinutes: 5,
    place: "thread",
    kinds: ["approval", "question", "finished", "blocked"],
  },
  projects: [],
  ...changes,
});
const format: SlackFormat = {
  time: (iso) => iso.slice(11, 16),
  dateTime: (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`,
};
const link = { slackUser: "U1", name: "Ana", linkedAt: "2026-10-09T08:00:00Z" };
const soon = "2026-10-10T12:15:00Z";

describe("what the Slack section loads", () => {
  const nothing = { data: null, error: null };
  const held = { data: me(), error: null };
  const connection = { data: { state: "connected" }, error: null };

  it("waits for what the person's role reads", () => {
    expect(slackLoad(false, { me: nothing, admin: nothing })).toEqual({ kind: "loading" });
    expect(slackLoad(true, { me: held, admin: nothing })).toEqual({ kind: "loading" });
    expect(slackLoad(true, { me: nothing, admin: connection })).toEqual({ kind: "loading" });
  });

  it("is ready with the member's view, and the connection for an owner or admin", () => {
    expect(slackLoad(false, { me: held, admin: nothing })).toEqual({
      kind: "ready",
      me: me(),
      admin: null,
    });
    expect(slackLoad(true, { me: held, admin: connection })).toEqual({
      kind: "ready",
      me: me(),
      admin: { state: "connected" },
    });
  });

  it("never lets a member's section wait on or fail with the connection they cannot read", () => {
    const refused = { data: null, error: "Only owners and admins can change Slack." };
    expect(slackLoad(false, { me: held, admin: refused }).kind).toBe("ready");
  });

  it("shows a failure instead of data it already holds, so Retry is offered", () => {
    const failed = { data: me(), error: "Could not reach the hub at https://hub.example.com." };
    expect(slackLoad(false, { me: failed, admin: nothing })).toEqual({
      kind: "error",
      message: "Could not reach the hub at https://hub.example.com.",
    });
    expect(
      slackLoad(true, { me: held, admin: { data: null, error: "Slack is turned off." } }),
    ).toEqual({ kind: "error", message: "Slack is turned off." });
  });

  it("tells a Hub without Slack support apart from a failure to retry", () => {
    const old = { data: null, error: "Slack needs a newer Peer Hub." };
    expect(slackLoad(false, { me: old, admin: nothing })).toEqual({ kind: "older-hub" });
    expect(slackLoad(true, { me: held, admin: old })).toEqual({ kind: "older-hub" });
  });
});

describe("a member's link", () => {
  it("reads linked with the name Slack knows them by", () => {
    expect(slackLinkView(me({ link }), format)).toEqual({
      kind: "linked",
      text: "Linked as Ana",
    });
  });

  it("reads not linked when nothing was started", () => {
    expect(slackLinkView(me(), format)).toEqual({ kind: "none", text: "Not linked" });
  });

  it("tells a member who was sent a button where to confirm", () => {
    const pending = { kind: "dm", name: "Ana", expiresAt: soon };
    expect(slackLinkView(me({ pending }), format)).toEqual({
      kind: "pending",
      text: "Confirm in the direct message Peer sent to Ana in Slack, before 12:15.",
    });
  });

  it("gives the code and the bot to send it to", () => {
    const pending = { kind: "code", code: "123456", expiresAt: soon };
    expect(slackLinkView(me({ pending }), format)).toEqual({
      kind: "pending",
      text: "Send 123456 to @Peer in a direct message in Slack, before 12:15.",
    });
    // The bot is named by the Hub; a Hub that sent none still has the app's default name.
    expect(slackLinkView(me({ pending, bot: null }), format).text).toContain("@Peer ");
    expect(slackLinkView(me({ pending, bot: { name: "Helper" } }), format).text).toContain(
      "@Helper ",
    );
  });

  it("asks to finish in Slack for a proof a newer Hub invented, and for a code that is missing", () => {
    for (const pending of [
      { kind: "passkey", expiresAt: soon },
      { kind: "code", expiresAt: soon },
    ]) {
      expect(slackLinkView(me({ pending }), format)).toEqual({
        kind: "pending",
        text: "Finish linking in Slack, before 12:15.",
      });
    }
  });

  it("prefers the link over a request still lying around", () => {
    const pending = { kind: "dm", name: "Ana", expiresAt: soon };
    expect(slackLinkView(me({ link, pending }), format).kind).toBe("linked");
  });
});

describe("a member's options", () => {
  it("keeps the switch off until the account is linked, and says why", () => {
    const view = slackMemberView(me(), format);
    expect(view).toMatchObject({
      on: false,
      switchReason: SLACK_LINK_FIRST,
      delay: 5,
      place: "thread",
    });
    expect(view.kinds).toEqual([...PEER_SLACK_KINDS]);
    // Waiting for proof is not a link yet.
    const pending = { kind: "code", code: "123456", expiresAt: soon };
    expect(slackMemberView(me({ pending }), format).switchReason).toBe(SLACK_LINK_FIRST);
  });

  it("lets a linked member turn it on", () => {
    expect(slackMemberView(me({ link }), format)).toMatchObject({
      on: false,
      switchReason: null,
    });
  });

  it("always lets a member turn it off, even when the link is gone", () => {
    const settings = { ...me().settings, enabled: true };
    expect(slackMemberView(me({ settings }), format)).toMatchObject({
      on: true,
      switchReason: null,
    });
  });

  it("carries the member's delay, place and kinds as the Hub holds them", () => {
    const settings = { enabled: true, delayMinutes: 15, place: "direct", kinds: ["approval"] };
    expect(slackMemberView(me({ link, settings }), format)).toMatchObject({
      on: true,
      delay: 15,
      place: "direct",
      kinds: ["approval"],
    });
  });

  it("adds and removes one kind and keeps Peer's order", () => {
    expect(slackKindsWith(["finished", "approval"], "question", true)).toEqual([
      "approval",
      "question",
      "finished",
    ]);
    expect(slackKindsWith(["approval", "question"], "approval", false)).toEqual(["question"]);
    expect(slackKindsWith([], "blocked", false)).toEqual([]);
    // A kind only a newer Hub knows cannot be sent back, so it is not kept.
    expect(slackKindsWith(["digest", "approval"], "blocked", true)).toEqual([
      "approval",
      "blocked",
    ]);
  });

  it("sends only the delays and places this build offers", () => {
    expect(slackDelayOf(0)).toBe(0);
    expect(slackDelayOf(15)).toBe(15);
    expect(slackDelayOf(30)).toBeNull();
    expect(slackPlaceOf("direct")).toBe("direct");
    expect(slackPlaceOf("channel")).toBeNull();
  });

  it("offers this build's delays and places, and the one a newer Hub holds", () => {
    expect(slackDelayChoices(5)).toEqual([0, 2, 5, 15]);
    expect(slackDelayChoices(30)).toEqual([0, 2, 5, 15, 30]);
    expect(slackDelayChoices(1)).toEqual([0, 1, 2, 5, 15]);
    expect(slackPlaceChoices("direct")).toEqual(["thread", "direct"]);
    expect(slackPlaceChoices("channel")).toEqual(["thread", "direct", "channel"]);
  });
});

describe("a member's part of the Slack section", () => {
  it("gives every member their options once Slack is connected", () => {
    for (const admin of [false, true]) {
      expect(slackMemberPart(admin, me(), format)).toMatchObject({
        kind: "options",
        view: { on: false, switchReason: SLACK_LINK_FIRST },
      });
    }
  });

  it("tells a member of a workspace without Slack to ask an admin", () => {
    expect(slackMemberPart(false, me({ connected: false }), format)).toEqual({
      kind: "unconnected",
    });
  });

  it("leaves an owner or admin to the connection until Slack is connected", () => {
    expect(slackMemberPart(true, me({ connected: false }), format)).toBeNull();
  });
});

describe("what an owner or admin reads of the connection", () => {
  it("names its state, the Slack workspace and the bot", () => {
    expect(slackConnectionRows(admin())).toEqual([
      { label: "State", value: "Connected" },
      { label: "Slack workspace", value: "Acme" },
      { label: "Bot", value: "Peer" },
    ]);
  });

  it("leaves out the Slack workspace and bot until Slack has confirmed them", () => {
    expect(slackConnectionRows(admin({ state: "off", team: null, bot: null }))).toEqual([
      { label: "State", value: "Off" },
    ]);
  });

  it("lists the last post and failure and how many members and agents are involved", () => {
    const view = admin({
      lastPostAt: "2026-10-10T09:15:00Z",
      lastFailure: { code: "not_in_channel", at: "2026-10-10T09:05:00Z" },
      linkedMembers: 3,
      openAsks: 1,
    });
    expect(slackActivityRows(view, format)).toEqual([
      { label: "Last post", value: "2026-10-10 09:15" },
      { label: "Last failure", value: "Invite @Peer to the channel. (2026-10-10 09:05)" },
      { label: "Linked members", value: "3" },
      { label: "Waiting for an answer", value: "1" },
    ]);
  });

  it("says so when nothing was posted or failed", () => {
    expect(slackActivityRows(admin(), format)).toEqual([
      { label: "Last post", value: "No post yet" },
      { label: "Last failure", value: "None" },
      { label: "Linked members", value: "0" },
      { label: "Waiting for an answer", value: "0" },
    ]);
  });
});
