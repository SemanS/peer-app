import { expect, it } from "vite-plus/test";
import { dropOperatorPeerPath, dropOperatorSession } from "./operatorEnv.ts";

it("drops the running agent's Peer session, Mod and markers but keeps auth and paths", () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    HOME: "/home/op",
    CLAUDE_CODE_OAUTH_TOKEN: "auth",
    PEER_SESSION: "operator-session",
    PEER_SESSION_TOKEN: "operator-token",
    PEER_MOD_SESSION: "operator-session",
    PEER_MOD_SESSION_TOKEN: "operator-token",
    CLAUDE_CODE_PLUGIN_DIRS: "/home/op/.peer/userdata/coord/claude-mod",
    CLAUDECODE: "1",
    CLAUDE_EFFORT: "high",
  };
  expect(dropOperatorSession(env).toSorted()).toEqual([
    "CLAUDECODE",
    "CLAUDE_CODE_PLUGIN_DIRS",
    "CLAUDE_EFFORT",
    "PEER_MOD_SESSION",
    "PEER_MOD_SESSION_TOKEN",
    "PEER_SESSION",
    "PEER_SESSION_TOKEN",
  ]);
  expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/op", CLAUDE_CODE_OAUTH_TOKEN: "auth" });
  expect(dropOperatorSession(env)).toEqual([]);
});

it("takes other Peers' peer commands off PATH, the operator's real one among them", () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "/Users/op/.peer/userdata/coord/bin:/usr/bin:/Users/op/.local/bin:/tmp/dev/.t3/userdata/coord/bin/",
  };
  expect(dropOperatorPeerPath(env)).toEqual([
    "/Users/op/.peer/userdata/coord/bin",
    "/tmp/dev/.t3/userdata/coord/bin/",
  ]);
  expect(env.PATH).toBe("/usr/bin:/Users/op/.local/bin");
});

it("leaves PATH alone when no Peer command is on it", () => {
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  expect(dropOperatorPeerPath(env)).toEqual([]);
  expect(env.PATH).toBe("/usr/bin:/bin");
});
