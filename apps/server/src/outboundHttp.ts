import * as NodeModule from "node:module";

import type * as Undici from "undici";

// undici stays external to the CLI bundle (scripts/lib/cli-external-packages.ts).
// Inside a Node single-executable only `require` can load it from disk.
const requireUndici = NodeModule.createRequire(import.meta.url);

/**
 * Node's `--use-env-proxy` / `NODE_USE_ENV_PROXY` installs an
 * `EnvHttpProxyAgent` at startup; that choice is kept so proxies still apply.
 */
export function installHttp1FetchDispatcher(): void {
  const undici = requireUndici("undici") as typeof Undici;
  // Node's agent comes from its internal undici copy, so `instanceof` against the npm class is false.
  const usesEnvProxy = undici.getGlobalDispatcher().constructor.name === "EnvHttpProxyAgent";
  undici.setGlobalDispatcher(
    usesEnvProxy
      ? new undici.EnvHttpProxyAgent({
          allowH2: false,
          // The connection to an HTTPS proxy is built here, not from `allowH2`. ProxyAgent's
          // `connect` option is dropped on purpose: its connector has h2 fixed on.
          clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
        })
      : new undici.Agent({ allowH2: false }),
  );
}

/**
 * Use the patched npm web APIs instead of Electron/Node's bundled undici.
 * An undici HTTP/2 session that hits its idle timeout can emit `'error'` on a
 * stream with no listener, which Node turns into an uncaught exception that
 * exits the server (https://github.com/nodejs/undici/issues/5936).
 */
export function keepOutboundFetchOnHttp1(): void {
  const undici = requireUndici("undici") as typeof Undici;
  undici.install();
  installHttp1FetchDispatcher();
}
