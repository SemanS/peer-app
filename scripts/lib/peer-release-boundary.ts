/** The app is distributable independently. The private Hub and workspace data are separate inputs. */
export function assertPeerLocalSourcePaths(files: readonly string[]): void {
  const privateRoots = ["server/", "deploy/", "nix/", "workspaces/", ".ai/"];
  const forbidden = files.filter((file) => {
    const path = file.replaceAll("\\", "/").replace(/^\.\//, "");
    return (
      privateRoots.some((root) => path.startsWith(root)) ||
      path.split("/").includes("PRIVATE-HUB.md") ||
      path === ".env" ||
      path.startsWith(".env.local") ||
      /(^|\/)peerhub\.(?:key|env)$/.test(path)
    );
  });
  if (forbidden.length > 0)
    throw new Error(
      `Peer Local release contains private Hub or operator files:\n${forbidden.join("\n")}`,
    );
}
