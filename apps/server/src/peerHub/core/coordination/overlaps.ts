import * as Effect from "effect/Effect";
import { fallbackAnswers } from "../broker/fallbackPolicies.ts";
// @effect-diagnostics globalDate:off - intent deadlines and quiet overlaps in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Overlaps and intent, as the broker runs them. Before an agent changes a file the Hub decides,
 * recording its claim and the overlaps in the same step: within its deadline, or by an explicit
 * fallback (G7). A Hub without that leaves the decision to the last view. Agents' and people's
 * notes and resolutions on overlaps, and the nudge that has the closing agent close a quiet one.
 *
 * @module peerHub/core/coordination/overlaps
 */
import type { PeerCoordinationPolicy, PeerProjectPolicy } from "@t3tools/contracts";

import { clip } from "../../peerText.ts";
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
import { scopeOf } from "../contexts/text.ts";
import type {
  HubCoordSession,
  HubCoordView,
  HubIntentAnswer,
  HubOverlap,
  HubUnsupported,
} from "../hub/coordApi.ts";
import {
  announcementKey,
  answerForVerdict,
  contestKey,
  decideEdit,
  describe,
  type EditAnswer,
  editHookAnswer,
  generatedFile,
  INTENT_MAX_PATHS,
  policyWithoutHub,
  unverifiedAnswer,
} from "./edits.ts";
import { closerOf, settleNudge, settleRequest } from "./news.ts";

/** A view older than this is refreshed before deciding an edit. */
const FRESH_MS = 500;

/**
 * How long the hub has to decide an edit (`intent`) before the explicit fallback applies. Well
 * inside `HOOK_DEADLINE_MS`, so the answer still reaches the script that waits for it.
 */
export const INTENT_DEADLINE_MS = 2000;

/** Of which a session the hub has not heard of yet is reported first. */
const INTENT_REPORT_MS = 800;

/** A hub that answered 404 or 405 to `intent` is taken to have no such thing for this long. */
const INTENT_LEGACY_MS = 10 * 60 * 1000;

/**
 * An open overlap both agents wrote on and that went quiet this long is the
 * closing agent's to close: two minutes, or `PEER_SETTLE_QUIET_MS` (the lab
 * shortens it). It hears so at most `SETTLE_NUDGES` times per overlap.
 */
const SETTLE_QUIET_MS = Number(process.env.PEER_SETTLE_QUIET_MS) || 2 * 60 * 1000;
const SETTLE_NUDGES = 2;

const chunks = <T>(items: ReadonlyArray<T>, size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, at) =>
    items.slice(at * size, (at + 1) * size),
  );

const isDecided = (answer: HubIntentAnswer | HubUnsupported): answer is HubIntentAnswer =>
  !("unsupported" in answer);

/** A person's note on an overlap, from Peer. */
export async function personNote(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  overlap: string,
  text: string,
) {
  const updated = await this.host.note(workspace, project, overlap, text, undefined, newOp());
  this.record("note.person", { workspace, project, overlap, text });
  this.applyOverlap(workspace, updated);
}

export async function personResolve(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  overlap: string,
  resolution: string,
) {
  const updated = await this.host.resolve(
    workspace,
    project,
    overlap,
    resolution,
    undefined,
    newOp(),
  );
  this.record("resolve.person", { workspace, project, overlap, resolution });
  this.applyOverlap(workspace, updated);
}

/**
 * A person asks the agents on an overlap to settle it between them: both
 * hear it as a note (an idle one wakes up), with the one that closes it named
 * and what the person adds.
 */
export async function personSettle(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  overlapId: string,
  message: string | undefined,
) {
  await this.syncNow(workspace, 3000);
  const view = this.merged(workspace, this.views.get(workspace));
  const overlap = view.overlaps.find((o) => o.id === overlapId);
  const closerId = overlap === undefined ? undefined : closerOf(overlap, view.sessions);
  const closer = view.sessions.find((s) => s.id === closerId);
  const text = settleRequest({
    closer: closer === undefined ? undefined : this.agentName(workspace, closer),
    message: message === undefined ? undefined : clip(message, 300),
    cli: this.cli,
  });
  const updated = await this.host.note(workspace, project, overlapId, text, undefined, newOp());
  this.record("settle.person", { workspace, project, overlap: overlapId, closer: closerId, text });
  this.applyOverlap(workspace, updated);
}

/** An agent as people tell it apart: whose, and on which task. */
export function agentName(
  this: CoordinationBroker,
  workspace: string,
  session: HubCoordSession,
): string {
  const name = `${this.host.nameOf(workspace, session.email)}'s agent`;
  return session.task === undefined
    ? name
    : `${name} on ${this.host.taskName(workspace, session.project, session.task)}`;
}

export async function beforeTool(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  step: PipelineStep,
  verdictBudgetMs: number,
): Promise<Record<string, unknown> | null> {
  if (body.tool_name === "Bash") return this.beforeShell(session, body, step, verdictBudgetMs);
  const files: string[] = [];
  for (const path of this.editedPaths(session, body)) {
    if (this.keptBy(session, path)) continue;
    const mirror = [...this.shared.values()].find((candidate) =>
      this.samePath(candidate.path, path),
    );
    if (mirror !== undefined) {
      const keeper =
        mirror.keeper === undefined
          ? "another agent"
          : `${this.host.nameOf(mirror.workspace, mirror.keeper.email)}'s agent`;
      this.record("shared.denied", { session: session.id, scope: mirror.scope });
      const subject = this.subjectOf(mirror.workspace, mirror.project, mirror.scope);
      const ownWork =
        mirror.workspace === session.workspace &&
        mirror.project === session.project &&
        mirror.scope === scopeOf(session.task);
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: ownWork
            ? `Peer: ${keeper} keeps the shared context of ${subject}; the other agents on it only read it. Put what the work should know under "## For the team" in your working context (${session.ownContextPath}); Peer passes it to the keeper.`
            : `Peer: this is the shared context of ${subject}, another work on this project, and ${keeper} keeps it: only its keeper writes it. Read it${commandsOn(step.plugins)("ask") ? `; if your work depends on it, ask its agents: ${this.cli} ask ${this.handleOf(mirror.workspace, mirror.project, mirror.scope)} "<question>"` : ""}.`,
        },
      };
    }
    const file = inRepository(session, path);
    if (file !== null) files.push(file);
  }
  if (files.length === 0) {
    // Its own contexts only: Claude Code edits them unasked. Codex takes no "allow" without a
    // rewrite, and asks for them through PermissionRequest instead. A file elsewhere outside the
    // repository is not Peer's to let through: its person's permission settings decide; a plugin
    // may still deny one it knows (a harness's memory), and only a deny counts there.
    const paths = this.editedPaths(session, body);
    const own = paths.length > 0 && paths.every((path) => this.keptBy(session, path));
    if (session.agent === "claude" && own)
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "The agent's own working context",
        },
      };
    const ctx = this.toolContext(session, body, "pre-tool", remainingMs(step));
    if (ctx.outside !== undefined) {
      const theirs = await verdicts(step, ctx, "edits", verdictBudgetMs);
      const denied = theirs.find((said) => said.verdict.decision === "deny");
      if (denied !== undefined) {
        this.record("plugin.denied", {
          plugin: denied.plugin,
          session: session.id,
          outside: ctx.outside,
        });
        return editHookAnswer(session.agent, [verdictAnswer(denied, [])])?.output ?? null;
      }
    }
    return this.newsContext("PreToolUse", session, step, body);
  }
  // Plugins judge the edit after core's local checks and before the hub hears of it: a plugin's
  // deny stops it with that plugin's reason, and no claim is recorded.
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
  // The hub decides, recording the claim in the same step: a view from a while ago would let the
  // first edits of one file on two computers both pass.
  const { answers, policy } = await this.decideEdits(session, files);
  const said = answers.filter(
    ({ answer }) => answer.decision !== undefined || answer.context !== undefined,
  );
  for (const { file, answer } of said) this.settle(session, file, answer, policy);
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
 * Plugins' questions settle as core's do. Claude Code asked its person: the edit happening means
 * they agreed. Codex was told to ask its person in its reply, so its next try goes through.
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
      const asked = session.asked.get(file);
      session.asked.set(file, {
        keys: [...(asked?.keys ?? []), ...keys.filter((key) => key.endsWith(`#${file}`))],
        overlaps: asked?.overlaps ?? [],
        filesAt: asked?.filesAt ?? new Map(),
      });
    }
  } else if (decision === "deny" && session.agent === "codex") {
    for (const key of keys) session.memory.acknowledged.add(key);
  }
}

/**
 * What each file of an edit hears. The hub decides where it can (`intent`): it records the
 * session's claim and opens the overlaps in one step, so two first edits cannot both pass. A hub
 * without it leaves the view this computer has, as before it existed; a hub that gives no verdict
 * within its deadline leaves the explicit fallback (`unverifiedAnswer`).
 */
export async function decideEdits(
  this: CoordinationBroker,
  session: LocalSession,
  files: ReadonlyArray<string>,
): Promise<{
  readonly answers: ReadonlyArray<{
    readonly file: string;
    readonly answer: EditAnswer;
    readonly policy?: PeerProjectPolicy;
  }>;
  readonly policy: PeerProjectPolicy;
  readonly verification: "verified" | "legacy" | "unverified";
}> {
  const settings = this.host.policy();
  // Nobody contests a lockfile: it is made again after the merge.
  const checked = [...new Set(files)].filter((file) => !generatedFile(file));
  if (checked.length === 0) return { answers: [], policy: settings, verification: "verified" };
  const hub = await this.askHub(session, checked);
  if (hub.kind === "decided") return { ...hub, verification: "verified" };
  if (hub.kind === "unsupported") {
    return {
      answers: await this.viewAnswers(session, files, settings),
      policy: settings,
      verification: "legacy",
    };
  }
  const policy = policyWithoutHub(
    this.views.get(session.workspace)?.policies,
    session.project,
    settings,
  );
  // One answer for the edit as a whole: nothing here tells one of its files from another.
  const grouped = fallbackAnswers(
    await this.host.plugins(),
    this.sessionView(session),
    checked,
    policy,
    session.memory,
  );
  for (const group of grouped)
    if (group.answer.decision === undefined) {
      // Let go on the policy's word: its files reach the next report, so the hub finds the overlaps afterwards.
      this.record("intent.unverified", {
        session: session.id,
        files: group.files,
        policy: group.policy,
        wentOn: true,
      });
    }
  return {
    answers: grouped.flatMap(({ files, answer, policy }) =>
      files.map((file) => ({ file, answer, policy })),
    ),
    policy,
    verification: "unverified",
  };
}

/**
 * What each file of an edit hears from the view this computer has, as it did before the hub decided:
 * for a hub without `intent`.
 */
export async function viewAnswers(
  this: CoordinationBroker,
  session: LocalSession,
  files: ReadonlyArray<string>,
  policy: PeerCoordinationPolicy,
) {
  // Decide on what the other agents changed just now, not a view from a while ago.
  if (Date.now() - (this.viewAt.get(session.workspace) ?? 0) > FRESH_MS) {
    await this.syncNow(session.workspace, 1500);
  }
  let answers = files.map((file) => ({ file, answer: this.decide(session, file, policy) }));
  if (answers.some(({ answer }) => answer.decision === "deny")) {
    // Make each contest an overlap the hub knows, so the agent's note has somewhere to go.
    for (const { file, answer } of answers) {
      if (answer.decision === "deny") {
        session.claims = [...session.claims.filter((c) => c !== file), file];
      }
    }
    this.markDirty();
    // Both waits together stay well inside what the hook has (`HOOK_DEADLINE_MS`).
    await this.syncNow(session.workspace, 1000);
    answers = files.map((file) => ({ file, answer: this.decide(session, file, policy) }));
  }
  return answers;
}

/**
 * Asks the hub to decide an edit of `files` (not lockfiles), within `INTENT_DEADLINE_MS` in all:
 * its verdicts, worded as answers; that this hub has no `intent`, which it is not asked again for
 * ten minutes; or that it gave no verdict in time.
 */
export async function askHub(
  this: CoordinationBroker,
  session: LocalSession,
  files: ReadonlyArray<string>,
): Promise<
  | {
      readonly kind: "decided";
      readonly answers: ReadonlyArray<{
        readonly file: string;
        readonly answer: EditAnswer;
        readonly policy?: PeerProjectPolicy;
      }>;
      readonly policy: PeerProjectPolicy;
    }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed" }
> {
  const { workspace, project } = session;
  const intent = this.host.intent;
  const place = `${workspace}\u0000${project}`;
  if (intent === undefined || (this.intentUnsupportedUntil.get(place) ?? 0) > Date.now()) {
    return { kind: "unsupported" };
  }
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
    return { kind: "failed" } as const;
  };
  try {
    // The hub knows the sessions this computer reported: a new one is reported first, from the same budget.
    if (!this.reportedSessions.get(workspace)?.has(session.id)) {
      await this.syncNow(workspace, INTENT_REPORT_MS);
    }
    const left = Math.max(INTENT_DEADLINE_MS - (Date.now() - started), 0);
    const held = (session.intentPaths ??= new Set());
    const added = files.filter((file) => !held.has(file));
    for (const file of files) held.add(file);
    const answers = await within(
      Promise.all(
        chunks(files, INTENT_MAX_PATHS).map((paths) =>
          intent(
            workspace,
            project,
            {
              environment: this.host.environment,
              session: session.id,
              paths,
              policy: this.host.policy(),
              op: newOp(),
            },
            left,
          ),
        ),
      ),
      left,
    );
    if (answers === TIMED_OUT) return failed("timeout");
    const decided = answers.filter(isDecided);
    if (decided.length < answers.length || decided[0] === undefined) {
      for (const file of added) held.delete(file);
      this.intentUnsupportedUntil.set(place, Date.now() + INTENT_LEGACY_MS);
      if (!this.intentLegacyLogged.has(workspace)) {
        this.intentLegacyLogged.add(workspace);
        this.record("intent.legacy", { workspace, project });
      }
      return { kind: "unsupported" };
    }
    const answer: HubIntentAnswer = {
      ...decided[0],
      verdicts: decided.flatMap((one) => one.verdicts),
      overlaps: [...new Map(decided.flatMap((one) => one.overlaps).map((o) => [o.id, o])).values()],
    };
    // Texts, news and `peer status` see what the hub recorded at once, not at the next sync.
    const plugins = await this.host.plugins();
    await within(
      Promise.all(
        plugins.active.flatMap(({ contributions }) =>
          contributions.intentResult
            ? [
                this.host.run(
                  contributions
                    .intentResult(this.sessionView(session), answer)
                    .pipe(Effect.ignoreCause()),
                ),
              ]
            : [],
        ),
      ),
      100,
    );
    this.mergeIntent(workspace, project, answer);
    this.record("intent", {
      fileCount: files.length,
      session: session.id,
      workspace,
      project,
      ms: Date.now() - started,
      policy: answer.policy,
      policySource: answer.policySource,
      verdicts: answer.verdicts.map(({ path, verdict, with: parties, holder }) => ({
        path,
        verdict,
        with: parties,
        ...(typeof holder === "string" ? { holder } : {}),
      })),
    });
    const verdicts = new Map(answer.verdicts.map((verdict) => [verdict.path, verdict]));
    const me = this.asHub(session);
    const sessions = this.merged(workspace, this.views.get(workspace)).sessions;
    return {
      kind: "decided",
      policy: answer.policy,
      answers: files.map((file) => {
        const verdict = verdicts.get(file);
        return {
          file,
          policy: verdict?.policy ?? answer.policy,
          answer:
            verdict === undefined
              ? unverifiedAnswer({ policy: answer.policy, files: [file], memory: session.memory })
              : answerForVerdict({
                  verdict,
                  at: answer.at,
                  me,
                  sessions,
                  overlaps: answer.overlaps,
                  memory: session.memory,
                  nameOf: this.nameOf(workspace),
                  taskName: this.taskNamer(workspace, project),
                  cli: this.cli,
                }),
        };
      }),
    };
  } catch (error) {
    return failed(messageOf(error));
  }
}

/** What the hub answered about a project's files goes into the view at once: its overlaps, and the policy it decided by. */
export function mergeIntent(
  this: CoordinationBroker,
  workspace: string,
  project: string,
  answer: HubIntentAnswer,
) {
  const current: HubCoordView = this.views.get(workspace) ?? {
    sessions: [],
    overlaps: [],
    at: answer.at,
  };
  const named = new Set(answer.overlaps.map((overlap) => overlap.id));
  this.views.set(workspace, {
    ...current,
    overlaps: [...current.overlaps.filter((overlap) => !named.has(overlap.id)), ...answer.overlaps],
    ...(answer.policySource === "project"
      ? { policies: { ...current.policies, [project]: answer.policy } }
      : {}),
  });
  this.afterViewChange(workspace);
}

/** The person approved the edit its agent was asked about: the hub hears that the agent acknowledged the overlap. */
export async function ackOverlap(
  this: CoordinationBroker,
  session: LocalSession,
  overlap: string,
  filesAt: string | undefined,
) {
  const ack = this.host.ack;
  if (ack === undefined) return;
  const op = newOp();
  try {
    const updated = await ack(session.workspace, session.project, overlap, session.id, op, filesAt);
    // A hub from before acknowledgements: nothing to say to it.
    if ("unsupported" in updated) return;
    this.applyOverlap(session.workspace, updated);
    this.record("ack", { session: session.id, overlap, op });
  } catch (error) {
    this.record("ack.failed", { session: session.id, overlap, op, reason: messageOf(error) });
  }
}

/** What one contested file's answer leaves behind: who heard, what was asked, the log. */
export function settle(
  this: CoordinationBroker,
  session: LocalSession,
  file: string,
  answer: EditAnswer,
  policy: PeerProjectPolicy,
) {
  this.announce(session, answer.overlaps);
  if (answer.decision === "ask") {
    session.asked.set(file, {
      keys: answer.keys,
      overlaps: answer.overlaps,
      filesAt: new Map(
        answer.overlaps.map((id) => [
          id,
          this.views.get(session.workspace)?.overlaps.find((known) => known.id === id)?.filesAt ??
            undefined,
        ]),
      ),
    });
  } else if (answer.decision === undefined) {
    for (const key of answer.keys) session.memory.acknowledged.add(key);
  }
  this.record("decision", {
    session: session.id,
    file,
    policy,
    decision: answer.decision ?? "notify",
    with: answer.with,
    keys: answer.keys,
    text: answer.reason ?? answer.context,
  });
}

export function decide(
  this: CoordinationBroker,
  session: LocalSession,
  file: string,
  policy: PeerCoordinationPolicy,
) {
  return decideEdit({
    policy,
    me: this.asHub(session),
    file,
    view: this.merged(session.workspace, this.views.get(session.workspace)),
    memory: session.memory,
    nameOf: this.nameOf(session.workspace),
    taskName: this.taskNamer(session.workspace, session.project),
    cli: this.cli,
  });
}

/**
 * The open overlaps this session closes that went quiet after both agents
 * wrote: it hears, at most twice per overlap, to close it or say what is left.
 */
export function settleNews(this: CoordinationBroker, session: LocalSession): string | null {
  const view = this.merged(session.workspace, this.views.get(session.workspace));
  const now = Date.now();
  const said: string[] = [];
  for (const overlap of view.overlaps) {
    if (overlap.state !== "open" || !overlap.sessions.includes(session.id)) continue;
    if (closerOf(overlap, view.sessions) !== session.id) continue;
    const wrote = overlap.notes.some((note) => note.session === session.id);
    const answered = overlap.notes.some(
      (note) => note.session !== undefined && note.session !== session.id,
    );
    const last = overlap.notes.at(-1);
    if (!wrote || !answered || last === undefined) continue;
    const quiet = now - Date.parse(last.at);
    if (!(quiet >= SETTLE_QUIET_MS)) continue;
    const key = `${overlap.id}:${overlap.notes.length}`;
    // Each time it heard so of this overlap was at another number of notes.
    const settled = session.memory.settled;
    const times = [...settled].filter((heard) => heard.startsWith(`${overlap.id}:`)).length;
    if (settled.has(key) || times >= SETTLE_NUDGES) continue;
    settled.add(key);
    const otherId = overlap.sessions.find((id) => id !== session.id);
    const other = view.sessions.find((s) => s.id === otherId);
    said.push(
      settleNudge({
        overlap,
        other:
          other === undefined
            ? "an agent no longer at work"
            : describe(
                other,
                this.nameOf(session.workspace),
                this.taskNamer(session.workspace, session.project),
              ),
        minutes: Math.max(1, Math.round(quiet / 60_000)),
        taskName: this.taskNamer(session.workspace, session.project),
        cli: this.cli,
      }),
    );
  }
  if (said.length === 0) return null;
  const text = said.join("\n\n");
  this.record("settle.nudged", { session: session.id, text });
  return text;
}

/** The session posted on an overlap: it no longer has to before editing the files in it so far. */
export function acknowledge(this: CoordinationBroker, session: LocalSession, overlap: HubOverlap) {
  session.memory.announced.add(announcementKey(overlap));
  const others = overlap.sessions.filter((id) => id !== session.id);
  for (const file of overlap.files) {
    session.memory.acknowledged.add(contestKey(overlap.id, file));
    for (const other of others) session.memory.acknowledged.add(contestKey(`with:${other}`, file));
  }
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

export function markSeen(this: CoordinationBroker, session: LocalSession) {
  for (const overlap of this.views.get(session.workspace)?.overlaps ?? []) {
    if (!overlap.sessions.includes(session.id)) continue;
    session.memory.announced.add(announcementKey(overlap));
    for (const note of overlap.notes) session.memory.seenNotes.add(note.id);
  }
}
