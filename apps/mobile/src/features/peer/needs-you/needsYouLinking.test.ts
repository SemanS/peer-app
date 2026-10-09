import { describe, expect, it } from "vite-plus/test";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
// Use the installed resolver without loading React Native's platform renderer in Node.
const require = NodeModule.createRequire(import.meta.url);
const core = NodeModule.createRequire(require.resolve("@react-navigation/native")).resolve(
  "@react-navigation/core",
);
const { getStateFromPath } = (await import(
  NodeURL.pathToFileURL(NodePath.join(NodePath.dirname(core), "getStateFromPath.js")).href
)) as Pick<typeof import("@react-navigation/native"), "getStateFromPath">;
import { rewritePeerAlertPath, NEEDS_YOU_ROUTE_PATH } from "./needsYouLinking";

describe("Peer alert links", () => {
  it("resolves synthetic activities through React Navigation's resolver", () => {
    const id = "peer-needs-you.request.0123456789abcdef",
      environment = "office/desktop + laptop";
    const path = rewritePeerAlertPath(`/threads/${encodeURIComponent(environment)}/${id}`);
    expect(path).toBe(`/needs-you?focus=${id}&environment=${encodeURIComponent(environment)}`);
    // Installed useLinkTo.tsx:24 calls useBuildAction; useLinkBuilder.tsx:108,118
    // reads linking.getStateFromPath and passes the href through that exact custom resolver.
    const state = getStateFromPath(path, {
      screens: { NeedsYou: NEEDS_YOU_ROUTE_PATH, Thread: "threads/:environmentId/:threadId" },
    });
    expect(state?.routes.at(-1)).toMatchObject({
      name: "NeedsYou",
      params: { focus: id, environment },
    });
  });
  it("preserves real threads, malformed ids, queries and sub-routes", () => {
    for (const path of [
      "/threads/env/real",
      "/threads/env/peer-needs-you.thread.0123456789abcdef",
      "/threads/env/peer-needs-you.agent.0123456789abcdef/terminal",
      "/threads/%ZZ/peer-needs-you.agent.0123456789abcdef",
      "/threads/env/peer-needs-you.agent.0123456789abcdef?foo=bar",
    ])
      expect(rewritePeerAlertPath(path)).toBe(path);
  });
});
