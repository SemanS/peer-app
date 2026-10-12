import type { PeerSlackAdminResult, PeerSlackMe } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CHECKING, failedFact, readyFact } from "../../settings/connectionFacts";
import { slackAdminConnection, slackMemberConnection } from "./slackConnection.logic";

const admin = (extra: Partial<PeerSlackAdminResult> = {}): PeerSlackAdminResult => ({
  state: "connected",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: { id: "T1", name: "Acme" },
  bot: { name: "peer" },
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

const connection = (extra: Partial<PeerSlackAdminResult> = {}) =>
  slackAdminConnection(readyFact(admin(extra)), "Acme");

describe("Slack for an admin", () => {
  it("is Off while nothing is stored, and never claims a step", () => {
    expect(
      connection({
        state: "off",
        secrets: { botToken: "missing", signingSecret: "missing" },
        team: null,
        verifiedAt: null,
        default: null,
      }),
    ).toEqual({ state: "off", detail: "Not set up for Acme yet" });
  });

  it("needs setup at step 2 while one value is stored", () => {
    expect(
      connection({
        state: "needs-setup",
        secrets: { botToken: "stored", signingSecret: "missing" },
        team: null,
        verifiedAt: null,
        default: null,
      }),
    ).toEqual({
      state: "setup",
      step: { n: 2, of: 4, title: "install it and copy two values" },
    });
  });

  it("needs setup at step 3, never Off, once both values are stored and not verified", () => {
    const view = connection({
      state: "needs-setup",
      team: null,
      verifiedAt: null,
      default: null,
    });
    expect(view).toEqual({
      state: "setup",
      step: { n: 3, of: 4, title: "verify the stored token with Slack" },
    });
    expect(view.state).not.toBe("off");
  });

  it("needs setup at step 4 until agents have a place to post", () => {
    expect(connection({ default: null })).toEqual({
      state: "setup",
      step: { n: 4, of: 4, title: "choose where agents post" },
    });
    // A project with its own channel or direct messages is a place too.
    expect(
      connection({
        default: null,
        projects: [
          {
            id: "booking",
            name: "Booking",
            restricted: false,
            channel: null,
            mode: "direct",
            problem: null,
          },
        ],
      }).state,
    ).toBe("connected");
  });

  it("is connected to the Slack workspace and its bot, as of the last verification", () => {
    expect(connection()).toEqual({
      state: "connected",
      detail: "Acme as @peer",
      checkedAt: "2026-10-11T09:00:00Z",
    });
    expect(connection({ bot: null }).detail).toBe("Acme");
  });

  it("is a problem, before any step, when Slack rejects the token", () => {
    expect(
      connection({
        state: "needs-setup",
        auth: { code: "invalid_auth", at: "2026-10-11T10:42:00Z" },
      }),
    ).toEqual({
      state: "problem",
      detail: "Slack does not accept the bot token; store it again and choose Verify.",
    });
  });

  it("is a problem, naming the project, when a channel cannot be posted to", () => {
    expect(
      connection({
        projects: [
          {
            id: "booking",
            name: "Booking",
            restricted: false,
            channel: { id: "C2", name: "booking", private: false },
            mode: "thread",
            problem: { code: "not_in_channel", at: "2026-10-11T10:42:00Z" },
          },
        ],
      }),
    ).toEqual({ state: "problem", detail: "Booking: Invite @Peer to the channel." });
  });

  it("says Checking… until the connection is read, and a problem only when the read failed", () => {
    expect(slackAdminConnection({ kind: "loading" }, "Acme")).toBe(CHECKING);
    expect(slackAdminConnection(failedFact("The Hub refused."), "Acme")).toEqual({
      state: "problem",
      detail: "The Hub refused.",
    });
  });

  it("is not available on a Hub without Slack", () => {
    expect(slackAdminConnection(failedFact("Slack needs a newer Peer Hub."), "Acme")).toEqual({
      state: "unavailable",
      detail: "This Peer Hub has no Slack support yet; it must be updated.",
    });
  });
});

const member = (extra: Partial<PeerSlackMe> = {}): PeerSlackMe => ({
  connected: true,
  team: { id: "T1", name: "Acme" },
  bot: { name: "peer" },
  link: null,
  pending: null,
  settings: { enabled: false, delayMinutes: 2, place: "thread", kinds: [] },
  projects: [],
  ...extra,
});

describe("Slack for a member", () => {
  it("is Off, not something to finish, until the workspace connects Slack", () => {
    expect(
      slackMemberConnection(readyFact(member({ connected: false, team: null, bot: null })), "Acme"),
    ).toEqual({ state: "off", detail: "Acme hasn’t connected Slack. An admin does." });
  });

  it("is connected to the Slack workspace once the admin finished", () => {
    expect(slackMemberConnection(readyFact(member()), "Acme")).toEqual({
      state: "connected",
      detail: "Acme as @peer",
    });
  });

  it("reads like the admin's view while it is unread, failed or on an older Hub", () => {
    expect(slackMemberConnection({ kind: "loading" }, "Acme")).toBe(CHECKING);
    expect(slackMemberConnection(failedFact("boom"), "Acme").state).toBe("problem");
    expect(slackMemberConnection(failedFact("Slack needs a newer Peer Hub."), "Acme").state).toBe(
      "unavailable",
    );
  });
});
