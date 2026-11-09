// Starts the server over stdio, calls every tool, and saves the previews as preview-<tool>.png.
// BUSYBAR_DRY_RUN=1 npm run smoke   — no Bar needed
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '0' });

await client.connect(
  new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
    env: { ...process.env } as Record<string, string>,
    stderr: 'inherit',
  }),
);

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const calls: Array<[string, Record<string, unknown>]> = [
  ['bar_status', {}],
  ['bar_text', { line1: 'Deploy finished', line2: 'prod in 4m12s', accent: '#2ECC71' }],
  [
    'bar_pixels',
    {
      palette: { '.': 'none', R: '#E74C3C', P: '#FF8FA3' },
      grid: ['.RR.RR.', 'RPRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'],
      x: 2,
      y: 5,
      caption: 'hi from Claude',
    },
  ],
  ['bar_progress', { label: 'Build', value: 0.62 }],
  ['weather', { city: 'Moscow' }],
  ['github_ci', { repo: 'busy-app/busylib-ts' }],
  ['github_inbox', {}],
];

for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text?: string; data?: string }>;
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  const img = content.find((c) => c.type === 'image');

  console.log(`\n# ${name}${res.isError ? ' (ERROR)' : ''}\n${text}`);

  if (img?.data) {
    writeFileSync(`preview-${name}.png`, Buffer.from(img.data, 'base64'));
  }
}

await client.close();
