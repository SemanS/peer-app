// @effect-diagnostics nodeBuiltinImport:off - looking for repositories under the home directory.
/**
 * `peer core create`, `peer core invite`, and the menu `peer core login` opens on a terminal: what
 * a signed-in person can do next (accept an invitation or a founding, create a workspace, share
 * this folder, invite someone, connect an editor), asked until they are done. Every step is one
 * of the commands, so a script does the same without the menu.
 *
 * @module cli/peerCoreMenu
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { PeerHubStatus, PeerWorkspaceRole } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as CliError from "effect/cli/CliError";

import { idFromName } from "../peerHub/names.ts";
import * as PeerWorkspaces from "../peerHub/core/workspaces/PeerWorkspaces.ts";
import { type OneShotIo, outcome } from "./peerCoreIo.ts";
import { startOnTree } from "./peerCoreTasks.ts";
import * as Tree from "./peerCoreTree.ts";

/** Who may invite to a workspace: its owners and admins (a project's lead does it in the app). */
const inviter = (role: PeerWorkspaceRole) => role === "owner" || role === "admin";

/** `peer core create <name> [--slug <slug>]`: a workspace whose owner is the signed-in person. */
export const create = (input: { readonly name: string; readonly slug?: string }, io: OneShotIo) =>
  Effect.gen(function* () {
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    const name = input.name.trim();
    const slug = (input.slug?.trim() || idFromName(name, "")).toLowerCase();
    if (name === "" || slug === "")
      return yield* outcome(
        "usage",
        "a workspace needs a name",
        'run peer core create "<name>" [--slug <slug>].',
      );
    const status = yield* workspaces.createWorkspace({ slug, name, allowedDomains: [] });
    yield* io.say(`Created: ${slug} (${name}). You are its owner.`);
    yield* io.say(
      `Next: share a project with peer core share, then invite people with peer core invite <email> --workspace ${slug}.`,
    );
    return status;
  });

export interface InviteInput {
  readonly email: string;
  readonly workspace?: string;
  readonly projects?: ReadonlyArray<string>;
  readonly admin?: boolean;
  /** With one project: the areas and tasks they will own when they join. */
  readonly areas?: ReadonlyArray<string>;
  readonly tasks?: ReadonlyArray<string>;
}

/** `peer core invite <email>`: mails an invitation to a workspace the person may invite to. */
export const invite = (input: InviteInput, status: PeerHubStatus, io: OneShotIo) =>
  Effect.gen(function* () {
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    const mine = status.workspaces.filter((w) => inviter(w.role)).map((w) => w.slug);
    const slug = input.workspace ?? (mine.length === 1 ? mine[0] : undefined);
    if (slug === undefined)
      return yield* mine.length === 0
        ? outcome(
            "refused",
            "you own or administer no workspace",
            'create one with peer core create "<name>", or ask an admin of yours to invite.',
          )
        : outcome(
            "usage",
            `you may invite to ${mine.join(", ")}`,
            "choose one with --workspace <slug>.",
          );
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return yield* outcome(
        "usage",
        `${input.email} is no email address`,
        "run peer core invite <email>.",
      );
    const projects = (input.projects ?? []).map((p) => p.trim()).filter((p) => p !== "");
    const result = yield* workspaces.invite({
      workspace: slug,
      email,
      ...(input.admin === true ? { role: "admin" as const } : {}),
      ...(projects.length > 0 ? { projects } : {}),
      ...(input.areas === undefined || input.areas.length === 0 ? {} : { areas: input.areas }),
      ...(input.tasks === undefined || input.tasks.length === 0 ? {} : { tasks: input.tasks }),
    });
    const failed = result.delivery?.error;
    yield* io.say(
      `Invited: ${email} to ${slug}${projects.length > 0 ? ` (projects ${projects.join(", ")})` : ""}${input.admin === true ? " as admin" : ""}.`,
    );
    yield* io.say(
      failed === undefined || failed === null
        ? `The invitation is mailed; ${email} joins with its link, or with peer core join ${slug} once signed in.`
        : `The mail failed (${failed}); ${email} can still sign in and run peer core join ${slug}.`,
    );
    return result;
  });

/** Where people keep clones, under the home directory; each looked into two levels deep. */
const REPOSITORY_ROOTS = [
  "code",
  "Code",
  "projects",
  "Projects",
  "src",
  "dev",
  "Developer",
  "git",
  "repos",
  "work",
  "Documents/GitHub",
  "Desktop",
  ".superset/projects",
  ".t3/projects",
  ".peer/projects",
];
const SKIPPED = new Set(["node_modules", "dist", "build", "target", "vendor", "Library"]);

/**
 * The Git or Jujutsu repositories under the usual folders of `home`, the most recently touched
 * first, at most `limit`: what "Share a project from this computer" offers before browsing.
 */
export async function findRepositories(home: string, limit = 25): Promise<ReadonlyArray<string>> {
  const found = new Map<string, number>();
  const look = async (dir: string, depth: number): Promise<void> => {
    const entries = await NodeFSP.readdir(dir, { withFileTypes: true }).catch(() => []);
    const marker = entries.find((e) => e.name === ".git" || e.name === ".jj");
    if (marker !== undefined) {
      const stat = await NodeFSP.stat(NodePath.join(dir, marker.name)).catch(() => null);
      found.set(dir, stat?.mtimeMs ?? 0);
      return;
    }
    if (depth === 0) return;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIPPED.has(e.name))
        .map((e) => look(NodePath.join(dir, e.name), depth - 1)),
    );
  };
  // On a case-insensitive disk `code` and `Code` are one folder: each real folder is looked into once.
  const roots = await Promise.all(
    REPOSITORY_ROOTS.map((root) => NodeFSP.realpath(NodePath.join(home, root)).catch(() => null)),
  );
  await Promise.all(
    [...new Set(roots.filter((root) => root !== null))].map((root) => look(root, 2)),
  );
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([dir]) => dir);
}

/** The repository the menu runs in, as Peer sees it. */
export type Here =
  | { readonly root: string; readonly state: "new" }
  /** A clone of a workspace project's repository: connecting it joins that project. */
  | { readonly root: string; readonly state: "clone"; readonly project: string }
  | {
      readonly root: string;
      readonly state: "connected";
      readonly workspace: string;
      readonly project: string;
      /** The checkout has an `openspec/changes` folder. */
      readonly openspec?: boolean;
    };

/** One thing the menu offers. */
export type MenuItem =
  | { readonly kind: "accept"; readonly slug: string; readonly name: string }
  | { readonly kind: "domain"; readonly slug: string; readonly name: string }
  | { readonly kind: "founding"; readonly slug: string; readonly name: string }
  | { readonly kind: "here"; readonly folder: string }
  | { readonly kind: "another" }
  | { readonly kind: "invite" }
  | { readonly kind: "task" }
  | { readonly kind: "openspec" }
  | { readonly kind: "disconnect" }
  | { readonly kind: "open" }
  | { readonly kind: "create" }
  | { readonly kind: "join" }
  | { readonly kind: "workspace" }
  | { readonly kind: "editor" }
  | { readonly kind: "launch"; readonly editor: string; readonly folder: string }
  | { readonly kind: "exit" };

/** An editor or agent harness Peer can connect, as it stands on this computer. */
export interface Editor {
  readonly id: string;
  readonly title: string;
  /** Peer's hooks or MCP entry are in its settings. */
  readonly connected: boolean;
  /** Its command is on PATH, so the menu can start it in the project (Claude Code, Codex). */
  readonly launchable: boolean;
}

export interface MenuChoice {
  readonly title: string;
  readonly description?: string;
  readonly value: MenuItem;
}

const RECOMMENDED = "Recommended";

/** `~/…` for a path under the home directory: the name matters, the full path is context. */
export const shortPath = (path: string, home: string) =>
  path === home || path.startsWith(`${home}${NodePath.sep}`) ? `~${path.slice(home.length)}` : path;

/** The lines above the menu: who, which workspace, the project here, and the editors connected. */
export const menuContext = (
  status: PeerHubStatus,
  here: Here | null,
  editors: ReadonlyArray<Editor>,
) => {
  const names = status.workspaces.map((w) => w.slug);
  const lines = [
    `Signed in as ${status.email ?? "nobody"}`,
    names.length === 0
      ? "Workspace: none yet"
      : names.length === 1
        ? `Workspace: ${names[0]}`
        : `Workspaces: ${names.join(", ")}`,
  ];
  if (here !== null)
    lines.push(
      `Project: ${NodePath.basename(here.root)} · ${
        here.state === "connected"
          ? `Connected${here.project === NodePath.basename(here.root) ? "" : ` as ${here.workspace}/${here.project}`}`
          : here.state === "clone"
            ? `Clone of ${here.project}, not connected`
            : "Not connected"
      }`,
    );
  const connected = editors.filter((e) => e.connected);
  lines.push(
    connected.length === 0
      ? "Editors: none connected yet"
      : ["Editors:", ...connected.map((e) => `  ✓ ${e.title}`)].join("\n"),
  );
  return lines;
};

/**
 * What the menu offers, the step that gets the person to a shared project first and marked
 * recommended: an invitation that waits, else a workspace when there is none, else connecting
 * the project here, else inviting a teammate to it. Inviting is offered where they own or
 * administer a workspace; joining or creating one stays reachable, Exit last.
 */
export const menuItems = (
  status: PeerHubStatus,
  here: Here | null,
  editors: ReadonlyArray<Editor> = [],
): ReadonlyArray<MenuChoice> => {
  const offers: Array<MenuChoice> = [
    ...(status.foundings ?? [])
      .filter((f) => f.expired !== true)
      .map((f) => ({
        title: `Accept ${f.name}, founded for you`,
        value: { kind: "founding" as const, slug: f.slug, name: f.name },
      })),
    ...status.joinable.map((offer) => ({
      title:
        offer.reason === "invite"
          ? `Accept the invitation to ${offer.name}`
          : `Join ${offer.name} (your email domain is admitted)`,
      value: {
        kind: offer.reason === "invite" ? ("accept" as const) : ("domain" as const),
        slug: offer.slug,
        name: offer.name,
      },
    })),
  ];
  const inWorkspace = status.workspaces.length > 0;
  const canInvite = status.workspaces.some((w) => inviter(w.role));
  const name = here === null ? "" : NodePath.basename(here.root);
  const target =
    status.workspaces.length === 1 ? status.workspaces[0]!.slug : "the workspace you choose";
  const connectHere: Array<MenuChoice> =
    !inWorkspace || here === null || here.state === "connected"
      ? []
      : [
          {
            title: `Connect this project (${name})`,
            description:
              here.state === "clone"
                ? `It is a clone of ${here.project}: it joins that project, nothing new is created.`
                : `Your team in ${target} sees it and can clone it; the code stays in its repository.`,
            value: { kind: "here", folder: here.root },
          },
        ];
  const invite: Array<MenuChoice> = canInvite
    ? [
        {
          title: "Invite a teammate",
          description: "They get an email with a link; you choose the projects.",
          value: { kind: "invite" },
        },
      ]
    : [];
  const hasProjects = status.workspaces.some((w) => w.projects.length > 0);
  const work: Array<MenuChoice> = [
    ...(hasProjects
      ? [
          {
            title: "Start a task",
            description: "Your teammates and agents see it; take it yourself to begin.",
            value: { kind: "task" as const },
          },
        ]
      : []),
    {
      title: "Open Peer",
      description: "The app: tasks, agents and who works on what.",
      value: { kind: "open" },
    },
  ];
  // Work starts in the editor: in a connected project, the connected editors Peer can start there.
  const launch: Array<MenuChoice> =
    here?.state === "connected"
      ? editors
          .filter((e) => e.connected && e.launchable)
          .map((e) => ({
            title: `Open ${e.title}`,
            description: `In ${NodePath.basename(here.root)}, with Peer coordinating its agents.`,
            value: { kind: "launch" as const, editor: e.id, folder: here.root },
          }))
      : [];
  const openspec: Array<MenuChoice> =
    here?.state === "connected" && here.openspec === true
      ? [
          {
            title: "Sync OpenSpec changes",
            description: "New changes become tasks; edits made in Peer stay.",
            value: { kind: "openspec" },
          },
        ]
      : [];
  const items: Array<MenuChoice> = inWorkspace
    ? [
        ...offers,
        ...(here?.state === "connected"
          ? [...launch, ...invite, ...work, ...openspec, ...connectHere]
          : [...connectHere, ...invite, ...work]),
        {
          title: "Connect another local project",
          description: "Pick one of your repositories, or browse for a folder.",
          value: { kind: "another" },
        },
        ...(here?.state === "connected"
          ? [
              {
                title: `Disconnect this project (${NodePath.basename(here.root)})`,
                description: `It leaves ${here.workspace} for everyone; its clone here stays.`,
                value: { kind: "disconnect" as const },
              },
            ]
          : []),
        { title: "Join or create a workspace", value: { kind: "workspace" } },
      ]
    : [
        ...offers,
        {
          title: "Create a workspace",
          description: "A place for your team's projects; you become its owner.",
          value: { kind: "create" },
        },
        {
          title: "Join a workspace",
          description: "By the name in your invitation.",
          value: { kind: "join" },
        },
      ];
  items.push(
    editors.some((e) => e.connected)
      ? {
          title: "Manage integrations",
          description: "Connect or disconnect editors and agents.",
          value: { kind: "editor" },
        }
      : {
          title: "Connect an editor",
          description: "So your agents (Claude Code, Codex, Cursor, …) coordinate through Peer.",
          value: { kind: "editor" },
        },
    { title: "Exit", value: { kind: "exit" } },
  );
  const [first, ...rest] = items;
  return first === undefined || first.value.kind === "exit" || first.value.kind === "editor"
    ? items
    : [
        {
          ...first,
          description:
            first.description === undefined ? RECOMMENDED : `${RECOMMENDED} · ${first.description}`,
        },
        ...rest,
      ];
};

/** How the menu asks; every answer may be null (the person left the prompt). */
export interface MenuAsk<R = never> {
  readonly choose: <A>(
    message: string,
    choices: ReadonlyArray<{
      readonly title: string;
      readonly value: A;
      readonly description?: string;
    }>,
  ) => Effect.Effect<A | null, never, R>;
  readonly text: (message: string) => Effect.Effect<string | null, never, R>;
  readonly pick: (
    message: string,
    choices: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string> | null, never, R>;
  /** A folder, browsed from the home directory. */
  readonly folder: (message: string) => Effect.Effect<string | null, never, R>;
  readonly confirm: (message: string, initial: boolean) => Effect.Effect<boolean, never, R>;
  /** The areas, groups and tasks to assign, selected in a tree. */
  readonly tree: (
    message: string,
    nodes: ReadonlyArray<Tree.TreeNode>,
  ) => Effect.Effect<Tree.Selection | null, never, R>;
  /** One row of the tree; `expand` opens the way down to that node. */
  readonly treePick: (
    message: string,
    nodes: ReadonlyArray<Tree.TreeNode>,
    expand?: Tree.Picked,
  ) => Effect.Effect<Tree.Picked | null, never, R>;
}

export interface TaskInput {
  readonly workspace: string;
  readonly project: string;
  readonly title: string;
  /** The person becomes its owner. */
  readonly take: boolean;
  /** The task it goes under. */
  readonly parent?: string;
}

/** What the menu's steps run: each the command of the same name. */
export interface MenuSteps<R = never> {
  readonly status: Effect.Effect<PeerHubStatus, CliError.UserError, R>;
  readonly home: string;
  /** The repository the menu runs in, null outside one. */
  readonly here: Effect.Effect<Here | null, never, R>;
  /** Repositories on this computer that no workspace has yet, to offer for connecting. */
  readonly repositories: Effect.Effect<ReadonlyArray<string>, never, R>;
  /** Every editor Peer can connect, whether it is connected and whether it can be started here. */
  readonly editors: Effect.Effect<ReadonlyArray<Editor>, never, R>;
  readonly join: (slug: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly founding: (slug: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly create: (name: string) => Effect.Effect<void, CliError.UserError, R>;
  /** Connects a folder (`peer core share`); the project it became part of, or null. */
  readonly share: (
    folder: string,
  ) => Effect.Effect<
    { readonly workspace: string; readonly project: string } | null,
    CliError.UserError,
    R
  >;
  readonly invite: (input: InviteInput) => Effect.Effect<void, CliError.UserError, R>;
  readonly startTask: (input: TaskInput) => Effect.Effect<void, CliError.UserError, R>;
  /** Takes a project out of its workspace (`peer core unshare`). */
  readonly unshare: (
    workspace: string,
    project: string,
  ) => Effect.Effect<void, CliError.UserError, R>;
  /** The person becomes the owner of a task nobody owns. */
  readonly takeTask: (
    workspace: string,
    project: string,
    task: string,
  ) => Effect.Effect<void, CliError.UserError, R>;
  /** Settles whether an item runs as one task (`executable`) or by its parts. */
  readonly settleTask: (
    workspace: string,
    project: string,
    task: string,
    executable: boolean,
  ) => Effect.Effect<void, CliError.UserError, R>;
  /** A project's areas with their groups, tasks and owners, as a tree. */
  readonly scope: (
    workspace: string,
    project: string,
  ) => Effect.Effect<ReadonlyArray<Tree.TreeNode>, CliError.UserError, R>;
  /** Imports a connected checkout's OpenSpec changes, asking first; false without `openspec/`. */
  readonly openspec: (target: {
    readonly workspace: string;
    readonly project: string;
    readonly root: string;
  }) => Effect.Effect<boolean, CliError.UserError, R>;
  /** Opens the Peer app (or where to get it); the menu ends, the app coordinates from then on. */
  readonly openPeer: Effect.Effect<void, CliError.UserError, R>;
  readonly connectEditor: (id: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly disconnectEditor: (id: string) => Effect.Effect<void, CliError.UserError, R>;
}

/** How the menu ended: with an editor to start in a project, or just closed. */
export interface MenuEnd {
  readonly launch?: {
    readonly editor: string;
    readonly folder: string;
    /** The editor's first prompt: the task it starts on. */
    readonly prompt?: string;
  };
  /** An editor is connected, so Peer should keep coordinating after the menu. */
  readonly editorsConnected: boolean;
}

/**
 * Asks what to do next until the person exits; a step that fails says why and the menu asks
 * again, so one refusal does not end it. A connected project ends in what is ready for the team.
 */
export const menu = <R>(ask: MenuAsk<R>, steps: MenuSteps<R>, io: OneShotIo) =>
  Effect.gen(function* () {
    let shown = "";
    /** A step that ends the menu (an editor to open) sets this. */
    let ended: MenuEnd | null = null;
    const createStep = Effect.gen(function* () {
      const name = yield* ask.text("The workspace's name");
      if (name === null || name.trim() === "") return;
      yield* steps.create(name);
      shown = "";
    });
    const joinStep = Effect.gen(function* () {
      const slug = yield* ask.text("The workspace's short name (as your invitation names it)");
      if (slug === null || slug.trim() === "") return;
      yield* steps.join(slug.trim());
      shown = "";
    });
    for (;;) {
      const status = yield* steps.status;
      const here = yield* steps.here;
      const editors = yield* steps.editors;
      const editorsConnected = editors.some((e) => e.connected);
      const context = menuContext(status, here, editors).join("\n");
      if (context !== shown) {
        yield* io.say(context);
        shown = context;
      }
      const item = yield* ask.choose(
        "What would you like to do?",
        menuItems(status, here, editors),
      );
      const end = (more: Partial<MenuEnd> = {}): MenuEnd => ({ editorsConnected, ...more });
      if (item === null || item.kind === "exit") return end();
      if (item.kind === "launch")
        return end({ launch: { editor: item.editor, folder: item.folder } });
      if (item.kind === "open") {
        const opened = yield* steps.openPeer.pipe(
          Effect.as(true),
          Effect.catch((error) =>
            io.say(String(error.message).replace(/^peer core: /, "")).pipe(Effect.as(false)),
          ),
        );
        // The app coordinates from now on; Peer Core is not started beside it.
        if (opened) return end({ editorsConnected: false });
        continue;
      }
      const connect = (folder: string) =>
        Effect.gen(function* () {
          const joined = yield* steps.share(folder);
          if (joined === null) return;
          const ready = (yield* steps.editors).some((e) => e.connected);
          yield* io.say(
            [
              "",
              `✓ Signed in as ${status.email ?? ""}`,
              `✓ Project "${NodePath.basename(folder)}" connected to ${joined.workspace} (${joined.project})`,
              ready
                ? "✓ Agent integration ready"
                : "· Agent integration not set up yet: choose Connect an editor",
              "",
              "Your project is ready for collaboration.",
            ].join("\n"),
          );
          yield* steps.openspec({ ...joined, root: folder });
          shown = "";
        });
      const step: Effect.Effect<void, CliError.UserError, R> = Effect.gen(function* () {
        switch (item.kind) {
          case "accept":
          case "domain":
            return yield* steps.join(item.slug);
          case "founding":
            return yield* steps.founding(item.slug);
          case "here":
            return yield* connect(item.folder);
          case "another": {
            const found = yield* steps.repositories;
            const picked = yield* ask.choose<string>(
              found.length === 0 ? "No repositories found in the usual folders" : "Which project?",
              [
                ...found.map((dir) => ({
                  title: NodePath.basename(dir),
                  description: shortPath(dir, steps.home),
                  value: dir,
                })),
                { title: "Browse folders…", value: "\0browse" },
                { title: "Type a path…", value: "\0type" },
              ],
            );
            const folder =
              picked === "\0browse"
                ? yield* ask.folder(
                    "The project's folder (Enter, then y opens a folder, n chooses it)",
                  )
                : picked === "\0type"
                  ? yield* ask.text("The project's folder (a path)")
                  : picked;
            if (folder !== null && folder.trim() !== "") yield* connect(folder.trim());
            return;
          }
          case "editor": {
            const id = yield* ask.choose(
              "Which editor or agent?",
              editors.map((e) => ({
                title: `${e.connected ? "✓ " : "  "}${e.title}`,
                description: e.connected ? "Connected: choose it to disconnect" : "Connect it",
                value: e.id,
              })),
            );
            const chosen = editors.find((e) => e.id === id);
            if (chosen === undefined) return;
            if (!chosen.connected) yield* steps.connectEditor(chosen.id);
            else if (yield* ask.confirm(`Disconnect ${chosen.title} from Peer?`, false))
              yield* steps.disconnectEditor(chosen.id);
            shown = "";
            return;
          }
          case "workspace": {
            const next = yield* ask.choose<"create" | "join">("Join or create", [
              {
                title: "Join a workspace",
                description: "By the name in your invitation.",
                value: "join",
              },
              {
                title: "Create a workspace",
                description: "You become its owner.",
                value: "create",
              },
            ]);
            if (next === "create") return yield* createStep;
            if (next === "join") return yield* joinStep;
            return;
          }
          case "create":
            return yield* createStep;
          case "join":
            return yield* joinStep;
          case "disconnect":
            if (
              here?.state === "connected" &&
              (yield* ask.confirm(
                `Disconnect ${here.workspace}/${here.project}? It leaves the workspace for everyone, with its tasks; the settings history keeps it.`,
                false,
              ))
            ) {
              yield* steps.unshare(here.workspace, here.project);
              shown = "";
            }
            return;
          case "openspec":
            if (here?.state === "connected")
              yield* steps.openspec({
                workspace: here.workspace,
                project: here.project,
                root: here.root,
              });
            return;
          case "task": {
            const projects = status.workspaces.flatMap((w) =>
              w.projects.map((p) => ({ workspace: w.slug, project: p.project.id })),
            );
            const chooseProject = ask.choose(
              "Tasks of which project?",
              projects.map((p) => ({ title: `${p.workspace}/${p.project}`, value: p })),
            );
            // The project here first: the folder the person works in says which.
            let project =
              here?.state === "connected"
                ? { workspace: here.workspace, project: here.project }
                : projects.length === 1
                  ? projects[0]!
                  : yield* chooseProject;
            if (project === null) return;
            const launch = yield* startOnTree(ask, steps, io, {
              project,
              chooseProject,
              others: projects.length > 1,
              me: status.email?.toLowerCase(),
              editor:
                here?.state === "connected"
                  ? {
                      editor: editors.find((e) => e.connected && e.launchable),
                      here,
                    }
                  : undefined,
            });
            if (launch !== undefined) ended = { editorsConnected, launch };
            return;
          }
          case "invite": {
            const slugs = status.workspaces.filter((w) => inviter(w.role)).map((w) => w.slug);
            const slug =
              here?.state === "connected" && slugs.includes(here.workspace)
                ? here.workspace
                : slugs.length === 1
                  ? slugs[0]!
                  : yield* ask.choose(
                      "Invite to which workspace?",
                      slugs.map((s) => ({ title: s, value: s })),
                    );
            if (slug === null) return;
            const email = yield* ask.text("Teammate email");
            if (email === null || email.trim() === "") return;
            const projects =
              status.workspaces.find((w) => w.slug === slug)?.projects.map((p) => p.project.id) ??
              [];
            const project =
              here?.state === "connected" && here.workspace === slug
                ? here.project
                : projects.length <= 1
                  ? (projects[0] ?? null)
                  : yield* ask.choose(
                      "Which project?",
                      projects.map((p) => ({ title: p, value: p })),
                    );
            if (project === null)
              return yield* steps.invite({ email, workspace: slug, projects: [] });
            const nodes = yield* steps.scope(slug, project);
            const how = yield* ask.choose<"all" | "pick">("What would you like to assign?", [
              {
                title: "All areas and tasks",
                description: "Every area that has no owner yet, with its new tasks.",
                value: "all",
              },
              { title: "Select areas or tasks", value: "pick" },
            ]);
            if (how === null) return;
            const chosen: Tree.Selection | null =
              how === "all"
                ? { all: true, areas: [], tasks: [] }
                : yield* ask.tree("Select areas or tasks", nodes);
            if (chosen === null) return;
            const named = nodes.flatMap((a) => (a.id === "" ? [] : [a.id]));
            yield* io.say(
              [
                "",
                `Invite ${email.trim()}?`,
                "",
                `Workspace: ${slug}`,
                `Project: ${project}`,
                "",
                "Assignments:",
                ...(chosen.all || chosen.areas.length > 0 || chosen.tasks.length > 0
                  ? Tree.describe(nodes, chosen).map((line) => `  ${line}`)
                  : ["  none: they can take any task"]),
                ...nodes
                  .filter(
                    (a) =>
                      a.id !== "" &&
                      a.owner !== undefined &&
                      (chosen.all || chosen.areas.includes(a.id)),
                  )
                  .map((a) => `  · ${a.id} stays ${a.owner}'s`),
                "",
              ].join("\n"),
            );
            if (!(yield* ask.confirm("Send invitation?", true))) {
              yield* io.say("Nothing sent.");
              return;
            }
            return yield* steps.invite({
              email,
              workspace: slug,
              projects: [project],
              areas: chosen.all ? named : chosen.areas,
              tasks: chosen.all ? [] : chosen.tasks,
            });
          }
        }
      });
      yield* step.pipe(
        Effect.catch((error) => io.say(String(error.message).replace(/^peer core: /, ""))),
      );
      if (ended !== null) return ended;
    }
  });
