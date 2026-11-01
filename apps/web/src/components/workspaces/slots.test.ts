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
    // Plugins with slots; ask and find have none, webhooks has its card on the Integrations page,
    // and memory stays hidden while the build excludes it.
    expect(ids).toEqual([
      "herdr",
      "jujutsu",
      "github",
      "capacity",
      "observe",
      "audit",
      "tool-trust",
      "mcp",
      "changes",
      "rooms",
      "settings",
    ]);
  });

  it("hands back the same list until a plugin turns on or off", () => {
    expect(plugins(["audit", "observe"])).toBe(plugins(["observe", "audit", "telepathy"]));
    expect(plugins(["audit"])).not.toBe(plugins(["audit", "observe"]));
  });
});
