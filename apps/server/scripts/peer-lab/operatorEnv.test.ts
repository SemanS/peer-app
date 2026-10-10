import { expect, it } from "vite-plus/test";
import { dropOperatorSession } from "./operatorEnv.ts";

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
