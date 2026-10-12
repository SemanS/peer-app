import { SLACK_SCOPE_GROUPS } from "./slackSteps.logic";

/**
 * What the app may do, by what Peer does with each permission, with Slack’s own names in small
 * type. The groups add up to the scopes of Peer’s manifest, so an admin checking an app they have
 * made compares like with like.
 */
export function SlackScopes() {
  return (
    <section
      aria-labelledby="slack-scopes"
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card"
    >
      <h3 id="slack-scopes" className="px-3 py-2 text-xs font-semibold text-muted-foreground">
        What the app may do
      </h3>
      {SLACK_SCOPE_GROUPS.map((group) => (
        <div key={group.what} className="flex flex-col gap-0.5 px-3 py-2">
          <span className="text-sm font-medium text-foreground">{group.what}</span>
          <span className="text-xs text-muted-foreground">{group.why}</span>
          <code className="font-mono text-2xs text-muted-foreground">{group.ids.join(" · ")}</code>
        </div>
      ))}
    </section>
  );
}
