/**
 * The knowledge plugin: a project's reviewed knowledge (kontext, `.ai/` in its repository) for its
 * agents and its people. Agents find the entries that stand in their checkout in their index (the
 * index source), read them with `peer knowledge`, hear once when an entry governs a file they
 * change, and start with the project's guidance on what to mark [project]. People keep or dismiss
 * the candidates agents' findings become, and keeping writes them into the knowledge with kontext.
 * In a jj checkout, a change that ships knowledge gets kontext's commit trailers at the landing
 * step, which jj's missing git hooks would leave out. A project's word on its agents' harness
 * memory (`agents.memory`, `off` unless a lead says `personal`) is the plugin's too: an `off`
 * session starts with one line saying where a lesson, state and a preference belong, a write into
 * that memory is refused at the tool boundary, and `peer capture` (the `peer_capture` tool) is the
 * lesson's intake for sessions without the kontext MCP server.
 * It needs the Hub's `knowledge` feature, which keeps the candidates.
 *
 * @module peerHub/plugins/knowledge
 */
import { KnowledgeRpcGroup, PEER_KNOWLEDGE_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Knowledge from "./Knowledge.ts";
import { CAPTURE_USAGE, captureTool } from "./client/capture.ts";
import { known, knowledgeIndexText } from "./knowledgeIndex.ts";

/** Traced as Peer's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub" } as const;

export const KnowledgePlugin = bindPlugin({
  id: "knowledge",
  title: "Knowledge",
  summary:
    "Give agents the project's reviewed knowledge, and keep what they find in it with kontext.",
  defaultEnabled: true,
  commandNames: ["knowledge", "capture"],
  hubFeature: { id: "knowledge", revision: 1 },
  layer: Knowledge.layer,
  make: Effect.gen(function* () {
    const knowledge = yield* Knowledge.Knowledge;
    const methods = PEER_KNOWLEDGE_METHODS;
    return {
      commands: [
        {
          name: "knowledge",
          usage: "knowledge [<id or words>]",
          summary:
            "the project's decisions, conventions, learnings and incidents: list, search or read one",
          run: ({ session, text }) => knowledge.read(session, text),
        },
        {
          name: "capture",
          usage: CAPTURE_USAGE,
          summary:
            "record a decision, convention or learning as a candidate for the project's reviewed knowledge",
          run: ({ session, args }) => knowledge.capture(session, args),
        },
      ],
      agentTools: [captureTool],
      hooks: {
        sessionStart: (ctx) => knowledge.guidance(ctx.session, ctx.source),
        notices: [
          {
            wakes: false,
            // A finished tool call is `postTool`'s; before one, the files it is about to change.
            read: (ctx) =>
              ctx.event === "post-tool"
                ? Effect.succeed(null)
                : knowledge.governs(ctx.session, "tool" in ctx ? ctx.paths : []),
          },
        ],
        // Before a jj landing command, the knowledge trailers it should carry (a read, never a
        // verdict); before an edit, the one verdict the plugin gives: no write into a harness memory
        // the project keeps off.
        preTool: {
          on: "all",
          decide: (ctx) =>
            ctx.tool === "Bash" ? knowledge.beforeShell(ctx) : knowledge.beforeEdit(ctx),
          fallback: () => null,
        },
        postTool: (ctx) => knowledge.afterTool(ctx),
      },
      indexSource: {
        entries: knowledge.entries,
        section: (entries, shown, full) =>
          knowledgeIndexText(entries.map(known), { cli: "peer", shown, titles: full !== true }),
      },
      beforeReview: ({ session, remainingMs }) => knowledge.review(session, remainingMs),
      hubChanges: knowledge.hubChanges,
      status: { read: knowledge.waiting },
      rpc: {
        group: KnowledgeRpcGroup,
        handlers: (wrap) =>
          KnowledgeRpcGroup.of({
            [methods.peerHubKnowledgeCandidates]: (input) =>
              wrap.effect(methods.peerHubKnowledgeCandidates, knowledge.candidates(input), TRACE),
            [methods.peerHubDecideCandidate]: (input) =>
              wrap.effect(methods.peerHubDecideCandidate, knowledge.decide(input), TRACE),
            [methods.peerHubKnowledgeStatus]: (input) =>
              wrap.effect(methods.peerHubKnowledgeStatus, knowledge.status(input), TRACE),
            [methods.peerHubSetupKnowledge]: (input) =>
              wrap.effect(methods.peerHubSetupKnowledge, knowledge.setup(input), TRACE),
            [methods.peerHubKeepCandidate]: (input) =>
              wrap.effect(methods.peerHubKeepCandidate, knowledge.keep(input), TRACE),
            [methods.peerHubHarvestContext]: (input) =>
              wrap.effect(methods.peerHubHarvestContext, knowledge.harvest(input), TRACE),
            [methods.peerHubImproveGuidance]: (input) =>
              wrap.effect(methods.peerHubImproveGuidance, knowledge.improve(input), TRACE),
            [methods.peerKnowledgeChallenges]: (input) =>
              wrap.effect(methods.peerKnowledgeChallenges, knowledge.challenges(input)),
            [methods.peerKnowledgeEntry]: (input) =>
              wrap.effect(methods.peerKnowledgeEntry, knowledge.entry(input)),
            [methods.peerKnowledgeOpenChallenge]: (input) =>
              wrap.effect(methods.peerKnowledgeOpenChallenge, knowledge.openChallenge(input)),
            [methods.peerKnowledgeDecideChallenge]: (input) =>
              wrap.effect(methods.peerKnowledgeDecideChallenge, knowledge.decideChallenge(input)),
            [methods.peerKnowledgeDraftReplacement]: (input) =>
              wrap.effect(methods.peerKnowledgeDraftReplacement, knowledge.draftReplacement(input)),
            [methods.peerKnowledgeRelated]: (input) =>
              wrap.effect(methods.peerKnowledgeRelated, knowledge.related(input)),
            [methods.peerKnowledgeVerifyEntry]: (input) =>
              wrap.effect(methods.peerKnowledgeVerifyEntry, knowledge.verifyEntry(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});
