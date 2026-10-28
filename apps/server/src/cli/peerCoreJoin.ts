/**
 * `peer core login` and `peer core join` as one-shot work on core's services: signing an address in
 * (the code mailed, or echoed by a development Hub, else asked for), and joining a workspace from
 * its slug or its invitation link, then saying what the invitation named and what to do next. The
 * commands in `peerCore.ts` refuse while a broker runs and provide the services; this module only
 * talks to the Hub as the signed-in person.
 *
 * @module cli/peerCoreJoin
 */
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import * as PeerWorkspaces from "../peerHub/core/workspaces/PeerWorkspaces.ts";
import { isJoinLink, parseJoinLink } from "./joinLink.ts";
import { connectEditor, EDITORS, editorTitle } from "./peerCoreEditor.ts";
import { fail, type OneShotIo } from "./peerCoreIo.ts";

/** Signs `email` in: mails a code (or finishes a sign-in waiting for `code`) and checks it. */
export const signIn = (
  input: { readonly email: string; readonly code?: string; readonly hub?: string },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    const state = yield* PeerState.PeerState;
    const email = input.email.trim();
    const { persisted } = yield* state.read;
    let code = input.code?.trim();
    // A code from an earlier `login` finishes that sign-in instead of mailing a new one, when it
    // was asked of the same Hub.
    const pending = persisted.pendingSignIn;
    const otherHub =
      input.hub !== undefined &&
      pending?.hubUrl !== undefined &&
      !sameHub(pending.hubUrl, input.hub);
    if (code === undefined || pending?.email !== email || otherHub) {
      const started = yield* workspaces.startSignIn({
        email,
        ...(input.hub === undefined ? {} : { hubUrl: input.hub }),
      });
      const echoed = started.pendingSignIn?.echoedCode;
      if (echoed !== undefined) code = echoed;
      else yield* io.say(`A sign-in code was mailed to ${email}.`);
    }
    if (code === undefined || code === "") code = yield* io.askCode;
    if (code === "") return yield* fail("peer core: no code given.");
    return yield* workspaces.finishSignIn({ code });
  });

/** `peer core login`: refuses a second sign-in, naming the way out of it. */
export const login = (
  input: { readonly email: string; readonly code?: string; readonly hub?: string },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const email = input.email.trim();
    const { persisted } = yield* state.read;
    if (persisted.email !== null)
      return yield* fail(
        persisted.email === email
          ? `peer core: already signed in as ${email}.`
          : `peer core: signed in as ${persisted.email}. Run peer core logout first, then sign in as ${email}.`,
      );
    const status = yield* signIn(input, io);
    yield* io.say(`Signed in: ${status.email ?? email} at ${status.hubUrl}`);
    yield* sayWorkspaces(status, io);
  });

const sayWorkspaces = (status: PeerHubStatus, io: OneShotIo) =>
  Effect.gen(function* () {
    for (const workspace of status.workspaces)
      yield* io.say(`Workspace: ${workspace.slug} (${workspace.name})`);
    for (const offer of status.joinable)
      yield* io.say(
        offer.reason === "invite"
          ? `Invited: ${offer.slug} (${offer.name}). Accept it with peer core join ${offer.slug}.`
          : `Joinable: ${offer.slug} (${offer.name}). Confirm it with peer core join ${offer.slug}.`,
      );
    if (status.workspaces.length === 0 && status.joinable.length === 0)
      yield* io.say("Workspace: none yet (ask for an invitation, or create one in the Peer app).");
  });

/** What an invitation named, read from `/v1/me` before joining (the offer is gone after). */
interface Invitation {
  readonly projects?: ReadonlyArray<string>;
  readonly task?: string;
}

export interface JoinInput {
  /** A workspace's slug, or its invitation link. */
  readonly target: string;
  /** The code the Hub mailed, when a link signs its address in. */
  readonly code?: string;
  /**
   * `--hub`: a link of another Hub is refused. With nobody signed in, it is how a person trusts a
   * link of a Hub other than the one this computer uses.
   */
  readonly hub?: string;
}

/**
 * `peer core join <slug|link>`. A link signs its address in when nobody is signed in, at the Hub
 * this computer uses or the one `--hub` names, and refuses, signing nobody out, when another
 * address (or the same one at another Hub) is. Returns the
 * workspace joined and the clone commands of the invited projects, for the editor step.
 */
export const join = (input: JoinInput, io: OneShotIo) =>
  Effect.gen(function* () {
    const workspaces = yield* PeerWorkspaces.PeerWorkspaces;
    const state = yield* PeerState.PeerState;
    const client = yield* PeerHubClient.PeerHubClient;
    const target = input.target.trim();
    let slug = target;
    const viaLink = isJoinLink(target);
    if (viaLink) {
      const parsed = parseJoinLink(target, input.hub);
      if (Result.isFailure(parsed)) return yield* fail(`peer core: ${parsed.failure}`);
      const link = parsed.success;
      slug = link.slug;
      const { persisted } = yield* state.read;
      if (persisted.email !== null && persisted.email.toLowerCase() !== link.email)
        return yield* fail(
          `peer core: signed in as ${persisted.email}; the invitation is for ${link.email}. Run peer core logout first, then join with the link again.`,
        );
      if (persisted.email !== null && !sameHub(client.hubUrl(persisted), link.hub))
        return yield* fail(
          `peer core: signed in to ${client.hubUrl(persisted)}; the invitation is from ${link.hub}. Run peer core logout first, then join with the link again.`,
        );
      // A link names its Hub, and anyone can send one: with nobody signed in, only the Hub this
      // computer already uses, or the one `--hub` names, may be asked for a sign-in code.
      if (persisted.email === null && input.hub === undefined) {
        const configured = client.hubUrl(persisted);
        if (!sameHub(configured, link.hub))
          return yield* fail(
            `peer core: the invitation is from the Hub at ${new URL(link.hub).host}, and this computer signs in to ${configured}. If you trust ${new URL(link.hub).host}, join with --hub ${link.hub}.`,
          );
      }
      if (persisted.email === null) {
        const status = yield* signIn(
          {
            email: link.email,
            hub: link.hub,
            ...(input.code === undefined ? {} : { code: input.code }),
          },
          io,
        );
        yield* io.say(`Signed in: ${status.email ?? link.email} at ${status.hubUrl}`);
      }
    }
    const me = yield* client.me;
    const offer = me.joinable.find((w) => w.slug === slug);
    const invitation: Invitation = {
      ...(offer?.projects === undefined ? {} : { projects: offer.projects }),
      ...(offer?.task === undefined ? {} : { task: offer.task }),
    };
    const status = yield* workspaces.joinWorkspace({ workspace: slug, confirmDomainMatch: true });
    const joined = status.workspaces.find((workspace) => workspace.slug === slug);
    if (joined === undefined)
      return yield* fail(`peer core: ${slug} did not list you after joining.`);
    yield* io.say(`Joined: ${joined.slug} (${joined.name}) as ${joined.role}.`);
    return yield* sayInvitation(slug, invitation, io);
  });

const sameHub = (a: string, b: string) =>
  a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

/**
 * The invited projects with their repositories, the task that waits (kept in `invitedTasks`), and
 * the clone commands for the next step.
 */
const sayInvitation = (slug: string, invitation: Invitation, io: OneShotIo) =>
  Effect.gen(function* () {
    const state = yield* PeerState.PeerState;
    const client = yield* PeerHubClient.PeerHubClient;
    const workspace = (yield* state.workspaces).find((w) => w.slug === slug);
    const projects = (workspace?.manifest?.projects ?? []).filter(
      (project) =>
        invitation.projects === undefined ||
        invitation.projects.length === 0 ||
        invitation.projects.includes(project.id),
    );
    const clones: string[] = [];
    for (const project of projects)
      for (const repository of project.repositories) {
        yield* io.say(`${project.id} · ${repository.url} (${repository.branch})`);
        clones.push(`git clone --branch ${repository.branch} ${repository.url}`);
      }
    if (invitation.task !== undefined) {
      const wanted = invitation.task;
      // The title is the Hub's; without an answer, the id alone still says which task waits.
      const work = yield* Effect.flatMap(client.session, ({ hubUrl, session }) =>
        client.api.work(hubUrl, session, slug),
      ).pipe(Effect.option);
      const found = projects.flatMap((project) => {
        const tasks = work._tag === "Some" ? (work.value.projects[project.id]?.tasks ?? []) : [];
        const task = tasks.find((t) => t.id === wanted || t.key === wanted);
        return task === undefined ? [] : [{ project: project.id, task }];
      })[0];
      const project =
        found?.project ?? (projects.length === 1 ? (projects[0]?.id ?? undefined) : undefined);
      yield* io.say(
        found === undefined
          ? `Waiting for you: ${wanted}`
          : `Waiting for you: ${found.task.key ?? found.task.id} · ${found.task.title}`,
      );
      const id = found?.task.id ?? wanted;
      yield* state.updatePersisted((p) => ({
        ...p,
        invitedTasks: [
          ...(p.invitedTasks ?? []).filter((t) => !(t.workspace === slug && t.task === id)),
          { workspace: slug, ...(project === undefined ? {} : { project }), task: id },
        ],
      }));
    }
    return { workspace: slug, clones };
  });

/** After joining: how to get the invited repositories here, and the editor step unless done. */
export const sayNextStep = (
  joined: { readonly workspace: string; readonly clones: ReadonlyArray<string> },
  io: OneShotIo,
  editorConnected = false,
) =>
  Effect.gen(function* () {
    for (const clone of joined.clones) yield* io.say(`Next: ${clone}`);
    if (joined.clones.length > 0)
      yield* io.say("Peer binds the clone to its project by its remote the first time it is used.");
    if (!editorConnected)
      yield* io.say(
        "Next: connect your editor: peer core hooks install (Claude Code; --codex for Codex), or peer core connect <client>.",
      );
  });

export interface EditorChoice<R = never> {
  readonly editor?: string;
  /** Whether a person answers on a terminal. */
  readonly interactive: boolean;
  /** Asks which editor to connect, the detected ones first; null for none. */
  readonly choose: (detected: ReadonlyArray<string>) => Effect.Effect<string | null, never, R>;
  readonly detected: Effect.Effect<ReadonlyArray<string>>;
  readonly stateDir: string;
}

/** `--editor` names an editor Peer can connect, or says which it can. */
export const checkEditor = (editor: string | undefined) =>
  editor === undefined || EDITORS.includes(editor)
    ? undefined
    : fail(`peer core: --editor ${editor} is not one of: ${EDITORS.join(", ")}.`);

/**
 * `peer core join … [--editor <id>]`: joins, then connects the editor named, or the one a person
 * picks on a terminal; without a terminal it connects nothing and says how to.
 */
export const joinAndConnect = <R = never>(
  input: JoinInput,
  choice: EditorChoice<R>,
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const refused = checkEditor(choice.editor);
    if (refused !== undefined) return yield* refused;
    const joined = yield* join(input, io);
    let editor = choice.editor ?? null;
    if (editor === null && choice.interactive)
      editor = yield* choice.choose(yield* choice.detected);
    yield* sayNextStep(joined, io, editor !== null);
    if (editor !== null) yield* connectEditor(editor, choice.stateDir, io);
    return { ...joined, editor };
  });

/**
 * The terminal's choices for `choose`: the editors found in this person's home, then the others
 * Peer can connect, then none.
 */
export const editorChoices = (detected: ReadonlyArray<string>) => [
  ...detected.map((id) => ({ title: editorTitle(id), value: id as string | null })),
  ...EDITORS.filter((id) => !detected.includes(id)).map((id) => ({
    title: `${editorTitle(id)} (not found here)`,
    value: id as string | null,
  })),
  { title: "None (connect one later)", value: null as string | null },
];
