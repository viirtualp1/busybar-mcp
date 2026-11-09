import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { rect, text, type Scene } from '../bar.js';

const run = promisify(execFile);

let cachedToken: string | undefined;

/** GUI apps start servers without Homebrew on PATH, so look where gh usually lives. */
function ghBinary() {
  const known = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];

  return known.find((path) => existsSync(path)) ?? 'gh';
}

/** GITHUB_TOKEN, or whatever `gh` is logged in with. */
async function token(): Promise<string> {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  if (!cachedToken) {
    try {
      const { stdout } = await run(ghBinary(), ['auth', 'token']);
      cachedToken = stdout.trim();
    } catch {
      throw new Error('No GitHub token: set GITHUB_TOKEN or run `gh auth login`');
    }
  }

  return cachedToken;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${await token()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'busybar-mcp',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

type Run = {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
};

export type CiState = 'ok' | 'fail' | 'running' | 'none';

export type CiSummary = {
  repo: string;
  branch: string;
  state: CiState;
  workflow?: string;
  url?: string;
  at?: string;
};

const CI_COLORS: Record<CiState, string> = {
  ok: '#2ECC71',
  fail: '#E74C3C',
  running: '#F1C40F',
  none: '#7F8C8D',
};

const CI_LABEL: Record<CiState, string> = {
  ok: 'OK',
  fail: 'FAIL',
  running: 'RUN',
  none: '--',
};

export async function latestCi(repo: string, branch?: string): Promise<CiSummary> {
  const target = branch ?? (await gh<{ default_branch: string }>(`/repos/${repo}`)).default_branch;
  const { workflow_runs } = await gh<{ workflow_runs: Run[] }>(
    `/repos/${repo}/actions/runs?branch=${encodeURIComponent(target)}&per_page=1`,
  );
  const last = workflow_runs[0];

  if (!last) {
    return { repo, branch: target, state: 'none' };
  }

  const state: CiState =
    last.status !== 'completed' ? 'running' : last.conclusion === 'success' ? 'ok' : 'fail';

  return { repo, branch: target, state, workflow: last.name, url: last.html_url, at: last.created_at };
}

export function ciScene(ci: CiSummary): Scene {
  const color = CI_COLORS[ci.state];
  const name = ci.repo.split('/')[1] ?? ci.repo;

  return {
    ledColor: ci.state === 'fail' ? color : undefined,
    elements: [
      rect('ci-band', 0, 0, 3, 16, color),
      text('ci-repo', name, { x: 6, y: 1, width: 66, scroll_rate: name.length > 16 ? 600 : undefined }),
      text('ci-state', `${CI_LABEL[ci.state]} ${ci.branch}`, { x: 6, y: 9, color, width: 66 }),
    ],
  };
}

export type Inbox = { reviewRequests: number; myOpenPrs: number; assignedIssues: number };

export async function inbox(): Promise<Inbox> {
  const count = async (q: string) =>
    (await gh<{ total_count: number }>(`/search/issues?per_page=1&q=${encodeURIComponent(q)}`)).total_count;

  const [reviewRequests, myOpenPrs, assignedIssues] = await Promise.all([
    count('is:open is:pr review-requested:@me archived:false'),
    count('is:open is:pr author:@me archived:false'),
    count('is:open is:issue assignee:@me archived:false'),
  ]);

  return { reviewRequests, myOpenPrs, assignedIssues };
}

export function inboxScene(box: Inbox): Scene {
  const cell = (id: string, x: number, label: string, n: number, color: string) => [
    text(`${id}-n`, String(n), { x, y: 1, color: n > 0 ? color : '#555555FF' }),
    text(`${id}-l`, label, { x, y: 9, color: '#AAAAAAFF' }),
  ];

  return {
    ledColor: box.reviewRequests > 0 ? '#9B59B6' : undefined,
    elements: [
      ...cell('rev', 1, 'REV', box.reviewRequests, '#C39BD3FF'),
      ...cell('pr', 25, 'PR', box.myOpenPrs, '#5DADE2FF'),
      ...cell('iss', 49, 'ISS', box.assignedIssues, '#F5B041FF'),
    ],
  };
}
