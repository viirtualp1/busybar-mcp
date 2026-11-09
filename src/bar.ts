import {
  type BusyBar,
  generateXpm2,
  type AnimationElement,
  type CountdownElement,
  type ImageElement,
  type RectangleElement,
  type TextElement,
  type XpmBitmapElement,
} from '@busy-app/busy-lib';
import { createHash } from 'node:crypto';
import { BACK, FRONT } from 'busybar-kit/device';
import { isLowPriority } from 'busybar-kit/errors';
import { Bitmap, parseColor, renderOnto, type Rgba } from 'busybar-kit/preview';
import { createConnections, selectConnection } from './connection.js';
import { findBars } from './discover.js';
import type { Display } from './media/image.js';
import { readSettings, writeSettings } from './settings.js';
import { toAscii } from './text.js';
import { wmCommand } from './wm.js';

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
export type Countdown = {
  id: string;
  endsAt: Date;
  x: number;
  y: number;
  align?: TextElement['align'];
  color?: string;
};

export type Scene = {
  display?: Display;
  elements: Array<TextElement | RectangleElement>;
  pixels?: PixelArt[];
  images?: SceneImage[];
  ledColor?: string;
  /** Draw over anything, an active BUSY work session included. */
  urgent?: boolean;
  /** Skip the photo of the real screen after drawing. */
  photo?: boolean;
  /** Seconds until the Bar removes everything in the scene by itself; 0 or unset keeps it. */
  timeout?: number;
  /** Countdowns the Bar runs by itself, so nothing has to redraw every second. */
  countdowns?: Countdown[];
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

/**
 * Text rows on the 16px front strip. The device fonts draw capitals 2px below `y` (1px for tiny), 5px tall, with
 * descenders 3px under them: two lines at -1 and 8 leave 1px above the first capitals and 1px below the second.
 */
export const FRONT_ROW = { single: 4, top: -1, bottom: 8 } as const;

/** Where the device fonts start their capitals below `y`; the preview's own font starts at `y`, so it shifts by this. */
const CAP_TOP: Partial<Record<string, number>> = { tiny: 1 };

const PREVIEW_SCALE: Record<Display, number> = { front: 10, back: 4 };

const REACH_HINT =
  'Make sure it is switched on and connected with the USB cable, or to the same Wi-Fi as this computer. ' +
  'On a Mac, the app you are chatting in (Claude, ChatGPT) also needs permission: System Settings → ' +
  'Privacy & Security → Local Network.';

let connections = createConnections();

let active = connections.primary;

const dryRun = process.env.BUSYBAR_DRY_RUN === '1';

/** Element ids this process put on each display, so drawing one display leaves the other alone. */
const shown: Record<Display, string[]> = { front: [], back: [] };

/** A fresh process doesn't know what an earlier one left behind, so its first draw clears everything of ours. */
let synced = false;

const uploaded = new Set<string>();

const stockCache = new Map<StockKind, string[]>();

/** The Wi-Fi search runs at most once per process: it takes a few seconds, and the answer rarely changes. */
let lookedOnWifi = false;

async function currentConnection() {
  await findOnWifiIfNeeded();

  const configured = connections;
  const selected = await selectConnection(configured);

  if (configured !== connections) {
    throw new Error('The BUSY Bar connection changed. Retry the command.');
  }

  active = selected;

  return selected;
}

async function answers(client: BusyBar) {
  try {
    await client.systemVersionGet({ timeout: 1000 });
    return true;
  } catch (error) {
    // Any HTTP answer, even an error, means something is there.
    return error instanceof Error && 'status' in error;
  }
}

/**
 * A Bar set up over USB but now only on Wi-Fi (cable out, or it never had one): look for it on the network once,
 * and if exactly one Bar answers, remember it as the Wi-Fi fallback. Several Bars are left for bar_connect to ask.
 */
async function findOnWifiIfNeeded() {
  if (lookedOnWifi || dryRun || connections.lan || !connections.primary.config.isUsb) {
    return;
  }

  lookedOnWifi = true;

  if (await answers(connections.primary.client)) {
    return;
  }

  const found = await findBars();

  if (found.length === 1) {
    useWifiAddress(found[0].addr);
  }
}

/**
 * Saves a Bar found on Wi-Fi: as the fallback when the main connection is USB (the cable still wins when it is in),
 * otherwise as the address itself, replacing one that no longer answers.
 */
export function useWifiAddress(addr: string) {
  const key = connections.primary.config.isUsb ? 'BUSY_LAN_ADDR' : 'BUSY_ADDR';

  writeSettings({ ...readSettings(), [key]: addr });
  process.env[key] = addr;
  reconnect();
}

export async function discoverBars() {
  return findBars();
}

function isCurrent(client: BusyBar) {
  return client === connections.primary.client || client === connections.lan?.client;
}

/** Points the running server at another Bar (after `env` changed), forgetting what it knew about the old one. */
export function reconnect() {
  connections = createConnections();
  active = connections.primary;
  shown.front = [];
  shown.back = [];
  synced = false;
  uploaded.clear();
  stockCache.clear();
}

export function connectionInfo() {
  return {
    addr: active.config.busyAddr,
    cloud: active.config.isCloud,
    lanFallback: connections.lan?.config.busyAddr,
    dryRun,
    warnings: connections.warnings,
  };
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

  const texts = withDisplay
    .filter((e) => e.type === 'text')
    .map((e) => ({ ...e, y: (e.y ?? 0) + (CAP_TOP[e.font] ?? 2) }));

  const countdowns = (scene.countdowns ?? []).map((countdown) =>
    text(countdown.id, remaining(countdown.endsAt), {
      x: countdown.x,
      y: countdown.y + 2,
      align: countdown.align ?? 'top_left',
      color: countdown.color,
      display,
    }),
  );

  renderOnto(bitmap, [...texts, ...countdowns], display);

  return bitmap.scale(PREVIEW_SCALE[display]).toPng();
}

async function upload(connected: BusyBar, file: string, data: Buffer) {
  if (isCurrent(connected) && uploaded.has(file)) {
    return;
  }

  // A picture or a sound over Wi-Fi takes longer than an ordinary request.
  await connected.assetsUpload({ application_name: APP_NAME, file, data }, { timeout: 30_000 });

  if (isCurrent(connected)) {
    uploaded.add(file);
  }
}

/** Content-addressed, so the same picture or sound is uploaded once. */
export function assetName(prefix: string, data: Buffer, ext: string) {
  return `${prefix}-${createHash('sha1').update(data).digest('hex').slice(0, 12)}.${ext}`;
}

async function imageElement(connected: BusyBar, id: string, image: SceneImage): Promise<ImageElement | AnimationElement> {
  const base = { id, align: 'top_left' as const, x: image.x, y: image.y, timeout: 0 };

  if (image.kind === 'upload') {
    const file = assetName('img', image.png, 'png');
    await upload(connected, file, image.png);

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
    const { client: connected, config } = await currentConnection();
    const pictures = await Promise.all((scene.images ?? []).map((image, i) => imageElement(connected, `img${i}`, image)));

    if (!isCurrent(connected)) {
      throw new Error('The BUSY Bar connection changed. Retry the display command.');
    }

    const elements = [
      ...scene.elements.filter((e) => e.type === 'rectangle'),
      ...pictures,
      ...(scene.pixels ?? []).map((art, i) => xpmElement(`px${i}`, art)),
      ...scene.elements.filter((e) => e.type === 'text'),
      ...(scene.countdowns ?? []).map(countdownElement),
    ].map((element, i) => ({
      ...element,
      id: `${display}-${element.id}`,
      display,
      z_index: i,
      ...(scene.timeout ? { timeout: scene.timeout } : {}),
    }));

    await clearOwn(connected, synced ? shown[display] : undefined);
    await connected.displayDraw({
      application_name: APP_NAME,
      priority: scene.urgent ? 100 : config.drawPriority,
      led_notification_color: scene.ledColor ? rgba(scene.ledColor) : undefined,
      elements,
    });

    if (!isCurrent(connected)) {
      return { sent: true, preview: png };
    }

    if (!synced) {
      shown.front = [];
      shown.back = [];
    }

    shown[display] = elements.map((element) => element.id);
    synced = true;

    return { sent: true, preview: png, actual: scene.photo === false ? undefined : await settledScreenshot(connected, display) };
  } catch (err) {
    const error = isLowPriority(err)
      ? 'the Bar is busy with something more important (a focus session or another app), so nothing was shown. Try again with urgent: true only if the user asked to interrupt it.'
      : describe(err);

    return { sent: false, error, preview: png };
  }
}

/** The screen a moment after a draw; undefined if the Bar won't say. */
async function settledScreenshot(connected: BusyBar, display: Display) {
  await new Promise((done) => setTimeout(done, 400));

  try {
    return await readScreenshot(connected, display);
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

  const { client: connected, config: { busyAddr, isUsb, isCloud } } = await currentConnection();

  if (!isUsb && !isCloud && !connections.lan) {
    await wmCommand(busyAddr, { action: 'clear', display }, { optional: true });

    if (!isCurrent(connected)) {
      return;
    }
  }

  if (display && synced) {
    await clearOwn(connected, shown[display]);

    if (isCurrent(connected)) {
      shown[display] = [];
    }

    return;
  }

  await clearOwn(connected);

  if (!isCurrent(connected)) {
    return;
  }

  shown.front = [];
  shown.back = [];
  synced = true;
}

/** The Bar answers 400 when this app has nothing on screen, which is the state we want anyway. */
async function clearOwn(connected: BusyBar, ids?: string[]) {
  if (ids && ids.length === 0) {
    return;
  }

  try {
    await connected.displayClear({ application_name: APP_NAME, element_ids: ids });
  } catch (err) {
    const nothingShown = err instanceof Error && 'status' in err && err.status === 400 && /not displaying/i.test(describe(err));

    if (!nothingShown) {
      throw err;
    }
  }
}

function countdownElement({ id, endsAt, x, y, align, color }: Countdown): CountdownElement {
  return {
    id,
    type: 'countdown',
    timestamp: String(Math.round(endsAt.getTime() / 1000)),
    direction: 'time_left',
    show_hours: 'when_non_zero',
    align: align ?? 'top_left',
    x,
    y,
    color: rgba(color ?? '#FFFFFF'),
    timeout: 0,
  };
}

/** What a countdown shows right now, the way the Bar writes it: 4:05, or 1:02:03 once there are hours. */
export function remaining(endsAt: Date, now = new Date()) {
  const total = Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** The real screen, as a PNG. */
export async function screenshot(display: Display = 'front') {
  const { client } = await currentConnection();

  return readScreenshot(client, display);
}

async function readScreenshot(client: BusyBar, display: Display) {
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

  const { client } = await currentConnection();
  const { list } = await client.storageListGet({ path: `/ext/apps_assets/shared/${kind}` });
  const names = list.filter((entry) => entry.type === 'file' && !entry.name.startsWith('.')).map((entry) => entry.name);
  if (isCurrent(client)) {
    stockCache.set(kind, names);
  }

  return names;
}

export async function playSound(sound: { stock: string } | { snd: Buffer }) {
  if (dryRun) {
    return;
  }

  const { client: connected } = await currentConnection();

  if ('stock' in sound) {
    await connected.audioPlay({ application_name: APP_NAME, stock_path: `shared/${sound.stock}` });
    return;
  }

  const file = assetName('snd', sound.snd, 'snd');
  await upload(connected, file, sound.snd);
  await connected.audioPlay({ application_name: APP_NAME, path: file });
}

export async function status() {
  const { client } = await currentConnection();

  return client.systemStatusGet();
}

export async function diagnostics() {
  const { client: connected } = await currentConnection();
  const [system, updates, autoUpdate] = await Promise.all([
    readDiagnostic(() => connected.systemStatusGet()),
    readDiagnostic(() => connected.updateStatusGet()),
    readDiagnostic(() => connected.updateAutoUpdateGet()),
  ]);

  return { system, updates, autoUpdate };
}

export async function connectivity() {
  const { client: connected } = await currentConnection();
  const [wifi, ble, transport, interfaces] = await Promise.all([
    readDiagnostic(() => connected.wifiStatusGet()),
    readDiagnostic(() => connected.bleStatusGet()),
    readDiagnostic(() => connected.systemTransportGet()),
    readDiagnostic(async () => {
      const { usb_mac: usb, wifi_mac: wifi, ble_mac: ble } = await connected.systemStatusDeviceGet();

      return { usb, wifi, ble };
    }),
  ]);

  return { wifi, ble, transport, interfaces };
}

async function readDiagnostic<T>(read: () => Promise<T>) {
  try {
    return { value: await read() };
  } catch (error) {
    return { error: describe(error) };
  }
}

/**
 * Errors in words a user can act on; whatever the model passes on should make sense to someone who never saw an
 * HTTP status. The technical reason stays at the end in brackets for whoever has to debug it.
 */
export function describe(err: unknown) {
  const where = active.config.busyAddr;

  if (err && typeof err === 'object' && 'status' in err) {
    const { status, message, body } = err as { status: number; message: string; body?: unknown };
    const said = body && typeof body === 'object' && 'error' in body ? String(body.error) : message;

    if (status === 401 || status === 403) {
      return `The Bar at ${where} asked for its password. It is under Settings → HTTP Access on the Bar; tell me it and I will connect again. (HTTP ${status})`;
    }

    return `The Bar said no: ${said}. (HTTP ${status})`;
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    return `Your BUSY Bar (at ${where}) did not answer. ${REACH_HINT} (timeout)`;
  }

  // Node's fetch says only "fetch failed"; the reason is in `cause`.
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : undefined;

  if (cause) {
    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : cause.message;
    return `Cannot reach your BUSY Bar (at ${where}). ${REACH_HINT} (${code})`;
  }

  return err instanceof Error ? err.message : String(err);
}
