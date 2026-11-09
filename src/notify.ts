// `busybar-mcp notify`: called by Claude Code hooks (JSON on stdin) and by Codex's `notify`
// (JSON as the last argument) when an answer is ready, to put a short summary on the Bar.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { HOME_DIR } from './settings.js';
import { summarize, wrap } from './text.js';

type Event = {
  agent: 'Claude' | 'Codex';
  kind: 'ready' | 'waiting';
  project?: string;
  text: string;
};

type TranscriptLine = {
  type?: string;
  message?: { content?: string | Array<{ type?: string; text?: string }> };
};

export const CODEX_CHAIN_FILE = join(HOME_DIR, 'codex-notify-next.json');

const COLORS = { ready: '#2ECC71', waiting: '#F5B041' };

const CHIME = { ready: 'E6:70 G6:70 C7:140', waiting: 'A5:90 R:60 A5:90' };

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

function fromClaude(payload: Record<string, unknown>): Event | undefined {
  const project = typeof payload.cwd === 'string' ? basename(payload.cwd) : undefined;

  if (payload.hook_event_name === 'Notification') {
    return { agent: 'Claude', kind: 'waiting', project, text: String(payload.message ?? 'Claude is waiting for you') };
  }

  if (payload.hook_event_name !== 'Stop') {
    return undefined;
  }

  const text =
    typeof payload.last_assistant_message === 'string'
      ? payload.last_assistant_message
      : typeof payload.transcript_path === 'string'
        ? lastAnswer(payload.transcript_path)
        : '';

  return { agent: 'Claude', kind: 'ready', project, text };
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

async function show(event: Event) {
  const { draw, playSound, rect, text } = await import('./bar.js');
  const { melodyToSnd } = await import('./media/sound.js');
  const seconds = Number(process.env.BUSYBAR_NOTIFY_SECONDS) || 300;
  const color = COLORS[event.kind];
  const title = event.kind === 'ready' ? `${event.agent} - ready` : `${event.agent} - needs you`;
  const summary = summarize(event.text, 170) || (event.kind === 'ready' ? 'Done.' : 'Waiting for you.');
  const header = event.project ? `${event.agent} - ${event.project}` : event.agent;
  const lines = wrap(summary, 34, 5);
  const expire = <T extends object>(element: T) => ({ ...element, timeout: seconds });

  const front = await draw({
    display: 'front',
    photo: false,
    ledColor: color,
    elements: [
      rect('band', 0, 0, 3, 16, color),
      text('title', title, { x: 6, y: 0, width: 66, color }),
      text('summary', summary, { x: 6, y: 8, width: 66, color: '#DDDDDD', scroll_rate: summary.length > 16 ? 900 : undefined }),
    ].map(expire),
  });

  if (!front.sent) {
    // Refused for priority means a BUSY session or another app owns the Bar: stay quiet.
    return;
  }

  await draw({
    display: 'back',
    photo: false,
    elements: [
      text('header', header, { x: 6, y: 4, width: 138, color: '#888888' }),
      ...lines.map((line, i) => text(`line${i}`, line, { x: 6, y: 18 + i * 11, width: 138 })),
    ].map(expire),
  });

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
