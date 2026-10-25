import { openSpecGoal } from "@t3tools/client-runtime/peer/openspec";
import type { PeerOpenSpecReadResult } from "@t3tools/contracts";

import ChatMarkdown from "../../ChatMarkdown";
import { remarkChecklistPreview } from "./checklistMarkdown";

const CHECKLIST_PLUGINS = [remarkChecklistPreview];

export function OpenSpecBrief({
  source,
}: {
  readonly source: Extract<PeerOpenSpecReadResult, { state: "ready" }>;
}) {
  return (
    <div className="flex min-w-0 max-w-prose flex-col gap-6">
      <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
        {openSpecGoal(source.proposal)}
      </p>
      <section aria-label="Checklist" className="flex min-w-0 flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Checklist · {source.completed}/{source.total} complete
        </h3>
        <ChatMarkdown text={source.tasks} cwd={undefined} extraRemarkPlugins={CHECKLIST_PLUGINS} />
      </section>
      <div className="flex min-w-0 flex-col divide-y divide-border/60 border-y border-border/60">
        <details className="min-w-0 py-3">
          <summary className="min-h-8 cursor-pointer rounded-sm py-1 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            Full proposal
          </summary>
          <div className="flex min-w-0 flex-col gap-3 pt-4">
            <p className="break-all font-mono text-xs text-muted-foreground">{source.sourcePath}</p>
            <ChatMarkdown text={source.proposal} cwd={undefined} />
          </div>
        </details>
        <details className="min-w-0 py-3">
          <summary className="min-h-8 cursor-pointer rounded-sm py-1 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            Full checklist and validation
          </summary>
          <div className="min-w-0 pt-4">
            <ChatMarkdown text={source.tasks} cwd={undefined} />
          </div>
        </details>
        {source.design === null ? null : (
          <details className="min-w-0 py-3">
            <summary className="min-h-8 cursor-pointer rounded-sm py-1 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              Technical design
            </summary>
            <div className="min-w-0 pt-4">
              <ChatMarkdown text={source.design} cwd={undefined} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
