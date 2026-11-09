// Calls tools against a real Bar and saves the images they return as live-<n>-<tool>.png.
//   npm run live                       — the default walk-through below
//   npm run live -- bar_text '{"line1":"hi"}'
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const WALK: Array<[string, Record<string, unknown>]> = [
  ['bar_stock', {}],
  ['bar_text', { line1: 'Back screen works', line2: 'hello from busybar-mcp', display: 'back', urgent: true }],
  [
    'bar_pixels',
    {
      palette: { '.': 'none', R: '#E74C3C', P: '#FF8FA3' },
      grid: ['.RR.RR.', 'RPRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'],
      x: 4,
      y: 30,
      caption: 'pixels on the back',
      display: 'back',
      urgent: true,
    },
  ],
  ['bar_image', { source: 'https://github.com/viirtualp1.png?size=160', display: 'back', caption: 'viirtualp1', urgent: true }],
  ['bar_image', { source: 'https://github.com/viirtualp1.png?size=64', caption: 'avatar', urgent: true }],
  ['bar_image', { stock: 'dt_apple_red.image', caption: 'stock image', urgent: true }],
  ['bar_animation', { name: 'coding_72x16.anim', urgent: true }],
  ['bar_sound', { stock: 'volume_change.snd' }],
  ['bar_sound', { melody: 'C5:120 E5:120 G5:120 C6:300', wave: 'square' }],
  ['bar_sound', { file: '/System/Library/Sounds/Glass.aiff' }],
  ['bar_screenshot', { display: 'back' }],
  ['bar_clear', {}],
];

const WM_WALK: typeof WALK = [
  ['busybar_get_status', {}],
  ['busybar_get_connectivity', {}],
  ['busybar_list_apps', {}],
  ['busybar_show_message', { message: 'MCP test', durationSeconds: 2 }],
  ['busybar_start_timer', { durationSeconds: 3 }],
];

const [name, json] = process.argv.slice(2);
const calls = name === '--wm' ? WM_WALK : name ? [[name, JSON.parse(json ?? '{}')] as (typeof WALK)[number]] : WALK;

const client = new Client({ name: 'live', version: '0' });

await client.connect(
  new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/cli.ts'],
    env: { ...process.env } as Record<string, string>,
    stderr: 'inherit',
  }),
);

for (const [index, [tool, args]] of calls.entries()) {
  const res = await client.callTool({ name: tool, arguments: args });
  const content = res.content as Array<{ type: string; text?: string; data?: string }>;
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  const img = content.find((c) => c.type === 'image');

  console.log(`\n# ${index} ${tool}${res.isError ? ' (ERROR)' : ''}\n${text.slice(0, 600)}`);

  if (img?.data) {
    writeFileSync(`live-${index}-${tool}.png`, Buffer.from(img.data, 'base64'));
  }

  if (res.isError) {
    process.exitCode = 1;
  }

  if (tool === 'busybar_show_message' || tool === 'busybar_start_timer') {
    const duration = Number(args.durationSeconds ?? 10);
    await new Promise((done) => setTimeout(done, duration * 1000 + 250));
  }

  if (tool === 'bar_animation' || tool.startsWith('bar_sound')) {
    await new Promise((done) => setTimeout(done, 1500));
  }
}

await client.close();
