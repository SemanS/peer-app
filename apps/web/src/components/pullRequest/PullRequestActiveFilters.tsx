import { XIcon } from "lucide-react";

import { Button } from "../ui/button";
import type {
  PullRequestListPreferencePatch,
  PullRequestListPreferences,
} from "./pullRequestListPreferences";

/** Scope stays visible and is never removed by clearing list filters. */
export function PullRequestActiveFilters({
  search,
  projectName,
  environmentName,
  onChange,
  onClear,
}: {
  search: PullRequestListPreferences;
  projectName: string | undefined;
  environmentName: string | undefined;
  onChange: (patch: PullRequestListPreferencePatch) => void;
  onClear: () => void;
}) {
  const chips: Array<{ label: string; patch: PullRequestListPreferencePatch }> = [];
  if (search.state !== "all") {
    chips.push({ label: `State: ${search.state}`, patch: { state: "all" } });
  }
  if (search.involvement !== "all") {
    chips.push({
      label: search.involvement === "authored" ? "Authored by me" : "Reviewing",
      patch: { involvement: "all" },
    });
  }
  if (search.host) chips.push({ label: `Host: ${search.host}`, patch: { host: undefined } });
  if (search.q) chips.push({ label: `Search: ${search.q}`, patch: { q: undefined } });
  if (search.draft) {
    chips.push({
      label: search.draft === "only" ? "Drafts only" : "Hide drafts",
      patch: { draft: undefined },
    });
  }
  if (search.review) {
    chips.push({
      label: `Review: ${search.review.replaceAll("-", " ")}`,
      patch: { review: undefined },
    });
  }
  if (search.checks) {
    chips.push({ label: `Checks: ${search.checks}`, patch: { checks: undefined } });
  }
  if (search.author) {
    chips.push({ label: `Author: ${search.author}`, patch: { author: undefined } });
  }
  for (const label of search.labels ?? []) {
    chips.push({
      label: `Label: ${label}`,
      patch: { labels: search.labels?.filter((value) => value !== label) },
    });
  }
  return (
    <div
      aria-label="Current scope and filters"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      <span className="rounded-md bg-muted px-2 py-1">
        Project: {projectName ?? "All projects"}
      </span>
      {environmentName ? (
        <span className="rounded-md bg-muted px-2 py-1">Computer: {environmentName}</span>
      ) : null}
      {chips.map(({ label, patch }) => (
        <Button
          key={label}
          size="xs"
          variant="outline"
          className="h-auto max-w-full whitespace-normal text-start"
          aria-label={`Remove ${label}`}
          onClick={() => onChange(patch)}
        >
          <span className="break-words">{label}</span>
          <XIcon aria-hidden className="size-3 shrink-0" />
        </Button>
      ))}
      {chips.length > 0 ? (
        <Button size="xs" variant="ghost" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
