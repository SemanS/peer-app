// @effect-diagnostics globalDate:off - the folder probes retry on the wall clock, outside any Effect.
/**
 * The local coordination's projects for the status: the app's open folders that are repositories,
 * each named by its repository identity. Git never delays the status: identities are probed in the
 * background and kept until a folder closes.
 *
 * @module peerHub/core/localCoordination/localProjects
 */
import * as Effect from "effect/Effect";

import type * as ProjectService from "../../../project/ProjectService.ts";
import { coordinationRepository, localCoordinationProjectId } from "./localPlace.ts";

/** The status's local projects, read through a cache that lives as long as the returned effect. */
export function localProjectsOf(projects: ProjectService.ProjectService["Service"]) {
  // Repository names enrich status, but Git must never delay the Hub or broker snapshot.
  // Keep successful identities until a root closes; retry failed probes at most once a minute.
  type LocalRepository = Awaited<ReturnType<typeof coordinationRepository>>;
  interface LocalRepositoryEntry {
    value: LocalRepository;
    pending: boolean;
    retryAfter: number;
  }
  const localRepositoryCache = new Map<string, LocalRepositoryEntry>();
  return projects.listShells().pipe(
    Effect.map((opened) => {
      const now = Date.now();
      const roots = new Set(opened.map((project) => project.workspaceRoot));
      for (const root of localRepositoryCache.keys()) {
        if (!roots.has(root)) localRepositoryCache.delete(root);
      }
      return opened.flatMap((project) => {
        const root = project.workspaceRoot;
        let entry = localRepositoryCache.get(root);
        if (
          entry === undefined ||
          (!entry.pending && entry.value === null && entry.retryAfter <= now)
        ) {
          entry = { value: null, pending: true, retryAfter: 0 };
          localRepositoryCache.set(root, entry);
          const probeEntry = entry;
          void coordinationRepository(root).then(
            (repo) => {
              if (localRepositoryCache.get(root) !== probeEntry) return;
              probeEntry.value = repo;
              probeEntry.pending = false;
              probeEntry.retryAfter = Date.now() + 60_000;
            },
            () => {
              if (localRepositoryCache.get(root) !== probeEntry) return;
              probeEntry.pending = false;
              probeEntry.retryAfter = Date.now() + 60_000;
            },
          );
        }
        const repo = entry.value;
        return repo === null
          ? []
          : [
              {
                id: localCoordinationProjectId(repo.identity),
                projectId: project.id,
                name: project.title,
              },
            ];
      });
    }),
    Effect.orElseSucceed(() => []),
  );
}
