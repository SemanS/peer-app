import {
  PEER_KEPT_TEXT_MAX,
  type EnvironmentId,
  type PeerKeepTarget,
  type PeerKnowledgeCandidate,
  type PeerKnowledgePreview,
  type PeerKnowledgePreviewInput,
  type PeerKnowledgeRelation,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../../lib/utils";
import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { hubFailure } from "../WorkspaceAccess";
import {
  findingOperations,
  kindLabel,
  lineDiff,
  longEntryHint,
  relationOffer,
  whyLine,
  type KeepOperationId,
} from "./knowledge.logic";

/** How a person chose to keep a finding, as Apply sends it. */
export interface KeepChoice {
  readonly text?: string | undefined;
  readonly into?: PeerKeepTarget | undefined;
  readonly extends?: ReadonlyArray<string> | undefined;
  readonly supersedes?: ReadonlyArray<string> | undefined;
}

export type KeepOutcome = "kept" | "stale" | "failed";

/** The operation a person picked, with the entry it acts on when it acts on one. */
interface Choice {
  readonly operation: KeepOperationId;
  readonly entry?: PeerKnowledgeRelation | undefined;
}

type Drafting =
  | { readonly key: string; readonly state: "loading" }
  | { readonly key: string; readonly state: "ready"; readonly preview: PeerKnowledgePreview }
  | { readonly key: string; readonly state: "failed"; readonly message: string };

const quoted = (title: string) => `“${title}”`;

/**
 * A waiting finding's operations, where the project's kontext can add to an entry: the one its
 * relation selects first and the others beside it. Choosing one drafts what it would stage
 * (`peer.knowledge.preview`, once per entry revision on the server) and Apply stages that draft.
 * Nothing is staged without the click; a stale entry is said inline and its relation asked again.
 */
export function KeepOperations({
  environmentId,
  workspace,
  project,
  candidate,
  busy,
  taskName,
  onKeep,
  onDismiss,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly candidate: PeerKnowledgeCandidate;
  readonly busy: boolean;
  /** How people name a task. */
  readonly taskName: (task: string | undefined) => string;
  readonly onKeep: (choice: KeepChoice) => Promise<KeepOutcome>;
  readonly onDismiss: (reason?: string) => void;
}) {
  const asked = useEnvironmentQuery(
    serverEnvironment.peerKnowledgeRelated({
      environmentId,
      input: { workspace, project, id: candidate.id },
    }),
  );
  const relations = asked.data?.relations ?? [];
  const ops = findingOperations(relations);
  const firstChoice = (): Choice | null =>
    ops.primary === null
      ? null
      : ops.primary === "add"
        ? { operation: "add", entry: ops.addTargets[0] }
        : { operation: ops.primary };
  const [picked, setPicked] = useState<Choice | null>(null);
  // Until the person picks, the relation's default stands, also once the relations arrive.
  const choice = picked ?? firstChoice();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(candidate.text);
  const [stale, setStale] = useState<string | null>(null);
  const edited = text.trim() !== "" && text.trim() !== candidate.text ? text.trim() : undefined;
  const links = ops.links.map((relation) => relation.entry);

  const input = ((): PeerKnowledgePreviewInput | null => {
    if (choice === null || choice.operation === "dismiss") return null;
    const place = { workspace, project, id: candidate.id, ...(edited ? { text: edited } : {}) };
    if (choice.operation === "add")
      return choice.entry?.revision === undefined
        ? null
        : {
            ...place,
            operation: "add",
            entry: { entry: choice.entry.entry, revision: choice.entry.revision },
          };
    if (choice.operation === "supersede")
      return choice.entry === undefined
        ? null
        : {
            ...place,
            operation: "supersede",
            entry: { entry: choice.entry.entry, revision: choice.entry.revision ?? "unknown" },
          };
    return {
      ...place,
      operation: "new",
      ...(choice.operation === "new-linked" && links.length > 0 ? { extends: links } : {}),
    };
  })();
  const key = input === null || editing ? null : JSON.stringify(input);
  const draft = useAtomCommand(serverEnvironment.peerKnowledgePreview, { reportFailure: false });
  const [drafting, setDrafting] = useState<Drafting | null>(null);
  const asking = useRef<string | null>(null);
  useEffect(() => {
    // `key` spells the whole request; the ref keeps it to one draft however often this re-runs.
    if (key === null || asking.current === key) return;
    asking.current = key;
    const input = JSON.parse(key) as PeerKnowledgePreviewInput;
    setDrafting({ key, state: "loading" });
    void draft({ environmentId, input }).then((result) => {
      if (asking.current !== key) return;
      setDrafting(
        result._tag === "Success"
          ? { key, state: "ready", preview: result.value }
          : {
              key,
              state: "failed",
              message: hubFailure(result)?.message ?? "Could not draft it.",
            },
      );
    });
  }, [key, environmentId, draft, asking]);
  const shown = drafting !== null && drafting.key === key ? drafting : null;

  const apply = async () => {
    if (choice === null || input === null || shown?.state !== "ready") return;
    setStale(null);
    const outcome = await onKeep({
      text: edited,
      ...(input.operation === "add" ? { into: input.entry } : {}),
      ...(input.operation === "new" && input.extends !== undefined
        ? { extends: input.extends }
        : {}),
      ...(input.operation === "supersede" && input.entry !== undefined
        ? { supersedes: [input.entry.entry] }
        : {}),
    });
    if (outcome !== "stale") return;
    setStale("This entry changed since it was compared; compare again");
    setPicked(null);
    asking.current = null;
    setDrafting(null);
    asked.refresh();
  };

  const why = whyLine({
    relation:
      (choice?.operation === "add" || choice?.operation === "supersede"
        ? choice.entry
        : undefined) ??
      ops.same ??
      ops.links[0] ??
      ops.replaceable[0] ??
      null,
    sources: candidate.sources,
    finders: candidate.finders,
    taskName,
  });

  const label = (operation: KeepOperationId, entry?: PeerKnowledgeRelation) => {
    switch (operation) {
      case "add":
        return `Add to ${quoted(entry?.title ?? "")}`;
      case "supersede":
        return `Replace ${quoted(entry?.title ?? "")}`;
      case "dismiss":
        return ops.same === null ? "Dismiss" : "Dismiss: already known";
      default:
        return "Keep as a new entry";
    }
  };
  const isChosen = (operation: KeepOperationId, entry?: PeerKnowledgeRelation) =>
    choice?.operation === operation && (entry === undefined || choice.entry?.entry === entry.entry);
  const buttons = ops.offered.flatMap((operation): ReadonlyArray<Choice> =>
    operation === "add"
      ? [{ operation, entry: choice?.operation === "add" ? choice.entry : ops.addTargets[0] }]
      : operation === "supersede"
        ? ops.replaceable.map((entry) => ({ operation, entry }))
        : [{ operation, entry: undefined }],
  );

  return (
    <div className="flex flex-col gap-2.5">
      {relations.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {relations.map((relation) => (
            <li key={relation.entry}>
              {relationOffer(relation.relation, relation.kind).label} {quoted(relation.title)}
              {relation.kind === undefined ? "" : ` (${kindLabel(relation.kind)})`}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <Textarea
          aria-label="What to keep"
          autoFocus
          value={text}
          maxLength={PEER_KEPT_TEXT_MAX}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="How to keep it">
        {buttons.map(({ operation, entry }) => (
          <Button
            key={`${operation}:${entry?.entry ?? ""}`}
            size="xs"
            variant={isChosen(operation, entry) ? "secondary" : "outline"}
            aria-pressed={isChosen(operation, entry)}
            disabled={busy}
            onClick={() => {
              if (operation === "dismiss") {
                onDismiss(ops.same === null ? undefined : `already in ${quoted(ops.same.title)}`);
                return;
              }
              setStale(null);
              setPicked({ operation, entry });
            }}
          >
            {label(operation, entry)}
          </Button>
        ))}
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (editing && text.trim() === "") setText(candidate.text);
            setEditing((value) => !value);
          }}
        >
          {editing ? "Done editing" : "Edit"}
        </Button>
      </div>
      {choice?.operation === "add" && ops.addTargets.length > 1 ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Or add to
          {ops.addTargets
            .filter((target) => target.entry !== choice.entry?.entry)
            .map((target) => (
              <Button
                key={target.entry}
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => setPicked({ operation: "add", entry: target })}
              >
                {quoted(target.title)}
              </Button>
            ))}
        </p>
      ) : null}
      {choice?.operation === "new-linked" && ops.links.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Linked to {ops.links.map((link) => quoted(link.title)).join(", ")}
        </p>
      ) : null}
      {choice === null ? (
        <p className="text-xs text-muted-foreground">
          It may contradict what the project knows: choose how to keep it, or dismiss it.
        </p>
      ) : null}
      {shown === null ? null : shown.state === "loading" ? (
        <p className="text-xs text-muted-foreground">Drafting what it would stage…</p>
      ) : shown.state === "failed" ? (
        <p className="text-xs text-destructive-foreground">{shown.message}</p>
      ) : (
        <PreviewOf preview={shown.preview} />
      )}
      <p className="text-xs text-muted-foreground">{why}</p>
      {stale === null ? null : (
        <p role="alert" className="text-xs text-warning-foreground">
          {stale}
        </p>
      )}
      {choice === null || choice.operation === "dismiss" ? null : (
        <div>
          <Button
            size="xs"
            disabled={busy || editing || shown?.state !== "ready"}
            onClick={() => void apply()}
          >
            {busy ? "Applying…" : "Apply"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** What Apply stages: the amended entry as a diff, or the new entry with what it links to. */
function PreviewOf({ preview }: { readonly preview: PeerKnowledgePreview }) {
  const hint = preview.operation === "add" ? longEntryHint(preview.words) : null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{preview.entry.title}</span>
        <span>{kindLabel(preview.entry.kind)}</span>
        {preview.entry.path === null ? (
          <span>a new entry</span>
        ) : (
          <span className="min-w-0 truncate font-mono">{preview.entry.path}</span>
        )}
      </p>
      {preview.oldBody === null ? (
        <p className="text-sm whitespace-pre-wrap text-foreground">{preview.body}</p>
      ) : (
        <pre
          aria-label="What it changes"
          className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap"
        >
          {lineDiff(preview.oldBody, preview.body).map((line, index) => (
            <span
              // Lines repeat (blank ones above all); their order is the identity.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              data-diff={line.kind}
              className={cn(
                "block",
                line.kind === "added" && "bg-success/10 text-success-foreground",
                line.kind === "removed" && "bg-destructive/10 text-destructive-foreground",
                line.kind === "same" && "text-muted-foreground",
              )}
            >
              {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
              {line.text}
            </span>
          ))}
        </pre>
      )}
      {preview.links.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {preview.operation === "supersede" ? "Replaces" : "Links to"}{" "}
          {preview.links.map((link) => quoted(link.title)).join(", ")}
        </p>
      )}
      {preview.asWritten === null ? null : (
        <p className="text-xs text-muted-foreground">
          {preview.operation === "add"
            ? `It will be added as written (${preview.asWritten}).`
            : `It reads as the agents wrote it (${preview.asWritten}).`}
        </p>
      )}
      {hint === null ? null : <p className="text-xs text-warning-foreground">{hint}</p>}
    </div>
  );
}
