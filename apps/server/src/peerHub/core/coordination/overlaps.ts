// @effect-diagnostics globalDate:off - intent deadlines in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Overlaps and intent, as the broker runs them. Before an agent changes a file the Hub hears of it,
 * recording its claim and the overlaps in the same step, and says who else is on the file: the agent
 * hears that and goes on, whatever the Hub answers, or if it answers nothing.
 *
 * @module peerHub/core/coordination/overlaps
 */
import type { CoordinationBroker } from "../broker/Broker.ts";
import { commandsOn } from "../broker/cli.ts";
import { messageOf } from "../broker/log.ts";
import {
  type PipelineStep,
  remainingMs,
  verdictAnswer,
  verdicts,
  withReasons,
} from "../broker/pipeline.ts";
import { inRepository, type LocalSession } from "../broker/sessions.ts";
import { newOp, TIMED_OUT, within } from "../broker/sync.ts";
import type { HubCoordView, HubIntentAnswer } from "../hub/coordApi.ts";
import {
  announcementKey,
  answerForVerdict,
  type EditAnswer,
  editHookAnswer,
  generatedFile,
  INTENT_MAX_PATHS,
  noContest,
} from "./edits.ts";

/**
 * How long the hub has to answer an edit (`intent`) before the agent goes on without its word. Well
 * inside `HOOK_DEADLINE_MS`, so the answer still reaches the script that waits for it.
 */
export const INTENT_DEADLINE_MS = 2000;

/** Of which a session the hub has not heard of yet is reported first. */
const INTENT_REPORT_MS = 800;

const chunks = <T>(items: ReadonlyArray<T>, size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, at) =>
    items.slice(at * size, (at + 1) * size),
  );

export async function beforeTool(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  step: PipelineStep,
  verdictBudgetMs: number,
): Promise<Record<string, unknown> | null> {
  if (body.tool_name === "Bash") return this.beforeShell(session, body, step, verdictBudgetMs);
  const files = this.editedPaths(session, body).flatMap((path) => {
    const file = inRepository(session, path);
    return file === null ? [] : [file];
  });
  if (files.length === 0) return this.newsContext("PreToolUse", session, step, body);
  // Plugins judge the edit before the hub hears of it: a plugin's deny stops it with that plugin's
  // reason, and no claim is recorded.
  const theirs = await verdicts(
    step,
    this.toolContext(session, body, "pre-tool", remainingMs(step)),
    "edits",
    verdictBudgetMs,
  );
  const denied = theirs.find((said) => said.verdict.decision === "deny");
  if (denied !== undefined) {
    this.record("plugin.denied", { plugin: denied.plugin, session: session.id, files });
    return editHookAnswer(session.agent, [verdictAnswer(denied, files)])?.output ?? null;
  }
  // A plugin's question, once its person or its agent settled it, is not asked again.
  const asks = theirs
    .map((said) => verdictAnswer(said, files))
    .filter((ask) => !ask.keys.every((key) => session.memory.acknowledged.has(key)));
  const { answers } = await this.decideEdits(session, files, step);
  const said = answers.filter(({ answer }) => answer.context !== undefined);
  for (const { file, answer } of said) this.settle(session, file, answer);
  const hook = editHookAnswer(session.agent, [...said.map(({ answer }) => answer), ...asks]);
  if (hook === null) return this.newsContext("PreToolUse", session, step, body);
  for (const key of hook.acknowledge) session.memory.acknowledged.add(key);
  if (asks.length > 0) this.settlePluginAsks(session, files, asks, hook.output);
  return withReasons(
    hook.output,
    asks.flatMap((ask) => ask.reason ?? []),
  );
}

/**
 * Plugins' questions settle once. Claude Code asked its person: the edit happening means they
 * agreed. Codex was told to ask its person in its reply, so its next try goes through.
 */
export function settlePluginAsks(
  this: CoordinationBroker,
  session: LocalSession,
  files: ReadonlyArray<string>,
  asks: ReadonlyArray<EditAnswer>,
  output: Record<string, unknown>,
) {
  const decision = (output.hookSpecificOutput as { readonly permissionDecision?: unknown })
    ?.permissionDecision;
  const keys = asks.flatMap((ask) => ask.keys);
  if (decision === "ask") {
    for (const file of files) {
      const asked = session.asked.get(file) ?? [];
      session.asked.set(file, [...asked, ...keys.filter((key) => key.endsWith(`#${file}`))]);
    }
  } else if (decision === "deny" && session.agent === "codex") {
    for (const key of keys) session.memory.acknowledged.add(key);
  }
}

/**
 * What each file of an edit hears. The hub registers the session's claim and opens the overlaps in
 * one step (`intent`). Without its word in time the edit hears nothing: its files reach the next
 * report, where the hub finds the overlaps afterwards.
 */
export async function decideEdits(
  this: CoordinationBroker,
  session: LocalSession,
  files: ReadonlyArray<string>,
  step: Pick<PipelineStep, "plugins">,
): Promise<{
  readonly answers: ReadonlyArray<{ readonly file: string; readonly answer: EditAnswer }>;
  readonly verified: boolean;
}> {
  // Nobody contests a lockfile: it is made again after the merge.
  const checked = [...new Set(files)].filter((file) => !generatedFile(file));
  if (checked.length === 0) return { answers: [], verified: true };
  const answer = await this.askHub(session, checked);
  if (answer === null) {
    this.record("intent.unverified", { session: session.id, files: checked });
    return {
      answers: checked.map((file) => ({ file, answer: noContest() })),
      verified: false,
    };
  }
  const { workspace, project } = session;
  const verdicts = new Map(answer.verdicts.map((verdict) => [verdict.path, verdict]));
  const me = this.asHub(session);
  const sessions = this.merged(workspace, this.views.get(workspace)).sessions;
  const note = commandsOn(step.plugins)("note");
  return {
    verified: true,
    answers: checked.map((file) => {
      const verdict = verdicts.get(file);
      return {
        file,
        answer:
          verdict === undefined
            ? noContest()
            : answerForVerdict({
                verdict,
                me,
                sessions,
                overlaps: answer.overlaps,
                memory: session.memory,
                nameOf: this.nameOf(workspace),
                taskName: this.taskNamer(workspace, project),
                cli: this.cli,
                note,
              }),
      };
    }),
  };
}

/**
 * Tells the hub of an edit of `files` (not lockfiles), within `INTENT_DEADLINE_MS` in all: what it
 * answered, or null when it gave no answer in time or has no such thing.
 */
export async function askHub(
  this: CoordinationBroker,
  session: LocalSession,
  files: ReadonlyArray<string>,
): Promise<HubIntentAnswer | null> {
  const { workspace, project } = session;
  const intent = this.host.intent;
  if (intent === undefined) return null;
  const started = Date.now();
  const failed = (reason: string) => {
    this.record("intent.failed", {
      session: session.id,
      workspace,
      project,
      files,
      ms: Date.now() - started,
      reason,
    });
    return null;
  };
  try {
    // The hub knows the sessions this computer reported: a new one is reported first, from the same budget.
    if (!this.reportedSessions.get(workspace)?.has(session.id)) {
      await this.syncNow(workspace, INTENT_REPORT_MS);
    }
    const left = Math.max(INTENT_DEADLINE_MS - (Date.now() - started), 0);
    const held = (session.intentPaths ??= new Set());
    for (const file of files) held.add(file);
    const answers = await within(
      Promise.all(
        chunks(files, INTENT_MAX_PATHS).map((paths) =>
          intent(
            workspace,
            project,
            { environment: this.host.environment, session: session.id, paths, op: newOp() },
            left,
          ),
        ),
      ),
      left,
    );
    if (answers === TIMED_OUT) return failed("timeout");
    const answer: HubIntentAnswer = {
      at: answers[0]?.at ?? new Date().toISOString(),
      verdicts: answers.flatMap((one) => one.verdicts),
      overlaps: [...new Map(answers.flatMap((one) => one.overlaps).map((o) => [o.id, o])).values()],
    };
    // Texts, news and `peer status` see what the hub recorded at once, not at the next sync.
    this.mergeIntent(workspace, answer);
    this.record("intent", {
      fileCount: files.length,
      session: session.id,
      workspace,
      project,
      ms: Date.now() - started,
      verdicts: answer.verdicts.map(({ path, verdict, with: parties }) => ({
        path,
        verdict,
        with: parties,
      })),
    });
    return answer;
  } catch (error) {
    return failed(messageOf(error));
  }
}

/** What the hub answered about a project's files goes into the view at once: its overlaps. */
export function mergeIntent(this: CoordinationBroker, workspace: string, answer: HubIntentAnswer) {
  const current: HubCoordView = this.views.get(workspace) ?? {
    sessions: [],
    overlaps: [],
    at: answer.at,
  };
  const named = new Set(answer.overlaps.map((overlap) => overlap.id));
  this.views.set(workspace, {
    ...current,
    overlaps: [...current.overlaps.filter((overlap) => !named.has(overlap.id)), ...answer.overlaps],
  });
  this.afterViewChange(workspace);
}

/** What one contested file's heads-up leaves behind: that it was said, and the log. */
export function settle(
  this: CoordinationBroker,
  session: LocalSession,
  file: string,
  answer: EditAnswer,
) {
  this.announce(session, answer.overlaps);
  for (const key of answer.keys) session.memory.acknowledged.add(key);
  this.record("decision", {
    session: session.id,
    file,
    with: answer.with,
    keys: answer.keys,
    text: answer.context,
  });
}

/** The session was told about these overlaps as they are now. */
export function announce(
  this: CoordinationBroker,
  session: LocalSession,
  overlapIds: ReadonlyArray<string>,
) {
  for (const overlap of this.views.get(session.workspace)?.overlaps ?? []) {
    if (overlapIds.includes(overlap.id)) session.memory.announced.add(announcementKey(overlap));
  }
}

/** `peer status` showed the session its overlaps. */
export function markSeen(this: CoordinationBroker, session: LocalSession) {
  for (const overlap of this.views.get(session.workspace)?.overlaps ?? []) {
    if (overlap.sessions.includes(session.id))
      session.memory.announced.add(announcementKey(overlap));
  }
}
