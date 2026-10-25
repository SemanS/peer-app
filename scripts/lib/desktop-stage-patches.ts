import * as Schema from "effect/Schema";

const DependencyReferences = Schema.Record(Schema.String, Schema.String);
const ImporterDependencies = Schema.Record(
  Schema.String,
  Schema.Struct({ version: Schema.String }),
);

export const DesktopStageLockfile = Schema.Struct({
  lockfileVersion: Schema.Literal("9.0"),
  importers: Schema.Record(
    Schema.String,
    Schema.Struct({
      dependencies: Schema.optional(ImporterDependencies),
      optionalDependencies: Schema.optional(ImporterDependencies),
    }),
  ),
  snapshots: Schema.Record(
    Schema.String,
    Schema.Struct({
      dependencies: Schema.optional(DependencyReferences),
      optionalDependencies: Schema.optional(DependencyReferences),
    }),
  ),
});
export type DesktopStageLockfile = typeof DesktopStageLockfile.Type;

const decodeLockfile = Schema.decodeUnknownSync(DesktopStageLockfile);
const exactVersion = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/;

function packageIdentity(snapshotId: string): string {
  const identity = snapshotId.split("(", 1)[0] ?? "";
  const versionSeparator = identity.lastIndexOf("@");
  if (versionSeparator <= 0 || !exactVersion.test(identity.slice(versionSeparator + 1))) {
    throw new Error(`Invalid exact package identity in desktop stage lock: ${snapshotId}`);
  }
  return identity;
}

export function createStagePatchedDependencies(
  patches: Readonly<Record<string, string>>,
  dependencies: Readonly<Record<string, string>>,
  lockfile: unknown,
  importerPaths: ReadonlyArray<string> = ["apps/server", "apps/desktop"],
): Record<string, string> {
  const graph = decodeLockfile(lockfile);
  const importers = importerPaths.map((path) => {
    const importer = graph.importers[path];
    if (!importer) throw new Error(`Missing desktop stage lock importer: ${path}`);
    return importer;
  });
  const queue: string[] = [];
  const snapshotId = (name: string, reference: string) => {
    const id = Object.hasOwn(graph.snapshots, reference) ? reference : `${name}@${reference}`;
    if (!Object.hasOwn(graph.snapshots, id)) {
      throw new Error(`Missing desktop stage lock snapshot: ${id}`);
    }
    return id;
  };

  for (const [name, spec] of Object.entries(dependencies)) {
    let reference: string | undefined;
    // Stage dependency maps merge server first, then desktop; use the same precedence.
    for (const importer of importers) {
      reference =
        importer.dependencies?.[name]?.version ??
        importer.optionalDependencies?.[name]?.version ??
        reference;
    }
    if (reference !== undefined) {
      const id = snapshotId(name, reference);
      if (exactVersion.test(spec) && packageIdentity(id) !== `${name}@${spec}`) {
        throw new Error(`Desktop stage root ${name}@${spec} disagrees with locked ${id}`);
      }
      queue.push(id);
    } else {
      // Target-specific fff binaries are synthesized by the packager, not importer roots.
      const identity = `${name}@${spec}`;
      const matches = exactVersion.test(spec)
        ? Object.keys(graph.snapshots).filter(
            (id) => id === identity || id.startsWith(`${identity}(`),
          )
        : [];
      if (matches.length !== 1) {
        throw new Error(`Missing or ambiguous desktop stage root: ${name}@${spec}`);
      }
      queue.push(matches[0]!);
    }
  }

  const visited = new Set<string>();
  const reachable = new Set<string>();
  for (const id of queue) {
    if (visited.has(id)) continue;
    visited.add(id);
    reachable.add(packageIdentity(id));
    const snapshot = graph.snapshots[id]!;
    for (const [name, reference] of Object.entries({
      ...snapshot.dependencies,
      ...snapshot.optionalDependencies,
    })) {
      queue.push(snapshotId(name, reference));
    }
  }

  return Object.fromEntries(
    Object.entries(patches).filter(([key]) => reachable.has(packageIdentity(key))),
  );
}
