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
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";

import { PEER_LOCAL_WORKSPACE, type PeerHubError, ProjectId } from "@t3tools/contracts";
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
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import * as PeerWorkspaces from "../peerHub/core/workspaces/PeerWorkspaces.ts";
import { readProjects, registerFolder } from "../peerHub/headless/HeadlessProjects.ts";
import * as PeerCoreRuntime from "../peerHub/headless/PeerCoreRuntime.ts";
import { mcpClient, MCP_CLIENTS } from "../peerHub/plugins/mcp/clients.ts";
import * as McpConnect from "../peerHub/plugins/mcp/connect.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";
import * as PeerCoreEditor from "./peerCoreEditor.ts";
import { type OneShotIo } from "./peerCoreIo.ts";
import * as PeerCoreJoin from "./peerCoreJoin.ts";

const SOCKET_WAIT_MS = 20_000;
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
const serveDetached = (config: ServerConfig.ServerConfig["Service"], flags: CliAuthLocationFlags) =>
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
    for (const folder of folders) {
      const place = yield* state.placeOf(folder.workspaceRoot);
      yield* Console.log(
        place === null || place.workspace === PEER_LOCAL_WORKSPACE
          ? `Folder: ${folder.workspaceRoot} (not shared)`
          : `Folder: ${folder.workspaceRoot} (shared: ${place.workspace}/${place.project})`,
      );
    }
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

const refuseWhileRunning = (stateDir: string) =>
  Effect.gen(function* () {
    const owner = yield* ownerOf(stateDir);
    if (owner !== null)
      return yield* fail(
        `Peer is running (${describeOwner(owner)}): sign in in the app${
          owner.kind === "peer-core" ? ", or stop Peer Core with peer core stop first" : ""
        }.`,
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

const loginCommand = Command.make("login", {
  ...authLocationFlags,
  email: Argument.String("email").pipe(Argument.withDescription("Your work email address.")),
  code: codeFlag,
  hub: hubFlag,
}).pipe(
  Command.withDescription("Sign this computer's Peer in to its Peer Hub."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* refuseWhileRunning(config.stateDir);
      yield* PeerCoreJoin.login(
        {
          email: flags.email,
          ...(Option.isSome(flags.code) ? { code: flags.code.value } : {}),
          ...(Option.isSome(flags.hub) ? { hub: flags.hub.value } : {}),
        },
        terminalIo,
      ).pipe(
        Effect.catchTags({
          PeerHubError: (error) => Effect.fail(fail(`peer core: ${error.detail}`)),
        }),
        Effect.provide(PeerCoreRuntime.oneShotLayer(config)),
      );
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
      yield* refuseWhileRunning(config.stateDir);
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

const logoutCommand = Command.make("logout", { ...authLocationFlags }).pipe(
  Command.withDescription("Sign this computer's Peer out of its Peer Hub."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      yield* refuseWhileRunning(config.stateDir);
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

const shareCommand = Command.make("share", {
  ...authLocationFlags,
  folder: Argument.String("folder").pipe(Argument.withDescription("The project's folder.")),
  workspace: Flag.String("workspace").pipe(
    Flag.withDescription("The workspace to share it with (needed when you are in several)."),
    Flag.optional,
  ),
  name: Flag.String("name").pipe(Flag.withDescription("The project's name."), Flag.optional),
}).pipe(
  Command.withDescription("Share a folder on this computer with your Peer workspace."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(flags);
      const folder = realpathOrSelf(flags.folder);
      const owner = yield* ownerOf(config.stateDir);
      if (owner !== null)
        return yield* forward(
          config.stateDir,
          "share",
          [
            ...(Option.isSome(flags.workspace) ? ["--workspace", flags.workspace.value] : []),
            ...(Option.isSome(flags.name) ? ["--name", flags.name.value] : []),
          ],
          folder,
        );
      yield* Effect.gen(function* () {
        const state = yield* PeerState.PeerState;
        const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
        const place = yield* state.placeOf(folder);
        if (place !== null && place.workspace !== PEER_LOCAL_WORKSPACE) {
          yield* Console.log(
            `Shared already: ${folder} is project ${place.project} of ${place.workspace}.`,
          );
          return;
        }
        const slugs = (yield* state.workspaces)
          .map((workspace) => workspace.slug)
          .filter((slug) => slug !== PEER_LOCAL_WORKSPACE);
        if (slugs.length === 0)
          return yield* fail("peer core: you are in no workspace; run peer core login first.");
        const asked = Option.getOrUndefined(flags.workspace);
        if (asked !== undefined && !slugs.includes(asked))
          return yield* fail(`peer core: you are in no workspace ${asked}: ${slugs.join(", ")}.`);
        if (asked === undefined && slugs.length > 1)
          return yield* fail(
            `peer core: you are in ${slugs.length} workspaces (${slugs.join(", ")}); choose one with --workspace.`,
          );
        const workspace = asked ?? slugs[0]!;
        const { project } = yield* Effect.tryPromise({
          try: () => registerFolder(config.stateDir, folder, Option.getOrUndefined(flags.name)),
          catch: (cause) => fail(`peer core: ${messageOf(cause)}`),
        });
        const name = Option.getOrUndefined(flags.name)?.trim();
        yield* workspaces.shareProject({
          workspace,
          projectId: ProjectId.make(project.id),
          ...(name === undefined || name === "" ? {} : { name }),
        });
        const shared = yield* state.placeOf(folder);
        yield* Console.log(
          shared === null
            ? `Shared ${folder} with ${workspace}.`
            : `Shared ${folder} with ${workspace} as project ${shared.project}.`,
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

const makePeerCommand = (name: "peer" | "peer-core") =>
  Command.make(name).pipe(
    Command.withDescription(
      name === "peer"
        ? "Peer's coordination without the Peer app (Peer Core; also peer core …)."
        : "The former name of t3 peer, kept for shims written before it.",
    ),
    Command.withSubcommands([
      serveCommand,
      stopCommand,
      statusCommand,
      loginCommand,
      joinCommand,
      logoutCommand,
      shareCommand,
      editorCommand("connect"),
      editorCommand("disconnect"),
      hooksGroup,
      runCommand,
    ]),
  );

export const peerCommand = makePeerCommand("peer");
/** Shims from the previous build run `<launch> peer-core serve --detach`. */
export const peerCoreCommand = makePeerCommand("peer-core");
