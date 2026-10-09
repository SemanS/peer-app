import type { PeerLocalAgent } from "@t3tools/contracts";
import type { PeerSessionView } from "../plugin.ts";

/** Hook sessions observe their own edits; advisory sessions retain the runtime's after-work paths. */
export function mergeMcpObservations<
  S extends { readonly id: string; readonly files: ReadonlyArray<string> },
>(
  reported: ReadonlyArray<S>,
  live: ReadonlyArray<Pick<PeerSessionView, "id" | "adapter" | "pane">>,
  agents: ReadonlyArray<Pick<PeerLocalAgent, "id" | "paneId" | "postHocPaths">>,
): ReadonlyArray<S> {
  const advisory = new Map(
    live.filter((session) => session.adapter === "mcp").map((session) => [session.id, session]),
  );
  const aliases = new Set(
    [...advisory.values()].flatMap((session) => {
      const agent = agents.find(
        (agent) => session.pane !== undefined && agent.paneId === session.pane,
      );
      const id = agent?.id.replace(/^herdr:/, "");
      return id === undefined || id === session.id ? [] : [id];
    }),
  );
  return reported
    .filter((report) => !aliases.has(report.id))
    .map((report) => {
      const session = advisory.get(report.id);
      if (session === undefined) return report;
      const agent = agents.find(
        (agent) =>
          agent.id === `herdr:${report.id}` ||
          (session.pane !== undefined && agent.paneId === session.pane),
      );
      if (agent?.postHocPaths === undefined) return report;
      return {
        ...report,
        files: [...new Set([...report.files, ...agent.postHocPaths])].slice(0, 200),
      };
    });
}
