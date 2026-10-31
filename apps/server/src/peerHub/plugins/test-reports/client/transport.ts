/**
 * What the plugin offers beyond its hooks and command, each a thin transport over its service: the
 * RPC methods the apps call, and the MCP tool for agents without a shell (their `peer tests`).
 *
 * @module peerHub/plugins/test-reports/client/transport
 */
import { PEER_TEST_REPORTS_METHODS as methods, TestReportsRpcGroup } from "@t3tools/contracts";

import { usage, type PeerContributions } from "../../../core/plugin.ts";
import type { TestReports } from "../TestReports.ts";

export const testReportsRpc = (reports: TestReports["Service"]) =>
  ({
    group: TestReportsRpcGroup,
    handlers: (wrap) =>
      TestReportsRpcGroup.of({
        [methods.peerTestsList]: (input) => wrap.effect(methods.peerTestsList, reports.list(input)),
        [methods.peerTestsFile]: (input) =>
          wrap.effect(methods.peerTestsFile, reports.fileAsPerson(input)),
        [methods.peerTestsRemove]: (input) =>
          wrap.effect(methods.peerTestsRemove, reports.remove(input)),
        [methods.peerTestsSetOwner]: (input) =>
          wrap.effect(methods.peerTestsSetOwner, reports.setOwner(input)),
        [methods.peerTestsInherited]: (input) =>
          wrap.effect(methods.peerTestsInherited, reports.inherited(input)),
      }),
  }) satisfies NonNullable<PeerContributions["rpc"]>;

const texts = (value: unknown, key: string): ReadonlyArray<string> => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === ""))
    throw usage(`invalid ${key} for peer_tests`, "give it a list of texts.");
  if (value.some((item: string) => item.trimStart().startsWith("--")))
    throw usage("peer_tests text starts with a flag", "write plain text, without a leading --.");
  return value as ReadonlyArray<string>;
};

const RESULTS: ReadonlySet<unknown> = new Set(["pass", "fail", "mixed"]);
const KEYS = new Set(["action", "result", "summary", "task", "pass", "fail", "unverified"]);

export const testsTools = [
  {
    name: "peer_tests",
    description:
      'File a test report on your task (action file: result pass|fail|mixed, summary, pass/fail/unverified item lists; end an unverified item with " @person" to name its owner), or read a task\'s reports (action show).',
    command: "tests",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["file", "show"] },
        result: { type: "string", enum: ["pass", "fail", "mixed"] },
        summary: { type: "string" },
        task: { type: "string" },
        pass: { type: "array", items: { type: "string" } },
        fail: { type: "array", items: { type: "string" } },
        unverified: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    arguments: (input) => {
      if (Object.keys(input).some((key) => !KEYS.has(key)))
        throw usage("invalid arguments for peer_tests", "check the peer_tests tool schema.");
      const task =
        typeof input.task === "string" && input.task.trim() !== "" ? input.task.trim() : undefined;
      if (task?.startsWith("--"))
        throw usage(
          "peer_tests text starts with a flag",
          "write plain text, without a leading --.",
        );
      if ((input.action ?? "file") === "show")
        return ["show", ...(task === undefined ? [] : [task])];
      if (input.action !== undefined && input.action !== "file")
        throw usage("Invalid tests action.", "use file or show.");
      if (!RESULTS.has(input.result) || typeof input.summary !== "string")
        throw usage(
          "peer_tests file needs a result and a summary",
          "give result pass, fail or mixed and a summary.",
        );
      if (input.summary.trim() === "" || input.summary.trimStart().startsWith("--"))
        throw usage("peer_tests needs a plain summary", "write the summary as plain text.");
      return [
        String(input.result),
        input.summary,
        ...(task === undefined ? [] : ["--for", task]),
        ...texts(input.pass, "pass").flatMap((text) => ["--pass", text]),
        ...texts(input.fail, "fail").flatMap((text) => ["--fail", text]),
        ...texts(input.unverified, "unverified").flatMap((text) => ["--unverified", text]),
      ];
    },
  },
] satisfies NonNullable<PeerContributions["agentTools"]>;
