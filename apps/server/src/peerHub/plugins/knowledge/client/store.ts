/** Reads the configured project store through kontext, including alternate storage locations and ADR styles. */
import { PeerHubError, type PeerKnowledgeStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as PeerState from "../../../core/state/PeerState.ts";
import { safeId, type PersistedState } from "../../../core/state/PeerState.ts";
import { checkoutState } from "../../../core/vcs.ts";
import {
  engineStatus,
  asKnowledge,
  kontextApi,
  isKnowledgeIdentity,
  runKontext,
  type KontextClientShape,
  type KontextEntry,
} from "../../../kontext.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";

const local: KontextClientShape = { run: runKontext };

export async function readKnowledge(
  root: string,
  client: KontextClientShape = local,
): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];
  let offset = 0;
  let snapshot: string | undefined;
  do {
    const page = await kontextApi<{
      entries: KontextEntry[];
      next_offset: number | null;
      snapshot?: string;
    }>(client, root, "entries.list", { active_only: true, limit: 200, offset });
    if (snapshot !== undefined && page.snapshot !== undefined && snapshot !== page.snapshot)
      throw new Error(
        "Project knowledge changed while its index was being read; retaining the last complete index",
      );
    snapshot = page.snapshot;
    entries.push(...page.entries.filter((entry) => isKnowledgeIdentity(entry.id)).map(asKnowledge));
    if (page.next_offset === null || page.next_offset === undefined || page.next_offset <= offset)
      break;
    offset = page.next_offset;
  } while (offset < 400 && entries.length < 400);
  return entries.slice(0, 400);
}

export async function projectGuidance(
  root: string,
  client: KontextClientShape = local,
): Promise<{ readonly id: string; readonly text: string } | null> {
  const page = await kontextApi<{ entries: KontextEntry[] }>(client, root, "entries.list", {
    active_only: true,
    kinds: ["convention"],
    tags: ["peer-skill"],
    limit: 400,
  });
  const best = page.entries
    .filter((entry) => isKnowledgeIdentity(entry.id))
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id))[0];
  return best === undefined ? null : { id: best.id, text: asKnowledge(best).body.slice(0, 1500) };
}

const hubError = (detail: string) => new PeerHubError({ detail });

/** A project's checkouts here and the one that keeps its knowledge, with kontext in it. */
export function storesOn<K>(
  state: PeerState.PeerState["Service"],
  kontext: KontextClientShape,
  knowledgeLlm: boolean,
  /** What acts on the checkout with kontext (`kontextIn`). */
  kontextIn: (client: KontextClientShape, checkout: string) => K,
) {
  /** A workspace project's checkouts on this computer, the one that keeps kontext knowledge first. */
  const checkoutsOf = async (persisted: PersistedState, workspace: string, projectId: string) => {
    const project = persisted.workspaces
      .find((candidate) => candidate.slug === workspace)
      ?.manifest?.projects.find((candidate) => candidate.id === projectId);
    const paths = (project?.repositories ?? [])
      .filter((repo) => safeId(repo.id))
      .map((repo) => state.checkoutPath(persisted, workspace, projectId, repo.id));
    const states = await Promise.all(paths.map((path) => checkoutState(path)));
    return paths.filter((_, index) => states[index]?.state === "ready");
  };

  const statusOf = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const persisted = (yield* state.read).persisted;
      const checkouts = yield* Effect.promise(() => checkoutsOf(persisted, workspace, projectId));
      const states = yield* Effect.promise(() =>
        Promise.all(
          checkouts.map(async (checkout) => ({
            checkout,
            engine: await engineStatus(kontext, checkout).catch(() => null),
          })),
        ),
      );
      const selected = states.find(({ engine }) => engine?.store.configured) ?? states[0];
      const checkout = selected?.checkout;
      const installed = selected?.engine !== null && selected?.engine !== undefined;
      const store = selected?.engine?.store.configured === true;
      const guided =
        checkout !== undefined && store
          ? yield* Effect.promise(() => projectGuidance(checkout, kontext).catch(() => null))
          : null;
      return {
        checkout: checkout ?? null,
        store,
        kontext: installed,
        llm: selected?.engine?.llm.available === true && knowledgeLlm,
        guidance: guided?.text ?? null,
      } satisfies PeerKnowledgeStatus;
    });

  /** The project's checkout here and kontext in it, or why there is none. */
  const checkoutOf = (workspace: string, projectId: string) =>
    Effect.gen(function* () {
      const here = yield* statusOf(workspace, projectId);
      if (here.checkout === null) {
        return yield* hubError("This project is not on this computer: clone it first.");
      }
      if (!here.kontext) {
        return yield* hubError(
          "A compatible kontext machine API v1 is required here. Install kontext (semans.github.io/kontext) or set KONTEXT_BIN.",
        );
      }
      return { ...here, checkout: here.checkout, kontext: kontextIn(kontext, here.checkout) };
    });

  /** The checkout keeping the project's knowledge here, or why there is none. */
  const storeOf = (workspace: string, projectId: string) =>
    Effect.flatMap(checkoutOf(workspace, projectId), (here) =>
      here.store
        ? Effect.succeed(here)
        : Effect.fail(
            hubError(
              `This project keeps no knowledge yet: set it up (kontext init in ${here.checkout}).`,
            ),
          ),
    );

  return { statusOf, checkoutOf, storeOf };
}
