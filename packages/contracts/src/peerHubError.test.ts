import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PEER_HUB_FAILURE_KINDS, PeerHubError, isPeerHubFailureKind } from "./peerHub.ts";

const decode = Schema.decodeUnknownSync(PeerHubError);
const encode = Schema.encodeSync(PeerHubError);

/** The error as every Peer wrote it before it said where a call stopped: what an older Peer reads. */
class OlderPeerHubError extends Schema.TaggedError<OlderPeerHubError>()("PeerHubError", {
  code: Schema.optional(Schema.String),
  detail: Schema.String,
  refused: Schema.optional(Schema.Boolean),
}) {
  override get message(): string {
    return this.detail;
  }
}

const decodeOlder = Schema.decodeUnknownSync(OlderPeerHubError);

describe("PeerHubError compatibility", () => {
  it("preserves the optional refusal flag and the message", () => {
    for (const fields of [
      { detail: "No." },
      { detail: "No.", refused: true },
      { detail: "No.", refused: false },
    ]) {
      const error = decode({ _tag: "PeerHubError", ...fields });
      expect(error.message).toBe("No.");
      expect(encode(error)).toEqual({ _tag: "PeerHubError", ...fields });
    }
  });

  it("reads an error from before it said where a call stopped, and writes it back unchanged", () => {
    const older = {
      _tag: "PeerHubError",
      code: "not_found",
      detail: "no such route",
      refused: true,
    };
    const error = decode(older);
    expect(error.message).toBe("no such route");
    expect(error.kind).toBeUndefined();
    expect(error.status).toBeUndefined();
    expect(encode(error)).toEqual(older);
  });

  it("carries where a call stopped, and an older Peer still reads its message and flags", () => {
    const stopped = {
      _tag: "PeerHubError",
      code: "knowledge_down",
      detail: "knowledge store unavailable",
      refused: false,
      kind: "refused",
      status: 502,
      hubUrl: "https://hub.example.test",
      request: "GET /v1/workspaces/acme/candidates/pay",
      waitedMs: 20_000,
    };
    const error = decode(stopped);
    expect(encode(error)).toEqual(stopped);

    const older = decodeOlder(encode(error));
    expect(older.message).toBe("knowledge store unavailable");
    expect(older.code).toBe("knowledge_down");
    expect(older.refused).toBe(false);
  });

  it("reads a kind a newer Peer tells apart, and says it is not one this Peer knows", () => {
    const error = decode({ _tag: "PeerHubError", detail: "Slow down.", kind: "rateLimited" });
    expect(error.message).toBe("Slow down.");
    expect(isPeerHubFailureKind(error.kind)).toBe(false);
    for (const kind of PEER_HUB_FAILURE_KINDS) {
      expect(isPeerHubFailureKind(decode({ _tag: "PeerHubError", detail: "x", kind }).kind)).toBe(
        true,
      );
    }
    expect(isPeerHubFailureKind(undefined)).toBe(false);
  });
});
