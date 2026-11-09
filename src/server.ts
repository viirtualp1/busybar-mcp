import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  ascii,
  clear,
  connectivity,
  connectionInfo,
  describe,
  diagnostics,
  draw,
  FRONT_ROW,
  listStock,
  playSound,
  reconnect,
  rect,
  SCREEN,
  screenshot,
  status,
  text,
  validatePixels,
  type Display,
  type DrawResult,
  type Scene,
  type StockKind,
} from './bar.js';
import { LOGOS } from './logos.js';
import { prepareImage } from './media/image.js';
import { audioToSnd, MAX_SECONDS, melodyToSnd } from './media/sound.js';
import { readSettings, writeSettings } from './settings.js';
import { ciScene, inbox, inboxScene, latestCi } from './services/github.js';
import { weather, weatherScene } from './services/weather.js';
import { checkForUpdate, type UpdateInfo } from './update.js';
import { VERSION } from './version.js';
import { wmCommand, wmSnapshot } from './wm.js';

const server = new McpServer({ name: 'busybar', version: VERSION });

let update: UpdateInfo | undefined;

let updateNoticeShown = false;

const color = z.string().describe('Hex colour, #RRGGBB');

const urgent = z
  .boolean()
  .optional()
  .describe('Request higher draw priority. Use only when asked to interrupt.');

const display = z
  .enum(['front', 'back'])
  .default('front')
  .describe('front: 72x16 colour LED strip facing others. back: 160x80 greyscale (16 levels) OLED facing you.');

/** Where text goes on each screen. The back has room for a bigger first line. */
const LAYOUT = {
  front: { x: 1, width: 71, oneLineY: FRONT_ROW.single, line1Y: FRONT_ROW.top, line2Y: FRONT_ROW.bottom, font1: 'small', accentHeight: 16 },
  back: { x: 6, width: 138, oneLineY: 34, line1Y: 24, line2Y: 46, font1: 'bold', accentHeight: 80 },
} as const;

function image(png: Buffer) {
  return { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' };
}

function result(summary: unknown, drawn?: DrawResult): CallToolResult {
  let delivery: string | undefined;

  if (drawn?.sent) {
    delivery = drawn.actual
      ? 'Draw request accepted. The image shows what is currently on the Bar.'
      : 'Draw request accepted. The image is a preview.';
  } else if (drawn) {
    delivery = drawn.error ? `NOT shown on the Bar: ${drawn.error.replace(/\.$/, '')}. The image is a preview only.` : 'Dry run: the image is a preview only.';
  }

  const body = typeof summary === 'string' ? summary : JSON.stringify(summary, null, 2);

  return {
    content: [
      { type: 'text', text: [delivery, body, takeUpdateNotice()].filter(Boolean).join('\n') },
      ...(drawn ? [image(drawn.actual ?? drawn.preview)] : []),
    ],
  };
}

function failure(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: [describe(err), takeUpdateNotice()].filter(Boolean).join('\n') }] };
}

/** Once per session: the first tool result after the check found a newer release carries the note. */
function takeUpdateNotice() {
  if (!update || updateNoticeShown) {
    return undefined;
  }

  updateNoticeShown = true;

  return `Note for the user: busybar ${update.latest} is out (this is ${update.current}). To update, ${update.how}. Release notes: ${update.url}`;
}

async function show(scene: Scene, summary: unknown = '') {
  return result(summary, await draw(scene));
}

async function control(action: { action: string; [key: string]: unknown }) {
  const { addr, dryRun } = connectionInfo();

  if (dryRun) {
    return result({ dryRun, action });
  }

  try {
    return result(await wmCommand(addr, action));
  } catch (error) {
    return failure(error);
  }
}

async function wmStatus(addr: string) {
  try {
    const { activeApp, pinnedApp } = await wmSnapshot(addr);

    return { connected: true, activeApp, pinnedApp };
  } catch (error) {
    return { connected: false, error: describe(error) };
  }
}

async function stockExists(kind: StockKind, name: string) {
  const names = await listStock(kind);

  return !names || names.includes(name);
}

function caption(id: string, value: string, where: Display, x: number, colour?: string) {
  const screen = SCREEN[where];

  return text(id, value, {
    x,
    y: where === 'front' ? FRONT_ROW.single : 36,
    width: Math.max(1, screen.usableWidth - x - 1),
    color: colour,
    scroll_rate: value.length * 4 > screen.usableWidth - x ? 900 : undefined,
  });
}

server.registerTool(
  'bar_text',
  {
    title: 'Show text',
    description:
      'Show a short status on the BUSY Bar, ASCII only. Front: 72x16, ~17 characters per line. Back: 160x80, ~37 characters per line. ' +
      'One or two lines; a long first line scrolls. Returns an image of the result.',
    inputSchema: {
      line1: z.string().max(120),
      line2: z.string().max(60).optional(),
      color: color.optional(),
      line2_color: color.optional(),
      accent: color.optional().describe('Draws a 3px coloured band on the left'),
      led_color: color.optional().describe('Blink the status LED in this colour'),
      logo: z.enum(['claude', 'codex']).optional().describe('Show the Claude or Codex logo at the left, e.g. for "Claude is working on…"'),
      display,
      urgent,
    },
  },
  async ({ line1, line2, color: c, line2_color, accent, led_color, logo, display: where, urgent: force }) => {
    const layout = LAYOUT[where];
    const logoX = where === 'front' ? 0 : 2;
    const logoWidth = where === 'front' ? 18 : 48;
    const x = logo ? logoWidth : accent ? layout.x + 5 : layout.x;
    const width = layout.width - (x - layout.x);
    const twoLines = line2 !== undefined;

    return show({
      display: where,
      ledColor: led_color,
      urgent: force,
      pixels: logo ? [{ ...LOGOS[logo][where], x: logoX, y: where === 'front' ? 0 : 4 }] : [],
      elements: [
        ...(accent && !logo ? [rect('accent', 0, 0, 3, layout.accentHeight, accent)] : []),
        text('line1', line1, {
          x,
          y: twoLines ? layout.line1Y : layout.oneLineY,
          width,
          font: layout.font1,
          color: c,
          scroll_rate: line1.length * 4 > width ? 900 : undefined,
        }),
        ...(twoLines ? [text('line2', line2, { x, y: layout.line2Y, width, color: line2_color ?? '#AAAAAA' })] : []),
      ],
    });
  },
);

server.registerTool(
  'bar_pixels',
  {
    title: 'Draw pixel art',
    description:
      '`grid` is rows of single-character symbols, top to bottom; every symbol must be in `palette` ' +
      '(symbol → #RRGGBB, or "none" for transparent). Max 32 colours. Fits 72x16 on the front, 160x80 on the back (shown in grey there). ' +
      'Optionally add a caption to the right of the art. Look at the returned image and iterate if it looks wrong.',
    inputSchema: {
      palette: z.record(z.string().length(1), z.string()),
      grid: z.array(z.string()).min(1).max(80),
      x: z.number().int().min(0).max(159).optional(),
      y: z.number().int().min(0).max(79).optional(),
      caption: z.string().max(60).optional(),
      caption_color: color.optional(),
      display,
      urgent,
    },
  },
  async ({ palette, grid, x, y, caption: label, caption_color, display: where, urgent: force }) => {
    const art = { palette, grid, x, y };

    try {
      validatePixels(art, where);
    } catch (err) {
      return failure(err);
    }

    const right = (x ?? 0) + Math.max(...grid.map((r) => r.length)) + 2;

    return show({
      display: where,
      pixels: [art],
      urgent: force,
      elements: label ? [caption('caption', label, where, right, caption_color)] : [],
    });
  },
);

server.registerTool(
  'bar_progress',
  {
    title: 'Show progress',
    description: 'Show a labelled progress bar (0..1).',
    inputSchema: {
      label: z.string().max(40),
      value: z.number().min(0).max(1),
      color: color.optional(),
      display,
      urgent,
    },
  },
  async ({ label, value, color: c = '#2ECC71', display: where, urgent: force }) => {
    const pct = `${Math.round(value * 100)}%`;
    const back = where === 'back';
    const left = back ? 6 : 1;
    const span = back ? 136 : 70;
    const barY = back ? 44 : 10;
    const barHeight = back ? 10 : 4;
    const labelY = back ? 26 : 1;

    return show({
      display: where,
      urgent: force,
      elements: [
        text('label', label, { x: left, y: labelY, width: span - pct.length * 4 - 1 }),
        text('pct', pct, { x: left + span - pct.length * 4, y: labelY, color: '#AAAAAA' }),
        rect('track', left, barY, span, barHeight, '#2A2A2A'),
        rect('fill', left, barY, Math.max(1, value * span), barHeight, c),
      ],
    });
  },
);

server.registerTool(
  'bar_image',
  {
    title: 'Show a picture',
    description:
      'Show a picture: a local file path or an http(s) URL (PNG; on macOS also JPEG, GIF, HEIC, WebP), or a stock image from bar_stock. ' +
      'It is scaled to fit max_width x max_height (the whole screen by default), uploaded, and dithered to 16 greys on the back. ' +
      'Pixel art in small files stays sharp when scaled up.',
    inputSchema: {
      source: z.string().optional().describe('Path or URL of the picture'),
      stock: z.string().optional().describe('Stock image name from bar_stock, e.g. dt_apple_red.image'),
      x: z.number().int().min(0).max(159).optional(),
      y: z.number().int().min(0).max(79).optional(),
      max_width: z.number().int().min(1).max(160).optional(),
      max_height: z.number().int().min(1).max(80).optional(),
      caption: z.string().max(60).optional(),
      caption_color: color.optional(),
      display,
      urgent,
    },
  },
  async ({ source, stock, x = 0, y = 0, max_width, max_height, caption: label, caption_color, display: where, urgent: force }) => {
    if (Boolean(source) === Boolean(stock)) {
      return failure(new Error('Give exactly one of source or stock'));
    }

    try {
      const screen = SCREEN[where];
      let right: number;
      let scene: Scene;

      if (stock) {
        if (!(await stockExists('images', stock))) {
          return failure(new Error(`No stock image "${stock}"; see bar_stock`));
        }

        const size = /_(\d+)x\d+\.\w+$/.exec(stock);
        right = x + (size ? Number(size[1]) : 16) + 2;
        scene = { display: where, urgent: force, elements: [], images: [{ kind: 'stock', name: stock, animated: false, x, y }] };
      } else {
        const picture = await prepareImage(
          source as string,
          where,
          max_width ?? screen.usableWidth - x,
          max_height ?? screen.height - y,
        );
        right = x + picture.bitmap.width + 2;
        scene = { display: where, urgent: force, elements: [], images: [{ kind: 'upload', ...picture, x, y }] };
      }

      if (label && right < screen.usableWidth - 4) {
        scene.elements.push(caption('caption', label, where, right, caption_color));
      }

      return show(scene);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_animation',
  {
    title: 'Play an animation',
    description:
      'Play one of the Bar\'s stock animations (names from bar_stock, e.g. coding_72x16.anim, on_air_72x16.anim, meeting_72x16.anim). ' +
      'The size is in the name; 72x16 ones fill the front screen. Loops by default. Custom animations are not supported (closed format).',
    inputSchema: {
      name: z.string(),
      loop: z.boolean().default(true),
      x: z.number().int().min(0).max(159).optional(),
      y: z.number().int().min(0).max(79).optional(),
      caption: z.string().max(60).optional(),
      caption_color: color.optional(),
      display,
      urgent,
    },
  },
  async ({ name, loop, x = 0, y = 0, caption: label, caption_color, display: where, urgent: force }) => {
    try {
      if (!(await stockExists('animations', name))) {
        return failure(new Error(`No stock animation "${name}"; see bar_stock`));
      }

      const size = /_(\d+)x\d+\.\w+$/.exec(name);
      const right = x + (size ? Number(size[1]) : 16) + 2;
      const scene: Scene = {
        display: where,
        urgent: force,
        elements: [],
        images: [{ kind: 'stock', name, animated: true, loop, x, y }],
      };

      if (label && right < SCREEN[where].usableWidth - 4) {
        scene.elements.push(caption('caption', label, where, right, caption_color));
      }

      return show(scene, 'The preview cannot render device animations; the photo, when there is one, shows a single frame.');
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_stock',
  {
    title: 'List stock media',
    description: 'Images, animations and sounds built into the Bar, for bar_image, bar_animation and bar_sound.',
    inputSchema: { kind: z.enum(['images', 'animations', 'sounds']).optional() },
  },
  async ({ kind }) => {
    const kinds: StockKind[] = kind ? [kind] : ['images', 'animations', 'sounds'];

    try {
      const lists = await Promise.all(kinds.map(async (k) => [k, await listStock(k)] as const));

      if (lists.some(([, names]) => !names)) {
        return result('Dry run: the stock list lives on the Bar.');
      }

      return result(Object.fromEntries(lists));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_sound',
  {
    title: 'Play a sound',
    description:
      'Play exactly one of: a stock sound (bar_stock), an audio file path or URL (WAV; MP3/M4A/AIFF too on macOS or with ffmpeg), ' +
      `or a melody you write. Melody: space-separated NOTE:ms tokens, e.g. "C5:150 E5:150 G5:150 C6:400", R for a rest, ` +
      `chords with + ("C4+E4+G4:500"). Up to ${MAX_SECONDS}s.`,
    inputSchema: {
      stock: z.string().optional(),
      file: z.string().optional().describe('Path or URL of an audio file'),
      melody: z.string().max(2000).optional(),
      wave: z.enum(['square', 'sine', 'triangle', 'saw']).default('square').describe('Timbre for melody: square is chiptune, sine is soft'),
    },
  },
  async ({ stock, file, melody, wave }) => {
    if ([stock, file, melody].filter(Boolean).length !== 1) {
      return failure(new Error('Give exactly one of stock, file or melody'));
    }

    try {
      if (stock) {
        if (!(await stockExists('sounds', stock))) {
          return failure(new Error(`No stock sound "${stock}"; see bar_stock`));
        }

        await playSound({ stock });
        return result(connectionInfo().dryRun ? 'Dry run: not played.' : `Playing ${stock}.`);
      }

      const snd = melody ? melodyToSnd(melody, wave) : await audioToSnd(file as string);
      await playSound({ snd });
      const seconds = (snd.length / 2 / 44_100).toFixed(1);

      return result(connectionInfo().dryRun ? `Dry run: ${seconds}s, not played.` : `Playing ${seconds}s.`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_clear',
  {
    title: 'Clear',
    description: 'Dismiss temporary overlays and drawings from the MCP. Both screens unless display is given.',
    inputSchema: { display: z.enum(['front', 'back']).optional() },
  },
  async ({ display: where }) => {
    try {
      await clear(where);
      return result('Cleared.');
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_screenshot',
  {
    title: 'Screenshot',
    description: 'Grab what a BUSY Bar screen shows right now, as an image.',
    inputSchema: { display },
  },
  async ({ display: where }) => {
    try {
      return { content: [image(await screenshot(where))] };
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_connect',
  {
    title: 'Connect to a Bar',
    description:
      'Save a direct USB, Wi-Fi or cloud address, or a busybar-wm address for shared display orchestration.',
    inputSchema: {
      addr: z.string().min(1),
      password: z.string().optional().describe('HTTP access password, if the Bar has one'),
      token: z.string().optional().describe('Cloud token from cloud.busy.app/api-tokens'),
    },
  },
  async ({ addr, password, token }) => {
    const next = { ...readSettings(), BUSY_ADDR: addr, BUSY_HTTP_PASSWORD: password, BUSY_TOKEN: token };

    writeSettings(next);
    process.env.BUSY_ADDR = addr;
    process.env.BUSY_HTTP_PASSWORD = password ?? '';
    process.env.BUSY_TOKEN = token ?? '';
    reconnect();

    try {
      const system = await status();
      return result({ saved: true, addr, reachable: true, firmware: system.firmware?.version });
    } catch (err) {
      return result({ saved: true, addr, reachable: false, error: describe(err) });
    }
  },
);

server.registerTool(
  'bar_status',
  { title: 'Bar status', description: 'Which Bar the server talks to, and its system status.' },
  async () => {
    const info = connectionInfo();

    try {
      return result({ ...info, version: VERSION, update: update ?? null, system: info.dryRun ? null : await status() });
    } catch (err) {
      return result({ ...info, version: VERSION, update: update ?? null, reachable: false, error: describe(err) });
    }
  },
);

server.registerTool(
  'busybar_get_status',
  {
    description: 'Read WM connection and active app, plus device, power, uptime, firmware and update status.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  },
  async () => {
    const { addr, dryRun } = connectionInfo();

    if (dryRun) {
      return result({ addr, dryRun });
    }

    const [wm, device] = await Promise.all([wmStatus(addr), diagnostics()]);

    return result({ addr, wm, device });
  },
);

server.registerTool(
  'busybar_get_connectivity',
  {
    description: 'Read Wi-Fi, Bluetooth Low Energy, and USB or Wi-Fi transport status from the Bar.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  },
  async () => result(connectionInfo().dryRun ? { dryRun: true } : await connectivity()),
);

server.registerTool(
  'busybar_list_apps',
  {
    description: 'List apps in the window manager manifest, including which are running and ready to show.',
    annotations: { readOnlyHint: true },
    inputSchema: {},
  },
  async () => {
    try {
      const { activeApp, pinnedApp, apps } = await wmSnapshot(connectionInfo().addr);

      return result({ activeApp, pinnedApp, apps });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  'busybar_switch_app',
  {
    description: 'Pin a ready app by its exact name from busybar_list_apps.',
    inputSchema: { app: z.string().trim().min(1).max(128) },
  },
  async ({ app }) => control({ action: 'switch', app }),
);

server.registerTool(
  'busybar_show_message',
  {
    description: 'Show a temporary WM overlay and automatically reveal the app underneath when it expires.',
    inputSchema: {
      message: z.string().trim().min(1).max(120),
      durationSeconds: z.number().int().min(1).max(300).default(10),
      display,
    },
  },
  async ({ message, durationSeconds, display }) => {
    const printable = ascii(message).trim().slice(0, 120);

    if (!printable) {
      return failure(new Error('The message needs at least one character the Bar can display.'));
    }

    return control({ action: 'message', text: printable, durationSeconds, display });
  },
);

server.registerTool(
  'busybar_start_timer',
  {
    description: 'Start a countdown overlay on the Bar. The WM removes it when time runs out.',
    inputSchema: {
      durationSeconds: z.number().int().min(1).max(86400),
      label: z.string().max(120).optional(),
      display,
    },
  },
  async ({ durationSeconds, label, display }) => control({
    action: 'timer', text: ascii(label ?? '').slice(0, 120), durationSeconds, display,
  }),
);

server.registerTool(
  'busybar_return_to_auto',
  {
    description: 'Release the current WM app pin and resume automatic display scheduling.',
    inputSchema: {},
  },
  async () => control({ action: 'auto' }),
);

server.registerTool(
  'busybar_send_input',
  {
    description: 'Route an OK or START tap, or an encoder step, to an app listening through the WM. Supply delta only for the encoder.',
    inputSchema: {
      key: z.enum(['ok', 'start', 'encoder']),
      delta: z.number().int().min(-10).max(10).optional(),
    },
  },
  async ({ key, delta }) => {
    if (key === 'encoder' ? !delta : delta !== undefined) {
      return failure(new Error('Only the encoder takes a nonzero delta.'));
    }

    return control({ action: 'input', key, delta });
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
  async ({ repo, branch, show: visible }) => {
    try {
      const ci = await latestCi(repo, branch);
      return visible ? show(ciScene(ci), ci) : result(ci);
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
  async ({ show: visible }) => {
    try {
      const box = await inbox();
      return visible ? show(inboxScene(box), box) : result(box);
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
  async ({ city, show: visible }) => {
    try {
      const w = await weather(city);
      return visible ? show(weatherScene(w), w) : result(w);
    } catch (err) {
      return failure(err);
    }
  },
);

async function lookForUpdate() {
  update = await checkForUpdate();
}

export async function startServer() {
  await server.connect(new StdioServerTransport());
  lookForUpdate();

  for (const warning of connectionInfo().warnings) {
    console.error(`busybar-mcp: ${warning}`);
  }
}
