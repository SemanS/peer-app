/**
 * `peer core create`, `peer core invite`, and the menu `peer core login` opens on a terminal: what
 * a signed-in person can do next (accept an invitation or a founding, create a workspace, share
 * this folder, invite someone, connect an editor), asked until they are done. Every step is one
 * of the commands, so a script does the same without the menu.
 *
 * @module cli/peerCoreMenu
 */
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

/** One thing the menu offers. */
export type MenuItem =
  | { readonly kind: "accept"; readonly slug: string; readonly name: string }
  | { readonly kind: "domain"; readonly slug: string; readonly name: string }
  | { readonly kind: "founding"; readonly slug: string; readonly name: string }
  | { readonly kind: "share"; readonly folder: string }
  | { readonly kind: "invite"; readonly slug: string }
  | { readonly kind: "create" }
  | { readonly kind: "join" }
  | { readonly kind: "editor" }
  | { readonly kind: "done" };

/**
 * What the menu offers now: what waits for the person first (invitations, foundings, a domain
 * match), then sharing `folder` when it is a repository no workspace has, inviting where they may,
 * creating and joining, an editor, and done.
 */
export const menuItems = (
  status: PeerHubStatus,
  folder: string | null,
): ReadonlyArray<{ readonly title: string; readonly value: MenuItem }> => [
  ...(status.foundings ?? [])
    .filter((f) => f.expired !== true)
    .map((f) => ({
      title: `Accept ${f.name} (${f.slug}), founded for you`,
      value: { kind: "founding" as const, slug: f.slug, name: f.name },
    })),
  ...status.joinable.map((offer) => ({
    title:
      offer.reason === "invite"
        ? `Accept the invitation to ${offer.name} (${offer.slug})`
        : `Join ${offer.name} (${offer.slug}), which your email domain admits`,
    value: {
      kind: offer.reason === "invite" ? ("accept" as const) : ("domain" as const),
      slug: offer.slug,
      name: offer.name,
    },
  })),
  ...(folder === null || status.workspaces.length === 0
    ? []
    : [{ title: `Share ${folder} with a workspace`, value: { kind: "share" as const, folder } }]),
  ...status.workspaces
    .filter((w) => inviter(w.role))
    .map((w) => ({
      title: `Invite someone to ${w.name} (${w.slug})`,
      value: { kind: "invite" as const, slug: w.slug },
    })),
  { title: "Create a workspace", value: { kind: "create" } },
  { title: "Join a workspace by its name", value: { kind: "join" } },
  { title: "Connect an editor", value: { kind: "editor" } },
  { title: "Done", value: { kind: "done" } },
];

/** How the menu asks; every answer may be null (the person left the prompt). */
export interface MenuAsk<R = never> {
  readonly choose: <A>(
    message: string,
    choices: ReadonlyArray<{ readonly title: string; readonly value: A }>,
  ) => Effect.Effect<A | null, never, R>;
  readonly text: (message: string) => Effect.Effect<string | null, never, R>;
  readonly pick: (
    message: string,
    choices: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string> | null, never, R>;
}

/** What the menu's steps run: each the command of the same name. */
export interface MenuSteps<R = never> {
  readonly status: Effect.Effect<PeerHubStatus, CliError.UserError, R>;
  /** A repository here that no workspace has, to offer sharing; null otherwise. */
  readonly shareable: Effect.Effect<string | null, never, R>;
  readonly join: (slug: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly founding: (slug: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly create: (name: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly share: (folder: string) => Effect.Effect<void, CliError.UserError, R>;
  readonly invite: (input: InviteInput) => Effect.Effect<void, CliError.UserError, R>;
  readonly editor: Effect.Effect<void, CliError.UserError, R>;
}

/**
 * Asks what to do next until the person is done; a step that fails says why and the menu asks
 * again, so one refusal does not end it.
 */
export const menu = <R>(ask: MenuAsk<R>, steps: MenuSteps<R>, io: OneShotIo) =>
  Effect.gen(function* () {
    for (;;) {
      const status = yield* steps.status;
      const item = yield* ask.choose(
        "What next?",
        menuItems(status, status.workspaces.length === 0 ? null : yield* steps.shareable),
      );
      if (item === null || item.kind === "done") return;
      const step: Effect.Effect<void, CliError.UserError, R> = Effect.gen(function* () {
        switch (item.kind) {
          case "accept":
          case "domain":
            return yield* steps.join(item.slug);
          case "founding":
            return yield* steps.founding(item.slug);
          case "share":
            return yield* steps.share(item.folder);
          case "editor":
            return yield* steps.editor;
          case "create": {
            const name = yield* ask.text("The workspace's name");
            if (name !== null && name.trim() !== "") yield* steps.create(name);
            return;
          }
          case "join": {
            const slug = yield* ask.text("The workspace's short name (as its invitation names it)");
            if (slug !== null && slug.trim() !== "") yield* steps.join(slug.trim());
            return;
          }
          case "invite": {
            const email = yield* ask.text(`Whom to invite to ${item.slug} (their email)`);
            if (email === null || email.trim() === "") return;
            const projects =
              status.workspaces
                .find((w) => w.slug === item.slug)
                ?.projects.map((p) => p.project.id) ?? [];
            const chosen =
              projects.length === 0
                ? []
                : yield* ask.pick(
                    "Which projects (none chosen: all of them, now and later)",
                    projects,
                  );
            if (chosen === null) return;
            return yield* steps.invite({ email, workspace: item.slug, projects: chosen });
          }
        }
      });
      yield* step.pipe(
        Effect.catch((error) => io.say(String(error.message).replace(/^peer core: /, ""))),
      );
    }
  });
