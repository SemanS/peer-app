import { describe, expect, it } from "vite-plus/test";
import { mergeMcpObservations } from "./observations.ts";
describe("runtime observations with advisory tools", () => {
  it("combines an unnamed native runtime observation into one stable pane-bound session", () => {
    expect(
      mergeMcpObservations(
        [
          { id: "unknown:mcp-42", files: ["claimed.ts"] },
          { id: "42", files: ["observed.ts"] },
        ],
        [{ id: "unknown:mcp-42", adapter: "mcp", pane: "pane" }],
        [{ id: "herdr:42", paneId: "pane", postHocPaths: ["observed.ts"] }],
      ),
    ).toEqual([{ id: "unknown:mcp-42", files: ["claimed.ts", "observed.ts"] }]);
  });
  it("adds observed paths to one MCP report and leaves a hooked report intact", () => {
    const reports = [
      { id: "cursor:1", files: ["claimed.ts"] },
      { id: "codex:2", files: ["hooked.ts"] },
    ];
    const result = mergeMcpObservations(
      reports,
      [
        { id: "cursor:1", adapter: "mcp", pane: "1" },
        { id: "codex:2", adapter: "hooks", pane: "2" },
      ],
      [
        { id: "herdr:cursor:1", paneId: "1", postHocPaths: ["claimed.ts", "observed.ts"] },
        { id: "herdr:codex:2", paneId: "2", postHocPaths: ["old.ts"] },
      ],
    );
    expect(result).toEqual([
      { id: "cursor:1", files: ["claimed.ts", "observed.ts"] },
      { id: "codex:2", files: ["hooked.ts"] },
    ]);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(reports[1]);
  });
});
