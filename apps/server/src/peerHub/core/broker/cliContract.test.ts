import { describe, expect, it } from "@effect/vitest";

import {
  CliError,
  EXIT_STATUS,
  HTTP_STATUS,
  notRunning,
  refused,
  render,
  uncertain,
  usage,
} from "./cliContract.ts";

describe("peer command contract", () => {
  it("pins exit statuses and the broker's status mapping", () => {
    expect(EXIT_STATUS).toEqual({ done: 0, usage: 2, refused: 3, uncertain: 4, "not running": 5 });
    expect(HTTP_STATUS).toEqual({ done: 200, usage: 400, refused: 409, uncertain: 500 });
  });
  it("keeps a bare reason while rendering stable first and next lines", () => {
    const error = usage("review takes no arguments", "run peer review.");
    expect(error.message).toBe("review takes no arguments");
    expect(render(error)).toBe("peer: usage: review takes no arguments.\nNext: run peer review.");
    expect(render(refused("no open overlap", "run peer status."))).toBe(
      "peer: refused: no open overlap.\nNext: run peer status.",
    );
    expect(new Error("no")).not.toBeInstanceOf(CliError);
  });
  it("leaves a reason of several lines as written, its last line included", () => {
    expect(
      render(refused('a message waits\n[teammate text] Ana:\n"rename it first."', "peer review")),
    ).toBe(
      'peer: refused: a message waits\n[teammate text] Ana:\n"rename it first."\nNext: peer review',
    );
    expect(render(refused('a message waits\n"no period"', "peer review"))).toBe(
      'peer: refused: a message waits\n"no period"\nNext: peer review',
    );
  });
  it("does not promise whether a lost answer applied the command", () => {
    for (const cause of [
      "Peer did not answer within 0.4 s",
      "the connection to Peer was lost",
      "Peer failed while running the command",
      "the Hub gave no usable answer",
    ]) {
      expect(render(uncertain("note", cause))).toBe(
        `peer: uncertain: ${cause}, so peer note may or may not have taken effect.\nNext: run peer status to see whether it did, and repeat the command only if it did not.`,
      );
    }
    expect(render(uncertain("request", "the Hub gave no usable answer"))).toContain(
      "Next: repeat the same command; its operation id makes a second send do nothing.",
    );
    expect(notRunning()).toBe(
      "peer: not running: Peer is not running on this computer, or this shell cannot reach its socket; nothing was sent.\nNext: ask your person to start Peer (or let this shell reach its socket), then repeat the command.",
    );
  });
});
