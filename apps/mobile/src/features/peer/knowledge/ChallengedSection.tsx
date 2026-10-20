import type {
  EnvironmentId,
  PeerChallengeRow,
  PeerHubDecideChallengeInput,
} from "@t3tools/contracts";
import {
  challengeActive,
  challengeOffers,
  challengeWho,
  servesChallenges,
} from "@t3tools/client-runtime/peer/knowledge";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { PeerSectionProps } from "../slotTypes";
import { SavedKnowledge } from "./SavedKnowledge";

const LABEL = { second: "Second", dismiss: "Dismiss", resolve: "Resolve" } as const;

/**
 * A project's challenged knowledge entries on the phone: who said each may no longer hold and why,
 * and Second, Dismiss and Resolve. Writing a replacement or retiring an entry stages a change in a
 * checkout, which the desktop or web app does.
 */
function ProjectChallenges({
  environmentId,
  workspace,
  project,
  name,
  me,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly name: string;
  readonly me: string | undefined;
}) {
  const [changes, setChanges] = useState(0);
  const list = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeChallenges({
      environmentId,
      input: { workspace, project, waiting: changes },
    }),
  );
  const decide = useAtomCommand(serverEnvironment.peerKnowledgeDecideChallenge, {
    reportFailure: false,
  });
  const open = useAtomCommand(serverEnvironment.peerKnowledgeOpenChallenge, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [seconding, setSeconding] = useState<{
    readonly id: string;
    readonly reason: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canChallenge = useAtomValue(
    serverEnvironment.peerKnowledgeOpenChallenge.permissionAtom(environmentId),
  );
  const data = list.data;
  const rows = data?.rows.filter((row) => challengeActive(row.challenge)) ?? [];
  if (data === null || (rows.length === 0 && data.entries.length === 0)) return null;

  const done = (result: Parameters<typeof isAtomCommandInterrupted>[0]) => {
    if (result._tag === "Success") {
      setError(null);
      setChanges((n) => n + 1);
      list.refresh();
    } else if (!isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const run = async (row: PeerChallengeRow, decision: PeerHubDecideChallengeInput["decision"]) => {
    setBusy(row.challenge.id);
    const result = await decide({
      environmentId,
      input: { workspace, project, id: row.challenge.id, decision },
    });
    setBusy(null);
    done(result);
  };
  const second = async (row: PeerChallengeRow, reason: string) => {
    setBusy(row.challenge.id);
    const result = await open({
      environmentId,
      input: { workspace, project, entry: row.challenge.entry, reason },
    });
    setBusy(null);
    setSeconding(null);
    done(result);
  };

  return (
    <View className="gap-3">
      <Text className="font-t3-bold text-foreground">Project knowledge · {name}</Text>
      {error === null ? null : (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
      <SavedKnowledge
        environmentId={environmentId}
        workspace={workspace}
        project={project}
        entries={data.entries}
        challenged={new Set(rows.map((row) => row.challenge.entry))}
        busy={busy !== null}
        canChallenge={canChallenge}
        onChallenge={async (entry, reason) => {
          setBusy(entry);
          const result = await open({
            environmentId,
            input: { workspace, project, entry, reason },
          });
          setBusy(null);
          done(result);
          return result._tag === "Success";
        }}
      />
      {rows.length === 0 ? null : (
        <Text className="font-t3-medium text-foreground">Challenged · {rows.length}</Text>
      )}
      {rows.map((row) => {
        const { challenge, current } = row;
        const offers = challengeOffers(row, data, { surface: "mobile", me });
        return (
          <View key={challenge.id} className="gap-1.5">
            <Text className="text-foreground">{current?.title ?? challenge.entry}</Text>
            <Text className="text-sm text-foreground-muted">
              {challengeWho(challenge)}
              {challenge.status === "resolving" ? " · replacement staged" : ""}
            </Text>
            {challenge.sources.slice(0, 3).map((source) => (
              <Text key={source.finding} className="text-sm text-foreground">
                “{source.text}”
              </Text>
            ))}
            {seconding?.id === challenge.id ? (
              <View className="gap-1.5">
                <TextInput
                  accessibilityLabel="Why it may no longer hold"
                  placeholder="Why it may no longer hold"
                  maxLength={300}
                  value={seconding.reason}
                  onChangeText={(reason) => setSeconding({ id: challenge.id, reason })}
                  className="rounded-lg border border-border px-3 py-2 text-foreground"
                />
                <View className="flex-row gap-4">
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy !== null || seconding.reason.trim() === ""}
                    onPress={() => void second(row, seconding.reason.trim())}
                  >
                    <Text className="text-primary">Second</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setSeconding(null)}>
                    <Text className="text-foreground-muted">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-4">
                {offers.map((offer) =>
                  offer.id === "second" || offer.id === "dismiss" || offer.id === "resolve" ? (
                    <Pressable
                      key={offer.id}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busy !== null || offer.unavailable !== null }}
                      disabled={busy !== null || offer.unavailable !== null}
                      onPress={() =>
                        offer.id === "second"
                          ? setSeconding({ id: challenge.id, reason: "" })
                          : void run(row, offer.id === "dismiss" ? "dismissed" : "resolved")
                      }
                    >
                      <Text
                        className={
                          offer.unavailable === null ? "text-primary" : "text-foreground-muted"
                        }
                      >
                        {offer.unavailable ?? LABEL[offer.id]}
                      </Text>
                    </Pressable>
                  ) : null,
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Each project's challenged entries, where the Hub takes challenges. */
export function ChallengedSection({ environmentId, status }: PeerSectionProps) {
  if (!servesChallenges(status)) return null;
  return (
    <View className="gap-4">
      {status.workspaces.flatMap((workspace) =>
        workspace.projects.map((project) => (
          <ProjectChallenges
            key={`${workspace.slug}/${project.project.id}`}
            environmentId={environmentId}
            workspace={workspace.slug}
            project={project.project.id}
            name={project.project.name}
            me={status.email ?? undefined}
          />
        )),
      )}
    </View>
  );
}
