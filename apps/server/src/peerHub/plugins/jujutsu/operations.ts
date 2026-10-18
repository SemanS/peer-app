/**
 * What a person does from the app in a Jujutsu repository on this computer (design D7, D12): read
 * the operation log, undo one step, see the repository as it was, merge a change's two versions, and
 * make the change two sides integrate on. No `peer` command reaches any of it. The jj calls are in
 * `client/operations.ts`.
 *
 * @module peerHub/plugins/jujutsu/operations
 */
import {
  PeerHubError,
  type JujutsuConvergeInput,
  type JujutsuIntegrateInput,
  type JujutsuOperationInput,
  type JujutsuPlace,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { personName } from "./config.ts";
import { makeOperations, previewOf } from "./client/operations.ts";
import type { Places } from "./places.ts";
import { undoneNotice } from "./text.ts";

const fail = (detail: string) => Effect.fail(new PeerHubError({ detail }));
const UNREAD = "jj did not answer. Try again in a moment.";

export const makeOperationsApi = (deps: Places) => {
  const ops = makeOperations(deps.jj);
  /** Told once at the session's next step: the steps of its workspace a person undid. */
  const pending = new Map<string, Array<string>>();

  /** The project's checkout on this computer, when it is a Jujutsu repository. */
  const checkout = (place: JujutsuPlace) =>
    Effect.gen(function* () {
      const { project } = yield* deps.state.project(place.workspace, place.project);
      const persisted = (yield* deps.state.read).persisted;
      for (const { id } of project.repositories) {
        const found = yield* deps.placeOf(
          deps.state.checkoutPath(persisted, place.workspace, place.project, id),
        );
        if (found !== null) return found;
      }
      return yield* fail("This project's checkout on this computer is not a Jujutsu repository.");
    });

  const previewing = (input: JujutsuOperationInput) =>
    Effect.gen(function* () {
      const found = yield* checkout(input);
      const listed = yield* ops.list(found.repo, found.root);
      const preview = listed && previewOf(listed, input.operation);
      if (!preview)
        return yield* fail(listed ? "That step is no longer among the newest 50." : UNREAD);
      return { found, preview };
    });

  /** Tells the sessions that work in the workspace a step came from, at their next step. */
  const tell = (
    input: JujutsuOperationInput,
    repo: string,
    cwd: string,
    step: { workspace?: string | undefined; description: string },
    files: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const name = step.workspace?.replace(/@$/, "");
      const root = name ? yield* ops.rootOf(repo, cwd, name) : null;
      const email = yield* deps.state.email;
      const by = email ? deps.state.nameOf(input.workspace, email) : "A person";
      for (const session of root ? yield* deps.agents.sessions : []) {
        if (session.cwd !== root && !session.cwd.startsWith(`${root}/`)) continue;
        const text = undoneNotice({ by, description: step.description, files });
        pending.set(session.id, [...(pending.get(session.id) ?? []), text]);
        yield* deps.log("jujutsu.told", {
          session: session.id,
          kind: "undone",
          chars: text.length,
        });
      }
    });

  return {
    /** The notices queued for a session, taken: said once. */
    undone: (session: string) => {
      const texts = pending.get(session) ?? [];
      pending.delete(session);
      return texts;
    },
    api: {
      operations: (place: JujutsuPlace) =>
        Effect.gen(function* () {
          const found = yield* checkout(place);
          const listed = yield* ops.list(found.repo, found.root);
          if (listed === null) return yield* fail(UNREAD);
          return {
            operations: listed.operations,
            ...(listed.unread ? { changedUnread: true } : {}),
          };
        }),
      previewUndo: (input: JujutsuOperationInput) =>
        previewing(input).pipe(Effect.map(({ preview }) => preview)),
      undo: (input: JujutsuOperationInput) =>
        Effect.gen(function* () {
          const { found, preview } = yield* previewing(input);
          const step = preview.operation;
          const email = yield* deps.state.email;
          const done = yield* ops.undo(
            found.repo,
            found.root,
            step.id,
            preview.shared,
            step.changed,
            email ? personName(email) : "peer",
          );
          const outcome = !done.ok ? "refused" : done.needsPerson.length > 0 ? "conflict" : "done";
          yield* deps.log("jujutsu.undo", { operations: 1, outcome });
          if (!done.ok) return yield* fail(done.error);
          yield* tell(input, found.repo, found.root, step, done.files);
          return {
            reverted: step.id,
            ran: done.ran,
            converged: done.converged,
            needsPerson: done.needsPerson,
          };
        }),
      atOp: (input: JujutsuOperationInput) =>
        Effect.gen(function* () {
          const found = yield* checkout(input);
          const rows = yield* ops.at(found.repo, found.root, input.operation);
          if (rows === null) return yield* fail("jj could not read the repository at that step.");
          return { operation: input.operation, rows: rows.slice(0, 100) };
        }),
      /** In the workspace that holds the change, so a working copy it holds is updated by jj there. */
      converge: (input: JujutsuConvergeInput) =>
        Effect.gen(function* () {
          const found = yield* checkout(input);
          const holder = Object.entries((yield* deps.read).workspaces).find(
            ([, one]) =>
              one.repo === found.repo &&
              one.mine.some((id) => id.startsWith(input.change) || input.change.startsWith(id)),
          );
          return {
            resolved: yield* ops.converge(found.repo, holder?.[0] ?? found.root, input.change),
          };
        }),
      integrate: (input: JujutsuIntegrateInput) =>
        Effect.gen(function* () {
          const found = yield* checkout(input);
          const keys = yield* Effect.forEach([input.a, input.b], (side) =>
            deps
              .taskKey(input.workspace, input.project, side.task)
              .pipe(Effect.map((key) => key ?? side.task)),
          );
          const made = yield* ops.integrate(found.repo, found.root, {
            revs: [input.a.rev, input.b.rev],
            keys,
          });
          if (!made.ok) return yield* fail(made.error);
          return {
            change: made.change,
            bookmark: made.bookmark,
            task: (input.later === "a" ? input.a : input.b).task,
          };
        }),
    },
  };
};
