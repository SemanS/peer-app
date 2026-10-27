import type { EnvironmentId, PeerConversationReport } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, LightbulbIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  conversationExcerpts,
  conversationTitle,
  replySummary,
} from "./conversations/conversations.logic";
import { PeerSectionLabel } from "./PeerPageHeader";
import { reportFailure } from "./workFeedback";

/** Conversations shown before "Show all". */
const SHOWN = 5;

const STATUS_LABEL: Readonly<Record<string, string>> = {
  working: "Working",
  blocked: "Waiting",
  done: "Finished",
  idle: "Idle",
};

/**
 * Recent outcomes on a status report: every conversation of the project (or the task) in the
 * agents' own words, newest first, kept current in the background. One line each; the agent's
 * reply is what it reports, not verified work. From here kontext can propose what in them the
 * project should keep.
 */
export function ConversationReport({
  report,
  place,
  onOpenThread,
}: {
  readonly report: PeerConversationReport;
  /** Where to propose knowledge from; absent where this computer cannot. */
  readonly place:
    | {
        readonly environmentId: EnvironmentId;
        readonly workspace: string;
        readonly project: string;
      }
    | undefined;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const items = all ? report.items : report.items.slice(0, SHOWN);
  const incomplete = ["partial", "unavailable", "error"].includes(report.state);
  return (
    <section
      aria-label="Recent outcomes"
      aria-busy={report.state === "updating"}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeerSectionLabel>Recent outcomes</PeerSectionLabel>
        <span className="text-xs text-muted-foreground">
          {report.total} {report.total === 1 ? "conversation" : "conversations"}
          {report.working === 0 ? "" : ` · ${report.working} working`}
          {report.waiting === 0 ? "" : ` · ${report.waiting} waiting`}
          {report.updatedAt === null
            ? ""
            : ` · updated ${formatRelativeTimeLabel(report.updatedAt)}`}
        </span>
      </div>
      {incomplete ? (
        <p role="status" className="text-xs text-warning-foreground">
          {report.error ??
            `Saved messages were read for ${report.available} of ${report.total} conversations.`}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {report.state === "updating"
            ? "Gathering conversations…"
            : "No agent conversations in this project yet."}
        </p>
      ) : (
        <ol className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((item) => {
            const summary = replySummary(item);
            return (
              <li key={item.id} className="flex min-w-0 items-start gap-3 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                    {conversationTitle(item)}
                  </span>
                  {summary === null ? null : (
                    <span className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {summary}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABEL[item.status] ?? item.status.replaceAll("_", " ")}
                    {item.archived ? " · Archived" : ""}
                    {item.updatedAt === null ? "" : ` · ${formatRelativeTimeLabel(item.updatedAt)}`}
                    {item.availability === "available" ? "" : " · Partly unavailable"}
                  </span>
                </div>
                {item.threadId === null ? null : (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Open ${conversationTitle(item)}`}
                    onClick={() => onOpenThread(item.threadId!)}
                  >
                    <ChevronRightIcon aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {report.items.length > SHOWN ? (
          <Button size="xs" variant="outline" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${report.items.length}`}
          </Button>
        ) : null}
        {place === undefined ? null : <ProposeKnowledge {...place} items={report.items} />}
        <span className="text-xs text-muted-foreground">
          Replies are the agents&apos; own reports, not verified work.
        </span>
      </div>
    </section>
  );
}

/**
 * kontext reads these conversations for decisions, conventions and lessons the project should
 * keep, and for what contradicts an entry it keeps; each proposal waits in Knowledge › Review.
 * Offered only where the project keeps knowledge with kontext's model on this computer.
 */
function ProposeKnowledge({
  environmentId,
  workspace,
  project,
  items,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly items: PeerConversationReport["items"];
}) {
  const harvest = useAtomCommand(serverEnvironment.peerHubHarvestContext, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const [reading, setReading] = useState(false);
  const knowledge = useEnvironmentQuery(
    serverEnvironment.peerHubKnowledgeStatus({ environmentId, input: { workspace, project } }),
  ).data;
  const excerpts = conversationExcerpts(items);
  if (knowledge == null || knowledge.store !== true || !knowledge.llm || excerpts === null) {
    return null;
  }

  const propose = async () => {
    setReading(true);
    const result = await harvest({
      environmentId,
      input: { workspace, project, scope: "project", conversations: excerpts.text },
    });
    setReading(false);
    if (!reportFailure("Could not read them", result) || result._tag !== "Success") return;
    const proposed = result.value.proposed;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title:
          proposed === 0
            ? "Nothing in them holds beyond the work"
            : `${proposed} ${proposed === 1 ? "proposal" : "proposals"} waiting in Knowledge › Review`,
        description: "People keep or dismiss them there; nothing is kept on its own.",
        ...(proposed === 0
          ? {}
          : {
              actionProps: {
                children: "Review",
                onClick: () =>
                  void navigate({
                    to: "/knowledge/$workspace/$project",
                    params: { workspace, project },
                  }),
              },
            }),
      }),
    );
  };

  return (
    <Button size="xs" variant="outline" disabled={reading} onClick={() => void propose()}>
      <LightbulbIcon aria-hidden className="text-peer-knowledge-foreground" />
      {reading ? "Reading…" : "Propose knowledge from them"}
    </Button>
  );
}
