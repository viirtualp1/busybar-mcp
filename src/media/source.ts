import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Bytes from an http(s) URL or a local path (`~` allowed), refusing anything over `limit`. */
export async function readSource(source: string, limit: number) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { 'User-Agent': 'busybar-mcp' } });

    if (!res.ok) {
      throw new Error(`Download failed: HTTP ${res.status} for ${source}`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());

    if (bytes.length > limit) {
      throw new Error(`${source} is ${bytes.length} bytes; the limit is ${limit}`);
    }

    return bytes;
  }

  const path = resolve(source.replace(/^~(?=$|\/)/, homedir()));
  const size = statSync(path).size;

  if (size > limit) {
    throw new Error(`${path} is ${size} bytes; the limit is ${limit}`);
  }

  return readFileSync(path);
}
