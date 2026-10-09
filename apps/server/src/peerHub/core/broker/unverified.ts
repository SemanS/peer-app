// @effect-diagnostics globalDate:off nodeBuiltinImport:off - explicit hook fallback logs in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- A broker method re-exported by hooks.ts, bound on Broker.ts. */
import type * as NodeHttp from "node:http";
import { publishesWork } from "../../handoffCommands.ts";
import {
  agentNamed,
  editedFiles,
  editHookAnswer,
  emptyMemory,
  policyWithoutHub,
} from "../coordination/edits.ts";
import type { CoordinationBroker } from "./Broker.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { fallbacks, verdictAnswer, withReasons } from "./pipeline.ts";
import { headerOf } from "./server.ts";
import { inRepository } from "./sessions.ts";
import { fallbackAnswers } from "./fallbackPolicies.ts";
/**
 * What a tool call hears when Peer did not decide it before the hook's deadline: the plugins'
 * fallbacks first, then core's explicit fallback (G7). Publishing is stopped, since the inputs
 * it hands over were not verified; an edit goes by its policy.
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
  const publication = shell && typeof input?.command === "string" && publishesWork(input.command);
  const agent = agentNamed(headerOf(headers, "x-peer-agent"));
  const session = this.sessions.get(`${agent}:${String(body.session_id)}`);
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
  if (publication) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Peer could not verify shared input versions before the deadline. Retry publishing.",
      },
    };
  }
  if (mutations.length === 0) return editHookAnswer(agent, asks)?.output ?? null;
  const policy =
    session === undefined
      ? this.host.policy()
      : policyWithoutHub(
          this.views.get(session.workspace)?.policies,
          session.project,
          this.host.policy(),
        );
  const memory = session?.memory ?? emptyMemory();
  const relative =
    session === undefined
      ? mutations
      : mutations.flatMap((file) => {
          const path = inRepository(session, file);
          return path === null ? [] : [path];
        });
  const answers = fallbackAnswers(
    plugins,
    session === undefined ? undefined : this.sessionView(session),
    relative,
    policy,
    memory,
  );
  const hook = editHookAnswer(agent, [...answers.map((a) => a.answer), ...asks]);
  for (const key of hook?.acknowledge ?? []) memory.acknowledged.add(key);
  this.record("intent.unverified", {
    session: session?.id,
    files: mutations,
    policy,
    reason: "hook deadline",
    reasonClass: "hook_deadline",
    wentOn: answers.every(({ answer }) => answer.decision === undefined),
  });
  return hook === null
    ? null
    : withReasons(
        hook.output,
        asks.flatMap((ask) => ask.reason ?? []),
      );
}
