import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { isJoinLink, parseJoinLink } from "./joinLink.ts";

const LINK = "https://hub.example.com/join/example?email=cyril%40freelance.example";

describe("parseJoinLink", () => {
  it("reads the Hub, the workspace and the address of an invitation link", () => {
    assert.isTrue(isJoinLink(LINK));
    assert.isFalse(isJoinLink("example"));
    assert.deepStrictEqual(
      parseJoinLink(LINK),
      Result.succeed({
        hub: "https://hub.example.com",
        slug: "example",
        email: "cyril@freelance.example",
      }),
    );
    // A Hub under a path, a trailing slash, an address left unencoded.
    assert.deepStrictEqual(
      parseJoinLink("https://peer.example.com/hub/join/example/?email=Cyril@Freelance.example"),
      Result.succeed({
        hub: "https://peer.example.com/hub",
        slug: "example",
        email: "cyril@freelance.example",
      }),
    );
  });

  it("accepts the link of the Hub this computer uses", () => {
    assert.isTrue(Result.isSuccess(parseJoinLink(LINK, "https://hub.example.com/")));
  });

  it("refuses a link of a foreign Hub, naming both", () => {
    const parsed = parseJoinLink(LINK, "https://hub.other.test");
    assert.isTrue(Result.isFailure(parsed));
    if (Result.isFailure(parsed))
      assert.strictEqual(
        parsed.failure,
        "The link is for the Hub at https://hub.example.com, not https://hub.other.test.",
      );
  });

  it("refuses plain http except for a Hub on this computer", () => {
    const http = parseJoinLink("http://hub.example.com/join/example?email=a%40b.test");
    assert.isTrue(Result.isFailure(http));
    if (Result.isFailure(http)) assert.include(http.failure, "is not https");
    for (const host of ["127.0.0.1:5190", "localhost:5190", "[::1]:5190"])
      assert.deepStrictEqual(
        parseJoinLink(`http://${host}/join/example?email=a%40b.test`),
        Result.succeed({ hub: `http://${host}`, slug: "example", email: "a@b.test" }),
      );
  });

  it("refuses what is not an invitation link", () => {
    for (const text of [
      "not a link",
      "ftp://hub.example.com/join/example?email=a%40b.test",
      "https://hub.example.com/settings?email=a%40b.test",
      "https://hub.example.com/join/example",
      "https://hub.example.com/join/Ex_ample?email=a%40b.test",
    ])
      assert.isTrue(Result.isFailure(parseJoinLink(text)), text);
  });
});
