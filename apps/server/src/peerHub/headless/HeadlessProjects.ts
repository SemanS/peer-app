// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off - Peer Core's list of folders, a JSON file beside peer-hub.json.
/**
 * T3's projects without T3: Peer Core (`t3 peer-core`) knows the folders a person registered with
 * `t3 peer-core share`, kept in `<stateDir>/peer-core-projects.json`. Core reads projects by id, by
 * folder and as a list; the rest of T3's project service refuses clearly, since there is no T3
 * database here.
 *
 * @module peerHub/headless/HeadlessProjects
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  type OrchestrationProjectShell,
  type Project,
  ProjectId,
  type ProjectSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../../config.ts";
import * as ProjectService from "../../project/ProjectService.ts";

/** One folder Peer Core treats as a project. */
export interface HeadlessProject {
  readonly id: string;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly createdAt: string;
}

/** Where Peer Core keeps its folders. */
export const projectsFile = (stateDir: string) =>
  NodePath.join(stateDir, "peer-core-projects.json");

const realpathOrSelf = (path: string) => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    return NodePath.resolve(path);
  }
};

const isRecord = (value: unknown): value is HeadlessProject => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.workspaceRoot === "string" &&
    typeof record.createdAt === "string"
  );
};

/** The registered folders; none when the file is missing or unreadable. */
export async function readProjects(stateDir: string): Promise<ReadonlyArray<HeadlessProject>> {
  try {
    const value: unknown = JSON.parse(await NodeFSP.readFile(projectsFile(stateDir), "utf8"));
    return Array.isArray(value) ? value.filter(isRecord) : [];
  } catch {
    return [];
  }
}

async function writeProjects(stateDir: string, projects: ReadonlyArray<HeadlessProject>) {
  const file = projectsFile(stateDir);
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, { mode: 0o600 });
  await NodeFSP.rename(temporary, file);
}

/** A project id from the folder's name and a short hash of its real path. */
const idOf = (root: string) => {
  const slug =
    NodePath.basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "folder";
  const hash = NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
};

/**
 * Registers `folder` (its real path) as a project, or returns the one already registered there.
 * `created` says whether it is new.
 */
export async function registerFolder(
  stateDir: string,
  folder: string,
  name?: string,
): Promise<{ readonly project: HeadlessProject; readonly created: boolean }> {
  const root = realpathOrSelf(folder);
  const stat = await NodeFSP.stat(root);
  if (!stat.isDirectory()) throw new Error(`${root} is not a folder.`);
  const projects = await readProjects(stateDir);
  const known = projects.find((project) => project.workspaceRoot === root);
  if (known !== undefined) return { project: known, created: false };
  const project: HeadlessProject = {
    id: idOf(root),
    name: name?.trim() || NodePath.basename(root) || root,
    workspaceRoot: root,
    createdAt: new Date().toISOString(),
  };
  await writeProjects(stateDir, [...projects, project]);
  return { project, created: true };
}

const toShell = (project: HeadlessProject): OrchestrationProjectShell =>
  ({
    id: ProjectId.make(project.id),
    title: project.name,
    workspaceRoot: project.workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: project.createdAt,
    updatedAt: project.createdAt,
  }) as OrchestrationProjectShell;

const toProject = (project: HeadlessProject): Project =>
  ({ ...toShell(project), deletedAt: null }) as Project;

const unsupported = (operation: "dispatch-project-command") =>
  new ProjectService.ProjectOperationError({
    operation,
    cause: new Error("Peer Core has no T3 projects to change; use the Peer app."),
  });

const readFailure = (cause: unknown) =>
  new ProjectService.ProjectOperationError({ operation: "list-projects", cause });

/** `ProjectService` over Peer Core's folders. */
export const layer = Layer.effect(
  ProjectService.ProjectService,
  Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const all = Effect.tryPromise({ try: () => readProjects(stateDir), catch: readFailure });

    const register = (root: string, title: string) =>
      Effect.tryPromise({
        try: () => registerFolder(stateDir, root, title),
        catch: (cause) =>
          new ProjectService.ProjectOperationError({
            operation: "normalize-workspace",
            workspaceRoot: root,
            cause,
          }),
      });

    const getById: ProjectService.ProjectService["Service"]["getById"] = (projectId) =>
      all.pipe(
        Effect.map((projects) =>
          Option.map(
            Option.fromUndefinedOr(projects.find((project) => project.id === projectId)),
            toProject,
          ),
        ),
      );

    const getByWorkspaceRoot: ProjectService.ProjectService["Service"]["getByWorkspaceRoot"] = (
      workspaceRoot,
    ) =>
      all.pipe(
        Effect.map((projects) => {
          const root = realpathOrSelf(workspaceRoot);
          return Option.map(
            Option.fromUndefinedOr(projects.find((project) => project.workspaceRoot === root)),
            toProject,
          );
        }),
      );

    const listShells: ProjectService.ProjectService["Service"]["listShells"] = (options) =>
      all.pipe(
        Effect.map((projects) =>
          projects
            .filter(
              (project) =>
                options?.projectIds === undefined ||
                options.projectIds.includes(ProjectId.make(project.id)),
            )
            .map(toShell),
        ),
      );

    return ProjectService.ProjectService.of({
      create: (input) =>
        Effect.gen(function* () {
          const { project, created } = yield* register(input.workspaceRoot, input.title);
          if (!created)
            return yield* new ProjectService.ProjectConflictError({
              projectId: input.projectId,
              workspaceRoot: project.workspaceRoot,
              conflictingProjectId: ProjectId.make(project.id),
            });
          return toProject(project);
        }),
      bootstrap: (input) =>
        register(input.workspaceRoot, input.title).pipe(
          Effect.map(({ project, created }) => ({ project: toProject(project), created })),
        ),
      update: () => Effect.fail(unsupported("dispatch-project-command")),
      delete: () => Effect.fail(unsupported("dispatch-project-command")),
      getById,
      getByWorkspaceRoot,
      snapshot: all.pipe(
        Effect.map(
          (projects): ProjectSnapshot =>
            ({
              projects: projects.map(toProject),
              updatedAt: new Date().toISOString(),
            }) as ProjectSnapshot,
        ),
      ),
      getShell: (projectId) =>
        listShells({ projectIds: [projectId] }).pipe(
          Effect.map((shells) => Option.fromUndefinedOr(shells[0])),
        ),
      listShells,
    });
  }),
);
