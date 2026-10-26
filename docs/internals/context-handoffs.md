# Context handoffs

Portable provider and fork handoffs are textual summaries. They do not claim native provider context
parity.

`ContextHandoffServiceV2` selects structured history within the provider handoff token and byte
budgets, recording coverage and omitted item IDs. The default token cap is 16,000. Coverage is
evidence of what was offered, not proof that the model received or used it; delivery has its own
receipt. Missing history cannot be reconstructed from a summary.

Provider handoffs use either the full eligible app history or the delta since that provider last
participated. Fork merge-back handoffs carry selected child history and a separate compact delta
summary. Only that delta summary uses 240-character prefixes for text items. Neither path
reconstructs provider-native session state, tool state, approvals, or omitted text.

Coordination input checkpoints are separate from conversation delivery. They name the authority,
project and exact shared-context revisions the work depended on; they never contain private notes.
A different runtime or fork inherits references requiring revalidation, not the source agent's
read receipts. Runtime expiry must not delete those dependencies. An unavailable original revision
means incomplete comparison coverage, even when the latest context can be read.

Legacy v1 continuation uses a separate algorithm. It considers only user and assistant messages,
walks backward from the newest message, and builds a transcript suffix within a 32,000-character
budget. Do not describe that migration budget as the limit for portable handoffs, and do not describe
the 240-character prefix as a migration rule.
