import {
  BusyBar,
  generateXpm2,
  type AnimationElement,
  type ImageElement,
  type RectangleElement,
  type TextElement,
  type XpmBitmapElement,
} from '@busy-app/busy-lib';
import { createHash } from 'node:crypto';
import { loadBarConfig } from 'busybar-kit/config';
import { BACK, FRONT } from 'busybar-kit/device';
import { isLowPriority } from 'busybar-kit/errors';
import { Bitmap, parseColor, renderOnto, type Rgba } from 'busybar-kit/preview';
import type { Display } from './media/image.js';
import { toAscii } from './text.js';

export type { Display };

export type PixelArt = {
  palette: Record<string, string>;
  grid: string[];
  x?: number;
  y?: number;
};

export type SceneImage =
  | { kind: 'upload'; bitmap: Bitmap; png: Buffer; x: number; y: number }
  | { kind: 'stock'; name: string; animated: boolean; loop?: boolean; x: number; y: number };

/** What the server draws on one display: the device's own elements, plus what the preview has to paint itself. */
export type Scene = {
  display?: Display;
  elements: Array<TextElement | RectangleElement>;
  pixels?: PixelArt[];
  images?: SceneImage[];
  ledColor?: string;
  /** Draw over anything, an active BUSY work session included. */
  urgent?: boolean;
  /** Skip the photo of the real screen after drawing; the notifier has no one to show it to. */
  photo?: boolean;
  /** Seconds until the Bar removes everything in the scene by itself; 0 or unset keeps it. */
  timeout?: number;
};

export type DrawResult = {
  sent: boolean;
  error?: string;
  /** What the server expects the screen to look like. */
  preview: Buffer;
  /** What the screen really shows after the draw, when the Bar could be asked. */
  actual?: Buffer;
};

export type StockKind = 'images' | 'animations' | 'sounds';

/** The notifier draws under its own name, so a notification never wipes what the MCP tools drew. */
export const APP_NAME = process.env.BUSYBAR_APP || 'claude';

export const SCREEN = {
  front: { width: FRONT.width, height: FRONT.height, usableWidth: FRONT.width, index: 0 },
  // The firmware keeps a status column (Bluetooth, Wi-Fi, volume, battery) down the right edge of the back.
  back: { width: BACK.width, height: BACK.height, usableWidth: 146, index: 1 },
} as const;

const OFF: Record<Display, Rgba> = {
  front: { r: 10, g: 10, b: 12, a: 255 },
  back: { r: 0, g: 0, b: 0, a: 255 },
};

const PREVIEW_SCALE: Record<Display, number> = { front: 10, back: 4 };

const REACH_HINT =
  'Check the Bar is on and plugged in over USB (or on the same Wi-Fi). On macOS 15+, the app running this ' +
  '(Claude, ChatGPT/Codex) also needs System Settings → Privacy & Security → Local Network turned on.';

let { bar: config, warnings } = loadBarConfig();

const dryRun = process.env.BUSYBAR_DRY_RUN === '1';

let client = makeClient();

/** Element ids this process put on each display, so drawing one display leaves the other alone. */
const shown: Record<Display, string[]> = { front: [], back: [] };

/** A fresh process doesn't know what an earlier one left behind, so its first draw clears everything of ours. */
let synced = false;

const uploaded = new Set<string>();

const stockCache = new Map<StockKind, string[]>();

function makeClient() {
  return new BusyBar({
    addr: config.busyAddr,
    token: config.busyToken || undefined,
    HTTPAccessPassword: config.busyHttpPassword || undefined,
    timeout: 10_000,
  });
}

/** Points the running server at another Bar (after `env` changed), forgetting what it knew about the old one. */
export function reconnect() {
  ({ bar: config, warnings } = loadBarConfig());
  client = makeClient();
  shown.front = [];
  shown.back = [];
  synced = false;
  uploaded.clear();
  stockCache.clear();
}

export function connectionInfo() {
  return { addr: config.busyAddr, cloud: config.isCloud, dryRun, warnings };
}

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` → `#RRGGBBAA`, which is what the device wants. */
export function rgba(color: string) {
  let hex = color.trim().replace(/^#/, '');

  if (hex.length === 3) {
    hex = [...hex].map((c) => c + c).join('');
  }

  if (hex.length === 6) {
    hex += 'FF';
  }

  if (!/^[0-9a-f]{8}$/i.test(hex)) {
    throw new Error(`Bad colour "${color}", expected #RRGGBB`);
  }

  return `#${hex.toUpperCase()}`;
}

/** The fonts are printable ASCII only; anything else would show as garbage. */
export function ascii(text: string) {
  return toAscii(text);
}

export function text(id: string, value: string, opts: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: 'text',
    display: 'front',
    font: 'small',
    text: ascii(value),
    align: 'top_left',
    x: 0,
    y: 0,
    timeout: 0,
    ...opts,
    color: rgba(opts.color ?? '#FFFFFF'),
  };
}

export function rect(id: string, x: number, y: number, width: number, height: number, color: string): RectangleElement {
  return {
    id,
    type: 'rectangle',
    display: 'front',
    align: 'top_left',
    x,
    y,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    fill: 'solid',
    fill_colors: [rgba(color)],
    border_width: 0,
    border_color: '#00000000',
    timeout: 0,
  };
}

export function validatePixels(art: PixelArt, display: Display = 'front') {
  const width = Math.max(0, ...art.grid.map((row) => row.length));
  const x = art.x ?? 0;
  const y = art.y ?? 0;
  const screen = SCREEN[display];

  if (art.grid.length === 0 || width === 0) {
    throw new Error('grid is empty');
  }

  if (x + width > screen.width || y + art.grid.length > screen.height) {
    throw new Error(`Art is ${width}x${art.grid.length} at (${x},${y}); the ${display} screen is ${screen.width}x${screen.height}`);
  }

  if (Object.keys(art.palette).length > 32) {
    throw new Error('At most 32 colours');
  }

  for (const row of art.grid) {
    for (const ch of row) {
      if (!(ch in art.palette)) {
        throw new Error(`Symbol "${ch}" is not in the palette`);
      }
    }
  }
}

function xpmElement(id: string, art: PixelArt): XpmBitmapElement {
  const width = Math.max(...art.grid.map((row) => row.length));
  const transparent = Object.entries(art.palette).find(([, c]) => /^none$/i.test(c))?.[0] ?? ' ';
  const grid = art.grid.map((row) => row.padEnd(width, transparent));
  const palette = Object.fromEntries(
    Object.entries(art.palette).map(([symbol, color]) => [symbol, /^none$/i.test(color) ? 'None' : rgba(color)]),
  );

  if (!(transparent in palette)) {
    palette[transparent] = 'None';
  }

  return {
    id,
    type: 'xpmbitmap',
    align: 'top_left',
    x: art.x ?? 0,
    y: art.y ?? 0,
    data: generateXpm2({ palette, grid }),
    timeout: 0,
  };
}

function grey({ r, g, b, a }: Rgba): Rgba {
  const level = Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / 17) * 17;

  return { r: level, g: level, b: level, a };
}

/** Stock names carry their size, e.g. `coding_72x16.anim`. */
function stockSize(name: string) {
  const match = /_(\d+)x(\d+)\.\w+$/.exec(name);

  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 16, height: 16 };
}

/** A PNG of what the scene should look like, so the model can see its work even with no Bar on the desk. */
export function preview(scene: Scene) {
  const display = scene.display ?? 'front';
  const screen = SCREEN[display];
  const bitmap = new Bitmap(screen.width, screen.height, OFF[display]);
  const tone = display === 'back' ? grey : (color: Rgba) => color;
  const withDisplay = scene.elements.map((element) => ({ ...element, display }));

  renderOnto(bitmap, withDisplay.filter((e) => e.type === 'rectangle'), display);

  for (const image of scene.images ?? []) {
    if (image.kind === 'upload') {
      bitmap.blit(image.bitmap, image.x, image.y);
      continue;
    }

    // Stock .image/.anim files are a device format; mark where they go.
    const { width, height } = stockSize(image.name);
    bitmap.fillRect(image.x, image.y, width, height, tone({ r: 60, g: 60, b: 90, a: 255 }));
  }

  for (const art of scene.pixels ?? []) {
    art.grid.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        const color = art.palette[ch];

        if (color && !/^none$/i.test(color)) {
          bitmap.set((art.x ?? 0) + dx, (art.y ?? 0) + dy, tone(parseColor(rgba(color))));
        }
      });
    });
  }

  renderOnto(bitmap, withDisplay.filter((e) => e.type === 'text'), display);

  return bitmap.scale(PREVIEW_SCALE[display]).toPng();
}

async function upload(file: string, data: Buffer) {
  if (uploaded.has(file)) {
    return;
  }

  await client.assetsUpload({ application_name: APP_NAME, file, data });
  uploaded.add(file);
}

/** Content-addressed, so the same picture or sound is uploaded once. */
export function assetName(prefix: string, data: Buffer, ext: string) {
  return `${prefix}-${createHash('sha1').update(data).digest('hex').slice(0, 12)}.${ext}`;
}

async function imageElement(id: string, image: SceneImage): Promise<ImageElement | AnimationElement> {
  const base = { id, align: 'top_left' as const, x: image.x, y: image.y, timeout: 0 };

  if (image.kind === 'upload') {
    const file = assetName('img', image.png, 'png');
    await upload(file, image.png);

    return { ...base, type: 'image', path: file };
  }

  if (image.animated) {
    return { ...base, type: 'animation', stock_path: `shared/${image.name}`, loop: image.loop ?? true };
  }

  return { ...base, type: 'image', stock_path: `shared/${image.name}` };
}

export async function draw(scene: Scene): Promise<DrawResult> {
  const display = scene.display ?? 'front';
  const png = preview(scene);

  if (dryRun) {
    return { sent: false, preview: png };
  }

  try {
    const pictures = await Promise.all((scene.images ?? []).map((image, i) => imageElement(`img${i}`, image)));
    const elements = [
      ...scene.elements.filter((e) => e.type === 'rectangle'),
      ...pictures,
      ...(scene.pixels ?? []).map((art, i) => xpmElement(`px${i}`, art)),
      ...scene.elements.filter((e) => e.type === 'text'),
    ].map((element, i) => ({
      ...element,
      id: `${display}-${element.id}`,
      display,
      z_index: i,
      ...(scene.timeout ? { timeout: scene.timeout } : {}),
    }));

    await clearOwn(synced ? shown[display] : undefined);
    await client.displayDraw({
      application_name: APP_NAME,
      priority: scene.urgent ? 100 : config.drawPriority,
      led_notification_color: scene.ledColor ? rgba(scene.ledColor) : undefined,
      elements,
    });

    if (!synced) {
      shown.front = [];
      shown.back = [];
    }

    shown[display] = elements.map((element) => element.id);
    synced = true;

    return { sent: true, preview: png, actual: scene.photo === false ? undefined : await settledScreenshot(display) };
  } catch (err) {
    const error = isLowPriority(err)
      ? 'the Bar is showing something more important (an active BUSY work session or another app), so nothing was drawn. Retry with urgent: true only if the user asked to interrupt it'
      : describe(err);

    return { sent: false, error, preview: png };
  }
}

/** The screen a moment after a draw; undefined if the Bar won't say. */
async function settledScreenshot(display: Display) {
  await new Promise((done) => setTimeout(done, 400));

  try {
    return await screenshot(display);
  } catch {
    // The draw itself succeeded; the preview stands in for the photo.
    return undefined;
  }
}

/** Clears one display, or everything this app shows when `display` is left out. */
export async function clear(display?: Display) {
  if (dryRun) {
    return;
  }

  if (display && synced) {
    await clearOwn(shown[display]);
    shown[display] = [];
    return;
  }

  await clearOwn();
  shown.front = [];
  shown.back = [];
  synced = true;
}

/** The Bar answers 400 when this app has nothing on screen, which is the state we want anyway. */
async function clearOwn(ids?: string[]) {
  if (ids && ids.length === 0) {
    return;
  }

  try {
    await client.displayClear({ application_name: APP_NAME, element_ids: ids });
  } catch (err) {
    const nothingShown = err instanceof Error && 'status' in err && err.status === 400 && /not displaying/i.test(describe(err));

    if (!nothingShown) {
      throw err;
    }
  }
}

/** The real screen, as a PNG. */
export async function screenshot(display: Display = 'front') {
  const screen = SCREEN[display];
  const data = await client.displayScreenFrameGet({ display: screen.index }, { dataType: 'binary', format: 'rgba' });

  if (!data || data.length < screen.width * screen.height * 4) {
    throw new Error('The Bar returned no frame');
  }

  const opaque = Uint8Array.from(data.subarray(0, screen.width * screen.height * 4));

  for (let i = 3; i < opaque.length; i += 4) {
    opaque[i] = 255;
  }

  return Bitmap.fromRgba(screen.width, screen.height, opaque).scale(PREVIEW_SCALE[display]).toPng();
}

/** Undefined in a dry run: the list lives on the device. */
export async function listStock(kind: StockKind) {
  if (dryRun) {
    return undefined;
  }

  const cached = stockCache.get(kind);

  if (cached) {
    return cached;
  }

  const { list } = await client.storageListGet({ path: `/ext/apps_assets/shared/${kind}` });
  const names = list.filter((entry) => entry.type === 'file' && !entry.name.startsWith('.')).map((entry) => entry.name);
  stockCache.set(kind, names);

  return names;
}

export async function playSound(sound: { stock: string } | { snd: Buffer }) {
  if (dryRun) {
    return;
  }

  if ('stock' in sound) {
    await client.audioPlay({ application_name: APP_NAME, stock_path: `shared/${sound.stock}` });
    return;
  }

  const file = assetName('snd', sound.snd, 'snd');
  await upload(file, sound.snd);
  await client.audioPlay({ application_name: APP_NAME, path: file });
}

export async function status() {
  return client.systemStatusGet();
}

export function describe(err: unknown) {
  if (err && typeof err === 'object' && 'status' in err) {
    const e = err as { status: number; message: string; body?: unknown };
    return `HTTP ${e.status}: ${e.message}${e.body ? ` ${JSON.stringify(e.body)}` : ''}`;
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    return `the Bar at ${config.busyAddr} did not answer in time. ${REACH_HINT}`;
  }

  // Node's fetch says only "fetch failed"; the reason is in `cause`.
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : undefined;

  if (cause) {
    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : cause.message;
    return `cannot reach the Bar at ${config.busyAddr} (${code}). ${REACH_HINT}`;
  }

  return err instanceof Error ? err.message : String(err);
}
