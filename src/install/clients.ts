import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

export type Launch = { command: string; args: string[] };

export type Outcome = { client: string; ok: boolean; detail: string };

export type Client = {
  id: ClientId;
  name: string;
  detect: () => boolean;
  install: (launch: Launch) => Promise<Outcome>;
  uninstall: () => Promise<Outcome>;
  status: () => string;
};

export type ClientId = 'claude-code' | 'codex' | 'claude-desktop';

type McpJson = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

export const SERVER_NAME = 'busybar';

const run = promisify(execFile);

const home = homedir();

const desktopDir =
  platform() === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Claude')
    : platform() === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude')
      : '';

const desktopConfig = desktopDir && join(desktopDir, 'claude_desktop_config.json');

const codexConfig = join(process.env.CODEX_HOME || join(home, '.codex'), 'config.toml');

const claudeJson = join(home, '.claude.json');

export const CLIENTS: Client[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: () => Boolean(claudeBinary()) || existsSync(claudeJson),
    install: installClaudeCode,
    uninstall: uninstallClaudeCode,
    status: () => (readJson(claudeJson)?.mcpServers?.[SERVER_NAME] ? 'installed' : 'not installed'),
  },
  {
    id: 'codex',
    name: 'Codex',
    detect: () => existsSync(codexConfig) || Boolean(findOnPath('codex')),
    install: installCodex,
    uninstall: uninstallCodex,
    status: () =>
      existsSync(codexConfig) && readFileSync(codexConfig, 'utf8').includes(`[mcp_servers.${SERVER_NAME}]`)
        ? 'installed'
        : 'not installed',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    detect: () => Boolean(desktopDir) && existsSync(desktopDir),
    install: installDesktopJson,
    uninstall: uninstallDesktopJson,
    status: () =>
      readJson(desktopConfig)?.mcpServers?.[SERVER_NAME]
        ? 'installed (config file)'
        : 'not in config file (check Settings → Extensions)',
  },
];

function findOnPath(name: string) {
  const extensions = platform() === 'win32' ? ['.exe', '.cmd', ''] : [''];

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);

      if (dir && existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function claudeBinary() {
  const known = [
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];

  return findOnPath('claude') ?? known.find((path) => existsSync(path));
}

function readJson(file: string): McpJson | undefined {
  if (!file || !existsSync(file)) {
    return undefined;
  }

  return JSON.parse(readFileSync(file, 'utf8')) as McpJson;
}

function backup(file: string) {
  if (existsSync(file)) {
    copyFileSync(file, `${file}.bak-busybar`);
  }
}

/** Changes one key of a JSON config and leaves every other byte of meaning alone. */
function editJson(file: string, edit: (json: McpJson) => void) {
  const json = readJson(file) ?? {};
  backup(file);
  edit(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

async function installClaudeCode(launch: Launch): Promise<Outcome> {
  const claude = claudeBinary();

  if (claude) {
    try {
      await run(claude, ['mcp', 'remove', '-s', 'user', SERVER_NAME]);
    } catch {
      // Not registered yet, which is the usual case.
    }

    try {
      await run(claude, ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', launch.command, ...launch.args]);
      return { client: 'Claude Code', ok: true, detail: 'added with `claude mcp add -s user`' };
    } catch (err) {
      return { client: 'Claude Code', ok: false, detail: errorText(err) };
    }
  }

  editJson(claudeJson, (json) => {
    json.mcpServers = { ...json.mcpServers, [SERVER_NAME]: { type: 'stdio', ...launch, env: {} } };
  });

  return { client: 'Claude Code', ok: true, detail: `written to ${claudeJson}` };
}

async function uninstallClaudeCode(): Promise<Outcome> {
  const claude = claudeBinary();

  if (claude) {
    try {
      await run(claude, ['mcp', 'remove', '-s', 'user', SERVER_NAME]);
      return { client: 'Claude Code', ok: true, detail: 'removed' };
    } catch {
      return { client: 'Claude Code', ok: true, detail: 'was not installed' };
    }
  }

  editJson(claudeJson, (json) => {
    delete json.mcpServers?.[SERVER_NAME];
  });

  return { client: 'Claude Code', ok: true, detail: 'removed' };
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

/** Drops `[mcp_servers.busybar]` and its sub-tables, keeping the rest of the file as it was. */
function withoutCodexBlock(toml: string) {
  const header = new RegExp(`^\\[mcp_servers\\.${SERVER_NAME}(\\.[^\\]]+)?\\]\\s*$`);
  const lines = toml.split('\n');
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (/^\[/.test(line)) {
      skipping = header.test(line);
    }

    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function installCodex(launch: Launch): Promise<Outcome> {
  const current = existsSync(codexConfig) ? readFileSync(codexConfig, 'utf8') : '';
  const block = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(launch.command)}`,
    `args = [${launch.args.map(tomlString).join(', ')}]`,
    '',
  ].join('\n');

  backup(codexConfig);
  writeFileSync(codexConfig, `${withoutCodexBlock(current).trimEnd()}\n\n${block}`);

  return { client: 'Codex', ok: true, detail: `written to ${codexConfig}` };
}

async function uninstallCodex(): Promise<Outcome> {
  if (!existsSync(codexConfig)) {
    return { client: 'Codex', ok: true, detail: 'was not installed' };
  }

  backup(codexConfig);
  writeFileSync(codexConfig, `${withoutCodexBlock(readFileSync(codexConfig, 'utf8')).trimEnd()}\n`);

  return { client: 'Codex', ok: true, detail: 'removed' };
}

async function installDesktopJson(launch: Launch): Promise<Outcome> {
  editJson(desktopConfig, (json) => {
    json.mcpServers = { ...json.mcpServers, [SERVER_NAME]: { ...launch } };
  });

  return { client: 'Claude Desktop', ok: true, detail: 'written to claude_desktop_config.json; restart Claude Desktop' };
}

export async function uninstallDesktopJson(): Promise<Outcome> {
  if (!readJson(desktopConfig)?.mcpServers?.[SERVER_NAME]) {
    return { client: 'Claude Desktop', ok: true, detail: 'not in config file' };
  }

  editJson(desktopConfig, (json) => {
    delete json.mcpServers?.[SERVER_NAME];
  });

  return { client: 'Claude Desktop', ok: true, detail: 'removed from claude_desktop_config.json; restart Claude Desktop' };
}

/** Hands the bundle to Claude Desktop, which shows its own install dialog. */
export async function openExtension(file: string): Promise<Outcome> {
  try {
    if (platform() === 'darwin') {
      await run('open', ['-a', 'Claude', file]);
    } else if (platform() === 'win32') {
      await run('cmd', ['/c', 'start', '', file]);
    } else {
      return { client: 'Claude Desktop', ok: false, detail: 'Claude Desktop is not available on this OS' };
    }

    return { client: 'Claude Desktop', ok: true, detail: 'opened the extension; confirm Install in Claude Desktop' };
  } catch (err) {
    return { client: 'Claude Desktop', ok: false, detail: `could not open ${file}: ${errorText(err)}` };
  }
}

export function hasDesktopJsonEntry() {
  return Boolean(readJson(desktopConfig)?.mcpServers?.[SERVER_NAME]);
}

function errorText(err: unknown) {
  if (err && typeof err === 'object' && 'stderr' in err && typeof err.stderr === 'string' && err.stderr.trim()) {
    return err.stderr.trim();
  }

  return err instanceof Error ? err.message : String(err);
}
