import {
  PEER_CHALLENGE_REASON_MAX,
  type EnvironmentId,
  type PeerKnowledgeChallenges,
} from "@t3tools/contracts";
import { provenanceLine, sinceLine } from "@t3tools/client-runtime/peer/knowledge";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";

interface SavedKnowledgeProps {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly entries: PeerKnowledgeChallenges["entries"];
  readonly challenged: ReadonlySet<string>;
  readonly busy: boolean;
  readonly canChallenge: boolean;
  readonly onChallenge: (entry: string, reason: string) => Promise<boolean>;
}

export function SavedKnowledge(props: SavedKnowledgeProps) {
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(10);
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState("all");
  const [state, setState] = useState<"all" | "current" | "challenged">("all");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const results = useEnvironmentQuery(
    debounced === ""
      ? null
      : serverEnvironment.peerKnowledgeChallenges({
          environmentId: props.environmentId,
          input: { workspace: props.workspace, project: props.project, query: debounced },
        }),
  );
  const searching = search.trim() !== debounced || (debounced !== "" && results.isPending);
  const query = debounced.toLocaleLowerCase();
  const source = debounced === "" ? props.entries : (results.data?.entries ?? []);
  const entries = source.filter(
    (entry) =>
      (entry.snippet !== undefined ||
        query === "" ||
        `${entry.title} ${entry.kind} ${entry.summary ?? ""} ${(entry.paths ?? []).join(" ")} ${(entry.tags ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (kind === "all" || entry.kind === kind) &&
      (state === "all" || (state === "challenged") === props.challenged.has(entry.id)),
  );
  const kinds = [...new Set(props.entries.map((entry) => entry.kind))].sort();
  if (props.entries.length === 0) return null;

  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: props.busy }}
        disabled={props.busy}
        className="min-h-11 justify-center"
        onPress={() => setExpanded((value) => !value)}
      >
        <Text className="font-t3-medium text-primary-text">
          {expanded ? "Hide saved knowledge" : "Read saved knowledge"} · {props.entries.length}
        </Text>
      </Pressable>
      {expanded ? (
        <>
          <TextInput
            accessibilityLabel="Search saved knowledge"
            placeholder="Search content, topic or path…"
            maxLength={200}
            value={search}
            editable={!props.busy}
            onChangeText={(value) => {
              setSearch(value);
              setVisible(10);
            }}
            className="rounded-lg border border-border px-3 py-2 text-foreground"
          />
          <Text className="text-sm text-foreground-muted">Kind</Text>
          <View className="flex-row flex-wrap gap-2">
            {["all", ...kinds].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === value }}
                className="min-h-11 justify-center rounded-lg border border-border px-3"
                onPress={() => {
                  setKind(value);
                  setVisible(10);
                }}
              >
                <Text className="text-primary-text">{value === "all" ? "All kinds" : value}</Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-sm text-foreground-muted">Status</Text>
          <View className="flex-row flex-wrap gap-2">
            {(["all", "current", "challenged"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: state === value }}
                className="min-h-11 justify-center rounded-lg border border-border px-3"
                onPress={() => {
                  setState(value);
                  setVisible(10);
                }}
              >
                <Text className="text-primary-text">
                  {value === "all" ? "All entries" : value === "current" ? "Current" : "Challenged"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
            {searching ? "Searching saved content…" : `${entries.length} matching entries`}
          </Text>
          {results.data?.searchLimited ? (
            <Text className="text-xs text-foreground-muted">
              Showing up to 100 content matches. Refine your search for more precise results.
            </Text>
          ) : null}
          {results.error === null ? null : (
            <View>
              <Text accessibilityRole="alert" className="text-destructive">
                Search could not load: {results.error}
              </Text>
              <Pressable
                accessibilityRole="button"
                className="min-h-11 justify-center"
                onPress={results.refresh}
              >
                <Text className="text-primary-text">Retry search</Text>
              </Pressable>
            </View>
          )}
          {!searching && entries.length === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No saved entries match this search.
            </Text>
          ) : null}
          {entries.slice(0, visible).map((entry) => (
            <View key={entry.id} className="gap-2 border-t border-border pt-2">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: selected === entry.id, disabled: props.busy }}
                disabled={props.busy}
                className="min-h-11 justify-center gap-1"
                onPress={() => setSelected((value) => (value === entry.id ? null : entry.id))}
              >
                <Text className="text-xs text-foreground-muted">
                  {entry.kind} · {props.challenged.has(entry.id) ? "Challenged" : "Current"}
                  {entry.checked === undefined && entry.verification === undefined
                    ? ""
                    : ` · ${provenanceLine(entry)}`}
                  {sinceLine(entry) === null ? "" : ` · ${sinceLine(entry)}`}
                </Text>
                <Text className="font-t3-medium text-foreground">{entry.title}</Text>
              </Pressable>
              {entry.snippet || entry.summary ? (
                <Text className="text-sm text-foreground-muted">
                  {entry.snippet || entry.summary}
                </Text>
              ) : null}
              {entry.paths?.length ? (
                <Text className="text-xs text-foreground-muted">
                  Applies to: {entry.paths.join(", ")}
                </Text>
              ) : null}
              {selected === entry.id ? (
                <SavedEntryDetail key={entry.id} {...props} entry={entry.id} />
              ) : null}
            </View>
          ))}
          {entries.length > visible ? (
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center"
              onPress={() => setVisible((count) => count + 10)}
            >
              <Text className="text-primary-text">
                Show more entries ({entries.length - visible} remaining)
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function SavedEntryDetail({ entry, ...props }: SavedKnowledgeProps & { readonly entry: string }) {
  const detail = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeEntry({
      environmentId: props.environmentId,
      input: { workspace: props.workspace, project: props.project, entry },
    }),
  );
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  if (detail.error !== null)
    return (
      <View className="gap-2">
        <Text accessibilityRole="alert" className="text-destructive">
          Could not read this entry: {detail.error}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center"
          onPress={detail.refresh}
        >
          <Text className="text-primary-text">Retry</Text>
        </Pressable>
      </View>
    );
  if (!detail.isSuccess) return <Text className="text-foreground-muted">Loading entry…</Text>;
  const saved = detail.data;
  if (saved === null)
    return (
      <Text className="text-foreground-muted">
        This entry is no longer available in this checkout.
      </Text>
    );
  return (
    <View className="gap-3">
      <Text selectable className="text-xs text-foreground-muted">
        {saved.file}
      </Text>
      {saved.summary === "" ? null : (
        <Text selectable className="text-foreground">
          {saved.summary}
        </Text>
      )}
      {saved.body === "" || saved.body === saved.summary ? null : (
        <Text selectable className="text-foreground">
          {saved.body}
        </Text>
      )}
      {submitted || props.challenged.has(entry) ? (
        <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
          This entry is challenged. Review the reasons below.
        </Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: writing, disabled: props.busy || !props.canChallenge }}
            disabled={props.busy || !props.canChallenge}
            className="min-h-11 justify-center"
            onPress={() => setWriting((value) => !value)}
          >
            <Text className="text-primary-text">Challenge this entry</Text>
          </Pressable>
          {!props.canChallenge ? (
            <Text className="text-sm text-foreground-muted">
              Read-only access: you cannot challenge entries here.
            </Text>
          ) : null}
          {writing ? (
            <View className="gap-2 border-l-2 border-border pl-3">
              <Text className="font-t3-medium text-foreground">
                Why does this entry no longer hold?
              </Text>
              <TextInput
                autoFocus
                multiline
                accessibilityLabel="Why does this entry no longer hold?"
                maxLength={PEER_CHALLENGE_REASON_MAX}
                value={reason}
                editable={!props.busy}
                onChangeText={setReason}
                className="rounded-lg border border-border px-3 py-2 text-foreground"
              />
              <Text className="text-sm text-foreground-muted">
                This flags the entry for review. Its content stays unchanged.
              </Text>
              <View className="flex-row flex-wrap gap-4">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: props.busy || !props.canChallenge || reason.trim() === "",
                  }}
                  disabled={props.busy || !props.canChallenge || reason.trim() === ""}
                  className="min-h-11 justify-center"
                  onPress={() => {
                    void props.onChallenge(entry, reason.trim()).then((done) => {
                      if (done) {
                        setWriting(false);
                        setSubmitted(true);
                        setReason("");
                      }
                    });
                  }}
                >
                  <Text className="text-primary-text">
                    {props.busy ? "Submitting…" : "Submit challenge"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={props.busy}
                  className="min-h-11 justify-center"
                  onPress={() => {
                    setWriting(false);
                    setReason("");
                  }}
                >
                  <Text className="text-foreground-muted">Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
