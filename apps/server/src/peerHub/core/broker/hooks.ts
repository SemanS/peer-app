// @effect-diagnostics nodeBuiltinImport:off cryptoRandomUUID:off globalTimers:off globalDate:off preferSchemaOverJson:off - hook deadlines in wall-clock time, Mod signatures and delivery ids.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * Agents' hooks: each answered within the time its script waits, what comes later queued for
 * the agent's next step and a tool call not decided in time given its explicit fallback (G7);
 * Peer Mod's signatures and runtime generations; and each event's answer, core's text first and
 * then the active plugins'. A shell command that publishes work needs fresh inputs, one that lands
 * work first gives the agent what it has not read (`landing.ts`) and is judged by the plugins
 * whatever it names, and Peer's own command runs unasked.
 *
 * @module peerHub/core/broker/hooks
 */
import { pluginsForWorkspace } from "./pluginScope.ts";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { publishesWork } from "../../handoffCommands.ts";
import { askedByPerson, clip, cutText } from "../../peerText.ts";
import { hookCommand } from "../adapters/scripts.ts";
import {
  agentNamed,
  editedFiles,
  editHookAnswer,
  isPlainCliCall,
  mentionsCli,
  withoutOutputTrim,
} from "../coordination/edits.ts";
import { INTENT_DEADLINE_MS } from "../coordination/overlaps.ts";
import type { PeerToolContext } from "../plugin.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { carriedText, injectedChars } from "./delivery.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import { isLanding } from "./landing.ts";
import { messageOf } from "./log.ts";
import {
  compactText,
  handlers,
  MOD_VERDICT_BUDGET_MS,
  ownPaths,
  type PipelineStep,
  type PreparedDelivery,
  notifyDeliveries,
  remainingMs,
  startBlocks,
  stepNotices,
  VERDICT_BUDGET_MS,
  verdictAnswer,
  verdicts,
  withPluginText,
  withReasons,
} from "./pipeline.ts";
import { headerOf } from "./server.ts";
import { forgetPluginTold } from "./sessionMemory.ts";
import { inRepository, type LocalSession, MAX_FILES } from "./sessions.ts";
import { TIMED_OUT, within } from "./sync.ts";

/**
 * A hook's script waits 4 s for Peer and then goes on silently, and Claude Code stops waiting
 * for the script after 5: what Peer has not got ready by this time goes to the agent's next step
 * instead of being lost with the answer.
 */
const HOOK_DEADLINE_MS = 3300;

/**
 * A hook answered within the time its script waits. What is not ready by then (a slow hub made
 * a session's start take longer) is queued for the agent's next step: it would be lost with
 * an answer nobody waits for.
 */
export async function hookInTime(
  this: CoordinationBroker,
  body: Record<string, unknown>,
  headers: NodeHttp.IncomingHttpHeaders,
): Promise<Record<string, unknown> | null> {
  const late = { passed: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shortLifecycle =
    headerOf(headers, "x-peer-agent") === "codex" &&
    (body.hook_event_name === "SessionEnd" || body.hook_event_name === "Interrupt");
  const deadline = shortLifecycle
    ? 2000
    : headerOf(headers, "x-peer-adapter") === "mod"
      ? 7500
      : HOOK_DEADLINE_MS;
  // Plugins are read once per hook: its answer and its deadline's fallback both go by them.
  let plugins: PeerBrokerPlugins | undefined;
  const due = Date.now() + deadline;
  const expired = new Promise<Record<string, unknown> | null>((resolve) => {
    timer = setTimeout(() => {
      late.passed = true;
      if (body.hook_event_name === "SessionStart") {
        // Startup may still be fetching shared context. Always deliver the local entry
        // point while the full context is queued for the next step by hook().
        resolve({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: `Peer is still connecting to the team's shared context. Use ${this.scripts.peer} status to check coordination and ${this.scripts.peer} context to read the current handoff. If your session is not registered yet, retry after the next step. Shared context will arrive when ready.`,
          },
        });
      } else if (body.hook_event_name !== "PreToolUse") {
        resolve(null);
      } else {
        resolve(
          plugins === undefined
            ? {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason:
                    "Peer could not load its coordination policies before the deadline. Retry this action.",
                },
              }
            : this.unverifiedTool(body, headers, plugins),
        );
      }
    }, deadline);
  });
  try {
    const running = this.plugins().then((snapshot) => {
      plugins = snapshot;
      return this.hook(body, headers, late, { plugins: snapshot, due });
    });
    return await Promise.race([running, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export { unverifiedTool } from "./unverified.ts";

export async function hook(
  this: CoordinationBroker,
  body: Record<string, unknown>,
  headers: NodeHttp.IncomingHttpHeaders,
  late: { passed: boolean } = { passed: false },
  timing?: { readonly plugins: PeerBrokerPlugins; readonly due: number },
): Promise<Record<string, unknown> | null> {
  const started = Date.now();
  const event = typeof body.hook_event_name === "string" ? body.hook_event_name : "";
  const agent = agentNamed(headerOf(headers, "x-peer-agent"));
  const pane = await this.paneOf(agent, body, headerOf(headers, "x-herdr-pane"));
  // A session Peer never saw that ends has nothing to clear.
  if (
    (event === "SessionEnd" || event === "Interrupt") &&
    !this.sessions.has(`${agent}:${String(body.session_id)}`) &&
    !this.creatingSessions.has(`${agent}:${String(body.session_id)}`)
  )
    return null;
  const session = await this.sessionFor(agent, body, pane);
  if (session === null) return null;
  const mod = headerOf(headers, "x-peer-adapter") === "mod";
  const signature = NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify([
        event,
        body.tool_name,
        body.tool_input,
        body.prompt,
        body.source,
        body.message,
        body.reason,
      ]),
    )
    .digest("hex");
  if (!mod && Date.now() - (session.modHandled.get(signature) ?? 0) < 10_000) return null;
  const token = headerOf(headers, "x-peer-session-token");
  if (session.agent === "claude") {
    // A Mod that starts speaking for a running session (switched on, or reloaded active) brings
    // the credential its shell now sends.
    if (
      token !== undefined &&
      (event === "SessionStart" ||
        session.credential === undefined ||
        (mod && session.modAt === undefined))
    ) {
      session.credential = NodeCrypto.createHash("sha256").update(token).digest();
      this.record("credential.bound", {
        session: session.id,
        source: event === "SessionStart" ? "start" : "hook",
      });
    } else if (event === "SessionStart" && body.source !== "compact" && token === undefined) {
      session.credential = undefined;
    }
  }
  if (mod) {
    session.modAt = Date.now();
  }
  if (pane !== undefined) session.pane = pane;
  const deliveries: PreparedDelivery[] = [];
  const answerPlugins = pluginsForWorkspace(
    timing?.plugins ?? (await this.plugins()),
    session.workspace,
  );
  // What the answer tells it has reached nobody until the answer goes out, or into `pending` at
  // once should it come late: the session's memory file is not written meanwhile (`sessionMemory.ts`).
  session.answering += 1;
  const pending = this.answerHook(event, session, body, {
    mod,
    signature,
    plugins: answerPlugins,
    due: timing?.due ?? started + (mod ? 7500 : HOOK_DEADLINE_MS),
    deliveries,
  }).finally(() => {
    session.answering -= 1;
  });
  const generation = session.runtimeGeneration;
  const out = await pending;
  if (
    event !== "SessionEnd" &&
    (session.runtimeGeneration !== generation || this.sessions.get(session.id) !== session)
  ) {
    await notifyDeliveries(deliveries, "dropped");
    this.record("hook.stale", {
      session: session.id,
      runtimeGeneration: generation,
      hookEvent: event,
    });
    const input = body.tool_input as Record<string, unknown> | null;
    if (
      event === "PreToolUse" &&
      (editedFiles(body.tool_name, body.tool_input).length > 0 ||
        (body.tool_name === "Bash" &&
          typeof input?.command === "string" &&
          publishesWork(input.command)))
    ) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Peer's runtime session changed while checking this action. Retry from the current session.",
        },
      };
    }
    return null;
  }
  if (mod) {
    session.modHandled.set(signature, Date.now());
    while (session.modHandled.size > 100)
      session.modHandled.delete(session.modHandled.keys().next().value!);
  }
  const chars = injectedChars(out);
  this.record("hook", {
    session: session.id,
    hookEvent: event,
    tool: body.tool_name,
    files: editedFiles(body.tool_name, body.tool_input),
    answer: out ?? undefined,
    ...(chars === 0 ? {} : { chars }),
    ms: Date.now() - started,
  });
  if (!late.passed) {
    await notifyDeliveries(deliveries, "offered", carriedText(out));
    // What reaches the agent is what Peer costs it: the log says how much, for tuning from real runs.
    if (!mod && chars > 0) session.injected.set(event, (session.injected.get(event) ?? 0) + chars);
    if (!mod || event === "SessionEnd") return out;
    const text = (out?.hookSpecificOutput as { readonly additionalContext?: unknown } | undefined)
      ?.additionalContext;
    const id = typeof text === "string" && text !== "" ? NodeCrypto.randomUUID() : undefined;
    if (id !== undefined && typeof text === "string") {
      session.deliveries.set(id, {
        text,
        event,
        acknowledged: false,
        refs: deliveries.filter((ref) => text.includes(ref.text)),
      });
      this.record("delivery.prepared", {
        session: session.id,
        runtimeGeneration: session.runtimeGeneration,
        id,
        chars: text.length,
        hookEvent: event,
      });
      while (session.deliveries.size > 100)
        session.deliveries.delete(session.deliveries.keys().next().value!);
    }
    return {
      ...out,
      peerStatus: `Peer · ${session.project} · ${session.status} · ${session.keeps ? "keeps shared context" : "private context"}`,
      ...(id === undefined
        ? {}
        : { peerDelivery: { id, text, chars: typeof text === "string" ? text.length : 0 } }),
    };
  }
  // Its script stopped waiting before this was ready: what it had to say goes with the next step.
  const said = (out?.hookSpecificOutput as { readonly additionalContext?: unknown } | undefined)
    ?.additionalContext;
  if (typeof said === "string" && said !== "") {
    const refs = deliveries.filter((ref) => said.includes(ref.text));
    session.pending.push(
      refs.length === 0
        ? said
        : { text: said, deliveries: refs, first: refs.some((ref) => ref.first) },
    );
    await notifyDeliveries(
      deliveries.filter((ref) => !said.includes(ref.text)),
      "dropped",
    );
  } else await notifyDeliveries(deliveries, "dropped");
  this.record("hook.late", {
    session: session.id,
    hookEvent: event,
    ms: Date.now() - started,
    queued: typeof said === "string" && said !== "",
    decided: (out?.hookSpecificOutput as { readonly permissionDecision?: unknown } | undefined)
      ?.permissionDecision,
  });
  return null;
}

export async function answerHook(
  this: CoordinationBroker,
  event: string,
  session: LocalSession,
  body: Record<string, unknown>,
  adapter?: {
    readonly mod: boolean;
    readonly signature: string;
    readonly plugins?: PeerBrokerPlugins;
    /** When the hook's answer is due (epoch ms). */
    readonly due?: number;
    readonly deliveries?: PreparedDelivery[];
  },
): Promise<Record<string, unknown> | null> {
  session.adapter = "hooks";
  const due = adapter?.due ?? Date.now() + HOOK_DEADLINE_MS;
  if (event === "SessionStart") {
    if (session.agent !== "codex" || body.source !== "compact") {
      for (const queued of session.pending.splice(0))
        if (typeof queued !== "string") await notifyDeliveries(queued.deliveries, "dropped");
    }
    // A resumed process may keep its native session id after a crash. Its old receipts
    // expire before any asynchronous work; compact continues the same process.
    if (body.source !== "compact") {
      session.runtimeGeneration = NodeCrypto.randomUUID();
      session.deliveries.clear();
      session.modHandled.clear();
      session.pluginState = new Map();
      forgetPluginTold(session);
      if (adapter?.mod === true) session.modAt = Date.now();
      else delete session.modAt;
    }
    // Mods handle the event before invoking the settings hook. Reserve its fingerprint
    // while startup is still waiting, so that fallback cannot rotate the process twice.
    if (adapter?.mod === true) session.modHandled.set(adapter.signature, Date.now());
  }
  const context = (hookEventName: string, text: string | null) =>
    text === null ? null : { hookSpecificOutput: { hookEventName, additionalContext: text } };
  // The active plugins, read once per hook; what they add follows core's own.
  const plugins = pluginsForWorkspace(
    adapter?.plugins ?? (await this.plugins()),
    session.workspace,
  );
  const step = () => this.pipelineStep(session, plugins, due, adapter?.deliveries);
  // What the plugins give its index (the project's `.ai`) is read before the steps that name it.
  if (["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(event)) {
    session.index = await this.indexOf(session, plugins);
  }
  switch (event) {
    case "SessionStart": {
      this.touch(session);
      session.status = "idle";
      this.markDirty();
      const source = typeof body.source === "string" ? body.source : "startup";
      // Plugins' blocks are read while core gathers its start text, and follow it.
      const blocks = startBlocks(step(), source);
      // startedContext replaces pending news with fresh state; pre-compaction plugin context
      // has no other source, and Codex accepts it only at this subsequent SessionStart.
      const restorePending = session.agent === "codex" && source === "compact";
      const pending = restorePending ? session.pending.splice(0) : [];
      const start = await this.startContextFor(session, source, plugins);
      session.pending.unshift(...pending);
      const news = this.news(session, {
        team: restorePending,
        discovery: false,
        deliveries: adapter?.deliveries,
        plugins,
      });
      return context(
        event,
        withPluginText(news === null ? start : `${start}\n\n${news}`, await blocks),
      );
    }
    case "UserPromptSubmit": {
      this.touch(session);
      session.status = "working";
      // What the person asked first says more than a terminal title ("Claude Code").
      const asked = typeof body.prompt === "string" ? clip(body.prompt, 200) : "";
      const prompt = asked.length > 60 ? `${cutText(asked, 59)}…` : asked;
      if (prompt !== "" && !session.labelFromPrompt) {
        session.label = prompt;
        session.labelFromPrompt = true;
      }
      const fullPrompt = typeof body.prompt === "string" ? body.prompt : "";
      const prompting = step();
      const notices = stepNotices(prompting, {
        session: prompting.session,
        event: "prompt",
        prompt: fullPrompt,
        fromPerson: askedByPerson(fullPrompt),
        remainingMs: remainingMs(prompting),
      });
      // It may have gone to another branch, which can name another task.
      session.branch =
        (await this.host.branchOf(session.root).catch(() => undefined)) ?? session.branch;
      this.markDirty();
      // One discovery batch per boundary. Tool steps use the same delta state, so late arrivals
      // do not depend on another human prompt and the news cannot duplicate this batch.
      const news = this.news(session, {
        discovery: false,
        deliveries: adapter?.deliveries,
        plugins,
      });
      const index = this.advise(
        session,
        "index",
        () => this.discoveryFor(session, askedByPerson(fullPrompt)),
        null,
      );
      return context(
        event,
        withPluginText(
          [news, index].filter((part) => part !== null).join("\n\n") || null,
          await notices,
        ),
      );
    }
    case "PreToolUse":
      this.touch(session);
      session.status = "working";
      // A command that commits what it changed leaves git clean: its commits say what it did.
      if (body.tool_name === "Bash") session.shellAt = Date.now();
      return this.beforeTool(
        session,
        body,
        step(),
        adapter?.mod === true ? MOD_VERDICT_BUDGET_MS : VERDICT_BUDGET_MS,
      );
    case "PostToolUse":
    case "PostToolUseFailure": {
      this.touch(session);
      session.status = "working";
      // A failed step is read from git, as a shell step is: an edit that could not be written
      // changed no file, and is no approval of the ask before it.
      const failed = event === "PostToolUseFailure";
      if (body.tool_name === "Bash" || failed) {
        // What git sees the command changed is what the plugins hear it edited.
        const changed = await this.readShellChanges(session);
        const finishing = step();
        const notices = stepNotices(finishing, {
          ...this.toolContext(session, body, "post-tool", remainingMs(finishing)),
          paths: changed,
          ...(failed ? { failed } : {}),
        });
        return context(
          event,
          withPluginText(
            this.news(session, { deliveries: adapter?.deliveries, plugins }),
            await notices,
          ),
        );
      }
      const finishing = step();
      const notices = stepNotices(
        finishing,
        this.toolContext(session, body, "post-tool", remainingMs(finishing)),
      );
      let file: string | null = null;
      let contextEdited = false;
      for (const path of this.editedPaths(session, body)) {
        if (this.samePath(path, session.ownContextPath)) {
          await this.readTeamLines(session);
          contextEdited = true;
          continue;
        }
        if (
          session.keeps &&
          this.samePath(path, this.mirrorOf(session)?.path ?? session.contextPath)
        ) {
          await this.saveShared(session);
          contextEdited = true;
          continue;
        }
        const changed = inRepository(session, path);
        if (changed === null) continue;
        file = changed;
        session.dirty.add(changed);
        session.files = [...session.files.filter((f) => f !== changed), changed].slice(-MAX_FILES);
        const asked = session.asked.get(changed);
        if (asked !== undefined) {
          // The edit ran after its person was asked: they approved, which the hub hears too.
          for (const key of asked.keys) session.memory.acknowledged.add(key);
          session.asked.delete(changed);
          this.record("ask.approved", { session: session.id, file: changed, keys: asked.keys });
          for (const overlap of asked.overlaps)
            void this.ackOverlap(session, overlap, asked.filesAt.get(overlap));
        }
        this.markDirty();
      }
      const news = this.news(session, { deliveries: adapter?.deliveries, plugins });
      if (contextEdited && file === null)
        return context(event, withPluginText(news, await notices));
      const nudge = this.nudge(session, file);
      return context(
        event,
        withPluginText(
          [news, nudge].filter((part) => part !== null).join("\n\n") || null,
          await notices,
        ),
      );
    }
    case "Notification": {
      // Waiting for its person's permission: not at work, so it neither keeps nor takes a context.
      const message = typeof body.message === "string" ? body.message : "";
      if (/permission|approv/i.test(message)) {
        session.status = "blocked";
        this.markDirty();
        this.record("session.blocked", { session: session.id, message: clip(message, 200) });
      }
      return null;
    }
    case "PermissionRequest": {
      // Codex asks its person. Peer's own command and the agent's own contexts, and the files
      // plugins keep for it, are Peer's to let through; for anything else the agent waits for
      // its person, so it does not work meanwhile.
      if (this.isPeerWork(session, body) || this.pluginsOwn(session, body, plugins)) {
        this.record("permission.allowed", { session: session.id, tool: body.tool_name });
        return {
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: { behavior: "allow" },
          },
        };
      }
      session.status = "blocked";
      this.markDirty();
      this.record("session.blocked", { session: session.id, tool: body.tool_name });
      return null;
    }
    case "Stop":
    case "Interrupt":
      session.status = "idle";
      session.lastActivity = Date.now();
      // What it changed in ways Peer's hooks did not see (a patch through the shell) is its too.
      await this.readShellChanges(session);
      this.markDirty();
      if (event === "Stop") await handlers(step(), "stop");
      return null;
    case "PreCompact": {
      const compacting = compactText(step());
      await this.checkpointPrivate(session);
      const text = withPluginText(null, await compacting);
      if (session.agent === "codex") {
        if (text !== null) session.pending.push(text);
        return null;
      }
      return context(event, text);
    }
    case "SessionEnd": {
      // Plugins hear of it as it was, after core let it go.
      const ending = step();
      await handlers(ending, "session-ending");
      for (const queued of session.pending.splice(0))
        if (typeof queued !== "string") await notifyDeliveries(queued.deliveries, "dropped");
      void this.release(session);
      this.sessions.delete(session.id);
      this.record("session.ended", {
        session: session.id,
        injected: Object.fromEntries(session.injected),
        tokenEstimate: Math.round([...session.injected.values()].reduce((a, b) => a + b, 0) / 4),
        tokenEstimateMethod: "chars/4",
      });
      this.markDirty();
      await handlers(ending, "session-end");
      return null;
    }
    default:
      return null;
  }
}

export function pipelineStep(
  this: CoordinationBroker,
  session: LocalSession,
  plugins: PeerBrokerPlugins,
  deadline: number,
  deliveries?: PreparedDelivery[],
): PipelineStep {
  return {
    plugins: pluginsForWorkspace(plugins, session.workspace),
    session: this.sessionView(session),
    run: this.host.run,
    log: (event, fields) => this.record(event, fields),
    later: (text, refs = [], first) =>
      void session.pending.push(refs.length === 0 ? text : { text, deliveries: refs, first }),
    deliveries,
    cli: this.cli,
    deadline,
  };
}

export function toolContext(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  event: "pre-tool" | "post-tool",
  remaining: number,
): PeerToolContext {
  const input = body.tool_input as Record<string, unknown> | null;
  return {
    session: this.sessionView(session),
    event,
    tool: typeof body.tool_name === "string" ? body.tool_name : "",
    paths: this.editedPaths(session, body).flatMap((path) => {
      const file = inRepository(session, path);
      return file === null ? [] : [file];
    }),
    ...(typeof input?.command === "string" ? { command: input.command } : {}),
    remainingMs: remaining,
  };
}

/** Whether every file a call edits is one the active plugins keep for the session. */
export function pluginsOwn(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  plugins: PeerBrokerPlugins,
): boolean {
  const own = ownPaths(plugins, this.sessionView(session));
  const paths = this.editedPaths(session, body);
  return (
    own.length > 0 &&
    paths.length > 0 &&
    paths.every((path) => own.some((kept) => this.samePath(kept, path)))
  );
}

/** A permission Codex asks for that is Peer's own business: its command, or the agent's contexts. */
export function isPeerWork(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
): boolean {
  if (body.tool_name === "Bash") {
    const input = body.tool_input as Record<string, unknown> | null;
    const command = typeof input?.command === "string" ? input.command : "";
    return (
      isPlainCliCall(command, this.scripts.peer) ||
      isPlainCliCall(command, hookCommand(this.scripts.peer)) ||
      isPlainCliCall(command, this.cli)
    );
  }
  const paths = this.editedPaths(session, body);
  return paths.length > 0 && paths.every((path) => this.keptBy(session, path));
}

/** The agent running Peer's own CLI: let it through its trusted hook. */
export async function beforeShell(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  step: PipelineStep,
  verdictBudgetMs: number,
): Promise<Record<string, unknown> | null> {
  const input = body.tool_input as Record<string, unknown> | null;
  const command = typeof input?.command === "string" ? input.command.trim() : "";
  // Nothing lands unread: what waits for the agent comes before the checks that may wait on the
  // Hub, and for any command that lands work, even one that names `peer` (a commit message does).
  if (isLanding(command)) {
    const stopped = await this.landingStop(session, body, command, step, verdictBudgetMs);
    if (stopped !== null) return stopped;
  }
  if (publishesWork(command)) {
    const refusal = await this.handoffRefusal(session, "publish");
    if (refusal !== null)
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: refusal.hook,
        },
      };
  }
  const script = this.scripts.peer;
  const quotedScript = hookCommand(script);
  const naming =
    mentionsCli(command, this.cli) || command.includes(script) || command.includes(quotedScript);
  if (!naming) return this.shellVerdicts(session, body, command, step, verdictBudgetMs);
  // A command that lands work is judged by the plugins' shell verdicts although it names `peer` (a
  // commit message does): what an owner decides holds for it, whatever its message says.
  if (isLanding(command)) {
    const judged = await this.shellVerdicts(session, body, command, step, verdictBudgetMs);
    if (judged !== null) return judged;
  }
  // `peer …` is Peer's own coordination command: run its script, without asking.
  const viaName = isPlainCliCall(command, this.cli);
  const viaQuotedScript = isPlainCliCall(command, quotedScript);
  if (!viaName && !viaQuotedScript && !isPlainCliCall(command, script)) {
    // On the session's PATH it still runs; it only is not let through without asking.
    this.record("cli.unplain", { session: session.id, command });
    return null;
  }
  // Codex takes "allow" only with a rewrite, and runs Peer's script past its sandbox only as
  // its rule names it: the script, without what the agent added to trim its output.
  const rewritten =
    session.agent === "codex"
      ? `${quotedScript}${withoutOutputTrim(command).slice(viaName ? this.cli.length : viaQuotedScript ? quotedScript.length : script.length)}`
      : viaName
        ? `${quotedScript}${command.slice(this.cli.length)}`
        : undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Peer coordination",
      ...(rewritten === undefined ? {} : { updatedInput: { ...input, command: rewritten } }),
    },
  };
}

export async function handoffRefusal(
  this: CoordinationBroker,
  session: LocalSession,
  at: "publish" | "review" | "done" = "publish",
): Promise<{ readonly hook: string; readonly reason: string; readonly next: string } | null> {
  if (this.host.staleReads === undefined) return null;
  try {
    const freshness = await within(
      this.host.staleReads(session.workspace, session.project, session.id),
      INTENT_DEADLINE_MS,
    );
    if (freshness === TIMED_OUT) throw new Error("freshness deadline");
    if (freshness.fresh && freshness.stale.length === 0) return null;
    this.record("handoff.stale", { session: session.id, stale: freshness.stale, at });
    const plugins = await this.plugins();
    await within(
      Promise.all(
        plugins.active.map((plugin) => {
          const report = plugin.contributions.hooks?.handoffRefused;
          return report === undefined
            ? Promise.resolve()
            : this.host
                .run(report(this.sessionView(session), freshness.stale))
                .catch(() => undefined);
        }),
      ),
      100,
    );
    const hook = `Peer: shared inputs changed. Read the current version before publishing, or explicitly confirm its change with ${this.cli} ack <task>: ${freshness.stale.map((read) => `${this.handleOf(session.workspace, session.project, read.scope)} v${read.readVersion} → v${read.currentVersion}`).join("; ")}.`;
    return {
      hook,
      reason: hook.replace(/^Peer: /, ""),
      next: "read the current version with peer context <task>, recheck the result and retry. peer ack <task> only accepts a change you have already checked.",
    };
  } catch (error) {
    this.record("handoff.unverified", { session: session.id, reason: messageOf(error), at });
    return {
      hook: "Peer could not verify shared input versions. Retry publishing when the hub is reachable.",
      reason: "Peer could not verify shared input versions",
      next: "retry when the Hub is reachable.",
    };
  }
}

/**
 * What the plugins that judge shell commands say of one that is not Peer's own: a deny stops
 * it, a question goes to its person (Codex's agent asks in its reply); else nothing.
 */
export async function shellVerdicts(
  this: CoordinationBroker,
  session: LocalSession,
  body: Record<string, unknown>,
  command: string,
  step: PipelineStep,
  verdictBudgetMs: number,
): Promise<Record<string, unknown> | null> {
  const theirs = await verdicts(
    step,
    this.toolContext(session, body, "pre-tool", remainingMs(step)),
    "shell",
    verdictBudgetMs,
  );
  if (theirs.length === 0) return null;
  const denied = theirs.find((said) => said.verdict.decision === "deny");
  if (denied !== undefined) {
    this.record("plugin.denied", { plugin: denied.plugin, session: session.id, command });
    return editHookAnswer(session.agent, [verdictAnswer(denied, [])])?.output ?? null;
  }
  const asks = theirs
    .map((said) => verdictAnswer(said, [`$ ${command}`]))
    .filter((ask) => !ask.keys.every((key) => session.memory.acknowledged.has(key)));
  const hook = editHookAnswer(session.agent, asks);
  if (hook === null) return null;
  for (const key of hook.acknowledge) session.memory.acknowledged.add(key);
  return withReasons(
    hook.output,
    asks.flatMap((ask) => ask.reason ?? []),
  );
}
