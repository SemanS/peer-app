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
  | { readonly kind: "open" }
  | { readonly kind: "create" }
  | { readonly kind: "join" }
  | { readonly kind: "workspace" }
  | { readonly kind: "editor" }
  | { readonly kind: "exit" };

export interface MenuChoice {
  readonly title: string;
  readonly description?: string;
  readonly value: MenuItem;
}

const RECOMMENDED = "Recommended";

/** `~/…` for a path under the home directory: the name matters, the full path is context. */
export const shortPath = (path: string, home: string) =>
  path === home || path.startsWith(`${home}${NodePath.sep}`) ? `~${path.slice(home.length)}` : path;

/** The lines above the menu: who, which workspace, and the project here. */
export const menuContext = (status: PeerHubStatus, here: Here | null, home: string) => {
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
      `Current project: ${NodePath.basename(here.root)} (${shortPath(here.root, home)}) · ${
        here.state === "connected"
          ? `connected to ${here.workspace}/${here.project}`
          : here.state === "clone"
            ? `a clone of ${here.project}, not connected`
            : "not connected"
      }`,
    );
  return lines;
};

/**
 * What the menu offers, the step that gets the person to a shared project first and marked
 * recommended: an invitation that waits, else a workspace when there is none, else connecting
 * the project here, else inviting a teammate to it. Inviting is offered where they own or
 * administer a workspace; joining or creating one stays reachable, Exit last.
 */
export const menuItems = (status: PeerHubStatus, here: Here | null): ReadonlyArray<MenuChoice> => {
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
  const items: Array<MenuChoice> = inWorkspace
    ? [
        ...offers,
        ...(here?.state === "connected"
          ? [...invite, ...work, ...connectHere]
          : [...connectHere, ...invite, ...work]),
        {
          title: "Connect another local project",
          description: "Pick one of your repositories, or browse for a folder.",
          value: { kind: "another" },
        },
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
    {
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
}

export interface TaskInput {
  readonly workspace: string;
  readonly project: string;
  readonly title: string;
  /** The person becomes its owner. */
  readonly take: boolean;
}

/** What the menu's steps run: each the command of the same name. */
export interface MenuSteps<R = never> {
  readonly status: Effect.Effect<PeerHubStatus, CliError.UserError, R>;
  readonly home: string;
  /** The repository the menu runs in, null outside one. */
  readonly here: Effect.Effect<Here | null, never, R>;
  /** Repositories on this computer that no workspace has yet, to offer for connecting. */
  readonly repositories: Effect.Effect<ReadonlyArray<string>, never, R>;
  /** Whether an editor or agent harness here already talks to Peer. */
  readonly agentsReady: Effect.Effect<boolean, never, R>;
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
  /** Opens the Peer app (or where to get it); the menu ends, the app coordinates from then on. */
  readonly openPeer: Effect.Effect<void, CliError.UserError, R>;
  readonly editor: Effect.Effect<void, CliError.UserError, R>;
}

/**
 * Asks what to do next until the person exits; a step that fails says why and the menu asks
 * again, so one refusal does not end it. A connected project ends in what is ready for the team.
 */
export const menu = <R>(ask: MenuAsk<R>, steps: MenuSteps<R>, io: OneShotIo) =>
  Effect.gen(function* () {
    let shown = "";
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
      const context = menuContext(status, here, steps.home).join("\n");
      if (context !== shown) {
        yield* io.say(context);
        shown = context;
      }
      const item = yield* ask.choose("What would you like to do?", menuItems(status, here));
      if (item === null || item.kind === "exit") return;
      if (item.kind === "open") {
        const opened = yield* steps.openPeer.pipe(
          Effect.as(true),
          Effect.catch((error) =>
            io.say(String(error.message).replace(/^peer core: /, "")).pipe(Effect.as(false)),
          ),
        );
        if (opened) return;
        continue;
      }
      const connect = (folder: string) =>
        Effect.gen(function* () {
          const joined = yield* steps.share(folder);
          if (joined === null) return;
          const ready = yield* steps.agentsReady;
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
          case "editor":
            yield* steps.editor;
            shown = "";
            return;
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
          case "task": {
            const projects = status.workspaces.flatMap((w) =>
              w.projects.map((p) => ({ workspace: w.slug, project: p.project.id })),
            );
            const project =
              here?.state === "connected"
                ? { workspace: here.workspace, project: here.project }
                : projects.length === 1
                  ? projects[0]!
                  : yield* ask.choose(
                      "In which project?",
                      projects.map((p) => ({ title: `${p.workspace}/${p.project}`, value: p })),
                    );
            if (project === null) return;
            const title = yield* ask.text(
              `What is the task? (in ${project.workspace}/${project.project})`,
            );
            if (title === null || title.trim() === "") return;
            const take = yield* ask.confirm("Take it yourself?", true);
            return yield* steps.startTask({ ...project, title: title.trim(), take });
          }
          case "invite": {
            const slugs = status.workspaces.filter((w) => inviter(w.role)).map((w) => w.slug);
            const slug =
              slugs.length === 1
                ? slugs[0]!
                : yield* ask.choose(
                    "Invite to which workspace?",
                    slugs.map((s) => ({ title: s, value: s })),
                  );
            if (slug === null) return;
            const email = yield* ask.text(`Their email (invited to ${slug})`);
            if (email === null || email.trim() === "") return;
            const projects =
              status.workspaces.find((w) => w.slug === slug)?.projects.map((p) => p.project.id) ??
              [];
            const chosen =
              projects.length === 0
                ? []
                : yield* ask.pick("Which projects (none chosen: all, now and later)", projects);
            if (chosen === null) return;
            return yield* steps.invite({ email, workspace: slug, projects: chosen });
          }
        }
      });
      yield* step.pipe(
        Effect.catch((error) => io.say(String(error.message).replace(/^peer core: /, ""))),
      );
    }
  });
