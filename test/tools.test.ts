import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function dryRunClient() {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/cli.ts'],
    env: { BUSYBAR_DRY_RUN: '1', BUSYBAR_NO_UPDATE_CHECK: '1', BUSYBAR_MCP_HOME: '/nonexistent/busybar-test' },
  }));

  return client;
}

function text(result: Awaited<ReturnType<Client['callTool']>>) {
  const [first] = result.content as Array<{ type: string; text?: string }>;
  return first?.text ?? '';
}

test('offers the ready-made actions as prompts, with their arguments filled in', async (t) => {
  const client = await dryRunClient();
  t.after(() => client.close());

  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((prompt) => prompt.name), ['setup', 'status', 'focus', 'weather', 'tell_me_when_done']);

  const focus = await client.getPrompt({ name: 'focus', arguments: { minutes: '50' } });
  assert.match((focus.messages[0].content as { text: string }).text, /50-minute focus session/);
});

test('hides busybar-wm tools when there is no WM', async (t) => {
  const client = await dryRunClient();
  t.after(() => client.close());

  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(names.includes('bar_set_status') && names.includes('bar_timer'));
  assert.equal(names.includes('busybar_switch_app'), false);
});

test('sets a ready-made status and starts a timer', async (t) => {
  const client = await dryRunClient();
  t.after(() => client.close());

  const status = await client.callTool({ name: 'bar_set_status', arguments: { status: 'lunch', minutes: 45 } });
  assert.match(text(status), /Lunch" for 45 min/);

  const timer = await client.callTool({ name: 'bar_timer', arguments: { minutes: 1.5, label: 'Tea' } });
  assert.match(text(timer), /Timer: 1:30 for Tea/);

  const unknown = await client.callTool({ name: 'bar_set_status', arguments: { status: 'sleeping' } });
  assert.equal(unknown.isError, true);
});
