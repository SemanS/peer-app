import { describe, expect, it } from "vite-plus/test";
import { assertPeerLocalSourcePaths } from "./peer-release-boundary.ts";

describe("Peer Local source distribution", () => {
  it("accepts the local server, public protocol, hooks and version control adapters", () => {
    expect(() =>
      assertPeerLocalSourcePaths([
        "apps/server/src/peerHub/core/localCoordination/LocalAuthority.ts",
        "packages/contracts/src/peerHub.ts",
        "apps/server/src/peerHub/core/adapters/scripts.ts",
        "apps/server/src/vcs/JjVcsDriver.ts",
        "LICENSE",
        ".env.example",
      ]),
    ).not.toThrow();
  });
  it("rejects private Hub source, company data and operator configuration", () => {
    for (const file of [
      "server/src/features/ownership/mod.rs",
      "workspaces/acme/workspace.yaml",
      "nix/modules/peerhub.nix",
      "deploy/deploy.sh",
      ".ai/decisions/secret-policy.md",
      "vendor/hub/PRIVATE-HUB.md",
      ".env",
      "config/peerhub.key",
    ])
      expect(() => assertPeerLocalSourcePaths([file])).toThrow("private Hub or operator");
  });
});
