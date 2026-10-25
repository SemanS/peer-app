#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - checks the source inputs before packaging a public client.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { assertPeerLocalSourcePaths } from "./lib/peer-release-boundary.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const files = NodeChildProcess.execFileSync(
  "git",
  ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)
  .split("\0")
  .filter(Boolean);
assertPeerLocalSourcePaths(files);
console.log("Peer Local source boundary checked: no private Hub or operator inputs.");
