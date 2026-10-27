import {
  contextEvidence,
  currentContextSections,
  contextViewRevision,
} from "@t3tools/client-runtime/peer/contextView";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

function ContextAction({ text, onPress }: { readonly text: string; readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
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
  const [sourceRevision, setSourceRevision] = useState<number | undefined>();
  const [inputCursor, setInputCursor] = useState<string | undefined>();
  const [findingCursor, setFindingCursor] = useState<string | undefined>();
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
      },
    }),
  );
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
        text="Refresh current context"
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
        <ContextAction
          text="Restart evidence pages"
          onPress={() => {
            setInputCursor(undefined);
            setFindingCursor(undefined);
          }}
        />
      )}
      {view == null ? (
        <AppText accessibilityLiveRegion="polite" className="text-foreground-muted">
          {read.error ?? "Loading current context…"}
        </AppText>
      ) : (
        <>
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
            Inputs read: {contextEvidence(view).label}
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
            Assembled {view.generatedAt} · {view.identity.backend === "local" ? "Local" : "Hub"} ·{" "}
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
