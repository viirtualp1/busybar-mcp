import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { decodePng, type RgbaImage } from 'busybar-kit/image';
import { Bitmap } from 'busybar-kit/preview';
import { readSource } from './source.js';

export type Display = 'front' | 'back';

const run = promisify(execFile);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const BACK_SHADES = 16;

/** PNG as is; anything else through macOS `sips`, which reads JPEG, GIF, HEIC, WebP, TIFF and BMP. */
async function toPng(bytes: Buffer) {
  if (bytes.subarray(0, 4).equals(PNG_SIGNATURE)) {
    return bytes;
  }

  if (platform() !== 'darwin') {
    throw new Error('Only PNG images are supported on this OS');
  }

  const dir = mkdtempSync(join(tmpdir(), 'busybar-img-'));

  try {
    const input = join(dir, 'in');
    const output = join(dir, 'out.png');
    writeFileSync(input, bytes);
    await run('/usr/bin/sips', ['-s', 'format', 'png', input, '--out', output]);

    return readFileSync(output);
  } catch {
    throw new Error('Could not read the image; use PNG, JPEG, GIF, HEIC or WebP');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fits inside the box keeping the aspect ratio: area average going down, nearest going up so pixel art stays crisp. */
function fit(image: RgbaImage, maxWidth: number, maxHeight: number): RgbaImage {
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / ratio);
      const y0 = Math.floor(y / ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) / ratio));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) / ratio));
      const sum = [0, 0, 0, 0];
      let alpha = 0;

      for (let sy = y0; sy < Math.min(y1, image.height); sy++) {
        for (let sx = x0; sx < Math.min(x1, image.width); sx++) {
          const i = (sy * image.width + sx) * 4;
          const a = image.data[i + 3];
          sum[0] += image.data[i] * a;
          sum[1] += image.data[i + 1] * a;
          sum[2] += image.data[i + 2] * a;
          sum[3] += a;
          alpha++;
        }
      }

      const o = (y * width + x) * 4;
      data[o] = sum[3] ? sum[0] / sum[3] : 0;
      data[o + 1] = sum[3] ? sum[1] / sum[3] : 0;
      data[o + 2] = sum[3] ? sum[2] / sum[3] : 0;
      data[o + 3] = alpha ? sum[3] / alpha : 0;
    }
  }

  return { width, height, data };
}

/** The back OLED has 16 greys; dithering here keeps gradients from turning into bands. */
function ditherGrey(image: RgbaImage): RgbaImage {
  const { width, height } = image;
  const grey = new Float32Array(width * height);
  const step = 255 / (BACK_SHADES - 1);
  const data = new Uint8Array(width * height * 4);

  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.2126 * image.data[i * 4] + 0.7152 * image.data[i * 4 + 1] + 0.0722 * image.data[i * 4 + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const level = Math.max(0, Math.min(255, Math.round(grey[i] / step) * step));
      const error = grey[i] - level;

      if (x + 1 < width) grey[i + 1] += (error * 7) / 16;
      if (y + 1 < height && x > 0) grey[i + width - 1] += (error * 3) / 16;
      if (y + 1 < height) grey[i + width] += (error * 5) / 16;
      if (y + 1 < height && x + 1 < width) grey[i + width + 1] += error / 16;

      data.set([level, level, level, image.data[i * 4 + 3]], i * 4);
    }
  }

  return { width, height, data };
}

/** Loads a picture from a path or URL and makes it fit the screen it is going to. */
export async function prepareImage(source: string, display: Display, maxWidth: number, maxHeight: number) {
  const png = await toPng(await readSource(source, 5_000_000));
  const fitted = fit(decodePng(png), maxWidth, maxHeight);
  const ready = display === 'back' ? ditherGrey(fitted) : fitted;
  const bitmap = Bitmap.fromRgba(ready.width, ready.height, ready.data);

  return { bitmap, png: bitmap.toPng() };
}
