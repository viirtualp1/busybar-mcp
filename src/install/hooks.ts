import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEX_CHAIN_FILE } from '../notify.js';
import type { Launch, Outcome } from './clients.js';

type HookCommand = { type: string; command?: string; timeout?: number };

type HookGroup = { matcher?: string; hooks?: HookCommand[] };

type ClaudeSettings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

const CLAUDE_SETTINGS = join(homedir(), '.claude', 'settings.json');

const CODEX_CONFIG = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');

const CLAUDE_EVENTS = ['Stop', 'Notification'];

const MARK = ' notify --client ';

function quote(path: string) {
  return `"${path.replace(/(["\\$`])/g, '\\$1')}"`;
}

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
    const kept = groups
      .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((hook) => !isOurs(hook)) }))
      .filter((group) => group.hooks.length > 0);

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

export function installClaudeHooks(launch: Launch): Outcome {
  const settings = withoutOurHooks(readClaudeSettings());
  const command = [launch.command, ...launch.args].map(quote).join(' ') + `${MARK}claude`;

  settings.hooks ??= {};

  for (const event of CLAUDE_EVENTS) {
    settings.hooks[event] = [...(settings.hooks[event] ?? []), { hooks: [{ type: 'command', command, timeout: 20 }] }];
  }

  writeClaudeSettings(settings);

  return { client: 'Claude Code notifications', ok: true, detail: 'Stop and Notification hooks in ~/.claude/settings.json' };
}

export function uninstallClaudeHooks(): Outcome {
  if (!existsSync(CLAUDE_SETTINGS)) {
    return { client: 'Claude Code notifications', ok: true, detail: 'were not installed' };
  }

  writeClaudeSettings(withoutOurHooks(readClaudeSettings()));

  return { client: 'Claude Code notifications', ok: true, detail: 'removed' };
}

export function hasClaudeHooks() {
  return Object.values(readClaudeSettings().hooks ?? {}).some((groups) =>
    groups.some((group) => (group.hooks ?? []).some(isOurs)),
  );
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
    return JSON.parse(line.replace(/^\s*notify\s*=\s*/, '').trim()) as string[];
  } catch {
    return undefined;
  }
}

/**
 * Codex calls a single `notify` program. If one is set already, it is remembered and called by ours
 * after every notification, so whatever relied on it keeps working.
 */
export function installCodexNotify(launch: Launch): Outcome {
  const content = existsSync(CODEX_CONFIG) ? readFileSync(CODEX_CONFIG, 'utf8') : '';
  const lines = content.split('\n');
  const at = findCodexNotify(lines);
  const ours = [launch.command, ...launch.args, 'notify', '--client', 'codex'];

  if (at >= 0) {
    const current = parseNotify(lines[at]);

    if (!current) {
      return { client: 'Codex notifications', ok: false, detail: 'could not read the existing `notify` line; left it alone' };
    }

    if (!current.join(' ').includes(`${MARK.trim()} codex`)) {
      writeFileSync(CODEX_CHAIN_FILE, JSON.stringify(current));
    }

    lines[at] = `notify = ${tomlArray(ours)}`;
  } else {
    lines.unshift(`notify = ${tomlArray(ours)}`);
  }

  if (existsSync(CODEX_CONFIG)) {
    copyFileSync(CODEX_CONFIG, `${CODEX_CONFIG}.bak-busybar`);
  }

  writeFileSync(CODEX_CONFIG, lines.join('\n'));

  const chained = existsSync(CODEX_CHAIN_FILE) ? ' (still calls the previous notify program)' : '';

  return { client: 'Codex notifications', ok: true, detail: `notify in config.toml${chained}` };
}

export function uninstallCodexNotify(): Outcome {
  if (!existsSync(CODEX_CONFIG)) {
    return { client: 'Codex notifications', ok: true, detail: 'were not installed' };
  }

  const lines = readFileSync(CODEX_CONFIG, 'utf8').split('\n');
  const at = findCodexNotify(lines);
  const current = at >= 0 ? parseNotify(lines[at]) : undefined;

  if (!current?.join(' ').includes(`${MARK.trim()} codex`)) {
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

  return at >= 0 && Boolean(parseNotify(lines[at])?.join(' ').includes(`${MARK.trim()} codex`));
}
