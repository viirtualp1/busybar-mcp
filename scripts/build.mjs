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
  description: 'Ask Claude to set your status, start a timer, show text, pictures or the weather, and play sounds on your BUSY Bar.',
  long_description:
    'Unofficial community extension, not affiliated with Flipper Devices / BUSY.\n\n' +
    'Plug the Bar in with its USB cable, or keep it on the same Wi-Fi: it is found automatically, no settings needed. ' +
    'Then just ask: "set my status to In a meeting for 30 minutes", "start a 25-minute focus timer", ' +
    '"show the weather in Berlin". Ready-made actions are in the + menu.\n\n' +
    'On a Mac, allow Claude under System Settings → Privacy & Security → Local Network.',
  author: { name: 'viirtualp1', url: 'https://github.com/viirtualp1' },
  repository: { type: 'git', url: 'https://github.com/viirtualp1/busybar-mcp' },
  homepage: 'https://github.com/viirtualp1/busybar-mcp',
  license: 'MIT',
  icon: 'icon.png',
  keywords: ['busy-bar', 'status', 'timer', 'focus', 'pixel-art'],
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs'],
      env: {
        BUSY_ADDR: '${user_config.busy_addr}',
        BUSY_LAN_ADDR: '${user_config.busy_lan_addr}',
        WM_API_TOKEN: '${user_config.wm_api_token}',
        BUSY_HTTP_PASSWORD: '${user_config.busy_http_password}',
        BUSY_TOKEN: '${user_config.busy_token}',
        GITHUB_TOKEN: '${user_config.github_token}',
      },
    },
  },
  tools: [
    { name: 'bar_set_status', description: 'Show a ready-made status: meeting, call, focus, lunch…' },
    { name: 'bar_timer', description: 'Count down, and chime when time is up' },
    { name: 'bar_text', description: 'Show one or two lines of text' },
    { name: 'bar_image', description: 'Show a picture from a file or a link' },
    { name: 'bar_pixels', description: 'Draw pixel art' },
    { name: 'bar_progress', description: 'Show a progress bar' },
    { name: 'bar_animation', description: 'Play one of the Bar\'s animations' },
    { name: 'bar_sound', description: 'Play a sound or a melody' },
    { name: 'weather', description: 'Current weather for a city' },
    { name: 'bar_clear', description: 'Give the screen back to the Bar' },
    { name: 'bar_connect', description: 'Find your Bar on the Wi-Fi, or set its address' },
    { name: 'bar_status', description: 'Is the Bar connected' },
  ],
  prompts: [
    { name: 'setup', description: 'Set up my BUSY Bar', text: 'Set up my BUSY Bar.' },
    { name: 'status', description: 'Set my status', arguments: ['status', 'minutes'], text: 'Set my BUSY Bar status to ${arguments.status}.' },
    { name: 'focus', description: 'Focus timer', arguments: ['minutes'], text: 'Start a focus timer on my BUSY Bar.' },
    { name: 'weather', description: 'Weather on the Bar', arguments: ['city'], text: 'Show the weather in ${arguments.city} on my BUSY Bar.' },
    { name: 'tell_me_when_done', description: 'Tell me on the Bar when you finish', arguments: ['task'], text: '${arguments.task}' },
  ],
  compatibility: {
    platforms: ['darwin', 'win32'],
    runtimes: { node: '>=20.0.0' },
  },
  user_config: {
    busy_addr: {
      type: 'string',
      title: 'BUSY Bar or window manager address',
      description: 'Defaults to saved settings or 10.0.4.20 over USB.',
      required: false,
    },
    busy_lan_addr: {
      type: 'string',
      title: 'LAN fallback address',
      description: 'Optional local address of the same Bar. Used if USB cannot be reached.',
      required: false,
    },
    wm_api_token: {
      type: 'string',
      title: 'Window manager API token',
      description: 'Match WM_API_TOKEN on the window manager, if configured.',
      required: false,
      sensitive: true,
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

rmSync(plugin, { recursive: true, force: true });
mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
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
  description: 'Draw, show pictures and play sounds on your BUSY Bar.',
  author: { name: 'viirtualp1', url: 'https://github.com/viirtualp1' },
  homepage: 'https://github.com/viirtualp1/busybar-mcp',
  repository: 'https://github.com/viirtualp1/busybar-mcp',
  license: 'MIT',
  keywords: ['busy-bar', 'led', 'status', 'notifications'],
  userConfig: {
    BUSY_ADDR: {
      type: 'string',
      title: 'BUSY Bar or window manager address',
      description: 'Defaults to 10.0.4.20 over USB.',
      default: '',
    },
    BUSY_LAN_ADDR: {
      type: 'string',
      title: 'LAN fallback address',
      description: 'Optional local address of the same Bar. Used if USB cannot be reached.',
      default: '',
    },
    WM_API_TOKEN: {
      type: 'string',
      title: 'Window manager API token',
      description: 'Match WM_API_TOKEN on the window manager, if configured.',
      default: '',
      sensitive: true,
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
  },
};

writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginManifest, null, 2)}\n`);
writeFileSync(
  join(plugin, '.mcp.json'),
  `${JSON.stringify({ mcpServers: { busybar: { command: 'node', args: [pluginServer] } } }, null, 2)}\n`,
);

const marketplace = JSON.parse(readFileSync(join('.claude-plugin', 'marketplace.json'), 'utf8'));
marketplace.plugins[0].version = pkg.version;
writeFileSync(join('.claude-plugin', 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);

console.log(`\nbuild/server.mjs, build/busybar.mcpb and plugin/ for ${pkg.version}`);
