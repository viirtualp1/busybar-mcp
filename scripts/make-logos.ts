// Measures the Claude and Codex marks from the app icons installed on this Mac and writes them as
// pixel grids to src/logos.ts: 15px for the front strip, 40px for the back panel.
//   npx tsx scripts/make-logos.ts
// Needs /Applications/Claude.app and /Applications/ChatGPT.app (which carries the Codex icon).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePng, type RgbaImage } from 'busybar-kit/image';

type Rgb = [number, number, number];

type Logo = { palette: Record<string, string>; grid: string[] };

const FRONT = 15;

const BACK = 40;

const CLAUDE_ORANGE = '#D97757';

// The back panel is greyscale, and the spark is light on the real icon (white on orange): keep it light there.
const CLAUDE_LIGHT = '#F0EEE6';

const SYMBOLS = '.ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function loadIcns(path: string) {
  const dir = mkdtempSync(join(tmpdir(), 'logo-'));

  try {
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', path, '--out', join(dir, 'icon.png')], { stdio: 'ignore' });
    return decodePng(readFileSync(join(dir, 'icon.png')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pixel(img: RgbaImage, x: number, y: number): Rgb {
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

function hex([r, g, b]: Rgb) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Turns a grid of colours (null = transparent) into palette + symbol rows. */
function encode(cells: (Rgb | null)[][]): Logo {
  const palette: Record<string, string> = { '.': 'none' };
  const bySymbol = new Map<string, string>();

  const grid = cells.map((row) =>
    row
      .map((cell) => {
        if (!cell) {
          return '.';
        }

        const colour = hex(cell);
        let symbol = bySymbol.get(colour);

        if (!symbol) {
          symbol = SYMBOLS[bySymbol.size + 1];
          bySymbol.set(colour, symbol);
          palette[symbol] = colour;
        }

        return symbol;
      })
      .join(''),
  );

  return { palette, grid };
}

/** The 12 rays of the Claude spark: angle (degrees, y down), width and length, all measured from its centre. */
function measureSpark(img: RgbaImage) {
  const on = (x: number, y: number) => {
    const [r, g, b] = pixel(img, x, y);
    return r > 225 && g > 205 && b > 195;
  };
  let sx = 0;
  let sy = 0;
  let count = 0;

  for (let y = 150; y < 870; y++) {
    for (let x = 150; x < 870; x++) {
      if (on(x, y)) {
        sx += x;
        sy += y;
        count++;
      }
    }
  }

  const cx = sx / count;
  const cy = sy / count;
  const radius = 200;
  const steps = 1440;
  const hits = Array.from({ length: steps }, (_, k) => {
    const a = (k / steps) * 2 * Math.PI;
    return on(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
  });
  const start = hits.indexOf(false);
  const rays: Array<{ angle: number; width: number; length: number }> = [];
  let run: number[] = [];

  for (let j = 0; j <= steps; j++) {
    const k = (start + j) % steps;

    if (hits[k] && j < steps) {
      run.push(k);
      continue;
    }

    if (run.length > 0) {
      const angle = (run[Math.floor(run.length / 2)] / steps) * 360;
      const t = (angle * Math.PI) / 180;
      let length = radius;

      while (on(cx + (length + 1) * Math.cos(t), cy + (length + 1) * Math.sin(t))) {
        length++;
      }

      rays.push({ angle, width: (run.length / steps) * 2 * Math.PI * radius, length });
      run = [];
    }
  }

  return rays;
}

/** Small: one-pixel rays from a plus-shaped core, so twelve of them stay apart at 15px. */
function sparkFront(rays: ReturnType<typeof measureSpark>, n: number) {
  const cells: (Rgb | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
  const orange = pixelOf(CLAUDE_ORANGE);
  const c = Math.round((n - 1) / 2);
  const longest = Math.max(...rays.map((ray) => ray.length));
  const plot = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) {
      cells[y][x] = orange;
    }
  };

  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    plot(c + dx, c + dy);
  }

  for (const ray of rays) {
    const t = (ray.angle * Math.PI) / 180;
    const reach = (ray.length / longest) * ((n - 1) / 2);
    let x = c;
    let y = c;
    const x1 = Math.round(c + reach * Math.cos(t));
    const y1 = Math.round(c + reach * Math.sin(t));
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const stepX = x < x1 ? 1 : -1;
    const stepY = y < y1 ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      plot(x, y);

      if (x === x1 && y === y1) {
        break;
      }

      const e2 = 2 * err;

      if (e2 >= dy) {
        err += dy;
        x += stepX;
      }

      if (e2 <= dx) {
        err += dx;
        y += stepY;
      }
    }
  }

  return encode(cells);
}

/** Large: the true shape, rays as measured strips around the core, supersampled. */
function sparkBack(rays: ReturnType<typeof measureSpark>, n: number) {
  const longest = Math.max(...rays.map((ray) => ray.length));
  const scale = (n - 1) / (2 * longest);
  const c = (n - 1) / 2;
  const core = 70;
  const light = pixelOf(CLAUDE_LIGHT);
  const inside = (gx: number, gy: number) => {
    const x = (gx - c) / scale;
    const y = (gy - c) / scale;

    if (Math.hypot(x, y) < core) {
      return true;
    }

    return rays.some((ray) => {
      const t = (ray.angle * Math.PI) / 180;
      const along = x * Math.cos(t) + y * Math.sin(t);
      const across = Math.abs(-x * Math.sin(t) + y * Math.cos(t));

      return along > 0 && along < ray.length && across < Math.max(ray.width / 2, 0.5 / scale);
    });
  };

  return encode(supersample(n, inside, 0.45, () => light));
}

function supersample(n: number, inside: (x: number, y: number) => boolean, threshold: number, colour: (y: number) => Rgb) {
  const ss = 8;

  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      let hits = 0;

      for (let i = 0; i < ss; i++) {
        for (let j = 0; j < ss; j++) {
          if (inside(x - 0.5 + (i + 0.5) / ss, y - 0.5 + (j + 0.5) / ss)) {
            hits++;
          }
        }
      }

      return hits / (ss * ss) >= threshold ? colour(y) : null;
    }),
  );
}

function pixelOf(colour: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) as Rgb;
}

/** The Codex cloud with its gradient, and `>_` drawn as strokes so it survives being small. */
function codex(img: RgbaImage, n: number, bands: number) {
  const x0 = 205;
  const y0 = 205;
  const side = 615;
  const isCloud = (x: number, y: number) => {
    const [r, g, b] = pixel(img, x, y);
    return b > r + 25 || (r > 200 && g > 200 && b > 220);
  };
  const toSource = (g: number) => (g + 0.5) / n;
  const bandColour = (gy: number): Rgb => {
    const band = Math.min(bands - 1, Math.floor((gy / n) * bands));
    const top = y0 + (band / bands) * side;
    const bottom = y0 + ((band + 1) / bands) * side;
    const sum: Rgb = [0, 0, 0];
    let count = 0;

    for (let y = Math.floor(top); y < bottom; y += 4) {
      for (let x = x0; x < x0 + side; x += 4) {
        const [r, g, b] = pixel(img, x, y);

        if (b > r + 25 && !(r > 200 && g > 200)) {
          sum[0] += r;
          sum[1] += g;
          sum[2] += b;
          count++;
        }
      }
    }

    return count ? (sum.map((v) => v / count) as Rgb) : [80, 80, 240];
  };
  const cells = supersample(
    n,
    (gx, gy) => isCloud(x0 + toSource(gx) * side, y0 + toSource(gy) * side),
    0.5,
    bandColour,
  );
  const glyph: Rgb = [230, 236, 255];
  const grid = (v: number, origin: number) => ((v - origin) / side) * n - 0.5;
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) {
      cells[y][x] = glyph;
    }
  };

  if (n < 20) {
    // At 15px the chevron is drawn one pixel wider than measured, or it reads as "|>".
    const top = Math.round(grid(430, y0));
    const left = Math.round(grid(372, x0));

    [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]].forEach(([dx, dy]) => set(left + dx, top + dy));

    for (let x = Math.round(grid(533, x0)); x <= Math.round(grid(650, x0)); x++) {
      set(x, top + 4);
    }

    return encode(cells);
  }

  const brush = (11 / side) * n;
  const stroke = (ax: number, ay: number, bx: number, by: number) => {
    const fx = grid(ax, x0);
    const fy = grid(ay, y0);
    const tx = grid(bx, x0);
    const ty = grid(by, y0);
    const steps = Math.ceil(Math.hypot(tx - fx, ty - fy) * 4) + 1;

    for (let s = 0; s <= steps; s++) {
      const px = fx + ((tx - fx) * s) / steps;
      const py = fy + ((ty - fy) * s) / steps;

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const gx = Math.round(px) + dx;
          const gy = Math.round(py) + dy;

          if (Math.hypot(gx - px, gy - py) <= brush + 0.5) {
            set(gx, gy);
          }
        }
      }
    }
  };

  stroke(372, 430, 418, 515);
  stroke(418, 515, 372, 598);
  stroke(533, 598, 650, 598);

  return encode(cells);
}

const claudeIcon = loadIcns('/Applications/Claude.app/Contents/Resources/electron.icns');
const codexIcon = decodePng(readFileSync('/Applications/ChatGPT.app/Contents/Resources/icon-codex-dark-color.png'));
const rays = measureSpark(claudeIcon);

if (rays.length !== 12) {
  throw new Error(`Expected the Claude spark's 12 rays, measured ${rays.length}`);
}

const logos = {
  claude: { front: sparkFront(rays, FRONT), back: sparkBack(rays, BACK) },
  codex: { front: codex(codexIcon, FRONT, 6), back: codex(codexIcon, BACK, 16) },
};

const source = `// Generated by scripts/make-logos.ts from the Claude and Codex app icons. Do not edit by hand.
import type { PixelArt } from './bar.js';

export type LogoName = 'claude' | 'codex';

export const LOGOS: Record<LogoName, { front: PixelArt; back: PixelArt }> = ${JSON.stringify(logos, null, 2)};
`;

writeFileSync('src/logos.ts', source);

for (const [name, { front }] of Object.entries(logos)) {
  console.log(`${name} (front):\n${front.grid.join('\n')}\n`);
}
