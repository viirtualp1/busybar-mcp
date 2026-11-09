import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME_DIR } from './settings.js';
import { VERSION } from './version.js';

export type UpdateInfo = { current: string; latest: string; url: string; how: string };

type Cache = { checkedAt: number; latest?: string; url?: string };

export const REPO = 'viirtualp1/busybar-mcp';

const CACHE_FILE = join(HOME_DIR, 'update-check.json');

const DAY_MS = 24 * 60 * 60 * 1000;

function parse(version: string) {
  const [core, pre] = version.replace(/^v/, '').split('-', 2);
  const parts = core.split('.').map((part) => Number(part) || 0);

  return { parts, pre };
}

/** Semver order, enough for x.y.z with an optional pre-release (which sorts before the release). */
export function isNewer(candidate: string, current: string) {
  const a = parse(candidate);
  const b = parse(current);

  for (let i = 0; i < 3; i++) {
    if ((a.parts[i] ?? 0) !== (b.parts[i] ?? 0)) {
      return (a.parts[i] ?? 0) > (b.parts[i] ?? 0);
    }
  }

  if (a.pre === b.pre) {
    return false;
  }

  return !a.pre || (Boolean(b.pre) && a.pre > b.pre);
}

/** How this copy was installed decides what the user runs to update it. */
export function updateHow(url: string) {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return 'in Claude Code run /plugin update busybar';
  }

  if (process.argv[1]?.includes('Claude Extensions')) {
    return `download busybar.mcpb from ${url} and double-click it`;
  }

  return 'run `npx busybar-mcp@latest update` in a terminal';
}

function readCache(): Cache | undefined {
  try {
    return existsSync(CACHE_FILE) ? (JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLatest(): Promise<Cache> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'busybar-mcp' },
    signal: AbortSignal.timeout(4000),
  });

  // 404: no release yet, which is not an error.
  if (res.status === 404) {
    return { checkedAt: Date.now() };
  }

  if (!res.ok) {
    throw new Error(`GitHub ${res.status}`);
  }

  const release = (await res.json()) as { tag_name: string; html_url: string };

  return { checkedAt: Date.now(), latest: release.tag_name.replace(/^v/, ''), url: release.html_url };
}

/**
 * The newest release if it is newer than this copy, looked up at most once a day. Quiet on any failure:
 * an update check must never get in the way of drawing on the Bar.
 */
export async function checkForUpdate(options: { force?: boolean } = {}) {
  if (process.env.BUSYBAR_NO_UPDATE_CHECK === '1' || VERSION === '0.0.0-dev') {
    return undefined;
  }

  let cache = readCache();

  if (options.force || !cache || Date.now() - cache.checkedAt > DAY_MS) {
    try {
      cache = await fetchLatest();
      mkdirSync(HOME_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(cache));
    } catch {
      // Offline or rate-limited: try again tomorrow with whatever the cache says.
      return undefined;
    }
  }

  if (!cache.latest || !isNewer(cache.latest, VERSION)) {
    return undefined;
  }

  const url = cache.url ?? `https://github.com/${REPO}/releases/latest`;

  return { current: VERSION, latest: cache.latest, url, how: updateHow(url) } satisfies UpdateInfo;
}
