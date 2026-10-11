import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { AuthAccessReadScope, AuthAccessWriteScope } from "../auth.ts";
import { PeerLocalAgent } from "./herdr.ts";
import { PEER_RPC_SCOPES } from "./rpcRegistry.ts";
import { PEER_SLACK_METHODS, SlackRpcGroup, SlackRpcScopes } from "./slack.rpc.ts";
import {
  PEER_SLACK_DELAYS,
  PEER_SLACK_KINDS,
  PEER_SLACK_MODES,
  PEER_SLACK_PLACES,
  PEER_SLACK_PLUGIN,
  PeerSlackAdminResult,
  PeerSlackChannels,
  PeerSlackMe,
  PeerSlackSaveSecretsInput,
  PeerSlackSetChannelsInput,
  PeerSlackSetMineInput,
} from "./slack.ts";

const decodeMe = Schema.decodeUnknownSync(PeerSlackMe);
const decodeAdmin = Schema.decodeUnknownSync(PeerSlackAdminResult);
const decodeChannels = Schema.decodeUnknownSync(PeerSlackChannels);
const decodeAgent = Schema.decodeUnknownSync(PeerLocalAgent);
const decodeSetMine = Schema.decodeUnknownSync(PeerSlackSetMineInput);
const decodeSaveSecrets = Schema.decodeUnknownSync(PeerSlackSaveSecretsInput);
const decodeSetChannels = Schema.decodeUnknownSync(PeerSlackSetChannelsInput);

const webshop = { id: "C1", name: "webshop", private: false };

/** A connected workspace as an admin's Peer reads it, with one project that needs the bot invited. */
const connectedAdmin = {
  state: "connected",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: { id: "T1", name: "Acme" },
  bot: { user: "U9", app: "A1", name: "Peer" },
  verifiedAt: "2026-10-10T08:00:00Z",
  auth: null,
  default: { id: "C0", name: "peer", private: false },
  projects: [
    {
      id: "webshop",
      name: "Webshop",
      restricted: false,
      channel: webshop,
      mode: "thread",
      problem: null,
    },
    {
      id: "client-x",
      name: "Client X",
      restricted: true,
      channel: { id: "G1", name: "client-x", private: true },
      mode: "unset",
      problem: { code: "not_in_channel", at: "2026-10-10T09:00:00Z" },
    },
  ],
  lastPostAt: "2026-10-10T09:30:00Z",
  lastFailure: { code: "ratelimited", at: "2026-10-10T09:31:00Z" },
  linkedMembers: 4,
  openAsks: 2,
  hubUrl: "https://hub.example.com",
  manifest: {
    eventsUrl: "https://hub.example.com/v1/workspaces/acme/slack/events",
    actionsUrl: "https://hub.example.com/v1/workspaces/acme/slack/actions",
  },
};

describe("Slack contracts: what the Hub shows an admin", () => {
  it("reads a connected workspace with its channels, health and problems", () => {
    const admin = decodeAdmin(connectedAdmin);
    expect(admin.team?.name).toBe("Acme");
    expect(admin.bot?.app).toBe("A1");
    expect(
      admin.projects.map((project) => [project.id, project.mode, project.problem?.code]),
    ).toEqual([
      ["webshop", "thread", undefined],
      ["client-x", "unset", "not_in_channel"],
    ]);
    expect(admin.manifest.eventsUrl).toBe(
      "https://hub.example.com/v1/workspaces/acme/slack/events",
    );
  });

  it("reads the admin view of a workspace that was never set up", () => {
    const admin = decodeAdmin({
      state: "off",
      secrets: { botToken: "missing", signingSecret: "missing" },
      team: null,
      bot: null,
      verifiedAt: null,
      auth: null,
      default: null,
      projects: [],
      lastPostAt: null,
      lastFailure: null,
      linkedMembers: 0,
      openAsks: 0,
      hubUrl: "https://hub.example.com",
      manifest: { eventsUrl: "https://hub.example.com/e", actionsUrl: "https://hub.example.com/a" },
    });
    expect(admin.state).toBe("off");
    expect(admin.team).toBeNull();
    expect(admin.projects).toEqual([]);
  });

  it("does not need the bot's app until Slack has sent an event", () => {
    const withoutApp = decodeAdmin({
      ...connectedAdmin,
      bot: { user: "U9", app: null, name: "Peer" },
    });
    expect(withoutApp.bot?.app).toBeNull();
    const minimal = decodeAdmin({ ...connectedAdmin, bot: { name: "Peer" } });
    expect(minimal.bot?.user).toBeUndefined();
  });

  it("lists who linked a Slack account when the Hub does, and only counts them when it does not", () => {
    const counted = decodeAdmin(connectedAdmin);
    expect(counted.members).toBeUndefined();
    expect(counted.linkedMembers).toBe(4);
    const listed = decodeAdmin({
      ...connectedAdmin,
      members: [
        {
          email: "eva@acme.dev",
          name: "Eva",
          link: { slackUser: "U1", name: "eva", linkedAt: "2026-10-01T09:00:00Z" },
        },
      ],
    });
    expect(listed.members?.map((member) => [member.email, member.link.name])).toEqual([
      ["eva@acme.dev", "eva"],
    ]);
  });

  it("reads the channels to pick from, with whether the bot is in each", () => {
    const answer = decodeChannels({
      channels: [
        { ...webshop, member: true },
        { id: "G1", name: "client-x", private: true, member: false },
      ],
    });
    expect(answer.channels.map((channel) => channel.member)).toEqual([true, false]);
  });
});

describe("Slack contracts: what the Hub shows a member", () => {
  it("reads a linked member's options and the projects they can reach", () => {
    const me = decodeMe({
      connected: true,
      team: { id: "T1", name: "Acme" },
      bot: { name: "Peer" },
      link: { slackUser: "U2", name: "Ana", linkedAt: "2026-10-09T10:00:00Z" },
      pending: null,
      settings: {
        enabled: true,
        delayMinutes: 2,
        place: "direct",
        kinds: ["approval", "finished"],
      },
      projects: [
        { id: "webshop", name: "Webshop", mode: "thread" },
        { id: "client-x", name: "Client X", mode: "unset" },
      ],
    });
    expect(me.link?.name).toBe("Ana");
    expect(me.settings.kinds).toEqual(["approval", "finished"]);
    expect(me.projects.map((project) => project.mode)).toEqual(["thread", "unset"]);
  });

  it("reads a workspace without Slack, and a link that waits for its proof", () => {
    const off = decodeMe({
      connected: false,
      team: null,
      bot: null,
      link: null,
      pending: null,
      settings: { enabled: false, delayMinutes: 5, place: "thread", kinds: PEER_SLACK_KINDS },
      projects: [],
    });
    expect(off.connected).toBe(false);
    expect(off.settings.enabled).toBe(false);

    const waiting = { ...off, connected: true };
    const byButton = decodeMe({
      ...waiting,
      pending: { kind: "dm", name: "Ana", expiresAt: "2026-10-10T10:15:00Z" },
    });
    expect(byButton.pending).toEqual({
      kind: "dm",
      name: "Ana",
      expiresAt: "2026-10-10T10:15:00Z",
    });
    const byCode = decodeMe({
      ...waiting,
      pending: { kind: "code", code: "482913", expiresAt: "2026-10-10T10:15:00Z" },
    });
    expect(byCode.pending?.code).toBe("482913");
  });
});

describe("Slack contracts: a newer Hub", () => {
  it("decodes states, modes, places, kinds, delays and problems this build does not know", () => {
    const admin = decodeAdmin({
      ...connectedAdmin,
      state: "paused",
      secrets: { botToken: "rotating", signingSecret: "stored" },
      auth: { code: "future_error", at: "2026-10-10T09:00:00Z" },
      projects: [{ ...connectedAdmin.projects[0], mode: "digest" }],
      extra: "ignored",
    });
    expect(admin.state).toBe("paused");
    expect(admin.secrets.botToken).toBe("rotating");
    expect(admin.auth?.code).toBe("future_error");
    expect(admin.projects[0]?.mode).toBe("digest");

    const me = decodeMe({
      connected: true,
      team: null,
      bot: null,
      link: null,
      pending: { kind: "qr", expiresAt: "2026-10-10T10:15:00Z" },
      settings: {
        enabled: true,
        delayMinutes: 30,
        place: "channel",
        kinds: ["approval", "digest"],
      },
      projects: [{ id: "p", name: "P", mode: "digest" }],
    });
    expect(me.pending?.kind).toBe("qr");
    expect(me.settings).toMatchObject({ delayMinutes: 30, place: "channel" });
    expect(me.settings.kinds).toEqual(["approval", "digest"]);
  });

  it("reads an agent entry from before sessions and turns were listed, and one with them", () => {
    const older = decodeAgent({ id: "herdr:t1", paneId: "w1:p1", title: "Claude", status: "idle" });
    expect(older.session).toBeUndefined();
    expect(older.turn).toBeUndefined();
    const newer = decodeAgent({
      id: "herdr:claude:abc",
      paneId: "w1:p1",
      title: "Claude",
      status: "done",
      session: "abc",
      turn: 12,
    });
    expect([newer.session, newer.turn]).toEqual(["abc", 12]);
  });
});

describe("Slack contracts: what clients send", () => {
  it("takes the options this build offers, one at a time or together", () => {
    expect(decodeSetMine({ workspace: " acme ", enabled: true })).toEqual({
      workspace: "acme",
      enabled: true,
    });
    for (const delayMinutes of PEER_SLACK_DELAYS) {
      expect(decodeSetMine({ workspace: "acme", delayMinutes }).delayMinutes).toBe(delayMinutes);
    }
    for (const place of PEER_SLACK_PLACES) {
      expect(decodeSetMine({ workspace: "acme", place }).place).toBe(place);
    }
    expect(decodeSetMine({ workspace: "acme", kinds: [...PEER_SLACK_KINDS] }).kinds).toEqual([
      ...PEER_SLACK_KINDS,
    ]);
  });

  it("refuses a delay, place or kind the Hub does not offer", () => {
    expect(() => decodeSetMine({ workspace: "acme", delayMinutes: 7 })).toThrow();
    expect(() => decodeSetMine({ workspace: "acme", place: "channel" })).toThrow();
    expect(() => decodeSetMine({ workspace: "acme", kinds: ["approval", "digest"] })).toThrow();
  });

  it("takes pasted secrets without their surrounding whitespace, and refuses empty or oversized ones", () => {
    expect(
      decodeSaveSecrets({ workspace: "acme", botToken: " xoxb-1 \n", signingSecret: "abc" }),
    ).toEqual({ workspace: "acme", botToken: "xoxb-1", signingSecret: "abc" });
    expect(decodeSaveSecrets({ workspace: "acme", signingSecret: "abc" }).botToken).toBeUndefined();
    expect(() => decodeSaveSecrets({ workspace: "acme", botToken: "  " })).toThrow();
    expect(() => decodeSaveSecrets({ workspace: "acme", botToken: "x".repeat(8_193) })).toThrow();
  });

  it("sets and clears channels, and refuses a mode that cannot be set", () => {
    expect(
      decodeSetChannels({
        workspace: "acme",
        default: null,
        projects: {
          webshop: { channel: "C1", mode: "thread" },
          "client-x": { channel: null },
          support: { mode: "off" },
        },
      }),
    ).toEqual({
      workspace: "acme",
      default: null,
      projects: {
        webshop: { channel: "C1", mode: "thread" },
        "client-x": { channel: null },
        support: { mode: "off" },
      },
    });
    for (const mode of PEER_SLACK_MODES) {
      expect(
        decodeSetChannels({ workspace: "acme", projects: { p: { mode } } }).projects?.p?.mode,
      ).toBe(mode);
    }
    expect(() =>
      decodeSetChannels({ workspace: "acme", projects: { p: { mode: "unset" } } }),
    ).toThrow();
    expect(() => decodeSetChannels({ workspace: "acme", default: "" })).toThrow();
  });
});

describe("Slack's RPCs", () => {
  const methods = Object.values(PEER_SLACK_METHODS);

  it("name the plugin and the Hub feature it needs", () => {
    expect(PEER_SLACK_PLUGIN).toMatchObject({
      id: "slack",
      title: "Slack",
      hubFeature: { id: "slack", revision: 1 },
    });
    expect(methods.every((method) => method.startsWith("peer.slack."))).toBe(true);
    expect(new Set(SlackRpcGroup.requests.keys())).toEqual(new Set(methods));
  });

  it("let only the three reads run with access-read, and everything that changes something need access-write", () => {
    const reads = methods.filter((method) => SlackRpcScopes[method] === AuthAccessReadScope);
    expect(reads.toSorted()).toEqual(["peer.slack.admin", "peer.slack.channels", "peer.slack.me"]);
    const others = methods.filter((method) => SlackRpcScopes[method] !== AuthAccessReadScope);
    expect(others.every((method) => SlackRpcScopes[method] === AuthAccessWriteScope)).toBe(true);
    expect(others).toHaveLength(methods.length - 3);
    // The server authorizes from Peer's merged table.
    for (const method of methods) expect(PEER_RPC_SCOPES[method]).toBe(SlackRpcScopes[method]);
  });
});
