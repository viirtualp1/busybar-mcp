import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEX_CHAIN_FILE } from '../notify.js';
import { SERVER_FILE } from '../settings.js';
import type { Outcome } from './clients.js';

type HookCommand = { type: string; command?: string; timeout?: number };

type HookGroup = { matcher?: string; hooks?: HookCommand[] };

type ClaudeSettings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json');

const CODEX_CONFIG = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');

const MARK = ' notify --client ';

function isOurs(hook: HookCommand) {
  return Boolean(hook.command?.includes('.busybar-mcp') && hook.command.includes(MARK));
}

function readClaudeSettings(): ClaudeSettings {
  return existsSync(CLAUDE_SETTINGS) ? (JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8')) as ClaudeSettings) : {};
}

function writeClaudeSettings(settings: ClaudeSettings) {
  if (existsSync(CLAUDE_SETTINGS)) {
    copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.bak-busybar`);
  }

  writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Drops our hook from every event, and any group or event left empty by that. */
function withoutOurHooks(settings: ClaudeSettings) {
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.flatMap((group) => {
      if (!group.hooks?.some(isOurs)) {
        return [group];
      }

      const hooks = group.hooks.filter((hook) => !isOurs(hook));

      return hooks.length > 0 ? [{ ...group, hooks }] : [];
    });

    if (kept.length > 0) {
      settings.hooks![event] = kept;
    } else {
      delete settings.hooks![event];
    }
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return settings;
}

export function uninstallClaudeHooks(): Outcome {
  if (!existsSync(CLAUDE_SETTINGS)) {
    return { client: 'Claude Code notifications', ok: true, detail: 'were not installed' };
  }

  const settings = readClaudeSettings();

  if (!containsClaudeHooks(settings)) {
    return { client: 'Claude Code notifications', ok: true, detail: 'were not installed' };
  }

  writeClaudeSettings(withoutOurHooks(settings));

  return { client: 'Claude Code notifications', ok: true, detail: 'removed' };
}

function containsClaudeHooks(settings: ClaudeSettings) {
  return Object.values(settings.hooks ?? {}).some((groups) =>
    groups.some((group) => (group.hooks ?? []).some(isOurs)),
  );
}

export function hasClaudeHooks() {
  return containsClaudeHooks(readClaudeSettings());
}

function tomlArray(values: string[]) {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

/** The top-level `notify = [...]` line, if there is one on a single line before the first table. */
function findCodexNotify(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      return -1;
    }

    if (/^\s*notify\s*=/.test(lines[i])) {
      return i;
    }
  }

  return -1;
}

function parseNotify(line: string) {
  try {
    const value: unknown = JSON.parse(line.replace(/^\s*notify\s*=\s*/, '').trim());

    if (Array.isArray(value) && value.every((arg): arg is string => typeof arg === 'string')) {
      return value;
    }
  } catch {
    // The installer wrote JSON-style TOML arrays on one line.
    return undefined;
  }
}

function isOurCodexNotify(command: string[] | undefined) {
  return command?.length === 5 && command[1] === SERVER_FILE &&
    command[2] === 'notify' && command[3] === '--client' && command[4] === 'codex';
}

export function uninstallCodexNotify(): Outcome {
  if (!existsSync(CODEX_CONFIG)) {
    return { client: 'Codex notifications', ok: true, detail: 'were not installed' };
  }

  const lines = readFileSync(CODEX_CONFIG, 'utf8').split('\n');
  const at = findCodexNotify(lines);
  const current = at >= 0 ? parseNotify(lines[at]) : undefined;

  if (!isOurCodexNotify(current)) {
    return { client: 'Codex notifications', ok: true, detail: 'were not installed' };
  }

  const previous = existsSync(CODEX_CHAIN_FILE) ? (JSON.parse(readFileSync(CODEX_CHAIN_FILE, 'utf8')) as string[]) : undefined;

  if (previous) {
    lines[at] = `notify = ${tomlArray(previous)}`;
  } else {
    lines.splice(at, 1);
  }

  copyFileSync(CODEX_CONFIG, `${CODEX_CONFIG}.bak-busybar`);
  writeFileSync(CODEX_CONFIG, lines.join('\n'));
  rmSync(CODEX_CHAIN_FILE, { force: true });

  return { client: 'Codex notifications', ok: true, detail: previous ? 'removed; the previous notify is back' : 'removed' };
}

export function hasCodexNotify() {
  if (!existsSync(CODEX_CONFIG)) {
    return false;
  }

  const lines = readFileSync(CODEX_CONFIG, 'utf8').split('\n');
  const at = findCodexNotify(lines);

  return at >= 0 && isOurCodexNotify(parseNotify(lines[at]));
}
