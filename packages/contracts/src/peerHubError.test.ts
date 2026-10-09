import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PeerHubError } from "./peerHub.ts";

const decode = Schema.decodeUnknownSync(PeerHubError);
const encode = Schema.encodeSync(PeerHubError);

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
});
