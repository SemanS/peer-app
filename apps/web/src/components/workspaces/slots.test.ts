import { PEER_PLUGIN_IDS, type PeerHubStatus, type PeerPluginState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { usePeerPlugins } from "./slots";

const listed = (ids: ReadonlyArray<string>): Pick<PeerHubStatus, "plugins"> => ({
  plugins: ids.map((id): PeerPluginState => ({ id, title: id, enabled: true, active: true })),
});

// `usePeerPlugins` only selects and caches; it calls no React hook, so it runs outside a component.
const plugins = (ids: ReadonlyArray<string>) => usePeerPlugins(listed(ids));

describe("the web plugin registry", () => {
  it("follows the order the server lists plugins, each plugin once", () => {
    const ids = plugins(PEER_PLUGIN_IDS).map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(PEER_PLUGIN_IDS.filter((id) => ids.includes(id)));
    // Plugins with web UI; ask and find have none, and memory stays hidden while the build excludes it.
    expect(ids).toEqual([
      "herdr",
      "github",
      "dependencies",
      "handoff",
      "capacity",
      "requests",
      "observe",
      "knowledge",
      "webhooks",
      "audit",
      "tool-trust",
      "mcp",
      "announcements",
      "needs-you",
      "resources",
      "recipes",
      "forecast",
      "metrics",
      "digest",
    ]);
  });

  it("hands back the same list until a plugin turns on or off", () => {
    expect(plugins(["requests", "observe"])).toBe(plugins(["observe", "requests", "telepathy"]));
    expect(plugins(["requests"])).not.toBe(plugins(["requests", "observe"]));
  });
});
