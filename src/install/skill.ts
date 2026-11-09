import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Outcome } from './clients.js';

const SKILL = `---
name: busybar
description: Show things on the user's BUSY Bar (an LED status display with a 72x16 colour front and a 160x80 greyscale back) and play sounds on it, through the busybar MCP tools. Use whenever the user mentions the Bar, BUSY Bar, busybar, their status display, or asks to show, draw, display, notify or play something "on the bar".
---

# BUSY Bar

The busybar MCP server's tools do the work; this skill says how to use them well.

- Text: \`bar_text\` (one or two lines). Pixel art: \`bar_pixels\`. Pictures: \`bar_image\` (path or URL).
  Built-in media: \`bar_stock\` lists it, then \`bar_animation\`, \`bar_image\` with \`stock\`, \`bar_sound\` with \`stock\`.
  Melodies: \`bar_sound\` with \`melody\`, e.g. "C5:150 E5:150 G5:150 C6:400".
- \`display: "front"\` is the strip other people see; \`"back"\` faces the user and holds more text.
- The fonts are ASCII only. Non-Latin text is transliterated, so keep it short and plain.
- Front fits about 17 characters per line; write a status, not a sentence.
- Every drawing tool returns an image of the result. Look at it, and redraw if it is wrong.
- "Not drawn due to low priority" means a BUSY work session owns the Bar. Pass \`urgent: true\` only if the user
  asked to interrupt it.
- When finished with a temporary message, \`bar_clear\` gives the screen back.
- Combine with other tools: read the calendar, mail or CI first, then show the result on the Bar.
`;

const TARGETS = [
  { client: 'Codex skill', dir: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills', 'busybar') },
  { client: 'Claude Code skill', dir: join(homedir(), '.claude', 'skills', 'busybar') },
];

export function installSkills(only?: 'codex' | 'claude'): Outcome[] {
  const chosen = only ? [TARGETS[only === 'codex' ? 0 : 1]] : TARGETS;

  return chosen.map(({ client, dir }) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), SKILL);

    return { client, ok: true, detail: join(dir, 'SKILL.md') };
  });
}

export function uninstallSkills(): Outcome[] {
  return TARGETS.map(({ client, dir }) => {
    const existed = existsSync(dir);
    rmSync(dir, { recursive: true, force: true });

    return { client, ok: true, detail: existed ? 'removed' : 'was not installed' };
  });
}

export function hasSkill(client: 'codex' | 'claude') {
  return existsSync(join(TARGETS[client === 'codex' ? 0 : 1].dir, 'SKILL.md'));
}
