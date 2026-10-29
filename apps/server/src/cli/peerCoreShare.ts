// @effect-diagnostics nodeBuiltinImport:off - the home directory and the folder's name.
/**
 * `peer core share [folder]`: a folder on this computer becomes a project of a workspace, either a
 * new one or, when it is a clone of a project's repository, that project's checkout here. On a
 * terminal it asks which and confirms before writing; without one it acts only on what the command
 * line already says (`--workspace`, `--project`, `--yes`), as `vercel link` and `netlify link` do.
 *
 * @module cli/peerCoreShare
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { PEER_LOCAL_WORKSPACE, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as CliError from "effect/cli/CliError";

import * as PeerState from "../peerHub/core/state/PeerState.ts";
import { matchRepositories, type RepositoryMatch } from "../peerHub/core/state/remotes.ts";
import * as PeerWorkspaces from "../peerHub/core/workspaces/PeerWorkspaces.ts";
import * as PeerCoreBind from "./peerCoreBind.ts";
import { shortPath } from "./peerCoreMenu.ts";
import { type OneShotIo, outcome } from "./peerCoreIo.ts";

export interface ShareInput {
  readonly folder: string;
  /** The folder was named on the command line, not taken from where the command runs. */
  readonly named: boolean;
  readonly workspace?: string;
  readonly name?: string;
  /** `workspace/project`: use the folder as that existing project's checkout. */
  readonly project?: string;
  readonly repository?: string;
  readonly yes: boolean;
}

/** How share asks on a terminal; `interactive` false means it never asks. */
export interface ShareAsk<R = never> {
  readonly interactive: boolean;
  readonly confirm: (message: string, initial: boolean) => Effect.Effect<boolean, never, R>;
  readonly choose: <A>(
    message: string,
    choices: ReadonlyArray<{ readonly title: string; readonly value: A }>,
  ) => Effect.Effect<A | null, never, R>;
}

/**
 * The folder to share: the one named, else the repository around where the command runs (as a
 * clone is shared whole), else that folder. Never the home directory, an ancestor of it or `/`:
 * a project that big is a mistake, not a choice.
 */
export const shareFolder = (named: string | undefined, cwd: string) =>
  Effect.gen(function* () {
    const folder =
      named !== undefined
        ? PeerState.realpathOrSelf(named)
        : ((yield* PeerCoreBind.repositoryRoot(cwd))?.root ?? PeerState.realpathOrSelf(cwd));
    const home = PeerState.realpathOrSelf(NodeOS.homedir());
    if (
      folder === NodePath.parse(folder).root ||
      folder === home ||
      home.startsWith(`${folder}${NodePath.sep}`)
    )
      return yield* outcome(
        "refused",
        `${folder} is ${folder === home ? "your home directory" : "above your home directory"}, too much to share as one project`,
        "run peer core share inside the project's folder, or name it: peer core share <folder>.",
      );
    return { folder, named: named !== undefined };
  });

type Choice =
  | { readonly kind: "bind"; readonly match: RepositoryMatch }
  | { readonly kind: "new"; readonly workspace: string };

const projectOf = (match: RepositoryMatch) => `${match.workspace}/${match.project}`;

export const share = <R>(
  input: ShareInput,
  ask: ShareAsk<R>,
  io: OneShotIo,
  register: (folder: string, name?: string) => Effect.Effect<string, CliError.UserError>,
) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const asking = ask.interactive && !input.yes;
    const { folder } = input;
    const bindTo = (project: string, repository?: string) =>
      PeerCoreBind.bind(
        { folder, project, ...(repository === undefined ? {} : { repository }) },
        io,
      );

    if (input.project !== undefined) {
      if (input.workspace !== undefined || input.name !== undefined)
        return yield* outcome(
          "usage",
          "--project uses an existing project; --workspace and --name are for a new one",
          "drop one of them.",
        );
      return yield* bindTo(input.project, input.repository);
    }

    const place = yield* state.placeOf(folder, { bindByRemote: false });
    if (place !== null && place.workspace !== PEER_LOCAL_WORKSPACE) {
      yield* io.say(
        `Connected already: ${folder} is project ${place.project} of ${place.workspace}.`,
      );
      return;
    }
    const { persisted } = yield* state.read;
    const slugs = persisted.workspaces
      .map((workspace) => workspace.slug)
      .filter((slug) => slug !== PEER_LOCAL_WORKSPACE);
    if (slugs.length === 0)
      return yield* outcome(
        "refused",
        "you are in no workspace",
        "sign in with peer core login <email> or join with your invitation link, then repeat the command.",
      );
    const asked = input.workspace;
    if (asked !== undefined && !slugs.includes(asked))
      return yield* outcome(
        "refused",
        `you are in no workspace ${asked}`,
        `choose one of ${slugs.join(", ")} with --workspace.`,
      );

    const checkout = yield* PeerCoreBind.repositoryRoot(folder);
    const remote =
      checkout === null
        ? null
        : yield* Effect.promise(() => PeerState.remoteOf(checkout.remoteRoot));
    const matches =
      remote === null
        ? []
        : matchRepositories(
            remote,
            persisted.workspaces.map((workspace) => workspace.manifest),
          );
    const cloned = new Set(matches.map((match) => match.workspace));
    // A workspace whose project has this repository already gets no second project for it.
    const fresh = slugs.filter((slug) => !cloned.has(slug));

    let choice: Choice | null;
    if (matches.length > 0 && (asked === undefined || cloned.has(asked))) {
      const offered = asked === undefined ? matches : matches.filter((m) => m.workspace === asked);
      const several = new Set(offered.map(projectOf)).size < offered.length;
      const title = (match: RepositoryMatch) =>
        several ? `${projectOf(match)} (repository ${match.repository})` : projectOf(match);
      const what = `${folder} is a clone of ${offered.map(title).join(", ")}`;
      if (asking) {
        yield* io.say(`${what}.`);
        choice = yield* ask.choose<Choice>("Connect it as", [
          ...offered.map((match) => ({
            title: `the checkout of ${title(match)}`,
            value: { kind: "bind", match } as const,
          })),
          ...(asked === undefined ? fresh : []).map((workspace) => ({
            title: `a new project of ${workspace}`,
            value: { kind: "new", workspace } as const,
          })),
        ]);
      } else if (offered.length === 1 && input.yes) {
        choice = { kind: "bind", match: offered[0]! };
      } else {
        return yield* outcome(
          "refused",
          `${what}, and sharing it again would make a second project of one repository`,
          offered.length === 1
            ? `use it as that project's checkout with peer core share --yes${input.named ? ` ${folder}` : ""}.`
            : `choose one with peer core share --project <workspace/project>${several ? " --repository <id>" : ""}.`,
        );
      }
    } else {
      const workspace =
        asked ??
        (slugs.length === 1
          ? slugs[0]!
          : asking
            ? yield* ask.choose(
                "Share it with",
                slugs.map((slug) => ({ title: slug, value: slug })),
              )
            : null);
      if (workspace === null && !asking)
        return yield* outcome(
          "usage",
          `you are in ${slugs.length} workspaces: ${slugs.join(", ")}`,
          "choose one with --workspace <slug>.",
        );
      choice = workspace === null ? null : { kind: "new", workspace };
    }
    if (choice === null) {
      yield* io.say("Nothing changed.");
      return;
    }

    if (choice.kind === "bind") {
      const { match } = choice;
      const recorded =
        persisted.localCheckouts?.[`${match.workspace}/${match.project}/${match.repository}`];
      if (
        asking &&
        recorded !== undefined &&
        PeerState.realpathOrSelf(recorded) !== folder &&
        !(yield* ask.confirm(
          `${projectOf(match)}'s checkout here is ${recorded}. Use ${folder} instead?`,
          false,
        ))
      ) {
        yield* io.say("Nothing changed.");
        return;
      }
      return yield* bindTo(projectOf(match), match.repository);
    }

    const name = input.name?.trim() || NodePath.basename(folder);
    const shown = shortPath(folder, PeerState.realpathOrSelf(NodeOS.homedir()));
    if (asking) {
      if (
        !(yield* ask.confirm(
          `Connect ${shown} to ${choice.workspace} as project "${name}"? Everyone in ${choice.workspace} sees it and can clone it; the code stays in its repository.`,
          true,
        ))
      ) {
        yield* io.say("Nothing changed.");
        return;
      }
    } else if (!input.yes && !input.named)
      return yield* outcome(
        "refused",
        `nothing confirms sharing ${folder} without a terminal to ask on`,
        `name the folder (peer core share ${folder}) or add --yes.`,
      );
    const projectId = yield* register(folder, input.name);
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    yield* workspaces.shareProject({
      workspace: choice.workspace,
      projectId: ProjectId.make(projectId),
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    });
    const shared = yield* state.placeOf(folder, { bindByRemote: false });
    yield* io.say(
      shared === null
        ? `Connected ${shown} to ${choice.workspace}.`
        : `Connected ${shown} to ${choice.workspace} as project ${shared.project}.`,
    );
  });
