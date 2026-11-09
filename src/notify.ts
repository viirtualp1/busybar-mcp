import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME_DIR } from './settings.js';

export const CODEX_CHAIN_FILE = join(HOME_DIR, 'codex-notify-next.json');

function forwardCodex(payloadArg: string | undefined) {
  if (!existsSync(CODEX_CHAIN_FILE)) {
    return;
  }

  try {
    const next = JSON.parse(readFileSync(CODEX_CHAIN_FILE, 'utf8')) as string[];

    if (next.length > 0) {
      const child = spawn(next[0], [...next.slice(1), ...(payloadArg ? [payloadArg] : [])], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {
        // A missing third-party notifier should not fail a Codex turn.
      });
      child.unref();
    }
  } catch {
    // A stale or unreadable chain file should not fail a Codex turn.
  }
}

// Clients may still invoke a hook loaded before the update.
export function notify(args: string[]) {
  const clientAt = args.indexOf('--client');

  if (clientAt >= 0 && args[clientAt + 1] === 'codex') {
    forwardCodex(args[clientAt + 2]);
  }
}
