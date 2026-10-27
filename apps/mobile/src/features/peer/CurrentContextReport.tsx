import {
  contextEvidence,
  currentContextSections,
  contextViewRevision,
} from "@t3tools/client-runtime/peer/contextView";
import type { EnvironmentId, PeerConversationReport, PeerHubStatus } from "@t3tools/contracts";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { AppState, Pressable, TextInput, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

function ContextAction({
  text,
  onPress,
  disabled = false,
}: {
  readonly text: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 justify-center py-2"
    >
      <AppText className="text-primary">{text}</AppText>
    </Pressable>
  );
}

function ClaimDetail({ detail }: { readonly detail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ContextAction text={open ? "Hide details" : "Show details"} onPress={() => setOpen(!open)} />
      {open ? <AppText className="text-sm text-foreground-muted">{detail}</AppText> : null}
    </>
  );
}

function ConversationReport({
  report,
  environmentId,
  onFirstPage,
  onNextPage,
  hasPreviousPage,
}: {
  readonly report: PeerConversationReport;
  readonly environmentId: EnvironmentId;
  readonly onFirstPage: () => void;
  readonly onNextPage: (cursor: string) => void;
  readonly hasPreviousPage: boolean;
}) {
  const navigation = useNavigation();
  const stateLabel = {
    updating: "Updating in the background…",
    current: "Up to date",
    partial: "Some conversation text is unavailable",
    unavailable: "Conversation text is unavailable",
    error: "Report could not be updated",
  }[report.state];
  return (
    <View className="gap-3 border-b border-border pb-4">
      <AppText className="font-semibold text-foreground">Automatic conversation report</AppText>
      <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
        {stateLabel}
      </AppText>
      <AppText className="text-sm text-foreground-muted">
        Saved messages read for {report.available} of {report.total} conversations ·{" "}
        {report.working} agents working · {report.waiting} waiting
      </AppText>
      <AppText className="text-xs text-foreground-muted">
        Latest requests and responses, including archived conversations. These excerpts do not
        verify that the work is complete.
      </AppText>
      <AppText className="text-xs text-foreground-muted">
        {report.updatedAt === null ? "No report update yet" : `Report updated ${report.updatedAt}`}
      </AppText>
      {report.error === null ? null : (
        <AppText accessibilityRole="alert" className="text-sm text-foreground">
          {report.error}
        </AppText>
      )}
      {report.total === 0 && report.state === "current" ? (
        <AppText className="text-sm text-foreground-muted">No conversations in this scope.</AppText>
      ) : null}
      {report.items.map((item) => (
        <View key={item.id} className="gap-2 border-t border-border pt-3">
          <AppText className="font-semibold text-foreground">
            {item.title || "Untitled conversation"}
          </AppText>
          <AppText className="text-xs text-foreground-muted">
            Agent state: {item.status === "done" ? "turn finished" : item.status}
            {item.archived ? " · archived" : ""}
            {item.availability === "unavailable"
              ? " · message count unknown"
              : ` · ${item.messages} messages available`}
          </AppText>
          {item.availability === "available" ? null : (
            <AppText className="text-sm text-foreground-muted">
              {item.availability === "partial"
                ? "Only part of this conversation is readable. The excerpts may be incomplete."
                : "Conversation text is unavailable in this environment."}
            </AppText>
          )}
          {item.request === null ? null : (
            <View className="gap-1">
              <AppText className="text-xs font-semibold text-foreground-muted">
                Latest request
              </AppText>
              <AppText className="text-sm text-foreground">{item.request}</AppText>
            </View>
          )}
          {item.response === null ? null : (
            <View className="gap-1">
              <AppText className="text-xs font-semibold text-foreground-muted">
                Latest agent response
              </AppText>
              <AppText className="text-sm text-foreground">{item.response}</AppText>
              {item.responseAt === null ? null : (
                <AppText className="text-xs text-foreground-muted">{item.responseAt}</AppText>
              )}
            </View>
          )}
          {item.availability === "available" && item.request === null && item.response === null ? (
            <AppText className="text-sm text-foreground-muted">No recorded messages yet.</AppText>
          ) : null}
          {item.truncated ? (
            <AppText className="text-xs text-foreground-muted">
              Excerpts shortened. Open the conversation for the complete messages.
            </AppText>
          ) : null}
          {item.threadId === null ? null : (
            <ContextAction
              text="Open conversation"
              onPress={() =>
                navigation.navigate("Thread", {
                  environmentId: String(environmentId),
                  threadId: item.threadId!,
                })
              }
            />
          )}
        </View>
      ))}
      <AppText className="text-xs text-foreground-muted">
        {report.items.length} of {report.coverage.total} conversations shown
      </AppText>
      {hasPreviousPage ? <ContextAction text="First conversations" onPress={onFirstPage} /> : null}
      {report.coverage.nextCursor === null ? null : (
        <ContextAction
          text={`More conversations · ${report.coverage.omittedCount}`}
          onPress={() => onNextPage(report.coverage.nextCursor!)}
        />
      )}
    </View>
  );
}

function CurrentContextReportContent({
  environmentId,
  workspace,
  project,
  scope = "project-aggregate",
  revision,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly scope?: string;
  readonly revision: string;
  readonly status: PeerHubStatus | null;
}) {
  const [selection, setSelection] = useState({
    scope,
    identity: `${environmentId}:${workspace}:${project}:${scope}`,
  });
  const identity = `${environmentId}:${workspace}:${project}:${scope}`;
  const selectedScope = selection.identity === identity ? selection.scope : scope;
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (value) =>
      setActive(value === "active"),
    );
    return () => subscription.remove();
  }, []);
  const visible = focused && active;
  const [sourceRevision, setSourceRevision] = useState<number | undefined>();
  const [inputCursor, setInputCursor] = useState<string | undefined>();
  const [findingCursor, setFindingCursor] = useState<string | undefined>();
  const [conversationCursor, setConversationCursor] = useState<string | undefined>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCursor, setArchiveCursor] = useState<string | undefined>();
  const [topic, setTopic] = useState("");
  const [history, setHistory] = useState(false);
  const openSource = (scope: string, revision?: string) => {
    setSourceRevision(
      revision !== undefined && Number.isSafeInteger(Number(revision)) && Number(revision) > 0
        ? Number(revision)
        : undefined,
    );
    setSelection({ scope, identity });
    setInputCursor(undefined);
    setFindingCursor(undefined);
    setConversationCursor(undefined);
  };
  const read = useEnvironmentQuery(
    serverEnvironment.peerHubContextView({
      environmentId,
      input: {
        workspace,
        project,
        scope: selectedScope,
        revision: status === null ? revision : contextViewRevision(status, workspace, project),
        ...(inputCursor === undefined ? {} : { inputCursor }),
        ...(findingCursor === undefined ? {} : { findingCursor }),
        ...(conversationCursor === undefined ? {} : { conversationCursor }),
      },
    }),
  );
  useEffect(() => {
    if (visible) read.refresh();
  }, [visible, read.refresh]);
  useEffect(() => {
    if (!visible || read.isPending) return;
    const timer = setTimeout(
      read.refresh,
      read.data?.conversations?.state === "updating" ? 2_000 : 15_000,
    );
    return () => clearTimeout(timer);
  }, [visible, read.isPending, read.refresh, read.data?.conversations?.state]);
  const historical = useEnvironmentQuery(
    sourceRevision === undefined
      ? null
      : serverEnvironment.peerHubReadContextVersion({
          environmentId,
          input: { workspace, project, scope: selectedScope, version: sourceRevision },
        }),
  );
  const archive = useEnvironmentQuery(
    !archiveOpen
      ? null
      : serverEnvironment.peerHubContextArchive({
          environmentId,
          input: {
            workspace,
            project,
            revision: status === null ? revision : contextViewRevision(status, workspace, project),
            history,
            topic,
            limit: 20,
            ...(archiveCursor === undefined ? {} : { cursor: archiveCursor }),
          },
        }),
  );
  const view = read.data;
  return (
    <View className="gap-3">
      <ContextAction
        text={read.isPending ? "Checking for updates…" : "Check for updates"}
        disabled={read.isPending}
        onPress={() => {
          read.refresh();
          if (archiveOpen) archive.refresh();
        }}
      />
      {selectedScope === "project-aggregate" ? null : (
        <ContextAction text="Project overview" onPress={() => openSource("project-aggregate")} />
      )}
      {sourceRevision === undefined ? null : (
        <View className="gap-2">
          <AppText className="font-semibold text-foreground">
            Source v{sourceRevision} · historical snapshot
          </AppText>
          <AppText className="text-foreground">
            {historical.data?.text ??
              historical.error ??
              (historical.isPending
                ? "Loading exact source revision…"
                : "This source revision is unavailable; an exact comparison is not possible.")}
          </AppText>
          <ContextAction text="Current report" onPress={() => setSourceRevision(undefined)} />
        </View>
      )}
      {read.error === null ? null : (
        <View className="gap-1">
          <AppText accessibilityRole="alert" className="text-sm text-foreground">
            {read.error}
          </AppText>
          <ContextAction
            text="Restart report pages"
            onPress={() => {
              setInputCursor(undefined);
              setFindingCursor(undefined);
              setConversationCursor(undefined);
              read.refresh();
            }}
          />
        </View>
      )}
      {view == null ? (
        <AppText accessibilityLiveRegion="polite" className="text-foreground-muted">
          {read.error ?? "Loading current context…"}
        </AppText>
      ) : (
        <>
          {view.conversations === undefined ? null : (
            <ConversationReport
              report={view.conversations}
              environmentId={environmentId}
              hasPreviousPage={conversationCursor !== undefined}
              onFirstPage={() => setConversationCursor(undefined)}
              onNextPage={setConversationCursor}
            />
          )}
          <AppText className="font-semibold text-foreground">Saved shared context</AppText>
          <AppText className="text-xs text-foreground-muted">
            Written by the work’s authors. Automatic conversation updates do not rewrite this
            document.
          </AppText>
          {currentContextSections(view).map((section) => (
            <View key={section.key} className="gap-1">
              <AppText className="font-semibold text-foreground">{section.title}</AppText>
              {section.groups.map((group) => (
                <View key={`${group.key}:${group.values[0]?.text}`}>
                  {group.values.map((value) => (
                    <View key={value.text}>
                      <AppText className="text-foreground">{value.text}</AppText>
                      {value.detail === undefined ? null : <ClaimDetail detail={value.detail} />}
                    </View>
                  ))}
                  {group.sources.map((source) => (
                    <ContextAction
                      key={source.id}
                      text={`Source: ${source.label}`}
                      onPress={() => openSource(source.scope, source.revision ?? undefined)}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))}
          <AppText className="font-semibold text-foreground">
            Recorded context reads: {contextEvidence(view).label}
          </AppText>
          <AppText className="text-xs text-foreground-muted">
            {contextEvidence(view).detail}
          </AppText>
          {view.inputs.coverage.total === 0 ? null : (
            <AppText className="text-xs text-foreground-muted">
              {view.inputs.required.length} of {view.inputs.coverage.total} reads shown. Opening a
              source does not count as a read by the agent.
            </AppText>
          )}
          <AppText className="text-xs text-foreground-muted">
            View loaded {view.generatedAt} · {view.identity.backend === "local" ? "Local" : "Hub"} ·{" "}
            {view.identity.environment} · {view.identity.scope}
          </AppText>
          <AppText className="text-xs text-foreground-muted">
            Reported by the work’s authors; tests and code are not independently verified here.
          </AppText>
          {selectedScope === "project-aggregate" ? (
            <AppText className="text-xs text-foreground-muted">
              Choose a work's context in the archive to inspect its published inputs.
            </AppText>
          ) : null}
          {view.inputs.required.map((input) => (
            <ContextAction
              key={input.scope}
              text={`${input.scope}: required v${input.revision}, ${input.currentRevision === null ? "source unavailable" : `current v${input.currentRevision}`}`}
              onPress={() => openSource(input.scope, String(input.revision))}
            />
          ))}
          {inputCursor === undefined ? null : (
            <ContextAction text="First inputs" onPress={() => setInputCursor(undefined)} />
          )}
          {view.inputs.coverage.nextCursor === null ? null : (
            <ContextAction
              text="More inputs"
              onPress={() => setInputCursor(view.inputs.coverage.nextCursor!)}
            />
          )}
          <AppText className="font-semibold text-foreground">Pending team findings</AppText>
          {view.pendingFindings.availability === "unavailable" ? (
            <AppText className="text-xs text-foreground-muted">
              Finding coverage is unavailable.
            </AppText>
          ) : (
            <>
              <AppText className="text-xs text-foreground-muted">
                {view.pendingFindings.ids.length} shown ·{" "}
                {view.pendingFindings.coverage.omittedCount} more await a keeper’s decision.
              </AppText>
              {view.pendingFindings.items.map((finding) => (
                <View key={finding.id}>
                  <AppText className="text-foreground">{finding.text}</AppText>
                  <AppText className="text-xs text-foreground-muted">
                    {finding.email} · {finding.at} · {finding.id}
                  </AppText>
                </View>
              ))}
              {findingCursor === undefined ? null : (
                <ContextAction text="First findings" onPress={() => setFindingCursor(undefined)} />
              )}
              {view.pendingFindings.coverage.nextCursor === null ? null : (
                <ContextAction
                  text="More findings"
                  onPress={() => setFindingCursor(view.pendingFindings.coverage.nextCursor!)}
                />
              )}
            </>
          )}
          {view.sources.some((source) =>
            ["unavailable", "disabled", "forbidden"].includes(source.availability),
          ) ? (
            <AppText accessibilityRole="alert" className="text-foreground-muted">
              Some sources are unavailable, disabled or access was denied. This view does not
              establish that nothing changed.
            </AppText>
          ) : null}
          {view.coverage.omittedCount > 0 ? (
            <AppText className="text-xs text-foreground-muted">
              {view.coverage.omittedCount} more contexts are available in the archive below.
            </AppText>
          ) : null}
        </>
      )}
      <ContextAction
        text={archiveOpen ? "Hide project archive" : "Browse project archive"}
        onPress={() => setArchiveOpen(!archiveOpen)}
      />
      {!archiveOpen ? null : (
        <View className="gap-2">
          <AppText className="font-semibold text-foreground">Project context archive</AppText>
          <TextInput
            accessibilityLabel="Find a topic in project archive"
            placeholder="Find a topic"
            value={topic}
            onChangeText={(value) => {
              setTopic(value);
              setArchiveCursor(undefined);
            }}
            className="rounded-md border border-border px-3 py-2 text-foreground"
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: history }}
            onPress={() => {
              setHistory(!history);
              setArchiveCursor(undefined);
            }}
            className="min-h-11 justify-center py-2"
          >
            <AppText className="text-primary">
              {history ? "Hide closed work" : "Include closed work"}
            </AppText>
          </Pressable>
          {archive.error === null || archiveCursor === undefined ? null : (
            <ContextAction text="Restart archive" onPress={() => setArchiveCursor(undefined)} />
          )}
          {archive.data == null ? (
            <AppText className="text-foreground-muted">
              {archive.error ?? "Loading archive…"}
            </AppText>
          ) : (
            <>
              {archive.data.availability === "available" ||
              archive.data.availability === "empty" ? null : (
                <AppText accessibilityRole="alert" className="text-foreground-muted">
                  Archive {archive.data.availability}; cached entries may be incomplete.
                </AppText>
              )}
              {archive.data.entries.length === 0 ? (
                <AppText className="text-foreground-muted">No matching work.</AppText>
              ) : (
                archive.data.entries.map((entry) => (
                  <View key={entry.scope}>
                    <ContextAction
                      text={`${entry.title}${entry.closed ? " · closed" : ""}${entry.revision === null ? "" : ` · v${entry.revision}`}`}
                      onPress={() => openSource(entry.scope)}
                    />
                    {entry.gist === null ? null : (
                      <AppText className="text-xs text-foreground-muted">{entry.gist}</AppText>
                    )}
                  </View>
                ))
              )}
              {archiveCursor === undefined ? null : (
                <ContextAction
                  text="First archive page"
                  onPress={() => setArchiveCursor(undefined)}
                />
              )}
              {archive.data.coverage.nextCursor === null ? null : (
                <ContextAction
                  text={`More work · ${archive.data.coverage.omittedCount}`}
                  onPress={() => setArchiveCursor(archive.data!.coverage.nextCursor!)}
                />
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

export function CurrentContextReport(props: Parameters<typeof CurrentContextReportContent>[0]) {
  return (
    <CurrentContextReportContent
      key={`${props.environmentId}:${props.workspace}:${props.project}:${props.scope ?? "project-aggregate"}`}
      {...props}
    />
  );
}
