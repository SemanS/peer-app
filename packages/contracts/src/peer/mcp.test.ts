import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { PeerHubStatus } from "../peerHub.ts";
import { PeerLocalAgent } from "./herdr.ts";
import { PeerMcpStatus } from "./mcp.ts";
const decodeMcpStatus = Schema.decodeSync(PeerMcpStatus);
const decodeLocalAgent = Schema.decodeSync(PeerLocalAgent);
const decodeOptionalStatus = Schema.decodeSync(Schema.Struct({ mcp: PeerHubStatus.fields.mcp }));

describe("advisory tools compatibility", () => {
  it("keeps the optional status and existing C wire literal", () => {
    expect(decodeOptionalStatus({})).toEqual({});
    expect(
      decodeOptionalStatus({
        mcp: { enabled: true, command: "/peer mcp", agents: ["herdr:cursor:1"] },
      }).mcp,
    ).toEqual(
      decodeMcpStatus({
        enabled: true,
        command: "/peer mcp",
        agents: ["herdr:cursor:1"],
      }),
    );
    expect(
      decodeLocalAgent({
        id: "herdr:cursor:1",
        paneId: "1",
        title: "Cursor",
        status: "idle",
        coordinationLevel: "C",
      }).coordinationLevel,
    ).toBe("C");
  });
});
