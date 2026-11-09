import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Settings = Partial<Record<SettingKey, string>>;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_KEYS = ['BUSY_ADDR', 'BUSY_HTTP_PASSWORD', 'BUSY_TOKEN', 'GITHUB_TOKEN', 'BUSYBAR_DRY_RUN', 'DRAW_PRIORITY', 'BUSYBAR_NOTIFY_SECONDS', 'BUSYBAR_NOTIFY_SOUND'] as const;

export const HOME_DIR = process.env.BUSYBAR_MCP_HOME || join(homedir(), '.busybar-mcp');

export const SETTINGS_FILE = join(HOME_DIR, 'config.json');

export const SERVER_FILE = join(HOME_DIR, 'server.mjs');

export function readSettings(): Settings {
  if (!existsSync(SETTINGS_FILE)) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => (SETTING_KEYS as readonly string[]).includes(key) && typeof value === 'string',
      ),
    );
  } catch {
    // A broken file must not stop the server; it then runs on env and defaults.
    return {};
  }
}

export function writeSettings(settings: Settings) {
  mkdirSync(HOME_DIR, { recursive: true });

  const clean = Object.fromEntries(Object.entries(settings).filter(([, value]) => value));
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  chmodSync(SETTINGS_FILE, 0o600);
}

/**
 * Fills env from a Claude Code plugin option (CLAUDE_PLUGIN_OPTION_<KEY>), then from ~/.busybar-mcp/config.json,
 * where the client left a value unset.
 * Claude Desktop passes an untouched `${user_config.x}` placeholder or an empty
 * string for optional fields, so both count as unset.
 */
export function applySettings(env: NodeJS.ProcessEnv = process.env) {
  const stored = readSettings();

  for (const key of SETTING_KEYS) {
    const current = env[key] || env[`CLAUDE_PLUGIN_OPTION_${key}`];
    const unset = !current || /^\$\{.*\}$/.test(current);

    if (!unset) {
      env[key] = current;
      continue;
    }

    if (stored[key]) {
      env[key] = stored[key];
    } else {
      delete env[key];
    }
  }
}
