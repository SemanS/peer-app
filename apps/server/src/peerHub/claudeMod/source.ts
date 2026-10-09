import { TEXT } from "../core/broker/cliContract.ts";

/**
 * Plain JavaScript shipped inside Peer's server bundle, like its coordination scripts.
 * Keep runtime policy in the broker: this module only translates Claude's events.
 * Claude Code 2.1.291 types and https://code.claude.com/docs/en/plugins/mods/reference
 * define the API used here. No model or credential API is used.
 */
export const PEER_MOD_SOURCE = String.raw`
let socketPath = __PEER_SOCKET__;
const peerBin = __PEER_BIN__;
  const contract = ${JSON.stringify(TEXT)};
  let sessionToken;
  let processStarted = false;
  let sessionId;
  let cwd;
  let pane;
  let enabled;
  let interactive = false;
  let closed = false;
  let waitEpoch = 0;
  let waitTimer;
  let status = 'Peer: connecting';
  let board = '';
  const pending = new Map();

  function cancelWake() {
    waitEpoch += 1;
    if (waitTimer) waitTimer.cancel();
    waitTimer = undefined;
  }

  async function identity($) {
    if (enabled === undefined) enabled = (await $.env.get('PEER_COORDINATION')) !== 'off';
    if (!enabled) return false;
    sessionId = await $.session.id();
    cwd = await $.session.cwd();
    pane = await $.env.get('HERDR_PANE_ID');
    return true;
  }

  async function credential($, rotate = false) {
    if (!sessionToken || rotate) sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    await $.env.set('PEER_SESSION', sessionId);
    await $.env.set('PEER_SESSION_TOKEN', sessionToken);
    const currentPath = await $.env.get('PATH');
    const path = typeof currentPath === 'string' ? currentPath : '/usr/bin:/bin';
    if (!path.split(':').includes(peerBin)) await $.env.set('PATH', peerBin + (path ? ':' + path : ''));
  }

  function show($, text) {
    status = text;
    $.ui.status(text);
    $.ui.invalidate('ui.render');
  }

  async function available($) {
    if (!(await identity($))) return false;
    if (!(await $.fs.exists(socketPath))) {
      show($, 'Peer: not running');
      return false;
    }
    return true;
  }

  function bounded($, promise, milliseconds) {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = $.clock.after(milliseconds, () => reject(new Error('Peer decision timed out. Retry the action.')));
    });
    return Promise.race([promise, deadline]).finally(() => timer.cancel());
  }

  async function request($, path, body, milliseconds = 8000) {
    const response = await bounded($, $.http.fetch('http://peer' + path, {
      socketPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Peer-Agent': 'claude',
        'X-Peer-Adapter': 'mod',
        'X-Peer-Session': path.startsWith('/cli/') ? 'claude:' + sessionId : sessionId,
        'X-Herdr-Pane': pane || '',
        'X-Peer-Cwd': cwd,
        ...(sessionToken ? { 'X-Peer-Session-Token': sessionToken } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }), milliseconds);
    if (!response.ok) throw new Error('Peer broker returned HTTP ' + response.status);
    return response;
  }

  function remember(response) {
    const delivery = response.peerDelivery;
    if (delivery && typeof delivery.id === 'string' && typeof delivery.text === 'string' && delivery.text) {
      // A successful socket response is only an offer. Verify it in a model request later.
      pending.set(delivery.id, { ...delivery, sessionId });
      if (pending.size > 128) pending.delete(pending.keys().next().value);
    }
  }

  function classicResult(response, eventName) {
    const specific = response.hookSpecificOutput || {};
    const result = {};
    if (response.decision === 'block') result.block = response.reason || 'Peer blocked this action.';
    if (response.continue === false) result.preventContinuation = true;
    if (typeof response.stopReason === 'string') result.stopReason = response.stopReason;
    if (['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'].includes(eventName)
      && typeof specific.additionalContext === 'string' && specific.additionalContext) {
      result.additionalContext = [specific.additionalContext];
    }
    return result;
  }

  function merge(downstream, ours) {
    const result = { ...downstream, ...ours };
    if (downstream.block) result.block = downstream.block;
    if (downstream.preventContinuation) result.preventContinuation = true;
    const context = [...(downstream.additionalContext || []), ...(ours.additionalContext || [])];
    if (context.length) result.additionalContext = context;
    return result;
  }

  async function classic($, event, next) {
    if (!(await available($))) return next(event);
    // Register the mod before next(): the broker suppresses Peer's fallback settings hook.
    const raw = await request($, '/hook', event, event.hook_event_name === 'SessionEnd' ? 1000 : 8000);
    const response = raw.text ? JSON.parse(raw.text) : {};
    if (typeof response.peerStatus === 'string') show($, response.peerStatus);
    remember(response);
    return merge(await next(event), classicResult(response, event.hook_event_name));
  }

  function startWait($) {
    cancelWake();
    if (!enabled || !interactive || closed) return;
    const epoch = waitEpoch;
    const expectedSession = sessionId;
    waitTimer = $.clock.after(0, () => {
      void (async () => {
        try {
          // HttpInit has no abort signal on this CLI. Logical cancellation rejects late wakes.
          const response = await request($, '/hook/wait', {
            session_id: expectedSession, cwd, timeout_ms: 25000,
          }, 30000);
          if (epoch !== waitEpoch || closed || expectedSession !== sessionId) return;
          if (response.text.trim()) await $.prompt.submit({ text: response.text });
          else startWait($);
        } catch {
          if (epoch !== waitEpoch || closed) return;
          show($, 'Peer: waiting for connection');
          waitTimer = $.clock.after(5000, () => startWait($));
        }
      })();
    });
  }

  function textBlocks(content) {
    if (typeof content === 'string') return [content];
    if (!Array.isArray(content)) return [];
    return content.flatMap(block => {
      if (block.type === 'text' && typeof block.text === 'string') return [block.text];
      if (block.type === 'tool_result') return textBlocks(block.content);
      return [];
    });
  }

  function outcome(command, cause) {
    return contract.uncertain.replace('%s', cause).replace('%s', command)
      + '\nNext: ' + (command === 'request' ? contract.repeat : contract.check);
  }
  async function cliRequest($, command, body) {
    try {
      if (!(await identity($)) || !(await $.fs.exists(socketPath)))
        return { ok: false, text: contract.notRunning + '\nNext: ' + contract.start };
      const response = await bounded($, $.http.fetch('http://peer/cli/' + command, {
        socketPath, method: 'POST', headers: {
          'Content-Type': 'text/plain', 'X-Peer-Agent': 'claude', 'X-Peer-Adapter': 'mod',
          'X-Peer-Session': 'claude:' + sessionId, 'X-Peer-Cwd': cwd,
          ...(sessionToken ? { 'X-Peer-Session-Token': sessionToken } : {}),
        }, body,
      }), 8000);
      if (response.ok) return { ok: true, text: response.text };
      if ([400, 409, 500].includes(response.status) && response.text)
        return { ok: false, text: response.text };
      return { ok: false, text: outcome(command, 'Peer answered with unexpected HTTP ' + response.status) };
    } catch (error) {
      return { ok: false, text: outcome(command, error.message === 'Peer decision timed out. Retry the action.'
        ? contract.timeout.replace('%s', '8') : contract.lost) };
    }
  }
  async function cli($, command, args = []) {
    if (args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 20000))
      return { ok: false, text: 'peer: usage: Peer command arguments must be bounded text without NUL.\nNext: run peer help for the commands.' };
    return cliRequest($, command, args.length ? args.join('\0') + '\0' : '');
  }

export function register(on, options = {}) {
  if (typeof options.socketPath === 'string') socketPath = options.socketPath;
  on('classic.SessionStart', async ($, event, next) => {
    if (await identity($)) await credential($);
    closed = false;
    cancelWake();
    return classic($, event, next);
  }).catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });
  on('classic.UserPromptSubmit', async ($, event, next) => {
    cancelWake();
    return classic($, event, next);
  }).catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });
  on('classic.PostToolUse', ($, event, next) => classic($, event, next))
    .catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });
  on('classic.Notification', ($, event, next) => classic($, event, next))
    .catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });
  on('classic.PreCompact', ($, event, next) => classic($, event, next))
    .catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });
  on('classic.SessionEnd', async ($, event, next) => {
    closed = true;
    cancelWake();
    pending.clear();
    return classic($, event, next);
  }).catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });

  on('classic.PreToolUse', async ($, event, next) => {
    // Bash mutations remain observable afterwards; the broker also gates publication.
    if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'].includes(event.tool)) return next(event);
    if (!(await available($))) return next(event);
    const { tool, tool_use_id, ...input } = event;
    const raw = await request($, '/hook', {
      hook_event_name: 'PreToolUse', session_id: sessionId, cwd,
      tool_name: tool, tool_use_id, tool_input: input,
    });
    const response = raw.text ? JSON.parse(raw.text) : {};
    if (typeof response.peerStatus === 'string') show($, response.peerStatus);
    remember(response);
    const specific = response.hookSpecificOutput || {};
    const context = typeof specific.additionalContext === 'string' && specific.additionalContext
      ? [specific.additionalContext] : [];
    if (specific.permissionDecision === 'deny') {
      return { deny: specific.permissionDecisionReason || 'Peer blocked this action.', ...(context.length ? { additionalContext: context } : {}) };
    }
    // Other mods and settings hooks keep their veto and their permission decision.
    const downstream = await next(event);
    const result = { ...downstream };
    if (specific.permissionDecision === 'ask' && !downstream.deny) {
      delete result.allow;
      result.ask = specific.permissionDecisionReason || 'Peer asks you to review this overlap.';
    }
    if (context.length) result.additionalContext = [...(downstream.additionalContext || []), ...context];
    if (specific.updatedInput && !downstream.updatedInput) result.updatedInput = specific.updatedInput;
    return result;
  }).catch(($, event, next) => {
    if (next.called) return next(event);
    show($, 'Peer: action blocked; retry');
    return { deny: 'Peer could not verify this action, so it did not run. Retry when Peer is available.' };
  });

  on('classic.Stop', async ($, event, next) => {
    const result = await classic($, event, next);
    if (!result.block && !result.preventContinuation) startWait($);
    return result;
  }).catch(($, event, next) => { show($, 'Peer: broker unavailable'); return next(event); });
  on('turn.start', ($, event, next) => { cancelWake(); return next(event); });
  on('session.end', ($, event, next) => {
    closed = true;
    cancelWake();
    pending.clear();
    return next(event);
  });

  on('turn.step', async function* ($, event, next) {
    const proofs = [];
    if (await identity($)) {
      try {
        const messages = await $.session.messages({ as: 'api', ...(event.agentId ? { agentId: event.agentId } : {}) });
        if (Array.isArray(messages)) {
          const texts = messages.flatMap(message => textBlocks(message.content));
          for (const [id, delivery] of pending) {
            if (delivery.sessionId === sessionId && texts.some(text => text.includes(delivery.text))) proofs.push(id);
          }
        }
      } catch {
        show($, 'Peer: model-input inspection unavailable');
      }
    }
    // Only a request with a real provider response proves it crossed the request boundary.
    const result = yield* next(event);
    if (enabled && result.usage) {
      try {
        await request($, '/usage', {
          session_id: sessionId, turnId: event.turnId, index: event.index,
          ...(event.agentId ? { agentId: event.agentId } : {}), usage: result.usage,
        });
        for (const id of proofs) {
          await request($, '/delivery', {
            session_id: sessionId, id, evidence: 'model-input', turnId: event.turnId, index: event.index,
            ...(event.agentId ? { agentId: event.agentId } : {}),
          });
          pending.delete(id);
        }
      } catch { show($, 'Peer: usage or receipt awaiting retry'); }
    }
    return result;
  });

  on('session.start', async ($, event, next) => {
    closed = false;
    interactive = event.isInteractive;
    if (await identity($)) {
      await credential($, processStarted);
      processStarted = true;
      await $.command.register({ name: 'peer', description: 'Show team work, or run a Peer recipe: /peer <recipe> [input]', argumentHint: '[recipe] [input]' });
      await $.tool.register({ name: 'peer_context', description: 'Read the current shared context of your work or a named task; records the version you read.', inputSchema: {
        type: 'object', properties: { work: { type: 'string' } }, additionalProperties: false,
      } });
      await $.tool.register({ name: 'peer_ask', description: 'Ask agents working on a named task a short question.', inputSchema: {
        type: 'object', properties: { work: { type: 'string' }, question: { type: 'string' } }, required: ['work', 'question'], additionalProperties: false,
      } });
      await $.tool.register({ name: 'peer_note', description: 'Write a short coordination note to the agents sharing your files.', inputSchema: {
        type: 'object', properties: { text: { type: 'string' }, overlap: { type: 'string' } }, required: ['text'], additionalProperties: false,
      } });
      await available($);
    }
    return next(event);
  });

  on('tool.call', { tool: 'mcp__peer__peer_context' }, async ($, event) => {
    const text = await cli($, 'context', event.work ? [event.work] : []);
    return text.ok ? { result: text.text } : { deny: text.text };
  });
  on('tool.call', { tool: 'mcp__peer__peer_ask' }, async ($, event) => {
    const text = await cli($, 'ask', [event.work, event.question]);
    return text.ok ? { result: text.text } : { deny: text.text };
  });
  on('tool.call', { tool: 'mcp__peer__peer_note' }, async ($, event) => {
    const text = await cli($, 'note', [event.text, ...(event.overlap ? ['--overlap', event.overlap] : [])]);
    return text.ok ? { result: text.text } : { deny: text.text };
  });

  on('command.run', { command: 'peer' }, async ($, event) => {
    const words = typeof event.args === 'string' ? event.args.trim() : '';
    if (words) {
      const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(words);
      const name = match[1]; const input = match[2];
      const answer = await cli($, 'recipe', name === 'recipes' ? [] : [name, ...(input === undefined ? [] : [input])]);
      if (answer.ok && answer.text.startsWith('Peer: recipe ')) {
        const expectedSession = sessionId;
        // A command holds a turn; the native host permits submission only after it returns.
        $.clock.after(0, () => {
          void (async () => {
            if (closed || expectedSession !== sessionId) return;
            try { await $.prompt.submit({ text: answer.text.trim(), asUser: true }); }
            catch { show($, 'Peer: recipe could not be submitted; try it again.'); }
          })();
        });
        return {};
      }
      return { text: answer.text };
    }
    board = (await cli($, 'status')).text;
    const surfaces = await $.session.surfaces();
    if (surfaces.some(surface => surface === 'terminal' || surface === 'desktop')) {
      await $.ui.open({ id: 'peer-board', title: 'Peer', focus: true });
      $.ui.invalidate('ui.render');
      return {};
    }
    return { text: board };
  });
  on('ui.render', { component: 'Pane', requestId: 'peer-board' }, ($, event, next) => {
    if (event.surface !== 'terminal' && event.surface !== 'desktop') return next(event);
    const { Box, Text, Button } = $.ui.resolve(event);
    return Box({ flexDirection: 'column', children: [
      Text({ bold: true, children: [status] }),
      Text({ children: [board || 'No team work to display.'] }),
      Button({ key: 'peer-refresh', label: 'Refresh', onPress: () => {
        void cli($, 'status').then(answer => { board = answer.text; $.ui.invalidate('ui.render'); }).catch(() => show($, 'Peer: broker unavailable'));
      } }),
      Button({ key: 'peer-close', label: 'Close', role: 'dismiss', onPress: () => { void $.ui.close({ id: 'peer-board' }); } }),
    ] });
  });
}
`;
