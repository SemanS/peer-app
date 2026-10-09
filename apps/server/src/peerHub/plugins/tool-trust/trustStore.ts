// @effect-diagnostics nodeBuiltinImport:off - one atomic, private local trust file.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  PeerToolSecretName,
  PeerToolTrustError,
  type PeerManifest,
  type PeerToolTrustApproveInput,
  type PeerToolTrustSetSecretInput,
  type PeerToolTrustStatus,
  type PeerToolTrustTurnOffInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import type { WorkspaceToolGate } from "../../hubPolicy.ts";
import {
  checkedDefinition,
  changes,
  validSecretName,
  validSecretValue,
  type CheckedDefinition,
} from "./definition.ts";

const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/));
const Pair = Schema.Tuple([Schema.String, Schema.String]);
const Canonical = Schema.Union([
  Schema.Tuple([
    Schema.Literal("stdio"),
    Schema.String,
    Schema.Array(Schema.String),
    Schema.Array(Pair),
  ]),
  Schema.Tuple([Schema.Literals(["http", "sse"]), Schema.String, Schema.Array(Pair)]),
]);
const Record = Schema.Union([
  Schema.Struct({ off: Schema.Struct({ at: Schema.String }) }),
  Schema.Struct({
    on: Schema.Struct({
      fingerprints: Schema.Array(Schema.String),
      approved: Canonical,
      at: Schema.String,
    }),
  }),
]);
const Workspace = Schema.Struct({
  tools: Schema.Record(Id, Record),
  secrets: Schema.Record(PeerToolSecretName, Schema.Literals(["stored", "environment"])),
});
const Document = Schema.Struct({
  version: Schema.Literal(1),
  workspaces: Schema.Record(Id, Workspace),
});
const DocumentJson = Schema.fromJsonString(Document);
const decodeDocument = Schema.decodeUnknownOption(DocumentJson);
const encodeDocument = Schema.encodeEffect(DocumentJson);
type Document = typeof Document.Type;
type Workspace = typeof Workspace.Type;
type ServedWorkspace = {
  readonly slug: string;
  readonly manifest?: Pick<PeerManifest, "workspace" | "projects"> | null;
};
type Options = {
  readonly stateDir: string;
  readonly secrets: Pick<ServerSecretStore.ServerSecretStore["Service"], "get" | "set" | "remove">;
  readonly workspaces: () => ReadonlyArray<ServedWorkspace>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
};
const empty = (): Document => ({ version: 1, workspaces: {} });
const emptyWorkspace = (): Workspace => ({ tools: {}, secrets: {} });
const own = <A>(record: Readonly<Record<string, A>>, key: string): A | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
const secretKey = (workspace: string, name: string) => `peer-tool-secret--${workspace}--${name}`;
const error = (detail: string) => new PeerToolTrustError({ detail });

/** All mutations use one semaphore. The provider gate reads memory only. */
export const makeTrustStore = (options: Options) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const path = NodePath.join(options.stateDir, "peer-tool-trust.json");
    const environment = options.environment ?? process.env;
    let document = empty();
    let failure: string | undefined;
    const cache = new Map<string, string>();
    const blockedSecrets = new Set<string>();
    const forgetting = new Set<string>();
    const quarantineTime = yield* Clock.currentTimeMillis;
    const read = yield* Effect.result(Effect.tryPromise(() => NodeFSP.readFile(path, "utf8")));
    if (read._tag === "Success") {
      const decoded = decodeDocument(read.success);
      if (Option.isSome(decoded)) document = decoded.value;
      else {
        failure = "Could not read tool approvals; review the tools again.";
        yield* Effect.tryPromise(() =>
          NodeFSP.rename(path, `${path}.unreadable-${quarantineTime}`),
        ).pipe(Effect.ignore);
      }
    } else if (
      !(
        typeof read.failure === "object" &&
        read.failure !== null &&
        "cause" in read.failure &&
        typeof read.failure.cause === "object" &&
        read.failure.cause !== null &&
        "code" in read.failure.cause &&
        read.failure.cause.code === "ENOENT"
      )
    ) {
      failure = "Could not read tool approvals; review the tools again.";
      yield* Effect.tryPromise(() =>
        NodeFSP.rename(path, `${path}.unreadable-${quarantineTime}`),
      ).pipe(Effect.ignore);
    }
    for (const [slug, workspace] of Object.entries(document.workspaces))
      for (const [name, source] of Object.entries(workspace.secrets))
        if (source === "stored") {
          const value = yield* options.secrets
            .get(secretKey(slug, name))
            .pipe(Effect.orElseSucceed(() => Option.none()));
          if (Option.isSome(value)) {
            const text = new TextDecoder().decode(value.value);
            if (validSecretValue(text)) cache.set(secretKey(slug, name), text);
          }
        }
    const persist = (next: Document) =>
      Effect.gen(function* () {
        const encoded = yield* encodeDocument(next).pipe(
          Effect.mapError(() => error("Could not encode tool approvals.")),
        );
        yield* Effect.tryPromise(async () => {
          await NodeFSP.mkdir(options.stateDir, { recursive: true });
          const temp = `${path}.${process.pid}.tmp`;
          try {
            await NodeFSP.writeFile(temp, `${encoded}\n`, { mode: 0o600 });
            await NodeFSP.chmod(temp, 0o600);
            await NodeFSP.rename(temp, path);
          } finally {
            await NodeFSP.rm(temp, { force: true }).catch(() => {});
          }
        }).pipe(Effect.mapError(() => error("Could not save tool approvals.")));
        document = next;
      });
    const secret = (slug: string, name: string): string | undefined => {
      if (blockedSecrets.has(secretKey(slug, name)) || forgetting.has(slug)) return undefined;
      const source = own(document.workspaces, slug)?.secrets[name];
      const value =
        source === "stored"
          ? cache.get(secretKey(slug, name))
          : source === "environment"
            ? environment[name]
            : undefined;
      return validSecretValue(value) ? value : undefined;
    };
    const inspect = (slug: string, tool: Parameters<WorkspaceToolGate>[0]["tool"]) => {
      const definition = checkedDefinition(tool);
      const record = forgetting.has(slug)
        ? undefined
        : own(own(document.workspaces, slug)?.tools ?? {}, tool.id);
      if (record !== undefined && "off" in record) return { definition, state: "off" as const };
      if (definition.reason !== undefined)
        return { definition, state: "invalid" as const, reason: definition.reason };
      if (record === undefined) return { definition, state: "review" as const };
      if (!record.on.fingerprints.includes(definition.fingerprint))
        return {
          definition,
          state: "changed" as const,
          changes: changes(record.on.approved, definition.canonical),
        };
      const missing = definition.names.filter((name) => secret(slug, name) === undefined);
      return missing.length === 0
        ? { definition, state: "on" as const }
        : { definition, state: "secret" as const, missing };
    };
    const status = (): PeerToolTrustStatus => ({
      ...(failure === undefined ? {} : { error: failure }),
      workspaces: options
        .workspaces()
        .filter((w) => PeerState.safeId(w.slug))
        .map((workspace) => {
          const tools = new Map<
            string,
            PeerToolTrustStatus["workspaces"][number]["tools"][number]
          >();
          const names = new Set(
            Object.keys(own(document.workspaces, workspace.slug)?.secrets ?? {}),
          );
          for (const project of workspace.manifest?.projects ?? [])
            for (const tool of project.tools) {
              const checked = inspect(workspace.slug, tool);
              checked.definition.names.forEach((name) => names.add(name));
              if (checked.state === "on") continue;
              const key = `${tool.id}/${checked.definition.fingerprint}`;
              const previous = tools.get(key);
              tools.set(key, {
                tool: tool.id,
                fingerprint: checked.definition.fingerprint,
                state: checked.state,
                projects: [...new Set([...(previous?.projects ?? []), project.id])],
                ...("reason" in checked ? { reason: checked.reason } : {}),
                ...("changes" in checked ? { changes: checked.changes } : {}),
                ...("missing" in checked ? { missing: checked.missing } : {}),
              });
            }
          const metadata = workspace.manifest?.workspace;
          return {
            workspace: workspace.slug,
            ...(metadata?.appliedBy === undefined ? {} : { appliedBy: metadata.appliedBy }),
            ...(metadata?.appliedAt === undefined ? {} : { appliedAt: metadata.appliedAt }),
            tools: [...tools.values()],
            secrets: [...names].sort().map((name) => ({
              name,
              source: own(document.workspaces, workspace.slug)?.secrets[name] ?? "missing",
              environmentSet: Object.hasOwn(environment, name),
            })),
          };
        }),
    });
    const decide: WorkspaceToolGate = (input) => {
      if (!PeerState.safeId(input.workspace)) return { give: false };
      const project = options
        .workspaces()
        .find((w) => w.slug === input.workspace)
        ?.manifest?.projects.find((p) => p.id === input.project);
      const checked = inspect(input.workspace, input.tool);
      // Provider policy may still carry an old snapshot while an async status rebuild is pending.
      if (
        !project?.tools.some(
          (t) =>
            t.id === input.tool.id &&
            checkedDefinition(t).fingerprint === checked.definition.fingerprint,
        )
      )
        return { give: false };
      if (checked.state !== "on" || forgetting.has(input.workspace)) return { give: false };
      const secrets = new Map<string, string>();
      for (const name of checked.definition.names) {
        const value = secret(input.workspace, name);
        if (value === undefined) return { give: false };
        secrets.set(name, value);
      }
      return { give: true, secrets };
    };
    const served = (slug: string, toolId: string): ReadonlyArray<CheckedDefinition> =>
      options
        .workspaces()
        .find((w) => w.slug === slug)
        ?.manifest?.projects.flatMap((p) =>
          p.tools.filter((t) => t.id === toolId).map(checkedDefinition),
        ) ?? [];
    const serialized = <A, E>(effect: Effect.Effect<A, E>) =>
      lock.withPermits(1)(Effect.uninterruptible(effect));
    const approve = (input: PeerToolTrustApproveInput) =>
      serialized(
        Effect.gen(function* () {
          const checked = input.items.map((item) => ({
            item,
            definitions: served(item.workspace, item.tool),
          }));
          const stale = checked.filter(
            ({ item, definitions }) =>
              forgetting.has(item.workspace) ||
              !definitions.some(
                (d) => d.fingerprint === item.fingerprint && d.reason === undefined,
              ),
          );
          if (stale.length > 0)
            return yield* error(
              `${stale.map(({ item }) => `${item.workspace}/${item.tool}`).join(", ")}: changed or invalid; review it again.`,
            );
          const workspaces = { ...document.workspaces };
          let dirty = false;
          // Prune every approval of the workspaces being reviewed against the currently served variants.
          for (const slug of new Set(input.items.map((item) => item.workspace))) {
            const workspace = own(workspaces, slug) ?? emptyWorkspace();
            const tools = { ...workspace.tools };
            for (const [id, record] of Object.entries(tools))
              if ("on" in record) {
                const active = new Set(served(slug, id).map((d) => d.fingerprint));
                const fingerprints = record.on.fingerprints.filter((fp) => active.has(fp));
                if (fingerprints.length !== record.on.fingerprints.length) {
                  tools[id] = { on: { ...record.on, fingerprints } };
                  dirty = true;
                }
              }
            workspaces[slug] = { ...workspace, tools };
          }
          for (const { item, definitions } of checked) {
            const workspace = own(workspaces, item.workspace) ?? emptyWorkspace();
            const previous = own(workspace.tools, item.tool);
            const fingerprints = [
              ...new Set([
                ...(previous !== undefined && "on" in previous ? previous.on.fingerprints : []),
                item.fingerprint,
              ]),
            ].sort();
            if (
              previous !== undefined &&
              "on" in previous &&
              previous.on.fingerprints.length === fingerprints.length &&
              previous.on.fingerprints.every((fp, i) => fp === fingerprints[i])
            )
              continue;
            const approved = definitions.find((d) => d.fingerprint === item.fingerprint)!;
            workspaces[item.workspace] = {
              ...workspace,
              tools: {
                ...workspace.tools,
                [item.tool]: {
                  on: {
                    fingerprints,
                    approved: approved.canonical,
                    at: DateTime.formatIso(yield* DateTime.now),
                  },
                },
              },
            };
            dirty = true;
          }
          if (dirty) yield* persist({ version: 1, workspaces });
          return status();
        }),
      );
    const turnOff = (input: PeerToolTrustTurnOffInput) =>
      serialized(
        Effect.gen(function* () {
          if (
            input.items.some(
              (item) =>
                !PeerState.safeId(item.workspace) ||
                !PeerState.safeId(item.tool) ||
                !options.workspaces().some((w) => w.slug === item.workspace),
            )
          )
            return yield* error("Workspace or tool is not available.");
          const workspaces = { ...document.workspaces };
          let dirty = false;
          for (const item of input.items) {
            const workspace = own(workspaces, item.workspace) ?? emptyWorkspace();
            const record = own(workspace.tools, item.tool);
            if (record !== undefined && "off" in record) continue;
            workspaces[item.workspace] = {
              ...workspace,
              tools: {
                ...workspace.tools,
                [item.tool]: { off: { at: DateTime.formatIso(yield* DateTime.now) } },
              },
            };
            dirty = true;
          }
          if (dirty) yield* persist({ version: 1, workspaces });
          return status();
        }),
      );
    const setSecret = (input: PeerToolTrustSetSecretInput) =>
      serialized(
        Effect.gen(function* () {
          if (
            !PeerState.safeId(input.workspace) ||
            !validSecretName(input.name) ||
            forgetting.has(input.workspace) ||
            !options.workspaces().some((w) => w.slug === input.workspace)
          )
            return yield* error("Workspace or secret name is not available.");
          if (input.source.kind === "value" && !validSecretValue(input.source.value))
            return yield* error("Secret must be 1–8192 characters without CR, LF or NUL.");
          const key = secretKey(input.workspace, input.name);
          const workspace = own(document.workspaces, input.workspace) ?? emptyWorkspace();
          const secrets = { ...workspace.secrets };
          blockedSecrets.add(key);
          cache.delete(key);
          if (input.source.kind === "value") {
            yield* options.secrets
              .set(key, new TextEncoder().encode(input.source.value))
              .pipe(Effect.mapError(() => error("Could not store the secret.")));
            secrets[input.name] = "stored";
            yield* persist({
              ...document,
              workspaces: { ...document.workspaces, [input.workspace]: { ...workspace, secrets } },
            });
            cache.set(key, input.source.value);
          } else {
            yield* options.secrets
              .remove(key)
              .pipe(Effect.mapError(() => error("Could not forget the secret.")));
            if (input.source.kind === "environment") secrets[input.name] = "environment";
            else delete secrets[input.name];
            yield* persist({
              ...document,
              workspaces: { ...document.workspaces, [input.workspace]: { ...workspace, secrets } },
            });
          }
          blockedSecrets.delete(key);
          return status();
        }),
      );
    const forgetAbsent = (keep = options.workspaces().map((w) => w.slug)) =>
      serialized(
        Effect.gen(function* () {
          const workspaces = { ...document.workspaces };
          let dirty = false;
          for (const [slug, workspace] of Object.entries(document.workspaces))
            if (!keep.includes(slug) || forgetting.has(slug)) {
              forgetting.add(slug);
              for (const name of Object.keys(workspace.secrets)) {
                const key = secretKey(slug, name);
                cache.delete(key);
                yield* options.secrets
                  .remove(key)
                  .pipe(
                    Effect.mapError(() =>
                      error("Could not forget a departed workspace's secrets."),
                    ),
                  );
              }
              delete workspaces[slug];
              dirty = true;
            }
          if (dirty) yield* persist({ version: 1, workspaces });
          for (const slug of forgetting)
            if (!Object.hasOwn(document.workspaces, slug)) forgetting.delete(slug);
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              failure = "Could not forget a departed workspace's tools. Try syncing again.";
            }),
          ),
        ),
      );
    yield* forgetAbsent().pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          failure = "Could not forget a departed workspace's tools. Try syncing again.";
        }),
      ),
    );
    return { status, decide, approve, turnOff, setSecret, forgetAbsent };
  });
export class ToolTrustStore extends Context.Service<
  ToolTrustStore,
  Effect.Success<ReturnType<typeof makeTrustStore>>
>()("t3/peerHub/plugins/tool-trust/trustStore/ToolTrustStore") {}
export const layer = Layer.effect(
  ToolTrustStore,
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const config = yield* ServerConfig.ServerConfig;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    return yield* makeTrustStore({
      stateDir: config.stateDir,
      secrets,
      workspaces: () => state.current().persisted.workspaces,
    });
  }),
);
