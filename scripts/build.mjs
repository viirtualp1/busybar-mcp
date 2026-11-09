// Builds everything that ships:
//   build/server.mjs   one-file server + CLI (the npm bin, and what clients run)
//   build/busybar.mcpb Claude Desktop extension (double-click to install)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Bitmap, parseColor } from 'busybar-kit/preview';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = 'build';
const stage = join(out, 'mcpb');

const ICON = [
  '................',
  '..RRRR....RRRR..',
  '.RRRRRR..RRRRRR.',
  'RRPPRRRRRRRRRRRR',
  'RRPRRRRRRRRRRRRR',
  'RRRRRRRRRRRRRRRR',
  'RRRRRRRRRRRRRRRR',
  '.RRRRRRRRRRRRRR.',
  '..RRRRRRRRRRRR..',
  '...RRRRRRRRRR...',
  '....RRRRRRRR....',
  '.....RRRRRR.....',
  '......RRRR......',
  '.......RR.......',
  '................',
  '................',
];

const manifest = {
  manifest_version: '0.3',
  name: 'busybar',
  display_name: 'BUSY Bar',
  version: pkg.version,
  description: 'Let Claude draw on your BUSY Bar: status text, pixel art, progress, GitHub and weather.',
  long_description:
    'Unofficial community extension, not affiliated with Flipper Devices / BUSY.\n\n' +
    'Every drawing tool returns a preview image, so Claude sees what it drew. ' +
    'Leave the fields empty to use the settings saved by `npx busybar-mcp install`, or the USB address 10.0.4.20.',
  author: { name: 'viirtualp1', url: 'https://github.com/viirtualp1' },
  repository: { type: 'git', url: 'https://github.com/viirtualp1/busybar-mcp' },
  homepage: 'https://github.com/viirtualp1/busybar-mcp',
  license: 'MIT',
  icon: 'icon.png',
  keywords: ['busy-bar', 'led', 'status', 'pixel-art'],
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs'],
      env: {
        BUSY_ADDR: '${user_config.busy_addr}',
        BUSY_HTTP_PASSWORD: '${user_config.busy_http_password}',
        BUSY_TOKEN: '${user_config.busy_token}',
        GITHUB_TOKEN: '${user_config.github_token}',
      },
    },
  },
  tools: [
    { name: 'bar_text', description: 'Show one or two lines of text' },
    { name: 'bar_pixels', description: 'Draw pixel art from a palette and a grid' },
    { name: 'bar_progress', description: 'Show a labelled progress bar' },
    { name: 'bar_clear', description: 'Give the screen back to the Bar' },
    { name: 'bar_screenshot', description: 'See what the screen shows now' },
    { name: 'bar_status', description: 'Which Bar, and whether it answers' },
    { name: 'github_ci', description: 'Latest GitHub Actions run for a repo' },
    { name: 'github_inbox', description: 'Review requests, your PRs, assigned issues' },
    { name: 'weather', description: 'Current weather for a city' },
  ],
  compatibility: {
    platforms: ['darwin', 'win32'],
    runtimes: { node: '>=20.0.0' },
  },
  user_config: {
    busy_addr: {
      type: 'string',
      title: 'BUSY Bar address',
      description: 'IP on your Wi-Fi, 10.0.4.20 over USB, or https://api.busy.app with a cloud token. Empty: saved settings or USB.',
      required: false,
    },
    busy_http_password: {
      type: 'string',
      title: 'HTTP access password',
      description: 'Only if the Bar has HTTP access locked.',
      required: false,
      sensitive: true,
    },
    busy_token: {
      type: 'string',
      title: 'BUSY cloud token',
      description: 'From cloud.busy.app/api-tokens, to reach the Bar from anywhere.',
      required: false,
      sensitive: true,
    },
    github_token: {
      type: 'string',
      title: 'GitHub token',
      description: 'For the GitHub tools. Empty: uses `gh auth token` if the GitHub CLI is logged in.',
      required: false,
      sensitive: true,
    },
  },
};

function icon() {
  const palette = { R: '#E74C3C', P: '#FF8FA3' };
  const bitmap = new Bitmap(16, 16, { r: 18, g: 18, b: 22, a: 255 });

  ICON.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (palette[ch]) {
        bitmap.set(x, y, parseColor(`${palette[ch]}FF`));
      }
    });
  });

  return bitmap.scale(32).toPng();
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(stage, 'server'), { recursive: true });

await build({
  entryPoints: ['src/cli.ts'],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'external',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  // Some bundled CommonJS (protobufjs) calls require(); ESM has none of its own.
  banner: { js: "#!/usr/bin/env node\nimport{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});

copyFileSync(join(out, 'server.mjs'), join(stage, 'server', 'index.mjs'));
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(stage, 'icon.png'), icon());
copyFileSync('LICENSE', join(stage, 'LICENSE'));

execFileSync('npx', ['mcpb', 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
execFileSync('npx', ['mcpb', 'pack', stage, join(out, 'busybar.mcpb')], { stdio: 'inherit' });

rmSync(stage, { recursive: true, force: true });
console.log(`\nbuild/server.mjs and build/busybar.mcpb for ${pkg.version}`);
