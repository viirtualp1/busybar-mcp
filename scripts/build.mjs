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
  description: 'Let Claude draw and play sounds on your BUSY Bar: text, pixel art, pictures, animations, melodies, GitHub and weather, on both screens.',
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
    { name: 'bar_image', description: 'Show a picture from a file, a URL or the Bar\'s stock' },
    { name: 'bar_animation', description: 'Play a stock animation' },
    { name: 'bar_sound', description: 'Play a stock sound, an audio file or a melody' },
    { name: 'bar_stock', description: 'List built-in images, animations and sounds' },
    { name: 'bar_clear', description: 'Give the screen back to the Bar' },
    { name: 'bar_screenshot', description: 'See what the screen shows now' },
    { name: 'bar_connect', description: 'Point the server at your Bar and remember it' },
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

// The Claude Code plugin is committed, because plugins install straight from the git repo.
const plugin = 'plugin';
const pluginServer = '${CLAUDE_PLUGIN_ROOT}/server.mjs';
const notifyCommand = `node "${pluginServer}" notify --client claude`;

rmSync(plugin, { recursive: true, force: true });
mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
mkdirSync(join(plugin, 'hooks'), { recursive: true });
mkdirSync(join(plugin, 'skills', 'busybar'), { recursive: true });

copyFileSync(join(out, 'server.mjs'), join(plugin, 'server.mjs'));
copyFileSync('LICENSE', join(plugin, 'LICENSE'));
writeFileSync(join(plugin, '.claude-plugin', 'icon.png'), icon());
writeFileSync(
  join(plugin, 'skills', 'busybar', 'SKILL.md'),
  execFileSync('node', [join(out, 'server.mjs'), 'skill'], { encoding: 'utf8' }),
);

const pluginManifest = {
  name: 'busybar',
  version: pkg.version,
  description:
    'Draw, show pictures and play sounds on your BUSY Bar, and see a summary of every answer on it when Claude finishes.',
  author: { name: 'viirtualp1', url: 'https://github.com/viirtualp1' },
  homepage: 'https://github.com/viirtualp1/busybar-mcp',
  repository: 'https://github.com/viirtualp1/busybar-mcp',
  license: 'MIT',
  keywords: ['busy-bar', 'led', 'status', 'notifications'],
  userConfig: {
    BUSY_ADDR: {
      type: 'string',
      title: 'BUSY Bar address',
      description: 'IP on your Wi-Fi, 10.0.4.20 over USB, or https://api.busy.app with a cloud token. Empty: USB.',
      default: '',
    },
    BUSY_HTTP_PASSWORD: {
      type: 'string',
      title: 'HTTP access password',
      description: 'Only if the Bar has HTTP access locked.',
      default: '',
      sensitive: true,
    },
    BUSY_TOKEN: {
      type: 'string',
      title: 'BUSY cloud token',
      description: 'From cloud.busy.app/api-tokens, to reach the Bar from anywhere.',
      default: '',
      sensitive: true,
    },
    GITHUB_TOKEN: {
      type: 'string',
      title: 'GitHub token',
      description: 'For the GitHub tools. Empty: uses `gh auth token` if the GitHub CLI is logged in.',
      default: '',
      sensitive: true,
    },
    NOTIFY: {
      type: 'boolean',
      title: 'Answer-ready notifications',
      description: 'Show a short summary on the Bar when Claude finishes an answer or waits for you.',
      default: true,
    },
    NOTIFY_SOUND: {
      type: 'boolean',
      title: 'Notification chime',
      description: 'Play a short chime with each notification.',
      default: true,
    },
  },
};

const hookEntry = [{ hooks: [{ type: 'command', command: notifyCommand, timeout: 20 }] }];

writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginManifest, null, 2)}\n`);
writeFileSync(
  join(plugin, '.mcp.json'),
  `${JSON.stringify({ mcpServers: { busybar: { command: 'node', args: [pluginServer] } } }, null, 2)}\n`,
);
writeFileSync(
  join(plugin, 'hooks', 'hooks.json'),
  `${JSON.stringify({ description: 'Answer-ready notifications on the BUSY Bar', hooks: { Stop: hookEntry, Notification: hookEntry } }, null, 2)}\n`,
);

const marketplace = JSON.parse(readFileSync(join('.claude-plugin', 'marketplace.json'), 'utf8'));
marketplace.plugins[0].version = pkg.version;
writeFileSync(join('.claude-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);

console.log(`\nbuild/server.mjs, build/busybar.mcpb and plugin/ for ${pkg.version}`);
