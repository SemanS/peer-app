import type { PeerContextRead, PeerStaleReads } from "@t3tools/contracts";
import type { HubContextText, HubContextVersionText } from "../hub/coordApi.ts";

interface InputManifest {
  readonly status: "complete" | "revalidation-required" | "unavailable";
  readonly pendingScopes: readonly string[];
  readonly requiredScopes: readonly string[];
  readonly baselineIncomplete?: boolean | undefined;
  readonly reason?: string | undefined;
  readonly coverage?: "reconstructed" | "new-work" | "transferred" | "unavailable" | undefined;
  readonly at?: string | undefined;
}
interface InputState {
  readonly reads?: readonly PeerContextRead[] | undefined;
  readonly manifests?: Readonly<Record<string, InputManifest>> | undefined;
  readonly contexts: Readonly<Record<string, HubContextText>>;
  readonly versions: Readonly<Record<string, readonly HubContextVersionText[]>>;
}
const keyOf = (project: string, scope: string) => JSON.stringify([project, scope]);

function hasVersion(state: InputState, project: string, scope: string, version: number) {
  return (
    Number.isSafeInteger(version) &&
    version > 0 &&
    (state.contexts[keyOf(project, scope)]?.version === version ||
      state.versions[keyOf(project, scope)]?.some((entry) => entry.version === version) === true)
  );
}

export function recordInputRead<S extends InputState>(
  state: S,
  project: string,
  scope: string,
  session: string,
  version: number,
  environment: string,
  at: string,
) {
  if (
    !hasVersion(state, project, scope, version) ||
    (state.contexts[keyOf(project, scope)]?.version ?? 0) !== version
  )
    throw new Error(
      "This context version is no longer current. Read the current context to revalidate it.",
    );
  const read = { project, scope, session, environment, version, at };
  const key = keyOf(project, session);
  const manifest = state.manifests?.[key];
  const pendingScopes = manifest?.pendingScopes.filter((pending) => pending !== scope) ?? [];
  const next: S = {
    ...state,
    reads: [
      ...(state.reads ?? []).filter(
        (entry) =>
          !(entry.project === project && entry.scope === scope && entry.session === session),
      ),
      read,
    ],
    ...(manifest === undefined
      ? {}
      : {
          manifests: {
            ...state.manifests,
            [key]: {
              ...manifest,
              pendingScopes,
              requiredScopes: [...new Set([...manifest.requiredScopes, scope])],
              status:
                manifest.coverage !== "transferred"
                  ? manifest.status
                  : manifest.status === "unavailable"
                    ? "unavailable"
                    : pendingScopes.length === 0 && manifest.baselineIncomplete !== true
                      ? "complete"
                      : "revalidation-required",
            },
          },
        }),
  };
  return { state: next, read };
}

/** Reconstruction is explicit; transferred references retain any missing baseline evidence. */
export function recoverInputManifest<S extends InputState>(
  state: S,
  project: string,
  session: string,
  reason: string,
  reads: readonly { readonly scope: string; readonly version: number }[],
  coverage: "reconstructed" | "new-work" | "transferred" | "unavailable",
  environment: string,
  at: string,
): S {
  if (reason.trim() === "") throw new Error("Explain how the input manifest was reconstructed.");
  if (coverage === "new-work" && reads.length > 0)
    throw new Error("New work starts with an empty input manifest.");
  if (new Set(reads.map((read) => read.scope)).size !== reads.length)
    throw new Error("Declare each context input once.");
  for (const read of reads)
    if (
      !Number.isSafeInteger(read.version) ||
      read.version < 1 ||
      (coverage !== "unavailable" && !hasVersion(state, project, read.scope, read.version))
    )
      throw new Error(
        `Context ${read.scope} version ${read.version} is unavailable; read a retained revision first.`,
      );
  const previousManifest = state.manifests?.[keyOf(project, session)];
  const previousRecovery = checkInputReads(state, project, session).recovery;
  const automatic = coverage === "transferred" || coverage === "unavailable";
  const targetReads = new Map(
    (state.reads ?? [])
      .filter((read) => read.project === project && read.session === session)
      .map((read) => [read.scope, read]),
  );
  if (automatic) {
    const merged = new Map(reads.map((read) => [read.scope, read]));
    for (const read of state.reads ?? [])
      if (read.project === project && read.session === session)
        merged.set(read.scope, { scope: read.scope, version: read.version });
    reads = [...merged.values()];
  }
  const baselineIncomplete =
    coverage === "transferred" &&
    (previousManifest?.baselineIncomplete === true ||
      previousRecovery === "unavailable" ||
      (previousManifest?.status === "revalidation-required" &&
        previousManifest.coverage !== "transferred"));
  const next: S = {
    ...state,
    reads: [
      ...(state.reads ?? []).filter(
        (read) => !(read.project === project && read.session === session),
      ),
      ...reads.map((read) =>
        automatic && targetReads.has(read.scope)
          ? targetReads.get(read.scope)!
          : { ...read, project, session, environment, at },
      ),
    ],
    manifests: {
      ...state.manifests,
      [keyOf(project, session)]: {
        status:
          coverage === "unavailable" ||
          (coverage === "transferred" && previousRecovery === "unavailable")
            ? "unavailable"
            : coverage === "transferred" && (reads.length > 0 || baselineIncomplete)
              ? "revalidation-required"
              : "complete",
        pendingScopes: coverage === "transferred" ? reads.map((read) => read.scope) : [],
        requiredScopes: [
          ...new Set([
            ...(automatic ? (previousManifest?.requiredScopes ?? []) : []),
            ...reads.map((read) => read.scope),
          ]),
        ],
        baselineIncomplete,
        reason: reason.trim(),
        coverage,
        at,
      },
    },
  };
  return next;
}

export function checkInputReads(
  state: InputState,
  project: string,
  session: string,
): PeerStaleReads {
  const reads = (state.reads ?? []).filter(
    (read) => read.project === project && read.session === session,
  );
  const stale = reads.flatMap((read) => {
    const current = state.contexts[keyOf(project, read.scope)];
    return (current?.version ?? 0) === read.version &&
      hasVersion(state, project, read.scope, read.version)
      ? []
      : [
          {
            project,
            scope: read.scope,
            readVersion: read.version,
            currentVersion: current?.version ?? null,
            at: read.at,
            updatedAt: current?.updatedAt ?? null,
          },
        ];
  });
  const expected = state.manifests?.[keyOf(project, session)]?.requiredScopes ?? [];
  const missing = expected.some((scope) => !reads.some((read) => read.scope === scope));
  const recovery =
    missing || reads.some((read) => !hasVersion(state, project, read.scope, read.version))
      ? "unavailable"
      : (state.manifests?.[keyOf(project, session)]?.status ?? "revalidation-required");
  return { fresh: recovery === "complete" && stale.length === 0, reads, stale, recovery };
}
