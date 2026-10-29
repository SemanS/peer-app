// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - the broker's unix socket, a detached child and its log, a code read from the terminal.
/**
 * `peer core …` (also `t3 peer …`): Peer's coordination without the desktop app. `serve` runs Peer Core (the broker
 * on `<stateDir>/coord.sock`, the `peer` shim, the Hub followed) until stopped or until the Peer
 * app takes over; the other commands either forward to the broker that runs (app or Peer Core) or,
 * with none, do their work once in this process and exit. One fact per output line.
 *
 * @module cli/peerCore
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";

import { PEER_LOCAL_WORKSPACE, type PeerHubError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Argument, Command, Flag, GlobalFlag, Prompt } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import type * as ServerConfig from "../config.ts";
import {
  coordSocketPath,
  coreLaunchCommand,
  type Owner,
  readOwner,
  requestHandover,
  waitForSocketGone,
} from "../peerHub/core/broker/owner.ts";
import * as PeerAdapters from "../peerHub/core/coordination/PeerAdapters.ts";
import * as PeerCoordination from "../peerHub/core/coordination/PeerCoordination.ts";
import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import * as PeerWork from "../peerHub/core/work/PeerWork.ts";
import { matchRepositories } from "../peerHub/core/state/remotes.ts";
import * as PeerWorkspaces from "../peerHub/core/workspaces/PeerWorkspaces.ts";
import { readProjects, registerFolder } from "../peerHub/headless/HeadlessProjects.ts";
import * as PeerCoreRuntime from "../peerHub/headless/PeerCoreRuntime.ts";
import { mcpClient, MCP_CLIENTS } from "../peerHub/plugins/mcp/clients.ts";
import * as McpConnect from "../peerHub/plugins/mcp/connect.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";
import * as PeerCoreBind from "./peerCoreBind.ts";
import * as PeerCoreEditor from "./peerCoreEditor.ts";
import { type OneShotIo, outcome } from "./peerCoreIo.ts";
import * as PeerCoreJoin from "./peerCoreJoin.ts";
import * as PeerCoreMenu from "./peerCoreMenu.ts";
import * as PeerCoreOpenSpec from "./peerCoreOpenSpec.ts";
import * as PeerCoreTree from "./peerCoreTree.ts";
import * as PeerCoreShare from "./peerCoreShare.ts";
import * as PeerCoreTasks from "./peerCoreTasks.ts";

const SOCKET_WAIT_MS = 20_000;
const PEER_DOWNLOAD = "https://github.com/SemanS/peer-app/releases/latest";
const HANDOVER_WAIT_MS = 10_000;

const fail = (text: string) => new CliError.UserError({ cause: text, userMessage: text });

const resolveConfig = (flags: CliAuthLocationFlags) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    return yield* resolveCliAuthConfig(flags, logLevel);
  });

const ownerOf = (stateDir: string) => Effect.promise(() => readOwner(stateDir));

const describeOwner = (owner: Owner) =>
  `${owner.kind === "app" ? "the Peer app" : "Peer Core"}, pid ${owner.pid}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `check` every 200 ms for at most `ms`; true once it held. */
async function waitUntil(check: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= until) return false;
    await sleep(200);
  }
}

const realpathOrSelf = (path: string) => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return NodePath.resolve(path);
  }
};

const messageOf = (error: PeerHubError | unknown) =>
  typeof error === "object" && error !== null && "detail" in error
    ? String((error as { readonly detail: unknown }).detail)
    : error instanceof Error
      ? error.message
      : String(error);

interface Forwarded {
  readonly status: number;
  readonly body: string;
}

/** `POST http://peer/cli/<command>` on the broker's socket; the args NUL-terminated, as `peer`. */
function forwardRequest(
  socketPath: string,
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<Forwarded> {
  const clean = (text: string) => text.replace(/[\r\n]/g, "");
  const headers: Record<string, string> = {
    "X-Peer-Session": clean(process.env.PEER_SESSION ?? process.env.CODEX_THREAD_ID ?? ""),
    "X-Peer-Cwd": clean(cwd),
  };
  const token = process.env.PEER_SESSION_TOKEN;
  if (token !== undefined && token !== "") headers["X-Peer-Session-Token"] = clean(token);
  const body = args.map((arg) => `${arg}\0`).join("");
  return new Promise((resolve, reject) => {
    const request = NodeHttp.request(
      {
        socketPath,
        method: "POST",
        host: "peer",
        path: `/cli/${command}`,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        timeout: 30_000,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: text }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Peer did not answer within 30 s.")));
    request.on("error", reject);
    request.end(body);
  });
}

const forward = (stateDir: string, command: string, args: ReadonlyArray<string>, cwd: string) =>
  Effect.gen(function* () {
    const answer = yield* Effect.tryPromise({
      try: () => forwardRequest(coordSocketPath(stateDir), command, args, cwd),
      catch: (cause) => fail(`peer core: could not reach Peer: ${messageOf(cause)}`),
    });
    const text = answer.body.trimEnd();
    if (answer.status >= 200 && answer.status < 300) {
      if (text !== "") yield* Console.log(text);
      return;
    }
    return yield* fail(text === "" ? `Peer answered HTTP ${answer.status}.` : text);
  });

const detachFlag = Flag.Boolean("detach").pipe(
  Flag.withDescription("Start Peer Core in the background, wait for its socket and print its pid."),
  Flag.withDefault(false),
);

/** Starts `peer core serve` detached, its output in `<logsDir>/peer-core.log`. */
const serveDetached = (
  config: ServerConfig.ServerConfig["Service"],
  flags: CliAuthLocationFlags,
  options: { readonly quiet?: boolean } = {},
) =>
  Effect.gen(function* () {
    const launch = coreLaunchCommand() ?? [process.execPath, ...process.argv.slice(1, 2)];
    const [executable, ...prefix] = launch;
    if (executable === undefined) return yield* fail("peer core: cannot tell how to start itself.");
    const args = [
      ...prefix,
      "peer",
      "serve",
      ...(Option.isSome(flags.baseDir) ? ["--base-dir", flags.baseDir.value] : []),
    ];
    const logPath = NodePath.join(config.logsDir, "peer-core.log");
    const child = yield* Effect.try({
      try: () => {
        NodeFS.mkdirSync(config.logsDir, { recursive: true });
        const log = NodeFS.openSync(logPath, "a", 0o600);
        const spawned = NodeChildProcess.spawn(executable, args, {
          detached: true,
          stdio: ["ignore", log, log],
          env: process.env,
        });
        NodeFS.closeSync(log);
        spawned.unref();
        return spawned;
      },
      catch: (cause) => fail(`peer core: could not start: ${messageOf(cause)}`),
    });
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    const started = yield* Effect.promise(() =>
      waitUntil(async () => exited || (await readOwner(config.stateDir)) !== null, SOCKET_WAIT_MS),
    );
    const owner = yield* ownerOf(config.stateDir);
    if (!started || owner === null)
      return yield* fail(
        `peer core: Peer Core did not start within ${SOCKET_WAIT_MS / 1000} s; see ${logPath}.`,
      );
    if (options.quiet === true) return;
    yield* Console.log(`Peer runs: ${describeOwner(owner)}.`);
    yield* Console.log(`Socket: ${coordSocketPath(config.stateDir)}`);
    yield* Console.log(`Log: ${logPath}`);
  });

/** Runs Peer Core here until SIGINT/SIGTERM or until another broker takes over. */
const serveHere = (config: ServerConfig.ServerConfig["Service"]) =>
  Effect.gen(function* () {
    const coordination = yield* PeerCoordination.PeerCoordination;
    // SIGINT/SIGTERM interrupt `serve`: the broker reports nothing left here and frees the socket.
    yield* Effect.addFinalizer(() => coordination.stop);
    // Coordination is what Peer Core is for: on, whatever the app's saved switch says. Core's `run`
    // already starts it unless that switch is off, so starting it here too would race on the scripts.
    const state = yield* PeerState.PeerState;
    if ((yield* state.read).persisted.coordination?.enabled === false)
      yield* coordination.start.pipe(
        Effect.mapError((error) => fail(`peer core: could not start the broker: ${error.detail}`)),
      );
    const bound = yield* Effect.promise(() =>
      waitUntil(() => coordination.broker() !== null, SOCKET_WAIT_MS),
    );
    if (!bound) return yield* fail("peer core: the broker did not start.");
    yield* Console.log(`Peer Core runs, pid ${process.pid}.`);
    yield* Console.log(`Socket: ${coordination.paths.socket}`);
    yield* Console.log(`peer: ${coordination.paths.peer}`);
    // The app took over (handover), or Peer Core stopped its broker itself.
    const brokerGone = Effect.promise(() =>
      waitUntil(() => coordination.broker() === null, Number.POSITIVE_INFINITY),
    );
    yield* Effect.raceFirst(coordination.handedOver, brokerGone);
    yield* Console.log("Peer Core stopped: the Peer app took over, or peer core stop asked it to.");
  }).pipe(Effect.provide(PeerCoreRuntime.layer(config)), Effect.scoped);

const serveCommand = Command.make("serve", { ...authLocationFlags, detach: detachFlag }).pipe(
  Command.withDescription("Run Peer Core: coordination for editors and agents without the app."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const owner = yield* ownerOf(config.stateDir);
      if (owner !== null) {
        yield* Console.log(`Peer is already running: ${describeOwner(owner)}.`);
        return;
      }
      if (flags.detach) return yield* serveDetached(config, flags);
      return yield* serveHere(config);
    }),
  ),
);

const stopCommand = Command.make("stop", { ...authLocationFlags }).pipe(
  Command.withDescription("Stop Peer Core (never the Peer app)."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const owner = yield* ownerOf(config.stateDir);
      if (owner === null) {
        yield* Console.log("Peer is not running.");
        return;
      }
      if (owner.kind === "app")
        return yield* fail(
          `peer core: ${describeOwner(owner)} runs Peer; quit the app to stop it.`,
        );
      const socket = coordSocketPath(config.stateDir);
      const acknowledged = yield* Effect.promise(() => requestHandover(socket));
      if (!acknowledged) return yield* fail("peer core: Peer Core did not agree to stop.");
      const gone = yield* Effect.promise(() => waitForSocketGone(socket, HANDOVER_WAIT_MS));
      if (!gone)
        return yield* fail(
          `peer core: Peer Core (pid ${owner.pid}) still holds ${socket} after ${HANDOVER_WAIT_MS / 1000} s.`,
        );
      yield* Console.log(`Stopped Peer Core, pid ${owner.pid}.`);
    }),
  ),
);

/** What this computer's Peer state says, read once without writing anything. */
const localStatus = (config: ServerConfig.ServerConfig["Service"], owner: Owner | null) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const { persisted } = yield* state.read;
    yield* Console.log(
      owner === null
        ? "Peer runs: no (start it with peer core serve, or open the Peer app)."
        : `Peer runs: ${describeOwner(owner)}.`,
    );
    yield* Console.log(`Hub: ${persisted.hubUrl ?? process.env.PEER_HUB_URL ?? "the default Hub"}`);
    yield* Console.log(
      persisted.email === null ? "Signed in: no" : `Signed in: ${persisted.email}`,
    );
    for (const workspace of persisted.workspaces)
      yield* Console.log(`Workspace: ${workspace.slug} (${workspace.name})`);
    const folders = yield* Effect.promise(() => readProjects(config.stateDir));
    yield* PeerCoreBind.sayCheckouts(
      folders.map((folder) => folder.workspaceRoot),
      terminalIo,
    );
  }).pipe(Effect.provide(PeerCoreRuntime.stateLayer(config)));

const statusCommand = Command.make("status", { ...authLocationFlags }).pipe(
  Command.withDescription("Who runs Peer here, who is signed in, and which folders are shared."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      // Read-only, whoever runs the broker: the app's `peer status` needs a shared folder, this does not.
      return yield* localStatus(config, yield* ownerOf(config.stateDir));
    }),
  ),
);

/**
 * The one-shot commands write `peer-hub.json`, which a running broker keeps in memory. The Peer
 * app is the person's to quit, so beside it they are refused; Peer Core runs in the background for
 * them (the menu or a session's hook started it), so it hands over, the command runs, and with
 * `restart` it starts again once the command ends, whether or not the command succeeded.
 */
const pauseCore = (
  config: ServerConfig.ServerConfig["Service"],
  flags: CliAuthLocationFlags,
  options: { readonly restart: boolean },
) =>
  Effect.gen(function* () {
    const owner = yield* ownerOf(config.stateDir);
    if (owner === null) return;
    if (owner.kind === "app")
      return yield* fail(
        `peer core: the Peer app runs here (pid ${owner.pid}): do this in the app, or quit it first.`,
      );
    const socket = coordSocketPath(config.stateDir);
    const handedOver =
      (yield* Effect.promise(() => requestHandover(socket))) &&
      (yield* Effect.promise(() => waitForSocketGone(socket, HANDOVER_WAIT_MS)));
    if (!handedOver)
      return yield* fail(
        `peer core: Peer Core (pid ${owner.pid}) did not stop for this command; run peer core stop, then repeat it.`,
      );
    if (!options.restart) {
      yield* Console.log(`Stopped Peer Core (pid ${owner.pid}).`);
      return;
    }
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if ((yield* ownerOf(config.stateDir)) !== null) return;
        yield* serveDetached(config, flags, { quiet: true });
        yield* Console.log("Peer Core coordinates in the background again.");
      }).pipe(Effect.ignore),
    );
  });

const readCode = Effect.tryPromise({
  try: async () => {
    const terminal = NodeReadlinePromises.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return (await terminal.question("Code: ")).trim();
    } finally {
      terminal.close();
    }
  },
  catch: () => fail("peer core: could not read the code."),
});

const terminalIo: OneShotIo = {
  say: (line) => Console.log(line),
  askCode: readCode,
};

const hubFlag = Flag.String("hub").pipe(
  Flag.withDescription("Another Peer Hub than the current one."),
  Flag.optional,
);

const codeFlag = Flag.String("code").pipe(
  Flag.withDescription("The code the Hub mailed (else it is asked for)."),
  Flag.optional,
);

const isTerminal = () => process.stdin.isTTY === true && process.stdout.isTTY === true;

const shareAsk: PeerCoreShare.ShareAsk<Prompt.Environment> = {
  interactive: true,
  confirm: (message, initial) =>
    Prompt.run(Prompt.Confirm({ message, initial })).pipe(Effect.orElseSucceed(() => false)),
  choose: (message, choices) =>
    Prompt.run(Prompt.Select({ message, choices: [...choices] })).pipe(
      Effect.orElseSucceed(() => null),
    ),
};

const menuAsk: PeerCoreMenu.MenuAsk<Prompt.Environment> = {
  choose: shareAsk.choose,
  text: (message) => Prompt.run(Prompt.String({ message })).pipe(Effect.orElseSucceed(() => null)),
  pick: (message, choices) =>
    Prompt.run(
      Prompt.MultiSelect({ message, choices: choices.map((title) => ({ title, value: title })) }),
    ).pipe(Effect.orElseSucceed(() => null)),
  confirm: shareAsk.confirm,
  tree: (message, nodes) =>
    Prompt.run(PeerCoreTree.treePrompt(message, nodes)).pipe(Effect.orElseSucceed(() => null)),
  treePick: (message, nodes, expand) =>
    Prompt.run(PeerCoreTree.treeStartPrompt(message, nodes, expand)).pipe(
      Effect.orElseSucceed(() => null),
    ),
  folder: (message) =>
    Prompt.run(Prompt.File({ type: "directory", message, startingPath: NodeOS.homedir() })).pipe(
      Effect.orElseSucceed(() => null),
    ),
};

/** A Hub's refusal as the CLI prints it; other failures unchanged. */
const hubFailure = <A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, PeerHubError> | CliError.UserError, R> =>
  Effect.mapError(self, (error) =>
    typeof error === "object" &&
    error !== null &&
    (error as { _tag?: unknown })._tag === "PeerHubError"
      ? fail(`peer core: ${(error as unknown as PeerHubError).detail}`)
      : (error as Exclude<E, PeerHubError>),
  );

type MenuServices =
  | Prompt.Environment
  | PeerWorkspaces.PeerWorkspaces
  | PeerState.PeerState
  | PeerHubClient.PeerHubClient
  | PeerWork.PeerWork
  | Effect.Services<ReturnType<typeof PeerCoreEditor.connectEditor>>;

/** Takes a project out of its workspace, and forgets what was imported into it here. */
const unshareProject = (stateDir: string, workspace: string, project: string) =>
  Effect.gen(function* () {
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    yield* workspaces.unshareProject({ workspace, projectId: project });
    yield* Effect.promise(() => PeerCoreOpenSpec.forgetProject(stateDir, workspace, project));
    yield* Console.log(
      `Disconnected ${workspace}/${project}: it left the workspace; the clone here stays as it is.`,
    );
  }).pipe(hubFailure);

/** The menu after signing in, each step the command of the same name. */
const runMenu = (stateDir: string) =>
  Effect.gen(function* () {
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    const state = yield* PeerState.PeerState;
    const status = workspaces.sync.pipe(hubFailure);
    return yield* PeerCoreMenu.menu<MenuServices>(
      menuAsk,
      {
        status,
        home: NodeOS.homedir(),
        here: Effect.gen(function* () {
          const checkout = yield* PeerCoreBind.repositoryRoot(process.cwd());
          if (checkout === null) return null;
          const place = yield* state.placeOf(checkout.root, { bindByRemote: false });
          if (place !== null && place.workspace !== PEER_LOCAL_WORKSPACE)
            return {
              root: checkout.root,
              state: "connected" as const,
              workspace: place.workspace,
              project: place.project,
              openspec: NodeFS.existsSync(NodePath.join(checkout.root, "openspec", "changes")),
            };
          const remote = yield* Effect.promise(() => PeerState.remoteOf(checkout.remoteRoot));
          const { persisted } = yield* state.read;
          const match =
            remote === null
              ? undefined
              : matchRepositories(
                  remote,
                  persisted.workspaces.map((w) => w.manifest),
                )[0];
          return match === undefined
            ? { root: checkout.root, state: "new" as const }
            : {
                root: checkout.root,
                state: "clone" as const,
                project: `${match.workspace}/${match.project}`,
              };
        }),
        editors: Effect.gen(function* () {
          const coordination = (yield* status).coordination;
          const mcp = yield* (yield* McpConnect.McpClients).connected;
          const env = yield* HostProcess.Environment;
          return PeerCoreEditor.EDITORS.map((id) => ({
            id,
            title: PeerCoreEditor.editorTitle(id),
            connected:
              id === "claude"
                ? coordination.claudeHooks
                : id === "codex"
                  ? (coordination.codexHookHomes ?? []).some((home) => home.installed)
                  : mcp.includes(id),
            launchable: (id === "claude" || id === "codex") && onPath(id, env.PATH),
          }));
        }).pipe(Effect.orElseSucceed(() => [])),
        join: (slug) =>
          PeerCoreJoin.join({ target: slug }, terminalIo).pipe(
            Effect.flatMap((joined) => PeerCoreJoin.sayNextStep(joined, terminalIo)),
            hubFailure,
          ),
        founding: (slug) =>
          workspaces
            .acceptFounding({ slug })
            .pipe(Effect.andThen(Console.log(`Accepted: ${slug}. You are its owner.`)), hubFailure),
        create: (name) => PeerCoreMenu.create({ name }, terminalIo).pipe(Effect.asVoid, hubFailure),
        repositories: Effect.gen(function* () {
          const found = yield* Effect.promise(() =>
            PeerCoreMenu.findRepositories(NodeOS.homedir()),
          );
          const open: Array<string> = [];
          for (const dir of found) {
            const place = yield* state.placeOf(dir, { bindByRemote: false });
            if (place === null || place.workspace === PEER_LOCAL_WORKSPACE) open.push(dir);
          }
          return open;
        }),
        share: (path) =>
          PeerCoreShare.shareFolder(
            path.replace(/^~(?=$|\/)/, NodeOS.homedir()),
            process.cwd(),
          ).pipe(
            Effect.flatMap(({ folder }) =>
              PeerCoreShare.share(
                { folder, named: true, yes: false },
                shareAsk,
                terminalIo,
                registerIn(stateDir),
              ).pipe(
                Effect.andThen(state.placeOf(folder, { bindByRemote: false })),
                Effect.map((place) =>
                  place === null || place.workspace === PEER_LOCAL_WORKSPACE
                    ? null
                    : { workspace: place.workspace, project: place.project },
                ),
              ),
            ),
            hubFailure,
          ),
        invite: (input) =>
          status.pipe(
            Effect.flatMap((now) => PeerCoreMenu.invite(input, now, terminalIo)),
            Effect.asVoid,
            hubFailure,
          ),
        startTask: (input) =>
          Effect.gen(function* () {
            const work = yield* PeerWork.PeerWork;
            const { createdTask: task } = yield* work.createTask({
              workspace: input.workspace,
              projectId: input.project,
              title: input.title,
              ...(input.parent === undefined ? {} : { parent: input.parent }),
            });
            yield* Console.log(
              `Created ${task.key ?? task.id} · ${task.title} in ${input.workspace}/${input.project}.`,
            );
            if (input.take)
              yield* PeerCoreTasks.takeTask(
                {
                  task: task.id,
                  project: `${input.workspace}/${input.project}`,
                  cwd: realpathOrSelf(process.cwd()),
                  canWrite: true,
                },
                terminalIo,
              );
            yield* Console.log(
              "Your agents in the project see it with peer tasks, and Peer tells them who works on what.",
            );
          }).pipe(hubFailure),
        settleTask: (workspace, project, task, executable) =>
          Effect.gen(function* () {
            const work = yield* PeerWork.PeerWork;
            yield* work.updateTask({
              workspace,
              projectId: project,
              taskId: task,
              executable,
              unsettled: false,
            });
          }).pipe(hubFailure),
        unshare: (workspace, project) => unshareProject(stateDir, workspace, project),
        takeTask: (workspace, project, task) =>
          PeerCoreTasks.takeTask(
            {
              task,
              project: `${workspace}/${project}`,
              cwd: realpathOrSelf(process.cwd()),
              canWrite: true,
            },
            terminalIo,
          ),
        checkoutOf: (workspace, project) =>
          Effect.gen(function* () {
            const { persisted } = yield* state.read;
            for (const [key, root] of Object.entries(persisted.localCheckouts ?? {}))
              if (key.startsWith(`${workspace}/${project}/`) && NodeFS.existsSync(root))
                return root;
            // A folder shared from this computer is its project's checkout too.
            for (const folder of yield* Effect.promise(() => readProjects(stateDir))) {
              const place = yield* state.placeOf(folder.workspaceRoot, { bindByRemote: false });
              if (place !== null && place.workspace === workspace && place.project === project)
                return folder.workspaceRoot;
            }
            return null;
          }),
        scope: (workspace, project) =>
          Effect.gen(function* () {
            const client = yield* PeerHubClient.PeerHubClient;
            const { hubUrl, session } = yield* client.session;
            const work = (yield* client.api.work(hubUrl, session, workspace)).projects[project];
            const view = yield* client.api
              .taskOwners(hubUrl, session, workspace)
              .pipe(Effect.option);
            const owners = Option.isSome(view) ? view.value.projects[project] : undefined;
            const imported = new Set(
              Object.values(
                (yield* Effect.promise(() => PeerCoreOpenSpec.readRecord(stateDir)))[
                  `${workspace}/${project}`
                ] ?? {},
              ).map((entry) => entry.task),
            );
            return PeerCoreTasks.projectTree({
              areas: work?.areas ?? [],
              tasks: work?.tasks ?? [],
              ...(owners === undefined
                ? {}
                : {
                    owners: Object.fromEntries(
                      Object.entries(owners.tasks).map(([id, row]) => [id, row.owner]),
                    ),
                    areaOwners: owners.map.areas,
                  }),
              imported,
            });
          }).pipe(hubFailure),
        openspec: (target) =>
          PeerCoreOpenSpec.sync(
            { ...target, stateDir },
            (message) => shareAsk.confirm(message, true),
            terminalIo,
          ).pipe(hubFailure),
        openPeer: Effect.gen(function* () {
          const app = [
            "/Applications/Peer.app",
            NodePath.join(NodeOS.homedir(), "Applications", "Peer.app"),
          ].find((path) => NodeFS.existsSync(path));
          const platform = yield* HostProcess.Platform;
          const opener =
            platform === "darwin" ? "open" : platform === "win32" ? undefined : "xdg-open";
          const launch = (target: string) =>
            Effect.sync(() =>
              NodeChildProcess.spawn(opener!, [target], {
                detached: true,
                stdio: "ignore",
              }).unref(),
            );
          if (app !== undefined && opener !== undefined) {
            yield* launch(app);
            yield* Console.log("Opening Peer. It coordinates this computer from now on.");
            return;
          }
          if (opener !== undefined) yield* launch(PEER_DOWNLOAD);
          return yield* fail(
            `peer core: the Peer app is not installed here${opener === undefined ? "" : "; its download page is open"}: ${PEER_DOWNLOAD}`,
          );
        }),
        connectEditor: (id) =>
          PeerCoreEditor.connectEditor(id, stateDir, terminalIo).pipe(hubFailure),
        disconnectEditor: (id) => PeerCoreEditor.disconnectEditor(id, terminalIo).pipe(hubFailure),
      },
      terminalIo,
    );
  });

const registerIn = (stateDir: string) => (path: string, name?: string) =>
  Effect.tryPromise({
    try: () => registerFolder(stateDir, path, name),
    catch: (cause) => fail(`peer core: ${messageOf(cause)}`),
  }).pipe(Effect.map(({ project }) => project.id));

const loginCommand = Command.make("login", {
  ...authLocationFlags,
  email: Argument.String("email").pipe(
    Argument.withDescription(
      "Your work email address (none: the menu, for whoever is signed in already).",
    ),
    Argument.optional,
  ),
  code: codeFlag,
  hub: hubFlag,
}).pipe(
  Command.withDescription(
    "Sign this computer's Peer in to its Peer Hub; on a terminal, then a menu: create or join a workspace, share, invite.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* pauseCore(config, flags, { restart: true });
      const end = yield* Effect.gen(function* () {
        const state = yield* PeerState.PeerState;
        const signedIn = (yield* state.read).persisted.email;
        const email = Option.getOrUndefined(flags.email)?.trim();
        if (email === undefined || (signedIn !== null && signedIn === email)) {
          if (signedIn === null)
            return yield* fail("peer core: nobody is signed in; run peer core login <email>.");
          if (!isTerminal()) {
            yield* Console.log(`Signed in: ${signedIn}`);
            return undefined;
          }
          return yield* runMenu(config.stateDir);
        }
        yield* PeerCoreJoin.login(
          {
            email,
            ...(Option.isSome(flags.code) ? { code: flags.code.value } : {}),
            ...(Option.isSome(flags.hub) ? { hub: flags.hub.value } : {}),
          },
          terminalIo,
        );
        return isTerminal() ? yield* runMenu(config.stateDir) : undefined;
      }).pipe(
        hubFailure,
        Effect.provide(
          McpConnect.layer.pipe(Layer.provideMerge(PeerCoreRuntime.oneShotLayer(config))),
        ),
      );
      if (end !== undefined) yield* afterMenu(end, config, flags);
    }),
  ),
);

/** Whether `command` is an executable in one of `path`'s folders. */
const onPath = (command: string, path: string | undefined) =>
  (path ?? "").split(NodePath.delimiter).some((dir) => {
    try {
      NodeFS.accessSync(NodePath.join(dir, command), NodeFS.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

/**
 * After the menu, with its state written and closed: Peer Core keeps coordinating when an editor
 * is connected and no Peer runs (the hooks only talk to a running Peer), and the editor the
 * person chose starts in the project, in this terminal.
 */
const afterMenu = (
  end: PeerCoreMenu.MenuEnd,
  config: ServerConfig.ServerConfig["Service"],
  flags: CliAuthLocationFlags,
) =>
  Effect.gen(function* () {
    if (
      (end.editorsConnected || end.launch !== undefined) &&
      (yield* ownerOf(config.stateDir)) === null
    ) {
      yield* serveDetached(config, flags);
      yield* Console.log(
        "Peer Core coordinates your agents in the background; peer core stop ends it.",
      );
    }
    const launch = end.launch;
    if (launch === undefined) return;
    yield* Console.log(
      `Starting ${PeerCoreEditor.editorTitle(launch.editor)} in ${launch.folder}…`,
    );
    const code = yield* Effect.callback<number>((resume) => {
      const child = NodeChildProcess.spawn(
        launch.editor,
        launch.prompt === undefined ? [] : [launch.prompt],
        {
          cwd: launch.folder,
          stdio: "inherit",
        },
      );
      child.once("error", () => resume(Effect.succeed(127)));
      child.once("exit", (exit) => resume(Effect.succeed(exit ?? 0)));
    });
    if (code === 127)
      return yield* fail(`peer core: could not start ${launch.editor}; is it installed?`);
  });

const createCommand = Command.make("create", {
  ...authLocationFlags,
  name: Argument.String("name").pipe(Argument.withDescription("The workspace's name.")),
  slug: Flag.String("slug").pipe(
    Flag.withDescription("Its short name in links and commands (default: made of the name)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Create a workspace whose owner you are."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* pauseCore(config, flags, { restart: true });
      yield* PeerCoreMenu.create(
        {
          name: flags.name,
          ...(Option.isSome(flags.slug) ? { slug: flags.slug.value } : {}),
        },
        terminalIo,
      ).pipe(hubFailure, Effect.provide(PeerCoreRuntime.oneShotLayer(config)));
    }),
  ),
);

const inviteCommand = Command.make("invite", {
  ...authLocationFlags,
  email: Argument.String("email").pipe(Argument.withDescription("Whom to invite.")),
  workspace: Flag.String("workspace").pipe(
    Flag.withDescription("The workspace (needed when you may invite to several)."),
    Flag.optional,
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription("A project they will be on, and no other (repeat it for more)."),
    Flag.atLeast(0),
  ),
  admin: Flag.Boolean("admin").pipe(
    Flag.withDescription("Invite them as an admin."),
    Flag.withDefault(false),
  ),
  area: Flag.String("area").pipe(
    Flag.withDescription(
      "With one --project: an area they will own when they join, its new tasks too (repeat it for more).",
    ),
    Flag.atLeast(0),
  ),
  task: Flag.String("task").pipe(
    Flag.withDescription(
      "With one --project: a task they will own when they join (repeat it for more).",
    ),
    Flag.atLeast(0),
  ),
}).pipe(
  Command.withDescription("Mail an invitation to a workspace you own or administer."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* pauseCore(config, flags, { restart: true });
      yield* Effect.gen(function* () {
        const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
        yield* PeerCoreMenu.invite(
          {
            email: flags.email,
            admin: flags.admin,
            projects: flags.project,
            areas: flags.area,
            tasks: flags.task,
            ...(Option.isSome(flags.workspace) ? { workspace: flags.workspace.value } : {}),
          },
          yield* workspaces.sync,
          terminalIo,
        );
      }).pipe(hubFailure, Effect.provide(PeerCoreRuntime.oneShotLayer(config)));
    }),
  ),
);

const joinCommand = Command.make("join", {
  ...authLocationFlags,
  workspace: Argument.String("link-or-workspace").pipe(
    Argument.withDescription(
      "The invitation link (https://…/join/<workspace>?email=…), or the organization's slug as login listed it.",
    ),
  ),
  code: codeFlag,
  hub: hubFlag,
  editor: Flag.String("editor").pipe(
    Flag.withDescription(
      `Connect this editor after joining: ${PeerCoreEditor.EDITORS.join(", ")} (else asked on a terminal).`,
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Accept an invitation (signing its address in when nobody is), or confirm a domain match.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const editor = Option.getOrUndefined(flags.editor);
      const refused = PeerCoreJoin.checkEditor(editor);
      if (refused !== undefined) return yield* refused;
      yield* pauseCore(config, flags, { restart: true });
      const choose = (detected: ReadonlyArray<string>) =>
        Prompt.run(
          Prompt.Select({
            message: "Connect an editor to Peer?",
            choices: PeerCoreJoin.editorChoices(detected),
          }),
        ).pipe(Effect.orElseSucceed(() => null));
      yield* PeerCoreJoin.joinAndConnect(
        {
          target: flags.workspace,
          ...(Option.isSome(flags.code) ? { code: flags.code.value } : {}),
          ...(Option.isSome(flags.hub) ? { hub: flags.hub.value } : {}),
        },
        {
          ...(editor === undefined ? {} : { editor }),
          interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
          choose,
          detected: PeerCoreEditor.detectedEditors,
          stateDir: config.stateDir,
        },
        terminalIo,
      ).pipe(
        Effect.catchTags({
          PeerHubError: (error) => Effect.fail(fail(`peer core: ${error.detail}`)),
        }),
        Effect.provide(
          McpConnect.layer.pipe(Layer.provideMerge(PeerCoreRuntime.oneShotLayer(config))),
        ),
      );
    }),
  ),
);

const bindCommand = Command.make("bind", {
  ...authLocationFlags,
  folder: Argument.String("folder").pipe(
    Argument.withDescription("The clone (default: this folder)."),
    Argument.optional,
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription("The project, as <workspace>/<project>."),
  ),
  repository: Flag.String("repository").pipe(
    Flag.withDescription("The project's repository, when the clone's origin does not say which."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Make a clone on this computer the checkout of a project's repository."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const owner = yield* ownerOf(config.stateDir);
      if (owner?.kind === "app")
        return yield* fail(
          `peer core: the Peer app runs here (pid ${owner.pid}) and keeps the checkouts in memory: choose the folder in the app's project settings.`,
        );
      yield* pauseCore(config, flags, { restart: true });
      yield* PeerCoreBind.bind(
        {
          folder: realpathOrSelf(Option.getOrElse(flags.folder, () => process.cwd())),
          project: flags.project,
          ...(Option.isSome(flags.repository) ? { repository: flags.repository.value } : {}),
        },
        terminalIo,
      ).pipe(Effect.provide(PeerCoreRuntime.stateLayer(config)));
    }),
  ),
);

const taskProjectFlag = Flag.String("project").pipe(
  Flag.withDescription("The project, as <workspace>/<project> (default: this folder's)."),
  Flag.optional,
);

const tasksCommand = Command.make("tasks", {
  ...authLocationFlags,
  project: taskProjectFlag,
  open: Flag.Boolean("open").pipe(
    Flag.withDescription("Only the tasks nobody owns (what you can take)."),
    Flag.withDefault(false),
  ),
  mine: Flag.Boolean("mine").pipe(
    Flag.withDescription("Only the tasks you own."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Your tasks that are not done, as the project's tree, with status, area and owner; an invitation's task first.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      if (flags.open && flags.mine)
        return yield* outcome("usage", "--open and --mine exclude each other", "use one of them.");
      const owner = yield* ownerOf(config.stateDir);
      yield* PeerCoreTasks.listTasks(
        {
          ...(Option.isSome(flags.project) ? { project: flags.project.value } : {}),
          filter: flags.open ? "open" : flags.mine ? "mine" : "all",
          cwd: realpathOrSelf(process.cwd()),
          canWrite: owner === null,
        },
        terminalIo,
      ).pipe(Effect.provide(PeerCoreRuntime.oneShotLayer(config)));
    }),
  ),
);

const takeCommand = Command.make("take", {
  ...authLocationFlags,
  tasks: Argument.String("task").pipe(
    Argument.withDescription("The tasks or groups, as peer core tasks lists them."),
    Argument.variadic({ min: 1 }),
  ),
  project: taskProjectFlag,
  asOne: Flag.Boolean("as-one").pipe(
    Flag.withDescription("Settle an item with items: it runs as one task."),
    Flag.withDefault(false),
  ),
  asParts: Flag.Boolean("as-parts").pipe(
    Flag.withDescription("Settle an item with items: its items are the tasks."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Become the owner of tasks or groups nobody owns."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      if (flags.asOne && flags.asParts)
        return yield* outcome(
          "usage",
          "--as-one and --as-parts exclude each other",
          "use one of them.",
        );
      const owner = yield* ownerOf(config.stateDir);
      yield* PeerCoreTasks.takeTasks(
        {
          tasks: flags.tasks,
          ...(flags.asOne
            ? { settle: "one" as const }
            : flags.asParts
              ? { settle: "parts" as const }
              : {}),
          ...(Option.isSome(flags.project) ? { project: flags.project.value } : {}),
          cwd: realpathOrSelf(process.cwd()),
          canWrite: owner === null,
        },
        terminalIo,
      ).pipe(Effect.provide(PeerCoreRuntime.oneShotLayer(config)));
    }),
  ),
);

const logoutCommand = Command.make("logout", { ...authLocationFlags }).pipe(
  Command.withDescription("Sign this computer's Peer out of its Peer Hub."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* pauseCore(config, flags, { restart: false });
      yield* Effect.gen(function* () {
        const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
        yield* workspaces.signOut;
        yield* Console.log("Signed out.");
      }).pipe(
        Effect.catchTags({
          PeerHubError: (error) => Effect.fail(fail(`peer core: ${error.detail}`)),
        }),
        Effect.provide(PeerCoreRuntime.oneShotLayer(config)),
      );
    }),
  ),
);

const unshareCommand = Command.make("unshare", {
  ...authLocationFlags,
  project: Flag.String("project").pipe(
    Flag.withDescription("The project, as <workspace>/<project> (default: the one you are in)."),
    Flag.optional,
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription("Do it without asking (needed without a terminal)."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Take a project out of its workspace (the way back from share); its clone here stays.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* pauseCore(config, flags, { restart: true });
      yield* Effect.gen(function* () {
        const state = yield* PeerState.PeerState;
        let target: { workspace: string; project: string } | null = null;
        if (Option.isSome(flags.project)) {
          const [workspace, project, ...rest] = flags.project.value.trim().split("/");
          if (workspace === undefined || project === undefined || rest.length > 0 || project === "")
            return yield* outcome(
              "usage",
              "--project takes <workspace>/<project>",
              "name it as peer core status shows it.",
            );
          target = { workspace, project };
        } else {
          const checkout = yield* PeerCoreBind.repositoryRoot(process.cwd());
          const place =
            checkout === null ? null : yield* state.placeOf(checkout.root, { bindByRemote: false });
          if (place !== null && place.workspace !== PEER_LOCAL_WORKSPACE)
            target = { workspace: place.workspace, project: place.project };
        }
        if (target === null)
          return yield* outcome(
            "refused",
            "this folder is no connected project",
            "run it in the project's folder, or name it with --project <workspace>/<project>.",
          );
        const question = `Disconnect ${target.workspace}/${target.project}? It leaves the workspace for everyone, with its tasks; the settings history keeps it.`;
        const agreed = flags.yes || (isTerminal() && (yield* shareAsk.confirm(question, false)));
        if (!agreed)
          return yield* isTerminal()
            ? Console.log("Nothing changed.")
            : outcome("refused", "nothing confirms it without a terminal", "add --yes.");
        yield* unshareProject(config.stateDir, target.workspace, target.project);
      }).pipe(hubFailure, Effect.provide(PeerCoreRuntime.oneShotLayer(config)));
    }),
  ),
);

const openspecCommand = Command.make("openspec", {
  ...authLocationFlags,
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription(
      "Import without asking (without a terminal, nothing is imported without it).",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Import the OpenSpec changes of the connected project you are in as its tasks, or update them.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* pauseCore(config, flags, { restart: true });
      yield* Effect.gen(function* () {
        const state = yield* PeerState.PeerState;
        const checkout = yield* PeerCoreBind.repositoryRoot(process.cwd());
        const place =
          checkout === null ? null : yield* state.placeOf(checkout.root, { bindByRemote: false });
        if (checkout === null || place === null || place.workspace === PEER_LOCAL_WORKSPACE)
          return yield* outcome(
            "refused",
            "this folder is no connected project",
            "connect it with peer core share, then repeat the command.",
          );
        const found = yield* PeerCoreOpenSpec.sync(
          {
            workspace: place.workspace,
            project: place.project,
            root: checkout.root,
            stateDir: config.stateDir,
          },
          (message) =>
            flags.yes
              ? Effect.succeed(true)
              : isTerminal()
                ? shareAsk.confirm(message, true)
                : Console.log(`${message} Add --yes to import.`).pipe(Effect.as(false)),
          terminalIo,
        );
        if (!found) yield* Console.log(`${checkout.root} has no openspec/changes folder.`);
      }).pipe(hubFailure, Effect.provide(PeerCoreRuntime.oneShotLayer(config)));
    }),
  ),
);

const shareCommand = Command.make("share", {
  ...authLocationFlags,
  folder: Argument.String("folder").pipe(
    Argument.withDescription(
      "The project's folder (default: the repository you are in, or this folder).",
    ),
    Argument.optional,
  ),
  workspace: Flag.String("workspace").pipe(
    Flag.withDescription(
      "The workspace to share it with (asked on a terminal when you are in several).",
    ),
    Flag.optional,
  ),
  name: Flag.String("name").pipe(Flag.withDescription("The new project's name."), Flag.optional),
  project: Flag.String("project").pipe(
    Flag.withDescription(
      "Use the folder as this existing project's checkout, as <workspace>/<project>.",
    ),
    Flag.optional,
  ),
  repository: Flag.String("repository").pipe(
    Flag.withDescription(
      "With --project: the project's repository, when the clone's origin does not say which.",
    ),
    Flag.optional,
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription(
      "Do it without asking (needed without a terminal unless the folder is named).",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Share a folder with your Peer workspace, or make a clone of a project's repository its checkout here.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const { folder, named } = yield* PeerCoreShare.shareFolder(
        Option.getOrUndefined(flags.folder),
        process.cwd(),
      );
      const interactive = isTerminal();
      const ask = { ...shareAsk, interactive };
      const owner = yield* ownerOf(config.stateDir);
      if (owner !== null) {
        if (Option.isSome(flags.project))
          return yield* fail(
            `peer core: Peer is running (${describeOwner(owner)}), and it keeps the checkouts in memory: ${
              owner.kind === "peer-core"
                ? "stop Peer Core with peer core stop first"
                : "choose the folder in the app's project settings"
            }.`,
          );
        if (!interactive && !named && !flags.yes)
          return yield* outcome(
            "refused",
            `nothing confirms sharing ${folder} without a terminal to ask on`,
            `name the folder (peer core share ${folder}) or add --yes.`,
          );
        // The broker shares as the running Peer; on a terminal it is asked which workspace first.
        let workspace = Option.getOrUndefined(flags.workspace);
        if (interactive && !flags.yes) {
          const slugs = yield* Effect.gen(function* () {
            const state = yield* PeerState.PeerState;
            return (yield* state.workspaces)
              .map((w) => w.slug)
              .filter((slug) => slug !== PEER_LOCAL_WORKSPACE);
          }).pipe(Effect.provide(PeerCoreRuntime.stateLayer(config)));
          if (workspace === undefined && slugs.length > 1) {
            const chosen = yield* ask.choose(
              "Share it with",
              slugs.map((slug) => ({ title: slug, value: slug })),
            );
            if (chosen === null) return yield* Console.log("Nothing changed.");
            workspace = chosen;
          }
          const target = workspace ?? slugs[0];
          if (
            target !== undefined &&
            !(yield* ask.confirm(
              `Share ${folder} with ${target}? Everyone in ${target} sees it.`,
              true,
            ))
          )
            return yield* Console.log("Nothing changed.");
        }
        return yield* forward(
          config.stateDir,
          "share",
          [
            ...(workspace === undefined ? [] : ["--workspace", workspace]),
            ...(Option.isSome(flags.name) ? ["--name", flags.name.value] : []),
          ],
          folder,
        );
      }
      yield* PeerCoreShare.share(
        {
          folder,
          named,
          yes: flags.yes,
          ...(Option.isSome(flags.workspace) ? { workspace: flags.workspace.value } : {}),
          ...(Option.isSome(flags.name) ? { name: flags.name.value } : {}),
          ...(Option.isSome(flags.project) ? { project: flags.project.value } : {}),
          ...(Option.isSome(flags.repository) ? { repository: flags.repository.value } : {}),
        },
        ask,
        terminalIo,
        registerIn(config.stateDir),
      ).pipe(
        Effect.catchTags({
          PeerHubError: (error) => Effect.fail(fail(`peer core: ${error.detail}`)),
        }),
        Effect.provide(PeerCoreRuntime.oneShotLayer(config)),
      );
    }),
  ),
);

const CLIENT_IDS = MCP_CLIENTS.map((client) => client.id).join(", ");

const editorCommand = (kind: "connect" | "disconnect") =>
  Command.make(kind, {
    ...authLocationFlags,
    client: Argument.String("client").pipe(Argument.withDescription(`One of: ${CLIENT_IDS}.`)),
    scope: Flag.Literals("scope", ["user", "project"]).pipe(
      Flag.withDescription("Everything on this computer, or one project's settings."),
      Flag.optional,
    ),
    project: Flag.String("project").pipe(
      Flag.withDescription("The project folder (project scope; default: this folder)."),
      Flag.optional,
    ),
  }).pipe(
    Command.withDescription(
      kind === "connect"
        ? "Give an editor Peer's tools over MCP."
        : "Remove Peer's MCP entry from an editor's settings.",
    ),
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const config = yield* resolveConfig(flags);
        const client = mcpClient(flags.client);
        if (client === undefined)
          return yield* fail(`peer core: ${flags.client} is not a known client: ${CLIENT_IDS}.`);
        const scope =
          Option.getOrUndefined(flags.scope) ?? (client.project !== undefined ? "project" : "user");
        const folder = realpathOrSelf(Option.getOrElse(flags.project, () => process.cwd()));
        const owner = yield* ownerOf(config.stateDir);
        if (owner !== null)
          return yield* forward(config.stateDir, kind, [client.id, "--scope", scope], folder);
        yield* Effect.gen(function* () {
          if (kind === "disconnect") return yield* disconnect(client.id, scope, folder);
          return yield* PeerCoreEditor.connectClient(
            { client: client.id, scope, folder, stateDir: config.stateDir },
            terminalIo,
          );
        }).pipe(
          Effect.catchTags({
            PeerHubError: (error) => Effect.fail(fail(`peer core: ${error.detail}`)),
          }),
          Effect.provide(
            McpConnect.layer.pipe(Layer.provideMerge(PeerCoreRuntime.oneShotLayer(config))),
          ),
        );
      }),
    ),
  );

/** Takes Peer's MCP entry out of `client`'s settings at `scope`. */
const disconnect = (client: string, scope: "user" | "project", folder: string) =>
  Effect.gen(function* () {
    const clients = yield* McpConnect.McpClients;
    const answer = yield* clients.disconnect({
      client,
      scope,
      ...(scope === "project" ? { project: { root: folder } } : {}),
    });
    const title = PeerCoreEditor.editorTitle(client);
    if (answer.outcome === "manual")
      yield* Console.log(
        `${answer.path} is not plain JSON, so Peer left it alone. Remove this entry by hand:\n${answer.entry}`,
      );
    else if (answer.outcome === "unchanged")
      yield* Console.log(`${title} has no Peer's MCP entry in ${answer.path}.`);
    else yield* Console.log(`Removed Peer's MCP entry from ${answer.path}.`);
  });

const codexFlag = Flag.Boolean("codex").pipe(
  Flag.withDescription("Codex's hooks too, in every configured Codex home."),
  Flag.withDefault(false),
);

/** A running broker keeps peer-hub.json in memory, so hooks change only while none runs. */
const refuseHooksWhileRunning = (stateDir: string) =>
  Effect.gen(function* () {
    const owner = yield* ownerOf(stateDir);
    if (owner === null) return;
    return yield* fail(
      owner.kind === "app"
        ? "Peer is running: install the hooks in Settings → This computer → Coordination & plugins."
        : "Peer Core is running: run peer core stop first.",
    );
  });

const hooksCommand = (kind: "install" | "remove") =>
  Command.make(kind, {
    ...authLocationFlags,
    codex: codexFlag,
    ...(kind === "install"
      ? {
          codexApprove: Flag.String("codex-approve").pipe(
            Flag.withDescription(
              "Trust Peer's Codex hooks in this home, after reading their review (give the review id after it).",
            ),
            Flag.optional,
          ),
          reviewId: Argument.String("review-id").pipe(
            Argument.withDescription("The review id printed for --codex-approve."),
            Argument.optional,
          ),
        }
      : {}),
  }).pipe(
    Command.withDescription(
      kind === "install"
        ? "Add Peer's hooks to Claude Code (and Codex with --codex), as the app's Install does."
        : "Take Peer's hooks out of Claude Code (and Codex with --codex).",
    ),
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const config = yield* resolveConfig(flags);
        yield* refuseHooksWhileRunning(config.stateDir);
        const install = kind === "install";
        const home =
          "codexApprove" in flags ? Option.getOrUndefined(flags.codexApprove) : undefined;
        const reviewId = "reviewId" in flags ? Option.getOrUndefined(flags.reviewId) : undefined;
        if (home !== undefined && reviewId === undefined)
          return yield* fail("peer core: --codex-approve takes a home and a review id.");
        yield* Effect.gen(function* () {
          const adapters = yield* PeerAdapters.PeerAdapters;
          const status = yield* adapters.setCoordination(
            home !== undefined && reviewId !== undefined
              ? { codexHookApproval: { home, reviewId } }
              : { claudeHooks: install, ...(flags.codex ? { codexHooks: install } : {}) },
          );
          yield* PeerCoreEditor.sayHooks(
            status,
            { claude: home === undefined, codex: flags.codex || home !== undefined, install },
            terminalIo,
          );
        }).pipe(
          Effect.catchTags({
            PeerHubError: (error) => Effect.fail(fail(`peer core: ${error.detail}`)),
          }),
          Effect.provide(PeerCoreRuntime.oneShotLayer(config)),
        );
      }),
    ),
  );

const hooksGroup = Command.make("hooks").pipe(
  Command.withDescription("Peer's hooks in Claude Code and Codex, without the app."),
  Command.withSubcommands([hooksCommand("install"), hooksCommand("remove")]),
);

/**
 * `peer <cmd> …` from the npm package's `peer` bin: what the shim does, through the broker's
 * socket (bin.ts rewrites argv to `peer run -- <cmd> …`).
 */
const runCommand = Command.make("run", {
  ...authLocationFlags,
  words: Argument.String("command").pipe(
    Argument.withDescription("A peer command and its arguments (after --)."),
    Argument.variadic({ min: 1 }),
  ),
}).pipe(
  Command.withDescription("Internal: run a peer command through the running Peer."),
  Command.unlisted,
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const [command, ...args] = flags.words;
      if (command === undefined || !/^[A-Za-z0-9_.-]+$/.test(command))
        return yield* fail(`peer: ${command ?? ""} is not a peer command.`);
      if ((yield* ownerOf(config.stateDir)) === null)
        return yield* fail(
          "peer: Peer is not running. Start it with peer core serve, or open the Peer app.",
        );
      return yield* forward(config.stateDir, command, args, process.cwd());
    }),
  ),
);

const makePeerCommand = (name: "peer" | "peer-core" | "core") =>
  Command.make(name).pipe(
    Command.withDescription(
      name === "peer-core"
        ? "The former name of t3 peer, kept for shims written before it."
        : "Peer's coordination without the Peer app (Peer Core; also peer core …).",
    ),
    Command.withSubcommands([
      serveCommand,
      stopCommand,
      statusCommand,
      loginCommand,
      joinCommand,
      createCommand,
      inviteCommand,
      openspecCommand,
      unshareCommand,
      logoutCommand,
      shareCommand,
      bindCommand,
      tasksCommand,
      takeCommand,
      editorCommand("connect"),
      editorCommand("disconnect"),
      hooksGroup,
      runCommand,
    ]),
  );

export const peerCommand = makePeerCommand("peer");
/** Shims from the previous build run `<launch> peer-core serve --detach`. */
export const peerCoreCommand = makePeerCommand("peer-core");
/** The npm package's `peer core …`, under a root of its own so help names `peer core`, not `t3 peer`. */
export const npmCoreCommand = makePeerCommand("core");
