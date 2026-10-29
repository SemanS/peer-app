// @effect-diagnostics nodeBuiltinImport:off - synthetic Codex homes exercise the real filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it, expect } from "@effect/vitest";
import {
  installCodexPeerHooks,
  readCodexPeerHookReview,
  trustCodexPeerHooks,
  trustConfiguredCodexPeerHooks,
} from "./codexHooks.ts";
import { codexPluginContentHash } from "./codexPlugin.ts";

const appendInstalledConfig = async (home: string, text: string) =>
  text + "\n" + (await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"));

async function fixture(
  run: (home: string, scripts: { hook: string; wait: string }) => Promise<void>,
) {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-codex-hooks-"));
  try {
    const scripts = {
      hook: NodePath.join(home, "coord", "hook"),
      wait: NodePath.join(home, "coord", "wait"),
    };
    await NodeFSP.mkdir(NodePath.dirname(scripts.hook));
    await NodeFSP.writeFile(scripts.hook, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await run(home, scripts);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
}

describe("Codex Peer hook review", () => {
  it.each([
    '[hooks.state]\n"KEY" = { trusted_hash = "sha256:old", enabled = false }\n',
    'hooks = { state = { "KEY" = { trusted_hash = "sha256:old", enabled = false } } }\n',
    '[hooks."state"."KEY"]\ntrusted_hash = "sha256:old"\nenabled = false\n',
    '["hooks".state."KEY"]\ntrusted_hash = "sha256:old"\nenabled = false\n',
    "[hooks.state.'KEY']\ntrusted_hash = 'sha256:old'\nenabled = false\n",
    '[ hooks . state . "KEY" ]\ntrusted_hash = "sha256:old"\nenabled = false\n',
    '[hooks]\n"state" = { "KEY" = { enabled = false } }\n',
    '"hooks"."state"."KEY" = { enabled = false }\n',
    '[hooks.state."KEY"]\n"enabled" = false\n',
  ])("leaves an unsupported TOML state layout untouched: %s", async (template) => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const config = await appendInstalledConfig(
        home,
        template.replaceAll("KEY", review.hooks[0]!.key),
      );
      const configPath = NodePath.join(home, "config.toml");
      await NodeFSP.writeFile(configPath, config);
      await expect(trustCodexPeerHooks(home, scripts, review.reviewId)).rejects.toThrow(
        /review.*Codex/i,
      );
      assert.strictEqual(await NodeFSP.readFile(configPath, "utf8"), config);
    });
  });

  it("leaves a dangling config symlink intact instead of replacing it during installation", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const target = NodePath.join(home, "absent-config.toml");
      const link = NodePath.join(home, "config.toml");
      await NodeFSP.rm(link);
      await NodeFSP.symlink(target, link);
      await expect(installCodexPeerHooks(home, scripts, true)).rejects.toThrow(/symlink.*missing/i);
      assert.strictEqual(await NodeFSP.readlink(link), target);
      await expect(NodeFSP.stat(target)).rejects.toThrow(/ENOENT/);
    });
  });

  it("preserves non-state hook options and empty parent state tables", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const config =
        "[hooks]\nallow_managed_hooks_only = false # personal option\n\n[hooks.state]\n# no inline entries\n";
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        await appendInstalledConfig(home, config),
      );
      const after = await trustCodexPeerHooks(home, scripts, review.reviewId);
      assert.isTrue(after.trusted);
      assert.isTrue(
        (await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8")).startsWith(config),
      );
    });
  });

  it("rejects approval of a home that was removed from the environment's provider configuration", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const before = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      await expect(
        trustConfiguredCodexPeerHooks(
          [`${home}/other-profile`],
          { home, reviewId: review.reviewId },
          scripts,
        ),
      ).rejects.toThrow(/no longer configured/);
      assert.strictEqual(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        before,
      );
    });
  });
  it("invalidates the review when the installed script contents change", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      await NodeFSP.writeFile(scripts.hook, "#!/bin/sh\necho changed\n");
      await expect(trustCodexPeerHooks(home, scripts, review.reviewId)).rejects.toThrow(/review/i);
    });
  });

  it("approves the plugin's files with the hooks, and asks again once a Peer update rewrites them", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const installedRoot = NodePath.dirname(NodePath.dirname(review.hooksPath));
      assert.strictEqual(review.contentHash, await codexPluginContentHash(installedRoot));
      const trusted = await trustCodexPeerHooks(home, scripts, review.reviewId);
      assert.isTrue(trusted.trusted);
      const config = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      assert.strictEqual(
        (config.match(/^trusted_content_hash = "sha256:[0-9a-f]{64}"$/gm) ?? []).length,
        9,
      );
      assert.include(config, `trusted_content_hash = ${JSON.stringify(review.contentHash)}`);
      // Codex compares the files at each run: an approval of the old files no longer counts.
      const moved = { hook: NodePath.join(home, "elsewhere", "hook"), wait: scripts.wait };
      await NodeFSP.mkdir(NodePath.dirname(moved.hook));
      await NodeFSP.copyFile(scripts.hook, moved.hook);
      await installCodexPeerHooks(home, moved, true);
      const rewritten = await readCodexPeerHookReview(home, moved);
      assert.isTrue(rewritten.installed);
      assert.isFalse(rewritten.trusted);
      assert.notStrictEqual(rewritten.contentHash, review.contentHash);
      assert.notStrictEqual(rewritten.reviewId, review.reviewId);
      assert.isTrue(
        rewritten.hooks.every(
          (hook) => hook.hash === review.hooks.find((h) => h.key === hook.key)?.hash,
        ),
      );
      const again = await trustCodexPeerHooks(home, moved, rewritten.reviewId);
      assert.isTrue(again.trusted);
      const next = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      assert.include(next, `trusted_content_hash = ${JSON.stringify(rewritten.contentHash)}`);
      assert.notInclude(next, `trusted_content_hash = ${JSON.stringify(review.contentHash)}`);
      assert.strictEqual((next.match(/^\[hooks\.state\./gm) ?? []).length, 9);
    });
  });

  it("treats an approval without the plugin's fingerprint as not trusted", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      await trustCodexPeerHooks(home, scripts, review.reviewId);
      const configPath = NodePath.join(home, "config.toml");
      const config = await NodeFSP.readFile(configPath, "utf8");
      await NodeFSP.writeFile(configPath, config.replace(/^trusted_content_hash = .*\n/m, ""));
      const partial = await readCodexPeerHookReview(home, scripts);
      assert.isFalse(partial.trusted);
      assert.strictEqual(partial.hooks.filter((hook) => !hook.trusted).length, 1);
      assert.isTrue((await trustCodexPeerHooks(home, scripts, partial.reviewId)).trusted);
    });
  });

  it("keeps a person's disabled Peer hook disabled when granting trust", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const disabled = `[hooks.state.${JSON.stringify(review.hooks[0]!.key)}]\nenabled = false # intentionally off\n`;
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        await appendInstalledConfig(home, disabled),
      );
      const after = await trustCodexPeerHooks(home, scripts, review.reviewId);
      assert.isFalse(after.trusted);
      assert.isFalse(after.hooks[0]!.enabled);
      assert.include(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        "enabled = false # intentionally off",
      );
    });
  });

  it("installs nine plugin hooks without trusting any, then approves only the exact reviewed Peer hooks", async () => {
    await fixture(async (home, scripts) => {
      const foreign = { type: "command", command: "echo /peer/coord/foreign" };
      await NodeFSP.writeFile(
        NodePath.join(home, "hooks.json"),
        JSON.stringify({ hooks: { Stop: [{ hooks: [foreign] }] } }),
      );
      const config =
        '# personal settings\nmodel = "gpt-5"\n[hooks.state."foreign"]\ntrusted_hash = "sha256:foreign"\nenabled = false\n';
      await NodeFSP.writeFile(NodePath.join(home, "config.toml"), config);
      await installCodexPeerHooks(home, scripts, true);
      const before = await readCodexPeerHookReview(home, scripts);
      assert.isTrue(before.installed);
      assert.isFalse(before.trusted);
      assert.strictEqual(before.hooks.length, 9);
      assert.isTrue(
        before.hooks.every((hook) => hook.command === 'sh "${PLUGIN_ROOT}/scripts/hook.sh"'),
      );
      await trustCodexPeerHooks(home, scripts, before.reviewId);
      const after = await readCodexPeerHookReview(home, scripts);
      assert.isTrue(after.trusted);
      assert.strictEqual(after.reviewId, before.reviewId);
      assert.isTrue(
        (await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8")).startsWith(config),
      );
      assert.deepStrictEqual(
        JSON.parse(await NodeFSP.readFile(NodePath.join(home, "hooks.json"), "utf8")).hooks.Stop[0]
          .hooks[0],
        foreign,
      );
    });
  });

  it("requires a fresh review after a hook changes and never approves a command containing the Peer path", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const hookPath = review.hooksPath;
      const config = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      const hooks = JSON.parse(await NodeFSP.readFile(hookPath, "utf8"));
      hooks.hooks.Stop[0].hooks[0].command += " && echo unsafe";
      await NodeFSP.writeFile(hookPath, JSON.stringify(hooks));
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).installed);
      await expect(trustCodexPeerHooks(home, scripts, review.reviewId)).rejects.toThrow(
        /review|installed/i,
      );
      assert.strictEqual(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        config,
      );
    });
  });

  it("does not report partial, disabled, or stale-hash installations as ready", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      await trustCodexPeerHooks(home, scripts, review.reviewId);
      const configPath = NodePath.join(home, "config.toml");
      const trusted = await NodeFSP.readFile(configPath, "utf8");
      await NodeFSP.writeFile(configPath, trusted.replace("enabled = true", "enabled = false"));
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).trusted);
      await NodeFSP.writeFile(configPath, trusted.replace(review.hooks[0]!.hash, "sha256:stale"));
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).trusted);
      const hookPath = review.hooksPath;
      const hooks = JSON.parse(await NodeFSP.readFile(hookPath, "utf8"));
      delete hooks.hooks.SessionStart;
      await NodeFSP.writeFile(hookPath, JSON.stringify(hooks));
      assert.isTrue((await readCodexPeerHookReview(home, scripts)).present);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).installed);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).trusted);
    });
  });

  it("shares plugin trust with a shadow home while preserving shared config and package links", async () => {
    await fixture(async (home, scripts) => {
      const shadow = NodePath.join(home, "shadow");
      await NodeFSP.mkdir(shadow);
      await NodeFSP.writeFile(NodePath.join(home, "config.toml"), 'model = "gpt-5"\n');
      await installCodexPeerHooks(home, scripts, true);
      await NodeFSP.symlink(
        NodePath.join(home, "config.toml"),
        NodePath.join(shadow, "config.toml"),
      );
      await NodeFSP.symlink(NodePath.join(home, "plugins"), NodePath.join(shadow, "plugins"));
      const native = await readCodexPeerHookReview(home, scripts);
      await trustCodexPeerHooks(home, scripts, native.reviewId);
      const managed = await readCodexPeerHookReview(shadow, scripts);
      assert.isTrue(managed.trusted);
      assert.notStrictEqual(managed.reviewId, native.reviewId);
      await trustCodexPeerHooks(shadow, scripts, managed.reviewId);
      assert.isTrue((await readCodexPeerHookReview(shadow, scripts)).trusted);
      assert.isTrue((await readCodexPeerHookReview(home, scripts)).trusted);
      assert.strictEqual(
        await NodeFSP.readlink(NodePath.join(shadow, "config.toml")),
        NodePath.join(home, "config.toml"),
      );
    });
  });

  it("removes only Peer hooks and leaves unrelated hook trust and config untouched", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      await trustCodexPeerHooks(home, scripts, review.reviewId);
      const config = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      await installCodexPeerHooks(home, scripts, false);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).present);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).installed);
      assert.strictEqual(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        config.replace(
          '[plugins."peer@peer"]\nenabled = true',
          '[plugins."peer@peer"]\nenabled = false',
        ),
      );
    });
  });

  /**
   * The files `herdr integration install codex` wrote in 0.9.3, recorded by running the pinned
   * binary in a fresh CODEX_HOME. herdr merges its own SessionStart hook into hooks.json, enables
   * Codex hooks in config.toml and keeps a hook script beside them; it reorders keys alphabetically
   * and keeps hooks it did not write (also checked the other way round with Peer's hooks in place).
   */
  const herdrCodexFiles = (home: string) => ({
    hooks: {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                command: `bash '${NodePath.join(home, "herdr-agent-state.sh")}' session`,
                timeout: 10,
                type: "command",
              },
            ],
          },
        ],
      },
    },
    config: "[features]\nhooks = true\n",
  });

  it("keeps the SessionStart hook herdr's Codex integration installed, through install, trust and removal", async () => {
    await fixture(async (home, scripts) => {
      const herdr = herdrCodexFiles(home);
      const hooksPath = NodePath.join(home, "hooks.json");
      const configPath = NodePath.join(home, "config.toml");
      await NodeFSP.writeFile(hooksPath, `${JSON.stringify(herdr.hooks, null, 2)}\n`);
      await NodeFSP.writeFile(configPath, herdr.config);

      await installCodexPeerHooks(home, scripts, true);
      const installed = JSON.parse(await NodeFSP.readFile(hooksPath, "utf8"));
      assert.deepStrictEqual(installed.hooks.SessionStart[0], herdr.hooks.hooks.SessionStart[0]);
      assert.strictEqual(
        installed.hooks.SessionStart.length,
        1,
        "Peer's hooks belong to the plugin",
      );
      const review = await readCodexPeerHookReview(home, scripts);
      assert.isTrue(review.installed);
      assert.isTrue(review.present);

      // Installing again changes nothing, and trusting Peer's hooks leaves herdr's settings be.
      const text = await NodeFSP.readFile(hooksPath, "utf8");
      await installCodexPeerHooks(home, scripts, true);
      assert.strictEqual(await NodeFSP.readFile(hooksPath, "utf8"), text);
      assert.isTrue((await trustCodexPeerHooks(home, scripts, review.reviewId)).trusted);
      assert.isTrue((await NodeFSP.readFile(configPath, "utf8")).startsWith(herdr.config));

      await installCodexPeerHooks(home, scripts, false);
      assert.deepStrictEqual(JSON.parse(await NodeFSP.readFile(hooksPath, "utf8")), herdr.hooks);
    });
  });

  it("trusts Peer's hooks beside keys named hooks or state in other tables", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      const config = '[features]\nhooks = true\n\n[mcp_servers.demo]\nstate = "on"\n';
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        await appendInstalledConfig(home, config),
      );
      const after = await trustCodexPeerHooks(home, scripts, review.reviewId);
      assert.isTrue(after.trusted);
      assert.isTrue(
        (await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8")).startsWith(config),
      );
    });
  });

  it("leaves herdr's hook alone when it was installed after Peer's", async () => {
    await fixture(async (home, scripts) => {
      const herdr = herdrCodexFiles(home);
      const hooksPath = NodePath.join(home, "hooks.json");
      await installCodexPeerHooks(home, scripts, true);
      // herdr's installer appends its group to SessionStart and keeps Peer's groups as they are.
      const both = herdr.hooks;
      await NodeFSP.writeFile(hooksPath, `${JSON.stringify(both, null, 2)}\n`);
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        await appendInstalledConfig(home, herdr.config),
      );

      const text = await NodeFSP.readFile(hooksPath, "utf8");
      await installCodexPeerHooks(home, scripts, true);
      assert.strictEqual(await NodeFSP.readFile(hooksPath, "utf8"), text);
      assert.isTrue((await readCodexPeerHookReview(home, scripts)).installed);

      await installCodexPeerHooks(home, scripts, false);
      assert.deepStrictEqual(JSON.parse(await NodeFSP.readFile(hooksPath, "utf8")), herdr.hooks);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).present);
    });
  });

  it("keeps plugin trust independent of CODEX_HOME symlinks", async () => {
    await fixture(async (root, scripts) => {
      const real = NodePath.join(root, "real-home");
      const linked = NodePath.join(root, "linked-home");
      await NodeFSP.mkdir(real);
      await NodeFSP.symlink(real, linked);
      await installCodexPeerHooks(linked, scripts, true);
      const review = await readCodexPeerHookReview(linked, scripts);
      assert.strictEqual(review.home, linked);
      assert.isTrue(
        review.hooks.every((hook) => hook.key.startsWith("peer@peer:hooks/hooks.json:")),
      );
      await trustConfiguredCodexPeerHooks([linked], review, scripts);
      const config = await NodeFSP.readFile(NodePath.join(real, "config.toml"), "utf8");
      assert.include(config, `[hooks.state.${JSON.stringify(review.hooks[0]!.key)}]`);
      assert.notInclude(config, `"${linked}/hooks.json:`);
      assert.isTrue((await readCodexPeerHookReview(linked, scripts)).trusted);
    });
  });
});
