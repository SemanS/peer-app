import { taskSummaries, testReportsRevision } from "@t3tools/client-runtime/peer/test-reports";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import type { PeerTaskProps } from "../slotTypes";
import { reportViews, summaryLines, type ReportView } from "./testReports.logic";

function Report({ view }: { readonly view: ReportView }) {
  return (
    <View className="gap-1.5 rounded-xl border border-border bg-card p-3">
      <AppText
        className={cn(
          "text-sm font-t3-medium",
          view.result === "pass" ? "text-foreground" : "text-warning-foreground",
        )}
      >
        {view.heading}
      </AppText>
      <AppText className="text-xs text-foreground-muted">{view.byline}</AppText>
      <AppText className="text-sm text-foreground">{view.summary}</AppText>
      <AppText className="text-xs text-foreground-muted">{view.counts}</AppText>
      {view.items.map((item) => (
        <View
          key={item.key}
          accessible
          accessibilityLabel={[item.kindLabel, item.text, item.mark, item.owner]
            .filter((part) => part !== null)
            .join(", ")}
          className="gap-0.5 border-t border-border pt-1.5"
        >
          <AppText className="text-sm text-foreground">
            <AppText className="font-t3-medium">{item.kindLabel}: </AppText>
            {item.text}
          </AppText>
          {item.mark === null ? null : (
            <AppText
              className={cn(
                "text-xs",
                item.disagrees ? "text-warning-foreground" : "text-foreground-muted",
              )}
            >
              {item.mark}
            </AppText>
          )}
          {item.owner === null ? null : (
            <AppText
              className={cn(
                "text-xs",
                item.needsOwner
                  ? "font-t3-medium text-warning-foreground"
                  : "text-foreground-muted",
              )}
            >
              {item.owner}
            </AppText>
          )}
        </View>
      ))}
      {view.shortened ? (
        <AppText className="text-xs text-foreground-muted">
          The Hub shortened this report to its limits.
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * The selected task's test reports, read-only: each author's newest report with its items, how
 * Peer marks them and who answers for what nobody verified. Reports are filed and items given
 * owners on a computer. The reports are read again whenever the status says one changed.
 */
export function ReportSection({ environmentId, status, workspace, project, task }: PeerTaskProps) {
  const [now] = useState(Date.now);
  const place = { workspace, project: project.project.id, task: task.id };
  const summaries = taskSummaries(status, place);
  const query = useEnvironmentQuery(
    summaries.length === 0
      ? null
      : serverEnvironment.peerTestsList({
          environmentId,
          input: place,
          revision: testReportsRevision(status, place),
        }),
  );
  const members = project.project.members;
  const views =
    query.data === null ? null : reportViews(query.data, { members, me: status.email, now });
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="font-t3-medium text-foreground">
        Test reports
      </AppText>
      {summaries.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          No test report on this task yet.
        </AppText>
      ) : views === null ? (
        summaryLines(summaries, members, status.email).map((line) => (
          <AppText key={line.key} className="text-sm text-foreground-muted">
            {line.text}
          </AppText>
        ))
      ) : (
        views.map((view) => <Report key={view.key} view={view} />)
      )}
      {query.error === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-destructive">
          {query.error}
        </AppText>
      )}
    </View>
  );
}
