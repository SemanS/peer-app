// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a broker on a temporary checkout and socket.
/**
 * The coordination broker for tests: a temporary checkout of acme's `app` project holding one `.ai`
 * decision, and a host of fakes that answer as an empty Hub would, with no plugin active. A case
 * replaces what it needs of the host.
 *
 * @module peerHub/core/broker/testkit
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { CoordinationBroker } from "../../coordinationBroker.ts";
import { brokerPlugins } from "../coordination/PeerCoordination.ts";
import * as PeerPlugins from "../plugins/PeerPlugins.ts";
import { NO_PLUGINS, type PeerBrokerHost } from "./host.ts";

/** A host's `plugins` as core gives the broker those of `plugins`, active or not, each time. */
export const pluginsOf = (
  plugins: PeerPlugins.PeerPlugins["Service"],
): Partial<PeerBrokerHost> => ({
  plugins: () =>
    Effect.runPromise(brokerPlugins.pipe(Effect.provideService(PeerPlugins.PeerPlugins, plugins))),
});

/**
 * A broker for Ana in a temporary checkout, its host built of fakes and `overrides`. `register`
 * makes a Claude Code session there known, `find` runs `peer find` as one, and `dispose` stops the
 * broker and removes the checkout.
 */
export async function brokerFixture(overrides?: (host: PeerBrokerHost) => Partial<PeerBrokerHost>) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-find-test-"));
  await NodeFSP.mkdir(NodePath.join(root, ".ai", "decisions"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(root, ".ai", "decisions", "prices.md"),
    "---\nid: prices\ntitle: Keep prices in cents\n---\nPrices are integers.\n",
  );
  const view = { sessions: [], overlaps: [], at: new Date().toISOString() };
  const unavailable = async (): Promise<never> => {
    throw new Error("not used by find");
  };
  const host: PeerBrokerHost = {
    socketPath: NodePath.join(root, "peer.sock"),
    scriptsDir: NodePath.join(root, "scripts"),
    logPath: NodePath.join(root, "broker.jsonl"),
    contextsDir: NodePath.join(root, "contexts"),
    environment: "test",
    placeOf: async () => ({ workspace: "acme", project: "app", root }),
    branchOf: async () => "feature/prices",
    queueCodex: async () => false,
    nameOf: () => "Ana",
    email: () => "ana@acme.test",
    policy: () => "notify",
    report: async () => view,
    view: async () => view,
    note: unavailable,
    resolve: unavailable,
    workspaces: () => ["acme"],
    changed: () => undefined,
    taskOf: () => undefined,
    threadOf: async () => undefined,
    tasks: () => [],
    taskName: (_workspace, _project, task) => task,
    readContext: async () => null,
    keepContext: unavailable,
    writeContext: unavailable,
    projectGuidance: async () => null,
    taskDone: () => false,
    gitStatus: async () => "",
    contextVersions: async () => [],
    readContextVersion: async () => null,
    plugins: async () => NO_PLUGINS,
    run: (effect) => Effect.runPromise(effect),
  };
  const broker = new CoordinationBroker({ ...host, ...overrides?.(host) });
  const register = async (id: string) => {
    await broker["sessionFor"]("claude", { session_id: id, cwd: root }, undefined);
  };
  const find = (id: string) =>
    broker["runCli"]("find", ["format prices"], { "x-peer-session": `claude:${id}` });
  const dispose = async () => {
    await broker.stop();
    await NodeFSP.rm(root, { recursive: true, force: true });
  };
  return { register, find, dispose, broker, root };
}
