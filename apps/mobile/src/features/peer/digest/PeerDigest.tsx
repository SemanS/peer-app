import { useCallback, useState, useSyncExternalStore } from "react";
import { Linking, Pressable, View } from "react-native";
import type { PeerHubStatus, EnvironmentId } from "@t3tools/contracts";
import {
  coverageNotice,
  digestRows,
  projectVisitKey,
  sinceFor,
  automaticSinceFor,
  windowLabel,
  type DigestWindow,
} from "@t3tools/client-runtime/peer-digest";
import { AppText as Text } from "../../../components/AppText";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import type { PeerSectionProps } from "../slotTypes";
import { visits } from "./VisitsBackground";
function ProjectDigest({
  environmentId,
  status,
  workspace,
  project,
}: {
  environmentId: EnvironmentId;
  status: PeerHubStatus;
  workspace: string;
  project: string;
}) {
  const email = status.email ?? "",
    visit = useSyncExternalStore(
      visits.subscribe,
      useCallback(() => (email ? visits.get(email) : null), [email]),
      () => null,
    );
  const [open, setOpen] = useState(false),
    [choice, setChoice] = useState<DigestWindow | null>(null),
    [revision, setRevision] = useState(0),
    [requestAt, setRequestAt] = useState(() => Date.now());
  const key = projectVisitKey(workspace, project),
    auto = !!visit?.away && !visit.away.dismissed.includes(key),
    window = choice ?? (auto ? "away" : null);
  const since = choice
    ? sinceFor(visit, choice, requestAt)
    : auto
      ? automaticSinceFor(visit)
      : null;
  const query = useEnvironmentQuery(
    since
      ? serverEnvironment.peerDigest.get({
          environmentId,
          person: email,
          input: { workspace, project, since, revision },
        })
      : null,
  );
  const choose = (next: DigestWindow) => {
    setChoice(next);
    setRequestAt(() => Date.now());
    setRevision((v) => v + 1);
  };
  const who = (address: string) =>
    address === email
      ? "you"
      : (status.workspaces
          .find((w) => w.slug === workspace)
          ?.projects.find((p) => p.project.id === project)
          ?.project.members.find((m) => m.email === address)?.name ?? address);
  const digest = query.data;
  return (
    <View className="gap-2">
      <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)}>
        <Text className="text-primary">What changed</Text>
      </Pressable>
      {open ? (
        <View className="flex-row flex-wrap gap-3">
          {([...(visit?.away ? ["away"] : []), "8h", "24h", "7d"] as DigestWindow[]).map((c) => (
            <Pressable key={c} accessibilityRole="button" onPress={() => choose(c)}>
              <Text className="text-primary">{windowLabel(c)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!query.isPending && !query.error && digest?.sections.some((s) => s.total > 0) && window ? (
        <View className="gap-2 rounded-md border border-border p-3">
          <View className="flex-row justify-between">
            <Text className="font-t3-medium text-foreground">{windowLabel(window)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                visits.dismiss(email, key);
                setChoice(null);
                setOpen(false);
              }}
            >
              <Text className="text-primary">Dismiss</Text>
            </Pressable>
          </View>
          <Text className="text-foreground-muted">
            {digest.since} – {digest.until}
          </Text>
          {coverageNotice(digest.coverage) ? (
            <Text className="text-foreground-muted">{coverageNotice(digest.coverage)}</Text>
          ) : null}
          {digest.unavailable?.length ? (
            <Text className="text-foreground-muted">
              Some sources are unavailable: {digest.unavailable.join(", ")}
            </Text>
          ) : null}
          {digestRows(digest, who).map((s) => (
            <View key={s.id} className="gap-1">
              <Text className="font-t3-medium text-foreground">
                {s.title} ({s.total})
              </Text>
              {s.rows.map((row) => (
                <View key={row.key}>
                  {row.target?.kind === "url" ? (
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => {
                        if (row.target?.kind === "url") void Linking.openURL(row.target.url);
                      }}
                    >
                      <Text className="text-primary">{row.text}</Text>
                    </Pressable>
                  ) : (
                    <Text className="text-foreground">{row.text}</Text>
                  )}
                  <Text className="text-foreground-muted">{row.at}</Text>
                  {row.note ? <Text className="text-foreground-muted">{row.note}</Text> : null}
                </View>
              ))}
              {s.remaining ? (
                <Text className="text-foreground-muted">+{s.remaining} more</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {choice && query.isPending ? (
        <Text className="text-foreground-muted">Reading what changed…</Text>
      ) : null}
      {choice && query.error ? (
        <View>
          <Text accessibilityRole="alert" className="text-destructive">
            {query.error}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => choose(choice)}>
            <Text className="text-primary">Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {choice && !query.isPending && !query.error && digest === null ? (
        <Text className="text-foreground-muted">This Hub cannot summarize what changed yet.</Text>
      ) : null}
      {choice && digest && !digest.sections.some((s) => s.total > 0) ? (
        <Text className="text-foreground-muted">Nothing changed in that time.</Text>
      ) : null}
    </View>
  );
}
export function PeerDigest({ environmentId, status }: PeerSectionProps) {
  return status.workspaces.flatMap((w) =>
    w.projects.map((p) => (
      <View key={projectVisitKey(w.slug, p.project.id)} className="gap-2">
        <Text className="font-t3-medium text-foreground">{p.project.name}</Text>
        <ProjectDigest
          key={status.email ?? ""}
          environmentId={environmentId}
          status={status}
          workspace={w.slug}
          project={p.project.id}
        />
      </View>
    )),
  );
}
