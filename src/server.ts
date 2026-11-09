import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
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
  discoverBars,
  draw,
  FRONT_ROW,
  listStock,
  playSound,
  reconnect,
  remaining,
  rect,
  SCREEN,
  screenshot,
  status,
  text,
  useWifiAddress,
  validatePixels,
  type Display,
  type DrawResult,
  type Scene,
  type StockKind,
} from './bar.js';
import { isLanAddress } from './connection.js';
import { LOGOS } from './logos.js';
import { prepareImage } from './media/image.js';
import { audioToSnd, MAX_SECONDS, melodyToSnd } from './media/sound.js';
import { readSettings, writeSettings } from './settings.js';
import { ciScene, hasGitHubLogin, inbox, inboxScene, latestCi } from './services/github.js';
import { weather, weatherScene } from './services/weather.js';
import { checkForUpdate, type UpdateInfo } from './update.js';
import { VERSION } from './version.js';
import { wmCommand, wmSnapshot } from './wm.js';

type ToolGroup = 'wm' | 'github';

type StatusName = keyof typeof STATUSES;

const server = new McpServer({ name: 'busybar', version: VERSION });

let update: UpdateInfo | undefined;

let updateNoticeShown = false;

/**
 * Tools that only work with something extra: busybar-wm, or a GitHub login. Hidden until it is there, so the
 * model (and a user reading the tool list) only sees what can actually run.
 */
const groups: Record<ToolGroup, RegisteredTool[]> = { wm: [], github: [] };

let wmDetected = false;

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
/** Ready-made statuses and the built-in 72x16 animation each one uses (from the Bar's shared assets). */
const STATUSES = {
  meeting: { animation: 'meeting_72x16.anim', words: 'In a meeting' },
  call: { animation: 'on_call_72x16.anim', words: 'On a call' },
  focus: { animation: 'flow_72x16.anim', words: 'Focus' },
  dnd: { animation: 'dnd_72x16.anim', words: 'Do not disturb' },
  coding: { animation: 'coding_72x16.anim', words: 'Coding' },
  lunch: { animation: 'lunch_72x16.anim', words: 'Lunch' },
  back_soon: { animation: 'back_soon_72x16.anim', words: 'Back soon' },
  on_air: { animation: 'on_air_72x16.anim', words: 'On air' },
  chill: { animation: 'chill_time_72x16.anim', words: 'Chill time' },
  booked: { animation: 'booked_72x16.anim', words: 'Booked' },
  keep_out: { animation: 'keep_out_72x16.anim', words: 'Keep out' },
  low_battery: { animation: 'low_social_battery_72x16.anim', words: 'Low social battery' },
  hello: { animation: 'wave_invitation_72x16.anim', words: 'Hello!' },
} as const;

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
    delivery = drawn.error
      ? `Not shown on the Bar. ${drawn.error.replace(/^./, (c) => c.toUpperCase())} The image is only a preview.`
      : 'Dry run: the image is a preview only.';
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

/** bar_connect without an address: the Wi-Fi search, in words a user can follow. */
async function connectFound() {
  const found = await discoverBars();

  if (found.length === 0) {
    return result(
      'No BUSY Bar answered on this Wi-Fi. Ask the user to check it is on and on the same Wi-Fi as this computer ' +
        '(on a Mac, the chat app also needs System Settings → Privacy & Security → Local Network), or to plug it in ' +
        'with the USB cable. The Bar shows its IP under Settings → Wi-Fi; bar_connect can take it as addr.',
    );
  }

  if (found.length > 1) {
    return result({
      found: found.map(({ name, addr }) => ({ name, addr })),
      next: 'Several Bars are on this Wi-Fi. Ask the user which one is theirs, then call bar_connect with its addr.',
    });
  }

  const [bar] = found;
  useWifiAddress(bar.addr);
  await detectWm();

  try {
    await status();
    return result({ connected: true, name: bar.name, addr: bar.addr, note: 'Saved. USB is still used first when the cable is in.' });
  } catch (err) {
    return result({ connected: false, name: bar.name, addr: bar.addr, error: describe(err) });
  }
}

async function ringTimer() {
  try {
    await playSound({ snd: melodyToSnd('C6:120 E6:120 G6:120 C7:360', 'sine') });
  } catch {
    // The Bar may be gone by the time the timer ends; there is nobody to tell.
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
  'bar_set_status',
  {
    title: 'Set a status',
    description:
      'Show a ready-made status on the front of the Bar, using its built-in animations: in a meeting, on a call, ' +
      'focus, do not disturb, coding, lunch, back soon, on air, chill, booked, keep out, low social battery, hello. ' +
      'Optionally for a number of minutes, after which the Bar goes back to normal.',
    inputSchema: {
      status: z.enum(Object.keys(STATUSES) as [StatusName, ...StatusName[]]),
      minutes: z.number().positive().max(720).optional().describe('How long to show it; leave out to keep it until cleared'),
      urgent,
    },
  },
  async ({ status: name, minutes, urgent: force }) => {
    const { animation, words } = STATUSES[name];

    try {
      const scene: Scene = (await stockExists('animations', animation))
        ? { display: 'front', urgent: force, elements: [], images: [{ kind: 'stock', name: animation, animated: true, loop: true, x: 0, y: 0 }] }
        : { display: 'front', urgent: force, elements: [text('status', words, { x: 36, y: FRONT_ROW.single, align: 'top_mid' })] };

      if (minutes) {
        scene.timeout = Math.round(minutes * 60);
      }

      return show(scene, minutes ? `Status "${words}" for ${minutes} min.` : `Status "${words}" until cleared.`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'bar_timer',
  {
    title: 'Start a timer',
    description:
      'Count down on the Bar, e.g. a 25-minute focus timer or "tea in 4 minutes". The Bar counts by itself and ' +
      'chimes when time is up; the timer goes away shortly after. Works without busybar-wm.',
    inputSchema: {
      minutes: z.number().positive().max(720).describe('Length; fractions are fine, 0.5 is 30 seconds'),
      label: z.string().max(40).optional().describe('What it is for, e.g. "Focus" or "Tea"'),
      chime: z.boolean().default(true).describe('Play a short melody when time is up'),
      display,
      urgent,
    },
  },
  async ({ minutes, label, chime, display: where, urgent: force }) => {
    const seconds = Math.round(minutes * 60);
    const endsAt = new Date(Date.now() + seconds * 1000);
    const front = where === 'front';
    const color = '#F5B041';
    const scene: Scene = {
      display: where,
      urgent: force,
      timeout: seconds + 10,
      elements: label
        ? [text('label', label, front ? { x: 1, y: FRONT_ROW.top, width: 70, color: '#AAAAAA' } : { x: 6, y: 18, width: 138, font: 'bold' })]
        : [],
      countdowns: [
        label
          ? { id: 'timer', endsAt, x: front ? 1 : 6, y: front ? FRONT_ROW.bottom : 40, color }
          : { id: 'timer', endsAt, x: front ? 36 : 73, y: front ? 8 : 40, align: 'center', color },
      ],
    };
    const shown = await show(scene, `Timer: ${remaining(endsAt)}${label ? ` for ${label}` : ''}, ends at ${endsAt.toLocaleTimeString()}.`);

    if (chime && !connectionInfo().dryRun) {
      // The Bar counts down by itself; only the chime needs this process, and it must not keep it alive.
      setTimeout(ringTimer, seconds * 1000).unref();
    }

    return shown;
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
      'Connect to the user\'s BUSY Bar and remember it. Without addr it looks for Bars on this Wi-Fi and connects ' +
      'if there is exactly one; with several it lists them so the user can pick. With addr it saves a USB, Wi-Fi ' +
      'or cloud address (or a busybar-wm address). Use it for setup, and when the Bar cannot be reached.',
    inputSchema: {
      addr: z.string().min(1).optional().describe('Leave out to search the Wi-Fi'),
      lan_addr: z.string().trim().refine((addr) => addr === '' || isLanAddress(addr), 'Enter a local IP address or HTTP(S) URL.').optional()
        .describe('Optional LAN fallback for USB. Pass an empty string to remove it.'),
      password: z.string().optional().describe('HTTP access password, if the Bar has one'),
      token: z.string().optional().describe('Cloud token from cloud.busy.app/api-tokens'),
    },
  },
  async ({ addr, lan_addr, password, token }) => {
    if (!addr) {
      return connectFound();
    }

    const next = { ...readSettings(), BUSY_ADDR: addr, BUSY_HTTP_PASSWORD: password, BUSY_TOKEN: token };

    if (lan_addr !== undefined) {
      next.BUSY_LAN_ADDR = lan_addr;
      process.env.BUSY_LAN_ADDR = lan_addr;
    }

    writeSettings(next);
    process.env.BUSY_ADDR = addr;
    process.env.BUSY_HTTP_PASSWORD = password ?? '';
    process.env.BUSY_TOKEN = token ?? '';
    reconnect();
    await detectWm();

    try {
      const system = await status();
      return result({ saved: true, addr: connectionInfo().addr, reachable: true, firmware: system.firmware?.version });
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
      const system = info.dryRun ? null : await status();

      return result({ ...connectionInfo(), version: VERSION, update: update ?? null, system });
    } catch (err) {
      return result({ ...connectionInfo(), version: VERSION, update: update ?? null, reachable: false, error: describe(err) });
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

    const device = await diagnostics();
    const selected = connectionInfo().addr;
    const wm = await wmStatus(selected);

    return result({ addr: selected, wm, device });
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

gated('wm', server.registerTool(
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
));

gated('wm', server.registerTool(
  'busybar_switch_app',
  {
    description: 'Pin a ready app by its exact name from busybar_list_apps.',
    inputSchema: { app: z.string().trim().min(1).max(128) },
  },
  async ({ app }) => control({ action: 'switch', app }),
));

gated('wm', server.registerTool(
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
));

gated('wm', server.registerTool(
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
));

gated('wm', server.registerTool(
  'busybar_return_to_auto',
  {
    description: 'Release the current WM app pin and resume automatic display scheduling.',
    inputSchema: {},
  },
  async () => control({ action: 'auto' }),
));

gated('wm', server.registerTool(
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
));

gated('github', server.registerTool(
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
));

gated('github', server.registerTool(
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
));

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

function ask(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

server.registerPrompt(
  'setup',
  {
    title: 'Set up my BUSY Bar',
    description: 'Connect to your Bar and check that everything works.',
  },
  () =>
    ask(
      'Set up my BUSY Bar. Call bar_status. If the Bar cannot be reached, call bar_connect without an address to ' +
        'look for it on the Wi-Fi; if several are found, ask me which one is mine. If none answers, walk me through ' +
        'it in plain words, one step at a time: plug it in with the USB cable, or check it is on the same Wi-Fi; on ' +
        'a Mac, allow this app under System Settings → Privacy & Security → Local Network; the Bar shows its IP ' +
        'under Settings → Wi-Fi. Once connected, show "Hello!" with bar_set_status and tell me in two or three ' +
        'short sentences what I can ask you to do with the Bar.',
    ),
);

server.registerPrompt(
  'status',
  {
    title: 'Set my status',
    description: 'Meeting, call, focus, lunch, back soon… on the front of your Bar.',
    argsSchema: {
      status: z.string().describe('For example: in a meeting, on a call, focus, lunch, back soon, do not disturb'),
      minutes: z.string().optional().describe('For how long, in minutes (optional)'),
    },
  },
  ({ status: wanted, minutes }) =>
    ask(
      `Set my BUSY Bar status to "${wanted}"${minutes ? ` for ${minutes} minutes` : ''}. Use bar_set_status with ` +
        'the closest ready-made status; if none fits, use bar_text with short words instead. Reply in one sentence.',
    ),
);

server.registerPrompt(
  'focus',
  {
    title: 'Focus timer',
    description: 'A focus timer on the Bar that chimes when time is up.',
    argsSchema: { minutes: z.string().optional().describe('Length in minutes, 25 if left empty') },
  },
  ({ minutes }) =>
    ask(
      `Start a ${minutes || 25}-minute focus session on my BUSY Bar: bar_set_status focus on the front for that long, ` +
        'and bar_timer labelled "Focus" on the back. Reply in one sentence.',
    ),
);

server.registerPrompt(
  'weather',
  {
    title: 'Weather on the Bar',
    description: 'Current weather for a city.',
    argsSchema: { city: z.string().describe('City name') },
  },
  ({ city }) => ask(`Show the current weather in ${city} on my BUSY Bar with the weather tool. Reply in one sentence.`),
);

server.registerPrompt(
  'tell_me_when_done',
  {
    title: 'Tell me on the Bar when you finish',
    description: 'Use with a longer task: the Bar shows when the answer is ready.',
    argsSchema: { task: z.string().describe('What you want done') },
  },
  ({ task }) =>
    ask(
      `${task}\n\nWhen you have finished, tell me on my BUSY Bar: bar_text with logo "claude", line1 "Ready" and ` +
        'line2 a few words about the result, and the same on the back display with a short summary.',
    ),
);

function gated(group: ToolGroup, tool: RegisteredTool) {
  groups[group].push(tool);
  tool.disable();

  return tool;
}

function refreshTools() {
  const everything = process.env.BUSYBAR_ALL_TOOLS === '1';
  const wanted: Record<ToolGroup, boolean> = {
    wm: everything || process.env.BUSYBAR_WM === '1' || wmDetected,
    github: everything || hasGitHubLogin(),
  };

  for (const [group, tools] of Object.entries(groups) as Array<[ToolGroup, RegisteredTool[]]>) {
    for (const tool of tools) {
      if (wanted[group] && !tool.enabled) {
        tool.enable();
      } else if (!wanted[group] && tool.enabled) {
        tool.disable();
      }
    }
  }
}

/** busybar-wm answers on its own control path; a plain Bar does not, which is the cheap way to tell them apart. */
async function detectWm() {
  const { addr, dryRun } = connectionInfo();

  if (dryRun) {
    return;
  }

  try {
    await wmSnapshot(addr);
    wmDetected = true;
  } catch {
    wmDetected = false;
  }

  refreshTools();
}

async function lookForUpdate() {
  update = await checkForUpdate();
}

export async function startServer() {
  refreshTools();
  await server.connect(new StdioServerTransport());
  lookForUpdate();
  detectWm();

  for (const warning of connectionInfo().warnings) {
    console.error(`busybar-mcp: ${warning}`);
  }
}
