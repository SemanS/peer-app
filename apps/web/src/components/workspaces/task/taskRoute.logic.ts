/**
 * Which task a Peer page is about, from its route: the review page names it in a `task` param, the
 * task context page in a `task:<id>` scope (`project` is the work on no task).
 */
export function taskIdOfParams(params: {
  readonly task?: string | undefined;
  readonly scope?: string | undefined;
}): string | undefined {
  if (params.task !== undefined && params.task !== "") return params.task;
  const scope = params.scope;
  return scope !== undefined && scope.startsWith("task:") && scope.length > "task:".length
    ? scope.slice("task:".length)
    : undefined;
}
