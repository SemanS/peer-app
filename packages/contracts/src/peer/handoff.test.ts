import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import fixture from "./handoff.fixture.json" with { type: "json" };
import { PeerHandoffPackage, PeerHandoffSummary } from "./handoff.ts";
import { HandoffRpcScopes, PEER_HANDOFF_METHODS } from "./handoff.rpc.ts";
import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
} from "../auth.ts";
const decodePackage = Schema.decodeUnknownSync(PeerHandoffPackage);
const decodeSummary = Schema.decodeUnknownSync(PeerHandoffSummary);
describe("handoff wire", () => {
  it("decodes golden package and drops unknown nested fields", () => {
    const p = decodePackage({
      ...fixture,
      future: true,
      context: {
        ...fixture.context,
        future: true,
        sections: fixture.context.sections.map((s) => ({ ...s, future: true })),
      },
      inputs: fixture.inputs.map((i) => ({ ...i, future: true })),
    });
    expect(p).toEqual(fixture);
    const summary = decodeSummary({
      project: p.project,
      task: p.task,
      author: p.author,
      number: p.number,
      composedAt: p.composedAt,
      contextVersion: p.context?.version ?? null,
      pullRequests: p.pullRequests.length,
      source: p.source,
      gist: "never",
    });
    expect(summary).not.toHaveProperty("gist");
  });
  it("decodes a package of an older Hub, without a test report", () => {
    const { report: _report, ...older } = fixture;
    const p = decodePackage(older);
    expect(p.report).toBeUndefined();
    expect(p).toEqual(older);
    expect(decodePackage(fixture).report?.unowned).toEqual(["iPhone layout of the task page"]);
  });
  it("authorizes the four surfaces separately", () => {
    expect(HandoffRpcScopes).toEqual({
      [PEER_HANDOFF_METHODS.peerHandoffRead]: AuthOrchestrationReadScope,
      [PEER_HANDOFF_METHODS.peerHandoffHandOff]: AuthOrchestrationOperateScope,
      [PEER_HANDOFF_METHODS.peerHandoffWithdraw]: AuthOrchestrationOperateScope,
      [PEER_HANDOFF_METHODS.peerHandoffSetTarget]: AuthAccessWriteScope,
    });
  });
});
