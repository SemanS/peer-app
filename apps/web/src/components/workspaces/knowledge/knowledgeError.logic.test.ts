import { PeerHubError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agoLabel,
  knowledgeBody,
  knowledgeErrorView,
  lineParts,
  plainText,
  readKnowledgeProblem,
  type KnowledgeErrorFacts,
  type KnowledgeErrorView,
  type KnowledgeFailure,
} from "./knowledgeError.logic";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const facts = (more: Partial<KnowledgeErrorFacts> = {}): KnowledgeErrorFacts => ({
  environment: { label: "MacBook Pro", connecting: false },
  hub: {
    url: "https://hub.webinson.com",
    version: "0.1.0",
    commit: "4787348",
    syncedAt: minutesAgo(1),
    syncError: null,
    signedIn: true,
  },
  appVersion: "0.0.45",
  lastLoadedAt: null,
  showingOlder: false,
  now: NOW,
  ...more,
});

const REQUEST = "GET /v1/workspaces/webinson/candidates/ordering-demo";

/** The 20 s timeout of the canvas's main card. */
const timeout: KnowledgeFailure = {
  kind: "unreachable",
  message: "Could not reach the hub at https://hub.webinson.com.",
  hubUrl: "https://hub.webinson.com",
  request: REQUEST,
  waitedMs: 20_000,
};

const sentence = (view: KnowledgeErrorView, index: number) => plainText(view.lines[index] ?? []);

describe("readKnowledgeProblem", () => {
  it("reads where the Hub's error says the call stopped", () => {
    const error = new PeerHubError({
      detail: "knowledge store unavailable",
      code: "knowledge_down",
      refused: false,
      kind: "refused",
      status: 502,
      hubUrl: "https://hub.webinson.com",
      request: REQUEST,
    });
    expect(readKnowledgeProblem(error)).toEqual({
      kind: "refused",
      message: "knowledge store unavailable",
      status: 502,
      code: "knowledge_down",
      hubUrl: "https://hub.webinson.com",
      request: REQUEST,
    });
    expect(
      readKnowledgeProblem(
        new PeerHubError({ detail: "x", kind: "unreachable", waitedMs: 20_000 }),
      ),
    ).toEqual({ kind: "unreachable", message: "x", waitedMs: 20_000 });
  });

  it("leaves what it cannot tell as failed, with the message as it came", () => {
    // From a server that does not say where a call stopped, or a kind a newer one does.
    expect(
      readKnowledgeProblem(
        new PeerHubError({ detail: "Could not reach the hub at https://h.test." }),
      ),
    ).toEqual({ kind: "failed", message: "Could not reach the hub at https://h.test." });
    expect(
      readKnowledgeProblem(new PeerHubError({ detail: "Slow down.", kind: "rateLimited" })),
    ).toEqual({ kind: "failed", message: "Slow down." });
    expect(readKnowledgeProblem(new Error("socket closed"))).toEqual({
      kind: "failed",
      message: "socket closed",
    });
    expect(readKnowledgeProblem("Environment x is offline.")).toEqual({
      kind: "failed",
      message: "Environment x is offline.",
    });
    expect(readKnowledgeProblem(undefined)).toEqual({
      kind: "failed",
      message: "The environment request failed.",
    });
  });

  it("says nothing was asked when the environment itself could not be reached", () => {
    for (const _tag of [
      "EnvironmentRpcUnavailableError",
      "EnvironmentNotRegisteredError",
      "ConnectionTransientError",
      "ConnectionBlockedError",
    ]) {
      expect(readKnowledgeProblem({ _tag, message: "Environment x is offline." })).toEqual({
        kind: "disconnected",
      });
    }
    // An environment that was reached and then failed is a failure of the request.
    expect(readKnowledgeProblem({ _tag: "RpcClientError", message: "closed" })).toEqual({
      kind: "failed",
      message: "closed",
    });
  });

  it("takes the Hub's fields from the Hub's error only", () => {
    expect(
      readKnowledgeProblem({
        message: "Not found",
        status: 404,
        request: "GET /x",
        kind: "refused",
      }),
    ).toEqual({ kind: "failed", message: "Not found" });
  });
});

describe("knowledgeErrorView", () => {
  it("says who asked whom, that the Hub is up on its evidence, and offers Try again and Copy details", () => {
    const view = knowledgeErrorView(timeout, facts());
    expect(view.tone).toBe("error");
    expect(view.title).toBe("Couldn’t load what to keep");
    expect(sentence(view, 0)).toBe(
      "Peer on MacBook Pro asked hub.webinson.com and got no answer within 20 seconds.",
    );
    expect(sentence(view, 1)).toBe(
      "The Hub itself is up: Peer synced with it 1 min ago. Only this request failed, so your other work is fine.",
    );
    expect(view.lines).toHaveLength(2);
    // The names a person looks for are the bold ones.
    expect(view.lines[0]).toContainEqual({ strong: "MacBook Pro" });
    expect(view.lines[0]).toContainEqual({ strong: "hub.webinson.com" });
    expect(view.actions).toEqual(["retry", "copy"]);
    expect(view.details).toEqual([
      { label: "Request", value: REQUEST, code: true },
      { label: "Route", value: "Peer on MacBook Pro → hub.webinson.com" },
      { label: "What happened", value: "No answer in 20 s (timeout)" },
      { label: "Last Hub sync", value: "1 min ago" },
      { label: "Versions", value: "Peer 0.0.45 · Hub 0.1.0 (4787348)" },
    ]);
  });

  it("says nothing of the Hub being up without a recent sync that did not fail", () => {
    const quiet = (hub: Partial<NonNullable<KnowledgeErrorFacts["hub"]>> | null) =>
      knowledgeErrorView(
        timeout,
        facts({ hub: hub === null ? null : { ...facts().hub!, ...hub } }),
      );
    for (const view of [
      quiet({ syncedAt: null }),
      quiet({ syncedAt: minutesAgo(16) }),
      quiet({ syncedAt: minutesAgo(1), syncError: "Could not reach the hub at https://h.test." }),
      quiet({ signedIn: false }),
      quiet({ syncedAt: "not a time" }),
      quiet(null),
    ]) {
      expect(view.lines.map((_, index) => sentence(view, index)).join(" ")).not.toContain("is up");
      expect(sentence(view, 1)).toBe("Check the network or VPN.");
    }
    // A sync at the edge of what Peer would call recent still counts.
    expect(sentence(quiet({ syncedAt: minutesAgo(15) }), 1)).toContain("synced with it 15 min ago");
  });

  it("tells a connection that failed from a Hub that stayed silent", () => {
    const { waitedMs: _waited, ...refusedToConnect } = timeout;
    const view = knowledgeErrorView(refusedToConnect, facts({ hub: null }));
    expect(sentence(view, 0)).toBe("Peer on MacBook Pro couldn’t reach hub.webinson.com.");
    expect(view.details.find((row) => row.label === "What happened")?.value).toBe(
      "Could not connect (network error)",
    );
    expect(view.details.find((row) => row.label === "Versions")?.value).toBe("Peer 0.0.45");
    expect(sentence(knowledgeErrorView({ ...timeout, waitedMs: 1_000 }, facts()), 0)).toContain(
      "within 1 second.",
    );
  });

  it("names the Hub by its address alone, never by a sign-in written into it", () => {
    const view = knowledgeErrorView(
      { ...timeout, hubUrl: "https://ana:secret@hub.webinson.com:8443/" },
      facts(),
    );
    expect(sentence(view, 0)).toBe(
      "Peer on MacBook Pro asked hub.webinson.com:8443 and got no answer within 20 seconds.",
    );
    expect(view.copy).not.toContain("secret");
  });

  it("falls back to the Hub the app is signed in to, and to saying the Hub, when no address is known", () => {
    const { hubUrl: _url, ...unnamed } = timeout;
    expect(sentence(knowledgeErrorView(unnamed, facts()), 0)).toContain("asked hub.webinson.com");
    expect(sentence(knowledgeErrorView(unnamed, facts({ hub: null })), 0)).toBe(
      "Peer on MacBook Pro asked the Hub and got no answer within 20 seconds.",
    );
    expect(
      sentence(
        knowledgeErrorView({ kind: "refused", message: "x", status: 502 }, facts({ hub: null })),
        0,
      ),
    ).toBe("The Hub refused with HTTP 502. Tell an admin if it stays.");
    expect(sentence(knowledgeErrorView(timeout, facts({ environment: null })), 0)).toBe(
      "Peer asked hub.webinson.com and got no answer within 20 seconds.",
    );
  });

  it("quotes the Hub's own words when it refused, and only then", () => {
    const refused: KnowledgeFailure = {
      kind: "refused",
      message: "knowledge store unavailable",
      code: "knowledge_down",
      status: 502,
      hubUrl: "https://hub.webinson.com",
      request: REQUEST,
    };
    const view = knowledgeErrorView(refused, facts());
    expect(view.tone).toBe("error");
    expect(view.lines.map((_, index) => sentence(view, index))).toEqual([
      "hub.webinson.com refused with HTTP 502: “knowledge store unavailable”. Tell an admin if it stays.",
    ]);
    expect(view.actions).toEqual(["retry", "copy"]);
    expect(view.details.find((row) => row.label === "What happened")?.value).toBe(
      "The Hub answered with an error (HTTP 502)",
    );
    expect(view.copy).toContain("Status: 502");
    expect(view.copy).toContain("Code: knowledge_down");

    // What fronts the Hub answered: its HTML is not the cause worth quoting.
    const { code: _code, ...proxied } = refused;
    expect(
      sentence(
        knowledgeErrorView(
          { ...proxied, message: "The hub answered /x with something other than JSON." },
          facts(),
        ),
        0,
      ),
    ).toBe("hub.webinson.com refused with HTTP 502. Tell an admin if it stays.");
  });

  it("says when the Hub answered something Peer could not read", () => {
    const view = knowledgeErrorView(
      {
        kind: "invalid",
        message: "x",
        status: 200,
        hubUrl: "https://hub.webinson.com",
        request: REQUEST,
      },
      facts(),
    );
    expect(sentence(view, 0)).toBe(
      "hub.webinson.com answered, but Peer couldn’t read the answer. It may be a different version than this Peer expects. Tell an admin if it stays.",
    );
    expect(view.actions).toEqual(["retry", "copy"]);
    expect(view.details.find((row) => row.label === "What happened")?.value).toBe(
      "The Hub’s answer could not be read (HTTP 200)",
    );
  });

  it("sends a Hub without knowledge to the Hub's page, never offering an empty list", () => {
    const missing: KnowledgeFailure = {
      kind: "unsupported",
      message: "This Hub has no knowledge to keep yet.",
      status: 404,
      hubUrl: "https://hub.webinson.com",
      request: REQUEST,
    };
    const view = knowledgeErrorView(missing, facts());
    expect(view.tone).toBe("warning");
    expect(view.title).toBe("This Hub can’t do it yet");
    expect(sentence(view, 0)).toBe(
      "Hub 0.1.0 has no knowledge to keep (404). An admin can update the Hub.",
    );
    expect(view.actions).toEqual(["hub"]);
    expect(view.details).toEqual([]);
    expect(view.copy).toBe("");
    // A Hub that does not say its version is named by its address.
    const unnamed = knowledgeErrorView(
      missing,
      facts({ hub: { ...facts().hub!, version: null, commit: null } }),
    );
    expect(sentence(unnamed, 0)).toBe(
      "hub.webinson.com has no knowledge to keep (404). An admin can update the Hub.",
    );
  });

  it("sends a signed-out session to sign in", () => {
    const view = knowledgeErrorView(
      {
        kind: "signedOut",
        message: "Your session with the hub ended. Sign in again.",
        status: 401,
      },
      facts(),
    );
    expect(view.tone).toBe("warning");
    expect(view.title).toBe("You’re signed out of the Hub");
    expect(sentence(view, 0)).toBe("Your Hub session ended. Sign in again to load knowledge.");
    expect(view.actions).toEqual(["signIn"]);
    expect(view.copy).toBe("");
  });

  it("keeps the message of a failure it cannot place, and lets the person ask again", () => {
    const view = knowledgeErrorView(
      { kind: "failed", message: "The environment request failed." },
      facts(),
    );
    expect(view.title).toBe("Couldn’t load what to keep");
    expect(sentence(view, 0)).toBe(
      "Peer on MacBook Pro couldn’t load this list: The environment request failed.",
    );
    expect(view.actions).toEqual(["retry", "copy"]);
    expect(view.details.find((row) => row.label === "What happened")?.value).toBe(
      "The environment request failed.",
    );
    expect(view.details.some((row) => row.label === "Request")).toBe(false);
  });

  it("says nothing was asked, and that the list is not empty, when the environment is not connected", () => {
    const disconnected = { kind: "disconnected" } as const;
    const view = knowledgeErrorView(disconnected, facts());
    expect(view.tone).toBe("neutral");
    expect(view.title).toBe("Nothing was asked");
    expect(sentence(view, 0)).toBe(
      "Peer on MacBook Pro isn’t connected right now, so this list wasn’t loaded. It isn’t empty.",
    );
    expect(view.actions).toEqual(["reconnect"]);
    expect(view.copy).toBe("");
    // An environment that is already connecting is not asked to reconnect; none known cannot be.
    expect(
      knowledgeErrorView(
        disconnected,
        facts({ environment: { label: "MacBook Pro", connecting: true } }),
      ).actions,
    ).toEqual([]);
    const unknown = knowledgeErrorView(disconnected, facts({ environment: null }));
    expect(sentence(unknown, 0)).toBe(
      "Peer isn’t connected right now, so this list wasn’t loaded. It isn’t empty.",
    );
    expect(unknown.actions).toEqual([]);
  });

  it("says when a list from before is still shown under the card, and when it loaded", () => {
    const view = knowledgeErrorView(
      timeout,
      facts({ showingOlder: true, lastLoadedAt: NOW - 12 * 60_000 }),
    );
    expect(sentence(view, 2)).toBe(
      "What is listed below loaded 12 min ago and may be out of date.",
    );
    expect(view.details.find((row) => row.label === "Last success")?.value).toBe("12 min ago");
    // No list shown, no such line.
    expect(
      knowledgeErrorView(timeout, facts({ lastLoadedAt: NOW - 12 * 60_000 })).lines,
    ).toHaveLength(2);
  });

  it("copies what a person who reports it needs: the request, where, what, when and which versions", () => {
    const view = knowledgeErrorView(timeout, facts({ lastLoadedAt: NOW - 2 * 24 * 60 * 60_000 }));
    expect(view.copy).toBe(
      [
        "Knowledge to keep couldn’t load",
        `Request: ${REQUEST}`,
        "Route: Peer on MacBook Pro → hub.webinson.com",
        "What happened: No answer in 20 s (timeout)",
        "Last success: 2 days ago (2026-10-10T12:00:00.000Z)",
        "Last Hub sync: 1 min ago (2026-10-12T11:59:00.000Z)",
        "Versions: Peer 0.0.45 · Hub 0.1.0 (4787348)",
        "As of: 2026-10-12T12:00:00.000Z",
      ].join("\n"),
    );
  });
});

describe("knowledgeBody", () => {
  it("never shows an empty list for a request that did not run, is on its way, or failed", () => {
    const body = (input: Partial<Parameters<typeof knowledgeBody>[0]>) =>
      knowledgeBody({ asked: true, loaded: true, failed: false, cards: 0, ...input });
    // Not asked: the card says so, and nothing says "nothing waits".
    expect(body({ asked: false, loaded: false })).toBe("none");
    // On its way.
    expect(body({ loaded: false })).toBe("loading");
    // Failed, with or without an earlier list.
    expect(body({ loaded: false, failed: true })).toBe("none");
    expect(body({ failed: true })).toBe("none");
    // Only a list the Hub answered, with nothing in it, is empty.
    expect(body({})).toBe("empty");
  });

  it("keeps the candidates it has, under the card of a failed refresh", () => {
    expect(knowledgeBody({ asked: true, loaded: true, failed: true, cards: 2 })).toBe("cards");
    expect(knowledgeBody({ asked: true, loaded: true, failed: false, cards: 1 })).toBe("cards");
  });
});

describe("agoLabel", () => {
  it("counts in the largest whole unit, and never in the future", () => {
    const ago = (ms: number) => agoLabel(NOW - ms, NOW);
    expect(ago(0)).toBe("just now");
    expect(ago(59_000)).toBe("just now");
    expect(ago(60_000)).toBe("1 min ago");
    expect(ago(59 * 60_000)).toBe("59 min ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(5 * 60 * 60_000)).toBe("5 hours ago");
    expect(ago(24 * 60 * 60_000)).toBe("1 day ago");
    expect(ago(2 * 24 * 60 * 60_000)).toBe("2 days ago");
    expect(ago(-60_000)).toBe("just now");
  });
});

describe("lineParts", () => {
  it("keeps a sentence's names apart from its words, each keyed by where it starts", () => {
    const line = [
      "Peer on ",
      { strong: "MacBook Pro" },
      " asked ",
      { strong: "hub.webinson.com" },
      ".",
    ];
    expect(plainText(line)).toBe("Peer on MacBook Pro asked hub.webinson.com.");
    expect(lineParts(line)).toEqual([
      { at: 0, text: "Peer on ", strong: false },
      { at: 8, text: "MacBook Pro", strong: true },
      { at: 19, text: " asked ", strong: false },
      { at: 26, text: "hub.webinson.com", strong: true },
      { at: 42, text: ".", strong: false },
    ]);
  });
});
