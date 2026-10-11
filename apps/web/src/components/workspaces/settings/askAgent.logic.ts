/**
 * What "Ask an agent to change this…" starts a thread with, apart from how it draws: the prompt
 * (design A7) and the checkout the thread is made in. The agent reads the settings with
 * `peer config show` and can only propose a change (`peer config propose`); an owner reviews it.
 */
import type { PeerProjectState, ProjectId } from "@t3tools/contracts";

/** What the request is about: one project, or the workspace's own settings. */
export type AskScope =
  | { readonly kind: "project"; readonly id: string; readonly name: string }
  | { readonly kind: "workspace" };

/**
 * The prompt that fills a new thread's composer: the person's words, where they apply, and how an
 * agent changes settings (read, edit one file, propose; never save). The person sends it.
 */
export function askPrompt(input: {
  readonly workspace: { readonly slug: string; readonly name: string };
  readonly scope: AskScope;
  readonly text: string;
}): string {
  const { workspace, scope } = input;
  // A sentence of the person's own ends the instruction; the template adds the full stop.
  const instruction = input.text.trim().replace(/[.\s]+$/, "");
  const where = scope.kind === "project" ? scope.name : "the whole workspace";
  const show =
    scope.kind === "project"
      ? `peer config show --project ${scope.id} --workspace ${workspace.slug}`
      : `peer config show --all --workspace ${workspace.slug}`;
  return [
    `Change Peer settings for ${where} in ${workspace.name}: ${instruction}.`,
    `Read them with \`${show}\`, edit only what this needs, and propose it with`,
    '`peer config propose --file <file> --why "<one line>"`.',
    "You cannot save settings; an owner reviews the proposal.",
  ].join(" ");
}

/** The T3 project a workspace project is opened as on this computer, once one of its repositories is ready. */
function localProject(state: PeerProjectState | undefined): ProjectId | undefined {
  return state?.repositories.find(
    (repository) => repository.projectId !== undefined && repository.state === "ready",
  )?.projectId;
}

/**
 * Where the thread starts: the project's own checkout here, else any checkout of the workspace's
 * projects (the agent reads the settings through the workspace, whichever project it runs in), else
 * nowhere, and the input says to clone a project first.
 */
export function askCheckout(
  projects: ReadonlyArray<PeerProjectState>,
  projectId: string | undefined,
): { readonly projectId: ProjectId; readonly name: string } | null {
  const own = projects.find((state) => state.project.id === projectId);
  for (const state of [...(own === undefined ? [] : [own]), ...projects]) {
    const local = localProject(state);
    if (local !== undefined) return { projectId: local, name: state.project.name };
  }
  return null;
}
