import {
  BusyBar,
  generateXpm2,
  type RectangleElement,
  type TextElement,
  type XpmBitmapElement,
} from '@busy-app/busy-lib';
import { loadBarConfig } from 'busybar-kit/config';
import { FRONT } from 'busybar-kit/device';
import { Bitmap, parseColor, renderOnto } from 'busybar-kit/preview';

export const APP_NAME = 'claude';

export type PixelArt = {
  palette: Record<string, string>;
  grid: string[];
  x?: number;
  y?: number;
};

/** What the server draws: the device's own elements, plus pixel art kept as a grid so the preview can paint it. */
export type Scene = {
  elements: Array<TextElement | RectangleElement>;
  pixels?: PixelArt[];
  ledColor?: string;
};

export type DrawResult = {
  sent: boolean;
  error?: string;
  preview: Buffer;
};

const { bar: config, warnings } = loadBarConfig();
const dryRun = process.env.BUSYBAR_DRY_RUN === '1';

const client = new BusyBar({
  addr: config.busyAddr,
  token: config.busyToken || undefined,
  HTTPAccessPassword: config.busyHttpPassword || undefined,
  timeout: 5000,
});

export function connectionInfo() {
  return { addr: config.busyAddr, cloud: config.isCloud, dryRun, warnings };
}

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` → `#RRGGBBAA`, which is what the device wants. */
export function rgba(color: string): string {
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

/** The front font is printable ASCII only; anything else would show as garbage. */
export function ascii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
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

export function validatePixels(art: PixelArt): void {
  const width = Math.max(0, ...art.grid.map((row) => row.length));
  const x = art.x ?? 0;
  const y = art.y ?? 0;

  if (art.grid.length === 0 || width === 0) {
    throw new Error('grid is empty');
  }

  if (x + width > FRONT.width || y + art.grid.length > FRONT.height) {
    throw new Error(`Art is ${width}x${art.grid.length} at (${x},${y}); the front screen is ${FRONT.width}x${FRONT.height}`);
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
    display: 'front',
    align: 'top_left',
    x: art.x ?? 0,
    y: art.y ?? 0,
    data: generateXpm2({ palette, grid }),
    timeout: 0,
  };
}

/** A PNG of what the scene should look like, so the model can see its work even with no Bar on the desk. */
export function preview(scene: Scene): Buffer {
  const bitmap = new Bitmap(FRONT.width, FRONT.height, { r: 10, g: 10, b: 12, a: 255 });
  const rects = scene.elements.filter((e) => e.type === 'rectangle');
  const texts = scene.elements.filter((e) => e.type === 'text');

  renderOnto(bitmap, rects, 'front');

  for (const art of scene.pixels ?? []) {
    art.grid.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        const color = art.palette[ch];

        if (color && !/^none$/i.test(color)) {
          bitmap.set((art.x ?? 0) + dx, (art.y ?? 0) + dy, parseColor(rgba(color)));
        }
      });
    });
  }

  renderOnto(bitmap, texts, 'front');

  return bitmap.scale(10).toPng();
}

export async function draw(scene: Scene): Promise<DrawResult> {
  const png = preview(scene);

  if (dryRun) {
    return { sent: false, preview: png };
  }

  const elements = [
    ...scene.elements.filter((e) => e.type === 'rectangle'),
    ...(scene.pixels ?? []).map((art, i) => xpmElement(`px${i}`, art)),
    ...scene.elements.filter((e) => e.type === 'text'),
  ].map((element, i) => ({ ...element, z_index: i }));

  try {
    await client.displayClear({ application_name: APP_NAME });
    await client.displayDraw({
      application_name: APP_NAME,
      priority: config.drawPriority,
      led_notification_color: scene.ledColor ? rgba(scene.ledColor) : undefined,
      elements,
    });

    return { sent: true, preview: png };
  } catch (err) {
    return { sent: false, error: describe(err), preview: png };
  }
}

export async function clear(): Promise<void> {
  if (!dryRun) {
    await client.displayClear({ application_name: APP_NAME });
  }
}

/** The real front screen, as a PNG. */
export async function screenshot(): Promise<Buffer> {
  const data = await client.displayScreenFrameGet({ display: 0 }, { dataType: 'binary', format: 'rgba' });

  if (!data) {
    throw new Error('The Bar returned no frame');
  }

  const bitmap = new Bitmap(FRONT.width, FRONT.height);

  for (let i = 0; i < FRONT.width * FRONT.height; i++) {
    bitmap.set(i % FRONT.width, Math.floor(i / FRONT.width), {
      r: data[i * 4],
      g: data[i * 4 + 1],
      b: data[i * 4 + 2],
      a: 255,
    });
  }

  return bitmap.scale(10).toPng();
}

export async function status() {
  return client.systemStatusGet();
}

export function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'status' in err) {
    const e = err as { status: number; message: string; body?: unknown };
    return `HTTP ${e.status}: ${e.message}${e.body ? ` ${JSON.stringify(e.body)}` : ''}`;
  }

  if (err instanceof Error) {
    return err.name === 'TimeoutError' ? `Bar at ${config.busyAddr} did not answer in time` : err.message;
  }

  return String(err);
}
