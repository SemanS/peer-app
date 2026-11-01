import * as BuiltInDrivers from "./builtInDrivers.ts";
import { SourceControlProviderKind } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";
import { HttpClient } from "effect/http";
import { VcsProcessSpawnError } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AzureDevOpsCli from "../../../../packages/source-control-azure-devops/src/server/AzureDevOpsCli.ts";
import * as AzureDevOpsPullRequestCli from "../../../../packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestCli.ts";
import * as BitbucketApi from "../../../../packages/source-control-bitbucket/src/server/BitbucketApi.ts";
import * as BitbucketPullRequestApi from "../../../../packages/source-control-bitbucket/src/server/BitbucketPullRequestApi.ts";
import * as GitHubRest from "../../../../packages/source-control-github/src/server/GitHubRest.ts";
import * as GitHubRequestPolicy from "../../../../packages/source-control-github/src/server/GitHubRequestPolicy.ts";
import * as GitHubPullRequestApi from "../../../../packages/source-control-github/src/server/GitHubPullRequestApi.ts";
import * as GitLabCli from "../../../../packages/source-control-gitlab/src/server/GitLabCli.ts";
import * as GitLabPullRequestCli from "../../../../packages/source-control-gitlab/src/server/GitLabPullRequestCli.ts";
import * as ForgejoCli from "../../../../packages/source-control-forgejo/src/server/ForgejoCli.ts";
import * as GitCafeApi from "../../../../packages/source-control-gitcafe/src/server/GitCafeApi.ts";
import * as GitCafeCredentials from "../../../../packages/source-control-gitcafe/src/server/GitCafeCredentials.ts";
import * as SourceControlDiscovery from "./SourceControlDiscovery.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";
import * as ServerSourceControlHost from "./ServerSourceControlHost.ts";

const layerSourceControlProviderRegistryTest = (input: {
  readonly bitbucket: Partial<BitbucketApi.BitbucketApi["Service"]>;
  readonly process: Partial<VcsProcess.VcsProcess["Service"]>;
}) =>
  SourceControlProviderRegistry.layer.pipe(
    Layer.provide(BuiltInDrivers.layer),
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-source-control-registry-test-",
        }).pipe(Layer.provide(NodeServices.layer)),
        Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
        Layer.mock(AzureDevOpsPullRequestCli.AzureDevOpsPullRequestCli)({}),
        Layer.mock(BitbucketApi.BitbucketApi)(input.bitbucket),
        Layer.mock(BitbucketPullRequestApi.BitbucketPullRequestApi)({}),
        ServerSettings.ServerSettingsService.layerTest(),
        Layer.mock(GitHubPullRequestApi.GitHubPullRequestApi)({}),
        Layer.mock(GitHubRest.GitHubRest)({}),
        // The GitHub provider's GraphQL reads go through these; no test here makes one.
        Layer.mock(GitHubRequestPolicy.GitHubRequestPolicy)({}),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die(new Error("Unexpected GitHub GraphQL read"))),
        ),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        Layer.mock(GitLabCli.GitLabCli)({}),
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({}),
        Layer.mock(ForgejoCli.ForgejoCli)({ listLogins: () => Effect.succeed([]) }),
        Layer.mock(GitCafeApi.GitCafeApi)({}),
        Layer.mock(GitCafeCredentials.GitCafeCredentials)({
          cliEnv: () => Effect.succeed({}),
        }),
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({}),
        Layer.mock(VcsProcess.VcsProcess)(input.process),
        ServerSourceControlHost.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(VcsProcess.VcsProcess)(input.process),
              ServerSettings.ServerSettingsService.layerTest(),
              Layer.mock(GitVcsDriver.GitVcsDriver)({}),
              Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({}),
            ),
          ),
        ),
      ),
    ),
  );

const processOutput = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.effect("reports implemented tools separately from locally available executables", () => {
  const processMock = {
    run: (input: VcsProcess.VcsProcessInput) => {
      if (input.command === "git") {
        return Effect.succeed(processOutput("git version 2.51.0\n"));
      }
      if (input.command === "gh" && input.args[0] === "--version") {
        return Effect.succeed(processOutput("gh version 2.83.0\n"));
      }
      if (input.command === "gh" && input.args.join(" ") === "auth status --json hosts") {
        return Effect.succeed(
          processOutput(
            encodeJson({
              hosts: {
                "github.com": [
                  {
                    state: "success",
                    active: true,
                    host: "github.com",
                    login: "juliusmarminge",
                    tokenSource: "keyring",
                    gitProtocol: "ssh",
                  },
                ],
              },
            }),
          ),
        );
      }
      return Effect.fail(
        new VcsProcessSpawnError({
          operation: input.operation,
          command: input.command,
          cwd: input.cwd,
          cause: new Error(`${input.command} not found`),
        }),
      );
    },
  } satisfies Partial<VcsProcess.VcsProcess["Service"]>;
  const layerTest = SourceControlDiscovery.layer.pipe(
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-source-control-discovery-",
      }),
    ),
    Layer.provide(Layer.mock(VcsProcess.VcsProcess)(processMock)),
    Layer.provide(
      layerSourceControlProviderRegistryTest({
        process: processMock,
        bitbucket: {
          probeAuth: Effect.succeed({
            status: "unauthenticated",
            account: Option.none(),
            host: Option.some("bitbucket.org"),
            detail: Option.some(
              "Add a Bitbucket token in Settings → Source Control, or set the T3CODE_BITBUCKET_* environment variables on the server.",
            ),
          }),
        },
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

  return Effect.gen(function* () {
    const discovery = yield* SourceControlDiscovery.SourceControlDiscovery;
    const result = yield* discovery.discover;

    assert.deepStrictEqual(
      result.versionControlSystems.map((item) => ({
        kind: item.kind,
        implemented: item.implemented,
        status: item.status,
      })),
      [
        { kind: "git", implemented: true, status: "available" },
        { kind: "jj", implemented: true, status: "missing" },
      ],
    );
    assert.deepStrictEqual(
      result.sourceControlProviders
        .map((item) => ({
          kind: item.kind,
          status: item.status,
          auth: item.auth.status,
          account: item.auth.account,
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
      [
        {
          kind: SourceControlProviderKind.make("github"),
          status: "available",
          auth: "authenticated",
          account: Option.some("juliusmarminge"),
        },
        {
          kind: SourceControlProviderKind.make("gitlab"),
          status: "missing",
          auth: "unknown",
          account: Option.none(),
        },
        {
          kind: SourceControlProviderKind.make("azure-devops"),
          status: "missing",
          auth: "unknown",
          account: Option.none(),
        },
        {
          kind: SourceControlProviderKind.make("bitbucket"),
          status: "available",
          auth: "unauthenticated",
          account: Option.none(),
        },
        {
          kind: SourceControlProviderKind.make("forgejo"),
          status: "missing",
          auth: "unknown",
          account: Option.none(),
        },
        {
          kind: SourceControlProviderKind.make("gitcafe"),
          status: "missing",
          auth: "unknown",
          account: Option.none(),
        },
      ].sort((a, b) => a.kind.localeCompare(b.kind)),
    );
    const bitbucket = result.sourceControlProviders.find((item) => item.kind === "bitbucket");
    assert.ok(bitbucket);
    assert.strictEqual(bitbucket.executable, undefined);
  }).pipe(Effect.provide(layerTest));
});
