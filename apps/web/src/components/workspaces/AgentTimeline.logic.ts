import type { PeerAgentEntry } from "@t3tools/contracts";

export type PeerAgentTool = Extract<PeerAgentEntry, { readonly kind: "tool" }>;

export type AgentTimelineRow =
  | { readonly kind: "step"; readonly entry: PeerAgentEntry }
  | {
      readonly kind: "tools";
      readonly label: string;
      readonly tools: ReadonlyArray<PeerAgentTool>;
    };

const toolsDone = (name: string, count: number) => {
  switch (name) {
    case "Bash":
      return `Ran ${count} commands`;
    case "Read":
      return `Read ${count} files`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "Write":
      return `Made ${count} edits`;
    case "Glob":
    case "Grep":
    case "WebSearch":
      return `Ran ${count} searches`;
    default:
      return `Used ${count} tools`;
  }
};

function toolsLabel(tools: ReadonlyArray<PeerAgentTool>): string {
  const kinds = new Set(tools.map((tool) => toolsDone(tool.name, tools.length)));
  const [only] = kinds;
  const done = kinds.size === 1 && only !== undefined ? only : `Used ${tools.length} tools`;
  const failed = tools.filter((tool) => tool.failed).length;
  return failed === 0 ? done : `${done} · ${failed} failed`;
}

/** Steps as a person follows them: tools used one after another read as one row. */
export function agentTimelineRows(
  entries: ReadonlyArray<PeerAgentEntry>,
): ReadonlyArray<AgentTimelineRow> {
  const rows: AgentTimelineRow[] = [];
  let tools: PeerAgentTool[] = [];
  const flush = () => {
    const [only, ...rest] = tools;
    if (only !== undefined) {
      rows.push(
        rest.length === 0
          ? { kind: "step", entry: only }
          : { kind: "tools", label: toolsLabel(tools), tools },
      );
    }
    tools = [];
  };
  for (const entry of entries) {
    if (entry.kind === "tool") {
      tools.push(entry);
      continue;
    }
    flush();
    rows.push({ kind: "step", entry });
  }
  flush();
  return rows;
}
