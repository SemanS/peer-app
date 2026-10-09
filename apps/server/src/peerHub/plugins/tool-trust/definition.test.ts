import { describe, expect, it } from "@effect/vitest";
import type { PeerTool } from "@t3tools/contracts";
import { definition, changes } from "./definition.ts";
const tool: PeerTool = {
  id: "tracker",
  name: "Tracker",
  requires: [],
  mcp: { transport: "stdio", command: "kontext", args: ["mcp"], env: {} },
};
describe("tool definition", () => {
  it("freezes the fingerprint and excludes presentation", () => {
    expect(definition(tool).fingerprint).toBe(
      "sha256:8c9c23a27a985f0397a5c71342006b491001d9da3abe70cd493293b4f41f4fdc",
    );
    expect(definition({ ...tool, description: "changed" }).fingerprint).toBe(
      definition(tool).fingerprint,
    );
  });
  it("sorts env names and names header changes without values", () => {
    const a = {
      ...tool,
      mcp: { transport: "stdio" as const, command: "x", args: [], env: { B: "2", A: "1" } },
    };
    expect(definition(a).fingerprint).toBe(
      definition({ ...a, mcp: { ...a.mcp, env: { A: "1", B: "2" } } }).fingerprint,
    );
    const remote = {
      ...tool,
      mcp: {
        transport: "http" as const,
        url: "https://example.test",
        headers: { Authorization: "old" },
      },
    };
    expect(
      changes(
        definition(remote).canonical,
        definition({ ...remote, mcp: { ...remote.mcp, headers: { Authorization: "secret" } } })
          .canonical,
      ),
    ).toEqual(["header Authorization"]);
  });
  it("refuses malformed and unclosed secret references and ids", () => {
    for (const value of ["${secret:lower}", "${secret:X", "${secret:../X}"])
      expect(
        definition({
          ...tool,
          mcp: { ...tool.mcp, transport: "stdio", command: value, args: [], env: {} },
        }).reason,
      ).toBeDefined();
    expect(definition({ ...tool, id: "../../bad" }).reason).toBeDefined();
  });
});
