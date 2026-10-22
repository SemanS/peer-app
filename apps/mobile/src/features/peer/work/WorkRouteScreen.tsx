import { LocalWork } from "../LocalWork";
import { useNavigation } from "@react-navigation/native";
import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import {
  projectCounts,
  projectScopeKey,
  type WorkProjectNode,
} from "@t3tools/client-runtime/peer/work";
import { needsYouPushId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { AppText } from "../../../components/ui/AppText";
import { NeedsYouRequestSheet } from "../needs-you/NeedsYouRequestSheet";
import { NeedsYouScreen } from "../needs-you/NeedsYouScreen";
import { OwnerCallSheet } from "../ownership/OwnerCallSheet";
import { PEER_MOBILE_PLUGINS } from "../slots";
import { selectPeerPlugins } from "../slots.logic";
import { projectSignals } from "./signals";
import { useWork } from "./useWork";
import { workEmptyText, workGroups, workNotices, type WorkCardAction } from "./work.logic";
import {
  WorkProjectCard,
  WorkProjectCards,
  WorkScopePills,
  WorkSignalRows,
  type WorkProjectSummary,
} from "./WorkProjectCards";
import { WorkThreadGroups } from "./WorkThreadGroups";

/**
 * Work on the phone: the team's projects over every computer it knows, as web's Work views show
 * them. With all projects it lists them as cards with their counts and signals; with one, that
 * project's signals and its threads by state. Pages the phone does not have say to open them on
 * web or desktop.
 */
export function WorkRouteScreen() {
  const work = useWork();
  const navigation = useNavigation();
  const [request, setRequest] = useState<Extract<NeedsYouItem, { kind: "request" }> | null>(null);
  // The call being decided, by its key: the sheet reads it from Needs you as it is now, and closes
  // itself once the call is decided elsewhere and no longer waits.
  const [ownerCallKey, setOwnerCallKey] = useState<string | null>(null);
  const statusOf = useCallback(
    (project: WorkProjectNode) => {
      const source = work.sources.get(projectScopeKey(project));
      return (
        work.environments.find((environment) => environment.environmentId === source)?.status ??
        null
      );
    },
    [work.environments, work.sources],
  );
  const summaries = useMemo(
    () =>
      work.tree.map((project): WorkProjectSummary => {
        const status = statusOf(project);
        return {
          project,
          counts: projectCounts(project, false, work.needs),
          signals:
            status === null
              ? []
              : projectSignals(status, project, selectPeerPlugins(PEER_MOBILE_PLUGINS, status)),
        };
      }),
    [statusOf, work.needs, work.tree],
  );
  const act = useCallback(
    (action: WorkCardAction) => {
      switch (action.kind) {
        case "thread":
          navigation.navigate("Thread", {
            environmentId: String(action.environmentId),
            threadId: String(action.threadId),
          });
          return;
        case "agent":
          navigation.navigate("NeedsYouAgent", {
            environmentId: String(action.environmentId),
            agentId: action.agentId,
          });
          return;
        case "request":
          setRequest(action.item);
          return;
        case "owner-call":
          setOwnerCallKey(action.item.key);
          return;
        case "overlap": {
          const focus = needsYouPushId(action.item.key);
          navigation.navigate("NeedsYou", focus === null ? {} : { focus });
          return;
        }
        case "unavailable":
          return;
      }
    },
    [navigation],
  );
  const ownerCall =
    ownerCallKey === null ? undefined : work.needs.find((need) => need.key === ownerCallKey);
  const current = summaries.find((summary) => projectScopeKey(summary.project) === work.scope);
  const empty = workEmptyText(work.environments, work.tree);
  const showWorkspace = new Set(work.tree.map((project) => project.workspace)).size > 1;
  return (
    <NeedsYouScreen title="Work">
      {work.environments.map((environment) =>
        environment.status?.coordination.local === undefined ? null : (
          <LocalWork key={String(environment.environmentId)} status={environment.status} />
        ),
      )}
      {workNotices(work.environments).map((notice) => (
        <AppText key={notice} accessibilityRole="alert" className="text-sm text-foreground-muted">
          {notice}
        </AppText>
      ))}
      {empty !== null ? (
        <AppText accessibilityLiveRegion="polite" className="text-foreground-muted">
          {empty}
        </AppText>
      ) : (
        <>
          <WorkScopePills tree={work.tree} scope={work.scope} onChange={work.setScope} />
          {current === undefined ? (
            <WorkProjectCards
              summaries={summaries}
              showWorkspace={showWorkspace}
              onOpen={work.setScope}
            />
          ) : (
            <>
              <WorkProjectCard summary={current} showWorkspace={showWorkspace} />
              <WorkSignalRows signals={current.signals} />
              <WorkThreadGroups
                groups={workGroups(work.tree, current.project, work.needs)}
                status={statusOf(current.project)}
                hosts={work.hosts}
                environments={work.environments}
                onAction={act}
              />
              <AppText className="text-sm text-foreground-muted">
                Task context, overlap, review and knowledge pages open on web or desktop.
              </AppText>
            </>
          )}
        </>
      )}
      {request === null ? null : (
        <NeedsYouRequestSheet key={request.key} item={request} onClose={() => setRequest(null)} />
      )}
      {ownerCall?.kind !== "owner-call" ? null : (
        <OwnerCallSheet
          key={ownerCall.key}
          item={ownerCall}
          environments={work.environments}
          onClose={() => setOwnerCallKey(null)}
        />
      )}
    </NeedsYouScreen>
  );
}
