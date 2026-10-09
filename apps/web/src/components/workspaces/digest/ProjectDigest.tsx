import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  projectVisitKey,
  sinceFor,
  windowLabel,
  type DigestWindow,
} from "@t3tools/client-runtime/peer-digest";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { Button } from "../../ui/button";
import type { ProjectSlotProps } from "../slots.types";
import { visits } from "./visitTracker";
import { WhatChanged } from "./WhatChanged";
import { DigestCard } from "./DigestCard";
export function ProjectDigest({ environmentId, status, project }: ProjectSlotProps) {
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
  const key = projectVisitKey(project.workspace, project.projectId),
    auto = !!visit?.away && !visit.away.dismissed.includes(key),
    window = choice ?? (auto ? "away" : null);
  const awaySince = visit?.away?.since;
  const automaticSince = useMemo(
    () => (awaySince === undefined ? null : new Date(awaySince).toISOString()),
    [awaySince],
  );
  const since = choice ? sinceFor(visit, choice, requestAt) : auto ? automaticSince : null;
  const query = useEnvironmentQuery(
    since
      ? serverEnvironment.peerDigest.get({
          environmentId,
          input: { workspace: project.workspace, project: project.projectId, since, revision },
        })
      : null,
  );
  const dismiss = () => {
    if (email) visits.dismiss(email, key);
    setChoice(null);
    setOpen(false);
  };
  const choose = (next: DigestWindow) => {
    setChoice(next);
    setRequestAt(() => Date.now());
    setRevision((v) => v + 1);
  };
  const who = (address: string) =>
    address === email
      ? "you"
      : (status.workspaces
          .find((w) => w.slug === project.workspace)
          ?.projects.find((p) => p.project.id === project.projectId)
          ?.project.members.find((m) => m.email === address)?.name ?? address);
  return (
    <div className="space-y-2">
      <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)}>
        What changed
      </Button>
      {open ? <WhatChanged away={!!visit?.away} onChoose={choose} /> : null}
      {query.data?.sections.some((s) => s.total > 0) && window ? (
        <DigestCard
          digest={query.data}
          title={windowLabel(window)}
          workspace={project.workspace}
          project={project.projectId}
          who={who}
          onDismiss={dismiss}
        />
      ) : null}
      {choice && query.isPending ? (
        <p className="text-xs text-muted-foreground">Reading what changed…</p>
      ) : null}
      {choice && query.error ? (
        <div role="alert" className="text-xs">
          <p>{query.error}</p>
          <Button size="xs" variant="ghost" onClick={() => choose(choice)}>
            Retry
          </Button>
        </div>
      ) : null}
      {choice && !query.isPending && !query.error && query.data === null ? (
        <p className="text-xs text-muted-foreground">This Hub cannot summarize what changed yet.</p>
      ) : null}
      {choice && query.data && !query.data.sections.some((s) => s.total > 0) ? (
        <p className="text-xs text-muted-foreground">Nothing changed in that time.</p>
      ) : null}
    </div>
  );
}
