// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a stopped provider's saved context and delivery memory in a temporary checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { PeerWorkStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { HubCoordView, HubOverlap } from "../hub/coordApi.ts";
import { CoordinationBroker } from "./Broker.ts";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

const NATIVE_ID = "native-one";
const THREAD = "peer:original-thread";
const PRIVATE_CONTEXT = "Coupon calculation stays in integer cents; keep the original rounding.";
const NEW_MESSAGE = "The human discussion is finished: apply the coupon before loyalty.";

async function dormantFixture(agent: "claude" | "codex") {
  const sessionId = `${agent}:${NATIVE_ID}`;
  const now = new Date().toISOString();
  const overlap: HubOverlap = {
    id: "discount-overlap",
    project: "app",
    sessions: [sessionId, "claude:teammate"],
    files: ["src/discounts.ts"],
    state: "open",
    notes: [
      {
        id: "already-read",
        session: "claude:teammate",
        email: "teammate@acme.test",
        text: "We are waiting for the humans to decide.",
        at: now,
      },
    ],
    openedAt: now,
    updatedAt: now,
  };
  let current: HubCoordView = { sessions: [], overlaps: [overlap], at: now };
  let cwd = "";
  const state = {
    resumable: false,
    selectedNative: NATIVE_ID,
    taken: true,
    admission: undefined as (() => Promise<boolean>) | undefined,
    task: undefined as string | undefined,
    completedTasks: new Set<string>(),
    runtime: null as PeerWorkStatus | null,
  };
  const admitted: Array<{ session: string; text: string; thread: string }> = [];
  let independentQueues = 0;
  const fixture = await brokerFixture(() => ({
    threadOf: async (nativeId) => (nativeId === NATIVE_ID ? THREAD : undefined),
    threadAgent: async () => ({ agent, nativeId: state.selectedNative, cwd }),
    threadRuntime: () => state.runtime,
    resumableThreads: async () =>
      state.resumable ? [{ agent, nativeId: NATIVE_ID, thread: THREAD, cwd }] : [],
    queueNative: async (session, text, thread) => {
      admitted.push({ session, text, thread });
      return state.admission === undefined ? state.taken : state.admission();
    },
    taskOf: () => state.task,
    taskDone: (_workspace, _project, task) => state.completedTasks.has(task),
    queueCodex: async () => {
      independentQueues++;
      return false;
    },
    report: async () => current,
    view: async () => current,
  }));
  cwd = fixture.root;
  fixture.broker.views.set("acme", current);
  const session = await fixture.broker.createSession(
    agent,
    { session_id: NATIVE_ID, cwd },
    undefined,
  );
  expect(session).not.toBeNull();
  await NodeFSP.mkdir(NodePath.dirname(session!.ownContextPath), { recursive: true });
  await NodeFSP.writeFile(session!.ownContextPath, `# Private context\n\n${PRIVATE_CONTEXT}\n`);
  expect(await fixture.broker.wakingNews(session!, NO_PLUGINS)).toContain("waiting for the humans");
  await fixture.broker.saveMemories();
  // The provider exits when its idle lease expires. Only the persisted provider-session
  // projection knows why: native SessionEnd hooks need not include the release reason.
  await fixture.broker.hook(
    { session_id: NATIVE_ID, cwd, hook_event_name: "SessionEnd" },
    { "x-peer-agent": agent },
  );
  state.resumable = true;

  const setOverlaps = (broker: CoordinationBroker, overlaps: ReadonlyArray<HubOverlap>) => {
    current = { ...current, overlaps };
    broker.views.set("acme", current);
  };
  const newNote = (broker: CoordinationBroker) =>
    setOverlaps(broker, [
      {
        ...overlap,
        notes: [
          ...overlap.notes,
          { id: "new-message", email: "ana@acme.test", text: NEW_MESSAGE, at: now },
        ],
      },
    ]);
  const resume = async (broker: CoordinationBroker) => {
    state.resumable = false;
    state.runtime = "idle";
    return broker.hook(
      { session_id: NATIVE_ID, cwd, hook_event_name: "SessionStart", source: "resume" },
      { "x-peer-agent": agent },
    );
  };
  return {
    ...fixture,
    state,
    sessionId,
    overlap,
    admitted,
    independentQueues: () => independentQueues,
    contextPath: session!.ownContextPath,
    setOverlaps,
    newNote,
    resume,
  };
}

describe("native Peer agents after idle process release", () => {
  it.each(["claude", "codex"] as const)(
    "checks the current task before waking a cached dormant %s agent",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      try {
        fixture.state.task = "original-task";
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([]);

        fixture.state.task = "completed-task";
        fixture.state.completedTasks.add("completed-task");
        fixture.newNote(fixture.broker);
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([]);
      } finally {
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "does not redeliver admitted news when %s resumes during admission",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      const entered = Promise.withResolvers<void>();
      const admission = Promise.withResolvers<boolean>();
      let broker = fixture.broker;
      let waking: Promise<void> | undefined;
      try {
        fixture.state.admission = () => {
          entered.resolve();
          return admission.promise;
        };
        fixture.newNote(broker);
        waking = broker.wakeIdle();
        await entered.promise;
        const live = await broker.createSession(
          agent,
          { session_id: NATIVE_ID, cwd: fixture.root },
          undefined,
        );
        expect(live?.thread).toBe(THREAD);
        expect(live?.memory.seenNotes.has("new-message")).toBe(false);
        admission.resolve(true);
        await waking;
        expect(fixture.admitted).toHaveLength(1);

        await broker.saveMemories();
        await broker.stop();
        broker = new CoordinationBroker(fixture.broker.host);
        fixture.state.admission = undefined;
        fixture.newNote(broker);
        await broker.wakeIdle();
        expect(fixture.admitted).toHaveLength(1);
      } finally {
        admission.resolve(false);
        await waking;
        await broker.stop();
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "keeps admitted news when %s resumes while its delivery memory is being saved",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      const entered = Promise.withResolvers<void>();
      const saving = Promise.withResolvers<void>();
      const originalSave = fixture.broker.saveMemories.bind(fixture.broker);
      let gate = true;
      let broker = fixture.broker;
      let waking: Promise<void> | undefined;
      try {
        fixture.broker.saveMemories = async () => {
          if (gate) {
            gate = false;
            entered.resolve();
            await saving.promise;
          }
          return originalSave();
        };
        fixture.newNote(broker);
        waking = broker.wakeIdle();
        await entered.promise;
        const live = await broker.createSession(
          agent,
          { session_id: NATIVE_ID, cwd: fixture.root },
          undefined,
        );
        expect(live?.thread).toBe(THREAD);
        saving.resolve();
        await waking;
        expect(fixture.admitted).toHaveLength(1);

        fixture.broker.saveMemories = originalSave;
        await broker.stop();
        broker = new CoordinationBroker(fixture.broker.host);
        fixture.newNote(broker);
        await broker.wakeIdle();
        expect(fixture.admitted).toHaveLength(1);
      } finally {
        saving.resolve();
        await waking;
        fixture.broker.saveMemories = originalSave;
        await broker.stop();
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "retains accepted news when %s promotion finishes after a stale memory read",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      const offered = Promise.withResolvers<void>();
      const admission = Promise.withResolvers<boolean>();
      const read = Promise.withResolvers<void>();
      const promotion = Promise.withResolvers<void>();
      const originalRestore = fixture.broker.restoreMemory.bind(fixture.broker);
      let pauseRead = false;
      let broker = fixture.broker;
      let waking: Promise<void> | undefined;
      let creating: ReturnType<CoordinationBroker["createSession"]> | undefined;
      try {
        fixture.state.admission = () => {
          offered.resolve();
          return admission.promise;
        };
        fixture.broker.restoreMemory = async (session) => {
          const remembered = await originalRestore(session);
          if (pauseRead) {
            pauseRead = false;
            read.resolve();
            await promotion.promise;
          }
          return remembered;
        };
        fixture.newNote(broker);
        waking = broker.wakeIdle();
        await offered.promise;
        pauseRead = true;
        creating = broker.createSession(
          agent,
          { session_id: NATIVE_ID, cwd: fixture.root },
          undefined,
        );
        await read.promise;
        admission.resolve(true);
        await waking;
        promotion.resolve();
        const live = await creating;
        expect(live?.thread).toBe(THREAD);
        // A later real input makes this live object's memory change and therefore get
        // written; an unchanged stale snapshot would leave the newer disk file untouched.
        live!.heard.add("another-input-read-after-resume");
        await broker.saveMemories();
        await broker.stop();
        broker = new CoordinationBroker(fixture.broker.host);
        fixture.state.admission = undefined;
        fixture.newNote(broker);
        await broker.wakeIdle();
        expect(fixture.admitted).toHaveLength(1);
        expect(live?.memory.seenNotes.has("new-message")).toBe(true);
      } finally {
        admission.resolve(false);
        promotion.resolve();
        await waking;
        await creating;
        fixture.broker.restoreMemory = originalRestore;
        await broker.stop();
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "keeps news for the %s hook when a concurrent resume outlives rejected admission",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      const entered = Promise.withResolvers<void>();
      const admission = Promise.withResolvers<boolean>();
      let waking: Promise<void> | undefined;
      try {
        fixture.state.admission = () => {
          entered.resolve();
          return admission.promise;
        };
        fixture.newNote(fixture.broker);
        waking = fixture.broker.wakeIdle();
        await entered.promise;
        await fixture.broker.createSession(
          agent,
          { session_id: NATIVE_ID, cwd: fixture.root },
          undefined,
        );
        admission.resolve(false);
        await waking;
        fixture.state.admission = undefined;
        await fixture.broker.saveMemories();

        const answer = await fixture.resume(fixture.broker);
        expect(JSON.stringify(answer)).toContain(NEW_MESSAGE);
        expect(JSON.stringify(answer)).toContain(PRIVATE_CONTEXT);
        expect(fixture.broker.sessions.get(fixture.sessionId)?.thread).toBe(THREAD);
      } finally {
        admission.resolve(false);
        await waking;
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "resumes %s for a confirmed human agreement on a resolved overlap",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      try {
        const words = "Agreement confirmed: apply the coupon before loyalty.";
        fixture.setOverlaps(fixture.broker, [
          {
            ...fixture.overlap,
            state: "resolved",
            resolution: "apply the coupon before loyalty",
            notes: [
              ...fixture.overlap.notes,
              {
                id: "human-confirmation",
                email: "ana@acme.test",
                text: words,
                at: fixture.overlap.updatedAt,
              },
            ],
          },
        ]);
        await fixture.broker.wakeIdle();
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([
          {
            session: fixture.sessionId,
            thread: THREAD,
            text: expect.stringContaining(words),
          },
        ]);
        expect(fixture.broker.reportFor("acme")).toEqual([]);
      } finally {
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "resumes %s once in the original thread for a new overlap message",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      try {
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([]);
        expect(fixture.broker.reportFor("acme")).toEqual([]);

        fixture.newNote(fixture.broker);
        await fixture.broker.wakeIdle();
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([
          {
            session: fixture.sessionId,
            thread: THREAD,
            text: expect.stringContaining(NEW_MESSAGE),
          },
        ]);
        expect(fixture.independentQueues()).toBe(0);
        expect(fixture.broker.reportFor("acme")).toEqual([]);

        const answer = await fixture.resume(fixture.broker);
        expect(JSON.stringify(answer)).toContain(PRIVATE_CONTEXT);
        expect(fixture.broker.sessions.get(fixture.sessionId)?.thread).toBe(THREAD);
        expect(await NodeFSP.readFile(fixture.contextPath, "utf8")).toContain(PRIVATE_CONTEXT);
      } finally {
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "keeps old and unrelated notes silent after a %s broker restart",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      let broker = fixture.broker;
      try {
        await broker.stop();
        broker = new CoordinationBroker(fixture.broker.host);
        fixture.setOverlaps(broker, [
          fixture.overlap,
          {
            ...fixture.overlap,
            id: "someone-elses-overlap",
            project: "another-project",
            sessions: ["claude:someone-else", "codex:another-agent"],
            notes: [
              {
                id: "unrelated",
                email: "ana@acme.test",
                text: NEW_MESSAGE,
                at: fixture.overlap.updatedAt,
              },
            ],
          },
        ]);
        await broker.wakeIdle();
        expect(fixture.admitted).toEqual([]);
        expect(broker.reportFor("acme")).toEqual([]);

        fixture.newNote(broker);
        await broker.wakeIdle();
        expect(fixture.admitted).toHaveLength(1);
        await broker.stop();
        broker = new CoordinationBroker(fixture.broker.host);
        fixture.newNote(broker);
        await broker.wakeIdle();
        expect(fixture.admitted).toHaveLength(1);
      } finally {
        await broker.stop();
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "leaves news available to the resumed %s hook when admission fails",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      try {
        fixture.state.taken = false;
        fixture.newNote(fixture.broker);
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toHaveLength(1);
        expect(fixture.broker.reportFor("acme")).toEqual([]);

        await fixture.broker.saveMemories();
        const answer = await fixture.resume(fixture.broker);
        expect(JSON.stringify(answer)).toContain(NEW_MESSAGE);
        expect(JSON.stringify(answer)).toContain(PRIVATE_CONTEXT);
        expect(fixture.broker.sessions.get(fixture.sessionId)?.thread).toBe(THREAD);
      } finally {
        await fixture.dispose();
      }
    },
  );

  it.each(["claude", "codex"] as const)(
    "does not resume an explicitly stopped or replaced %s agent",
    async (agent) => {
      const fixture = await dormantFixture(agent);
      try {
        fixture.newNote(fixture.broker);
        fixture.state.resumable = false;
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([]);

        fixture.state.resumable = true;
        fixture.state.selectedNative = "replacement-native-session";
        await fixture.broker.wakeIdle();
        expect(fixture.admitted).toEqual([]);
        expect(fixture.independentQueues()).toBe(0);
      } finally {
        await fixture.dispose();
      }
    },
  );
});
