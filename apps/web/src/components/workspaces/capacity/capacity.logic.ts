/**
 * Whether what shared capacity reports for a project says the workspace's gateway has no master
 * key yet, in the words the Hub uses ("the workspace's gateway has no admin key yet"): no one in
 * the workspace gets a shared key until an admin stores it, which they do in Shared capacity.
 */
export function gatewayKeyMissing(error: string | undefined): boolean {
  return error !== undefined && /\bno (?:gateway )?admin key\b/i.test(error);
}
