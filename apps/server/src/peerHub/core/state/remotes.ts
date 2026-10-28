/**
 * Repository URLs compared across the forms Git accepts: `https://host/owner/repo.git`,
 * `ssh://git@host[:port]/owner/repo`, `git@host:owner/repo.git`. Peer Core binds a fresh clone to
 * the project whose repository it is by comparing its `origin` this way.
 *
 * @module peerHub/core/state/remotes
 */

/**
 * `host/path`, the host in lower case, without user, port, scheme, trailing slashes or `.git`;
 * a local path stays a path. Null for text that is no repository address.
 */
export function normalizeRemote(url: string): string | null {
  const text = url.trim();
  if (text === "") return null;
  const tidy = (host: string, path: string) => {
    const cleaned = path
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
    return host === "" || cleaned === "" ? null : `${host.toLowerCase()}/${cleaned}`;
  };
  const file = /^file:\/\/[^/]*(\/.*)$/i.exec(text);
  if (file !== null) return tidy("file", file[1]!);
  // scheme://[user@]host[:port]/path
  const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::\d*)?(\/.*)?$/i.exec(text);
  if (withScheme !== null) return tidy(withScheme[2]!, withScheme[3] ?? "");
  // scp-like: [user@]host:path (not a Windows drive letter)
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(text);
  if (scp !== null && scp[1]!.length > 1) return tidy(scp[1]!, scp[2]!);
  // A local path.
  if (text.startsWith("/")) return tidy("file", text);
  return null;
}

/** What `matchRepositories` reads of a manifest. */
export interface RepositoryManifest {
  readonly workspace: { readonly slug: string };
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly repositories: ReadonlyArray<{ readonly id: string; readonly url: string }>;
  }>;
}

export interface RepositoryMatch {
  readonly workspace: string;
  readonly project: string;
  readonly repository: string;
}

/** Every repository of the manifests' projects whose URL is `remote`, once each. */
export function matchRepositories(
  remote: string,
  manifests: ReadonlyArray<RepositoryManifest | null | undefined>,
): ReadonlyArray<RepositoryMatch> {
  const wanted = normalizeRemote(remote);
  if (wanted === null) return [];
  const matches: RepositoryMatch[] = [];
  for (const manifest of manifests) {
    if (manifest === null || manifest === undefined) continue;
    for (const project of manifest.projects)
      for (const repository of project.repositories)
        if (normalizeRemote(repository.url) === wanted)
          matches.push({
            workspace: manifest.workspace.slug,
            project: project.id,
            repository: repository.id,
          });
  }
  return matches;
}
