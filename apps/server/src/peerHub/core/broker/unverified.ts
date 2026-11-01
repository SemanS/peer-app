// @effect-diagnostics globalDate:off nodeBuiltinImport:off - explicit hook fallback logs in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- A broker method re-exported by hooks.ts, bound on Broker.ts. */
import type * as NodeHttp from "node:http";
import { agentNamed, editedFiles, editHookAnswer } from "../coordination/edits.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { isLanding } from "./landing.ts";
import { fallbacks, verdictAnswer, withReasons } from "./pipeline.ts";
import { headerOf } from "./server.ts";
/**
 * What a tool call hears when Peer did not answer it before the hook's deadline: the plugins'
 * fallbacks (G7). Core has nothing to say: the edit goes on, and its files reach the next report.
 */
export function unverifiedTool(
  this: CoordinationBroker,
  body: Record<string, unknown>,
  headers: NodeHttp.IncomingHttpHeaders,
  plugins: PeerBrokerPlugins,
): Record<string, unknown> | null {
  const mutations = editedFiles(body.tool_name, body.tool_input);
  const input = body.tool_input as Record<string, unknown> | null;
  const shell = body.tool_name === "Bash";
  const agent = agentNamed(headerOf(headers, "x-peer-agent"));
  const session = this.sessions.get(`${agent}:${String(body.session_id)}`);
  // A landing step whose hook missed its deadline: what waits for the agent comes at its next step.
  if (shell && typeof input?.command === "string" && isLanding(input.command))
    this.record("landing.late", { session: session?.id });
  const call =
    session === undefined || (!shell && mutations.length === 0)
      ? undefined
      : this.toolContext(session, body, "pre-tool", 0);
  const theirs = call === undefined ? [] : fallbacks(plugins, call, shell ? "shell" : "edits");
  const denied = theirs.find((said) => said.verdict.decision === "deny");
  if (denied !== undefined) {
    return editHookAnswer(agent, [verdictAnswer(denied, call?.paths ?? [])])?.output ?? null;
  }
  const asks = theirs.map((said) => verdictAnswer(said, call?.paths ?? []));
  if (mutations.length > 0)
    this.record("intent.unverified", {
      session: session?.id,
      files: mutations,
      reason: "hook deadline",
      reasonClass: "hook_deadline",
    });
  const hook = editHookAnswer(agent, asks);
  for (const key of hook?.acknowledge ?? []) session?.memory.acknowledged.add(key);
  return hook === null
    ? null
    : withReasons(
        hook.output,
        asks.flatMap((ask) => ask.reason ?? []),
      );
}
