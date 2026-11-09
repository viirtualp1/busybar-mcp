// `busybar-mcp notify`: called by Claude Code hooks (JSON on stdin) and by Codex's `notify`
// (JSON as the last argument) when an answer is ready: who answered, when, where, how long it took.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Scene } from './bar.js';
import { LOGOS } from './logos.js';
import { HOME_DIR } from './settings.js';
import { summarize, wrap } from './text.js';

export type Event = {
  agent: 'Claude' | 'Codex';
  kind: 'ready' | 'waiting';
  project?: string;
  text: string;
  /** When the turn began, if the transcript says; for "worked 4m" and a date when the day changed. */
  startedAt?: Date;
};

type TranscriptLine = {
  type?: string;
  timestamp?: string;
  message?: { content?: string | Array<{ type?: string; text?: string }> };
};

export const CODEX_CHAIN_FILE = join(HOME_DIR, 'codex-notify-next.json');

const COLORS = { ready: '#2ECC71', waiting: '#F5B041' };

const CHIME = { ready: 'E6:70 G6:70 C7:140', waiting: 'A5:90 R:60 A5:90' };

const TITLE = { ready: 'Ready', waiting: 'Needs you' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function readStdin() {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function textOf(line: TranscriptLine) {
  const content = line.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  return (content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

function usesTool(line: TranscriptLine) {
  const content = line.message?.content;

  return Array.isArray(content) && content.some((block) => block.type === 'tool_use' || block.type === 'tool_result');
}

/** The final answer: the assistant's text after its last tool call, not the "let me look" along the way. */
function lastAnswer(transcriptPath: string) {
  if (!existsSync(transcriptPath)) {
    return '';
  }

  const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');
  const parts: string[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    let line: TranscriptLine;

    try {
      line = JSON.parse(lines[i]) as TranscriptLine;
    } catch {
      continue;
    }

    if (line.type === 'user' || (line.type === 'assistant' && usesTool(line))) {
      break;
    }

    if (line.type === 'assistant') {
      const text = textOf(line);

      if (text) {
        parts.unshift(text);
      }
    }
  }

  if (parts.length > 0) {
    return parts.join('\n\n');
  }

  // Ended on a tool call (stopped, or a hook firing mid-turn): the latest thing it said is the next best summary.
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = JSON.parse(lines[i]) as TranscriptLine;
      const text = line.type === 'assistant' ? textOf(line) : '';

      if (text) {
        return text;
      }
    } catch {
      continue;
    }
  }

  return '';
}

/** The time of the last message the user typed, which is when this turn began. */
function turnStart(transcriptPath: string) {
  if (!existsSync(transcriptPath)) {
    return undefined;
  }

  const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = JSON.parse(lines[i]) as TranscriptLine;

      if (line.type === 'user' && !usesTool(line) && textOf(line) && line.timestamp) {
        const at = new Date(line.timestamp);
        return Number.isNaN(at.getTime()) ? undefined : at;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function clock(at: Date) {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

function day(at: Date) {
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function fromClaude(payload: Record<string, unknown>): Event | undefined {
  const project = typeof payload.cwd === 'string' ? basename(payload.cwd) : undefined;

  if (payload.hook_event_name === 'Notification') {
    return { agent: 'Claude', kind: 'waiting', project, text: String(payload.message ?? 'Claude is waiting for you') };
  }

  if (payload.hook_event_name !== 'Stop') {
    return undefined;
  }

  const transcript = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
  const text = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : lastAnswer(transcript);

  return { agent: 'Claude', kind: 'ready', project, text, startedAt: transcript ? turnStart(transcript) : undefined };
}

function fromCodex(payload: Record<string, unknown>): Event | undefined {
  if (payload.type !== 'agent-turn-complete') {
    return undefined;
  }

  return {
    agent: 'Codex',
    kind: 'ready',
    project: typeof payload.cwd === 'string' ? basename(payload.cwd) : undefined,
    text: String(payload['last-assistant-message'] ?? ''),
  };
}

/** Codex has one `notify` slot; whatever held it before (Computer Use, say) still gets every call. */
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
      child.unref();
    }
  } catch {
    // The next notifier is someone else's; failing to start it must not break ours.
  }
}

/** What the notification looks like on each screen; `now` is passed in so a preview can pin the clock. */
export async function notificationScenes(event: Event, now: Date) {
  const { text } = await import('./bar.js');
  const seconds = Number(process.env.BUSYBAR_NOTIFY_SECONDS) || 300;
  const color = COLORS[event.kind];
  const logo = LOGOS[event.agent === 'Claude' ? 'claude' : 'codex'];
  const time = clock(now);
  const dayChanged = Boolean(event.startedAt && event.startedAt.toDateString() !== now.toDateString());
  const project = event.project ?? event.agent;
  const where = dayChanged ? `${time} ${day(now)} ${project}` : `${time} ${project}`;
  const worked = event.startedAt && event.kind === 'ready' ? `worked ${duration(now.getTime() - event.startedAt.getTime())}` : '';
  const gist = wrap(summarize(event.text, 70), 35, 2);

  const front: Scene = {
    display: 'front',
    photo: false,
    timeout: seconds,
    ledColor: color,
    pixels: [{ ...logo.front, x: 0, y: 0 }],
    elements: [
      text('title', TITLE[event.kind], { x: 18, y: 0, width: 54, color }),
      text('where', where, { x: 18, y: 8, width: 54, color: '#BBBBBB', scroll_rate: where.length > 13 ? 900 : undefined }),
    ],
  };

  const back: Scene = {
    display: 'back',
    photo: false,
    timeout: seconds,
    pixels: [{ ...logo.back, x: 2, y: 4 }],
    elements: [
      text('title', TITLE[event.kind], { x: 48, y: 4, font: 'bold' }),
      text('time', time, { x: 145, y: 4, align: 'top_right', font: 'bold' }),
      text('project', project, { x: 48, y: 18, width: 97 }),
      ...(worked ? [text('worked', worked, { x: 48, y: 29, width: 97, color: '#999999' })] : []),
      ...(dayChanged ? [text('day', day(now), { x: 48, y: 40, width: 97, color: '#999999' })] : []),
      ...gist.map((line, i) => text(`gist${i}`, line, { x: 4, y: 52 + i * 11, width: 141, color: '#BBBBBB' })),
    ],
  };

  return { front, back };
}

async function show(event: Event) {
  const { draw, playSound } = await import('./bar.js');
  const { melodyToSnd } = await import('./media/sound.js');
  const { front, back } = await notificationScenes(event, new Date());

  if (!(await draw(front)).sent) {
    // Refused for priority means a BUSY session or another app owns the Bar: stay quiet.
    return;
  }

  await draw(back);

  if (process.env.BUSYBAR_NOTIFY_SOUND !== '0') {
    await playSound({ snd: melodyToSnd(CHIME[event.kind], 'sine') });
  }
}

/** Never throws and always exits 0: a hook that fails would get in the agent's way. */
export async function notify(args: string[]) {
  if (process.env.CLAUDE_PLUGIN_OPTION_NOTIFY === 'false') {
    return;
  }

  if (process.env.CLAUDE_PLUGIN_OPTION_NOTIFY_SOUND === 'false') {
    process.env.BUSYBAR_NOTIFY_SOUND = '0';
  }

  const client = args[args.indexOf('--client') + 1] === 'codex' ? 'codex' : 'claude';
  const payloadArg = client === 'codex' ? args.at(-1) : undefined;

  process.env.BUSYBAR_APP = 'claude_notify';

  try {
    const raw = client === 'codex' ? (payloadArg ?? '') : await readStdin();
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const event = client === 'codex' ? fromCodex(payload) : fromClaude(payload);

    if (event) {
      await show(event);
    }
  } catch (err) {
    console.error(`busybar-mcp notify: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (client === 'codex') {
      forwardCodex(payloadArg);
    }
  }
}
