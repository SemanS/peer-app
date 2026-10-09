import { expect, it } from "@effect/vitest";
import {
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
  resolveT3McpToolSummaryAction,
} from "@t3tools/shared/t3McpToolPresentation";
import { Tool } from "effect/unstable/ai";

import { PeerMemoryToolkit } from "./tools.ts";

it("publishes memory's tools under unique names, with reference-free object-root inputs", () => {
  const names = new Set<string>();
  for (const tool of Object.values(PeerMemoryToolkit.tools)) {
    expect(names.has(tool.name)).toBe(false);
    names.add(tool.name);
    // T3's own tools never take this prefix, so memory's cannot collide with them.
    expect(tool.name.startsWith("peer_memory_"), tool.name).toBe(true);
    const schema = Tool.getJsonSchema(tool);
    expect(schema).toMatchObject({ type: "object" });
    // The published tool catalog must also work with providers without $ref support.
    expect(JSON.stringify(schema), tool.name).not.toContain('"$ref"');
    // Every published tool must have labels for its lifecycle, branding, and a summary.
    const definition = resolveT3McpToolDefinition(tool.name);
    expect(definition, tool.name).not.toBeNull();
    expect(
      definition?.labels.every((label) => label.trim().length > 0),
      tool.name,
    ).toBe(true);
    for (const name of [tool.name, `mcp__t3-code__${tool.name}`, `T3-code.${tool.name}`]) {
      expect(resolveT3McpToolPresentation(name)?.logo, name).toBe("t3-code");
      expect(resolveT3McpToolSummaryAction(name), name).not.toBeNull();
    }
  }
  expect(names.size).toBe(8);
});
