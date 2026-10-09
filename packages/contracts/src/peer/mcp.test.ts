import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { PeerHubStatus } from "../peerHub.ts";
import { PeerLocalAgent } from "./herdr.ts";
import { PeerMcpStatus } from "./mcp.ts";
describe("advisory tools compatibility", () => {
  it("keeps the optional status and existing C wire literal", () => {
    const status = Schema.Struct({ mcp: PeerHubStatus.fields.mcp });
    expect(Schema.decodeUnknownSync(status)({})).toEqual({});
    expect(
      Schema.decodeUnknownSync(status)({
        mcp: { enabled: true, command: "/peer mcp", agents: ["herdr:cursor:1"] },
      }).mcp,
    ).toEqual(
      Schema.decodeUnknownSync(PeerMcpStatus)({
        enabled: true,
        command: "/peer mcp",
        agents: ["herdr:cursor:1"],
      }),
    );
    expect(
      Schema.decodeUnknownSync(PeerLocalAgent)({
        id: "herdr:cursor:1",
        paneId: "1",
        title: "Cursor",
        status: "idle",
        coordinationLevel: "C",
      }).coordinationLevel,
    ).toBe("C");
  });
});
