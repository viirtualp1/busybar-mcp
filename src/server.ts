import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  clear,
  connectionInfo,
  describe,
  draw,
  rect,
  screenshot,
  status,
  text,
  validatePixels,
  type DrawResult,
  type Scene,
} from './bar.js';
import { ciScene, inbox, inboxScene, latestCi } from './services/github.js';
import { weather, weatherScene } from './services/weather.js';
import { VERSION } from './version.js';

const server = new McpServer({ name: 'busybar', version: VERSION });

const color = z.string().describe('Hex colour, #RRGGBB');

const urgent = z
  .boolean()
  .optional()
  .describe('Draw over an active BUSY work session or another app. Only when the user asked to interrupt.');

function image(png: Buffer) {
  return { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' };
}

function result(summary: unknown, drawn?: DrawResult): CallToolResult {
  const delivery = drawn
    ? drawn.sent
      ? 'Shown on the BUSY Bar.'
      : drawn.error
        ? `NOT shown on the Bar: ${drawn.error}. The image is a preview only.`
        : 'Dry run: the image is a preview only.'
    : undefined;

  return {
    content: [
      { type: 'text', text: [delivery, typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2)].filter(Boolean).join('\n') },
      ...(drawn ? [image(drawn.preview)] : []),
    ],
  };
}

function failure(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: describe(err) }] };
}

async function show(scene: Scene, summary: unknown = ''): Promise<CallToolResult> {
  return result(summary, await draw(scene));
}

server.registerTool(
  'bar_text',
  {
    title: 'Show text',
    description:
      'Show a short status on the BUSY Bar front screen (72x16 px, ~17 characters per line at the small font, ASCII only). ' +
      'One or two lines; a long first line scrolls. Returns a PNG preview of the result.',
    inputSchema: {
      line1: z.string().max(120),
      line2: z.string().max(40).optional(),
      color: color.optional(),
      line2_color: color.optional(),
      accent: color.optional().describe('Draws a 3px coloured band on the left'),
      led_color: color.optional().describe('Blink the status LED in this colour'),
      urgent,
    },
  },
  async ({ line1, line2, color: c, line2_color, accent, led_color, urgent: force }) => {
    const x = accent ? 6 : 1;
    const width = 72 - x;
    const twoLines = line2 !== undefined;

    return show({
      ledColor: led_color,
      urgent: force,
      elements: [
        ...(accent ? [rect('accent', 0, 0, 3, 16, accent)] : []),
        text('line1', line1, {
          x,
          y: twoLines ? 1 : 5,
          width,
          color: c,
          scroll_rate: line1.length * 4 > width ? 900 : undefined,
        }),
        ...(twoLines
          ? [text('line2', line2, { x, y: 9, width, color: line2_color ?? '#AAAAAAFF' })]
          : []),
      ],
    });
  },
);

server.registerTool(
  'bar_pixels',
  {
    title: 'Draw pixel art',
    description:
      'Draw pixel art on the 72x16 front screen. `grid` is rows of single-character symbols, top to bottom; every symbol must be in `palette` ' +
      '(symbol → #RRGGBB, or "none" for transparent). Max 32 colours. Keep art at most 16 px tall. ' +
      'Optionally add a caption to the right of the art. Look at the returned preview and iterate if it looks wrong.',
    inputSchema: {
      palette: z.record(z.string().length(1), z.string()),
      grid: z.array(z.string()).min(1).max(16),
      x: z.number().int().min(0).max(71).optional(),
      y: z.number().int().min(0).max(15).optional(),
      caption: z.string().max(60).optional(),
      caption_color: color.optional(),
      urgent,
    },
  },
  async ({ palette, grid, x, y, caption, caption_color, urgent: force }) => {
    const art = { palette, grid, x, y };

    try {
      validatePixels(art);
    } catch (err) {
      return failure(err);
    }

    const right = (x ?? 0) + Math.max(...grid.map((r) => r.length)) + 2;

    return show({
      pixels: [art],
      urgent: force,
      elements: caption
        ? [text('caption', caption, { x: right, y: 5, width: Math.max(1, 72 - right), color: caption_color })]
        : [],
    });
  },
);

server.registerTool(
  'bar_progress',
  {
    title: 'Show progress',
    description: 'Show a labelled progress bar (0..1) on the front screen.',
    inputSchema: {
      label: z.string().max(40),
      value: z.number().min(0).max(1),
      color: color.optional(),
      urgent,
    },
  },
  async ({ label, value, color: c = '#2ECC71', urgent: force }) => {
    const pct = `${Math.round(value * 100)}%`;

    return show({
      urgent: force,
      elements: [
        text('label', label, { x: 1, y: 1, width: 70 - pct.length * 4 }),
        text('pct', pct, { x: 71 - pct.length * 4, y: 1, color: '#AAAAAAFF' }),
        rect('track', 1, 10, 70, 4, '#2A2A2A'),
        rect('fill', 1, 10, Math.max(1, value * 70), 4, c),
      ],
    });
  },
);

server.registerTool(
  'bar_clear',
  { title: 'Clear', description: "Remove everything this server drew, giving the screen back to the Bar's own apps." },
  async () => {
    try {
      await clear();
      return result('Cleared.');
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_screenshot',
  { title: 'Screenshot', description: 'Grab what the BUSY Bar front screen shows right now, as an image.' },
  async () => {
    try {
      return { content: [image(await screenshot())] };
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_status',
  { title: 'Bar status', description: 'Which Bar the server talks to, and its system status.' },
  async () => {
    const info = connectionInfo();

    try {
      return result({ ...info, system: info.dryRun ? null : await status() });
    } catch (err) {
      return result({ ...info, reachable: false, error: describe(err) });
    }
  },
);

server.registerTool(
  'github_ci',
  {
    title: 'GitHub CI status',
    description: 'Latest GitHub Actions run for a repo branch (default branch if omitted). Shows it on the Bar unless show=false.',
    inputSchema: {
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).describe('owner/name'),
      branch: z.string().optional(),
      show: z.boolean().default(true),
    },
  },
  async ({ repo, branch, show: display }) => {
    try {
      const ci = await latestCi(repo, branch);
      return display ? show(ciScene(ci), ci) : result(ci);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'github_inbox',
  {
    title: 'GitHub inbox',
    description: 'Counts of PRs awaiting your review, your open PRs, and issues assigned to you. Shows them on the Bar unless show=false.',
    inputSchema: { show: z.boolean().default(true) },
  },
  async ({ show: display }) => {
    try {
      const box = await inbox();
      return display ? show(inboxScene(box), box) : result(box);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'weather',
  {
    title: 'Weather',
    description: 'Current weather for a city (Open-Meteo). Shows it on the Bar with an icon unless show=false.',
    inputSchema: { city: z.string().min(1), show: z.boolean().default(true) },
  },
  async ({ city, show: display }) => {
    try {
      const w = await weather(city);
      return display ? show(weatherScene(w), w) : result(w);
    } catch (err) {
      return failure(err);
    }
  },
);

export async function startServer() {
  await server.connect(new StdioServerTransport());

  for (const warning of connectionInfo().warnings) {
    console.error(`busybar-mcp: ${warning}`);
  }
}
