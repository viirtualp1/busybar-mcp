import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const path = '/wm/v1/control';
const names = [
  'busybar_get_status', 'busybar_get_connectivity', 'busybar_list_apps', 'busybar_switch_app',
  'busybar_show_message', 'busybar_start_timer', 'busybar_return_to_auto', 'busybar_send_input',
];
const apps = [{ name: 'clock', rank: 1, autostart: true, ready: true, running: true }];

async function fixture() {
  const commands: Record<string, unknown>[] = [];
  const requests: { method: string | undefined; url: string | undefined; auth: string | undefined }[] = [];
  const state = { wm: true, hang: false, offline: false };
  const responses: Record<string, object> = {
    '/api/version': { api_semver: '1.0.0' },
    '/api/status': { firmware: { version: '1.2.3' }, power: { battery_percent: 80 } },
    '/api/update/status': { check: { available_version: '1.2.4' } },
    '/api/update/autoupdate': { is_enabled: true },
    '/api/wifi/status': { state: 'connected', ssid: 'Test', rssi: -48 },
    '/api/ble/status': { status: 'enabled', address: 'test' },
    '/api/transport': { type: 'usb' },
    '/api/status/device': { usb_mac: '02:00:00:00:00:01' },
  };
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });

    const json = (status: number, value: object, control = false) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        ...(control ? { 'x-busybar-wm-control': '1' } : {}),
      });
      res.end(JSON.stringify(value));
    };

    if (req.url === path && state.wm) {
      if (state.hang) {
        return;
      }
      if (req.headers.authorization !== 'Bearer test-token') {
        return json(401, { error: 'Unauthorized' }, true);
      }
      if (req.method === 'GET') {
        return json(200, { protocol: 'busybar-wm/control/v1', activeApp: 'clock', pinnedApp: null, apps }, true);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }

      const command = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      commands.push(command);

      if (command.app === 'missing') {
        return json(404, { error: 'App is absent from the WM manifest' }, true);
      }

      return json(200, { accepted: true }, true);
    }

    const pathname = req.url?.split('?')[0] ?? '';
    if (!state.offline && ['/api/display/draw', '/api/assets/upload', '/api/audio/play'].includes(pathname)) {
      req.resume();
      return json(200, { result: 'ok' });
    }

    const value = responses[pathname];
    if (value && !state.offline) {
      return json(200, value);
    }

    return json(state.offline ? 502 : 404, { error: state.offline ? 'Disconnected device' : 'Not found' });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const client = await connectClient({
    BUSY_ADDR: `http://127.0.0.1:${address.port}`,
    WM_API_TOKEN: 'test-token',
  });

  return {
    client, commands, requests, state,
    async close() {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function connectClient(env: Record<string, string>) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/cli.ts'],
    env: {
      BUSYBAR_NO_UPDATE_CHECK: '1',
      BUSYBAR_MCP_HOME: '/nonexistent/busybar-test',
      ...env,
    },
  }));

  return client;
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0];
  assert.ok(first?.type === 'text' && typeof first.text === 'string');

  return first.text;
}

test('stdio discovers the eight tools and validates messages before contacting the WM', async (t) => {
  const wm = await fixture();
  t.after(wm.close);

  const tools = (await wm.client.listTools()).tools;
  assert.deepEqual(tools.filter((tool) => names.includes(tool.name)).map((tool) => tool.name), names);
  const message = tools.find((tool) => tool.name === 'busybar_show_message');
  assert.deepEqual(message?.inputSchema.required, ['message']);

  const invalid = await wm.client.callTool({
    name: 'busybar_show_message', arguments: { message: 'test', durationSeconds: -1 },
  });
  assert.equal(invalid.isError, true);
  assert.equal(wm.requests.length, 0);
});

test('stdio separates read-only diagnostics and WM commands', async (t) => {
  const wm = await fixture();
  t.after(wm.close);

  const status = await wm.client.callTool({ name: 'busybar_get_status' });
  assert.match(firstText(status), /1\.2\.3/);
  assert.match(firstText(status), /1\.2\.4/);
  assert.match(firstText(status), /"activeApp": "clock"/);

  const connectivity = await wm.client.callTool({ name: 'busybar_get_connectivity' });
  assert.match(firstText(connectivity), /"rssi": -48/);
  assert.match(firstText(connectivity), /"status": "enabled"/);
  assert.match(firstText(connectivity), /"type": "usb"/);
  assert.match(firstText(connectivity), /02:00:00:00:00:01/);
  assert.ok(wm.requests.every((req) => req.method === 'GET'));

  const listed = await wm.client.callTool({ name: 'busybar_list_apps' });
  assert.match(firstText(listed), /"ready": true/);

  const calls = [
    ['busybar_switch_app', { app: 'clock' }],
    ['busybar_show_message', { message: 'Done ✓', durationSeconds: 2 }],
    ['busybar_start_timer', { durationSeconds: 20, display: 'back' }],
    ['busybar_return_to_auto', {}],
    ['busybar_send_input', { key: 'encoder', delta: -2 }],
  ] as const;
  for (const [name, args] of calls) {
    const response = await wm.client.callTool({ name, arguments: args });
    assert.equal(response.isError, undefined, firstText(response));
  }

  const clear = await wm.client.callTool({ name: 'bar_clear', arguments: { display: 'front' } });
  assert.equal(firstText(clear), 'Cleared.');

  assert.deepEqual(wm.commands, [
    { action: 'switch', app: 'clock' },
    { action: 'message', text: 'Done v', durationSeconds: 2, display: 'front' },
    { action: 'timer', text: '', durationSeconds: 20, display: 'back' },
    { action: 'auto' },
    { action: 'input', key: 'encoder', delta: -2 },
    { action: 'clear', display: 'front' },
  ]);
});

test('reports unavailable apps, device disconnection, and WM timeouts', async (t) => {
  const wm = await fixture();
  t.after(wm.close);

  const missing = await wm.client.callTool({ name: 'busybar_switch_app', arguments: { app: 'missing' } });
  assert.equal(missing.isError, true);
  assert.match(firstText(missing), /absent/);

  wm.state.offline = true;
  const offline = await wm.client.callTool({ name: 'busybar_get_status' });
  assert.match(firstText(offline), /502/);

  wm.state.hang = true;
  const timeout = await wm.client.callTool({ name: 'busybar_return_to_auto' });
  assert.equal(timeout.isError, true);
  assert.match(firstText(timeout), /timed out/);
});

test('uses the USB address when no connection settings are supplied', async (t) => {
  const client = await connectClient({ BUSYBAR_DRY_RUN: '1' });
  t.after(() => client.close());

  const status = await client.callTool({ name: 'bar_status' });
  assert.match(firstText(status), /"addr": "10\.0\.4\.20"/);
});

test('draws, plays sound, and clears directly without a WM', async (t) => {
  const bar = await fixture();
  t.after(bar.close);
  bar.state.wm = false;

  const draw = await bar.client.callTool({ name: 'bar_text', arguments: { line1: 'Direct draw' } });
  assert.match(firstText(draw), /Draw request accepted/);

  const sound = await bar.client.callTool({ name: 'bar_sound', arguments: { melody: 'C5:120' } });
  assert.match(firstText(sound), /Playing/);
  assert.equal(bar.requests.some(({ url }) => url === path), false);

  const clear = await bar.client.callTool({ name: 'bar_clear', arguments: { display: 'front' } });
  assert.equal(firstText(clear), 'Cleared.');
  assert.deepEqual(
    bar.requests.filter(({ method, url }) => method !== 'GET').map(({ method, url }) => [method, url?.split('?')[0]]),
    [
      ['DELETE', '/api/display/draw'],
      ['POST', '/api/display/draw'],
      ['POST', '/api/assets/upload'],
      ['POST', '/api/audio/play'],
      ['DELETE', '/api/display/draw'],
    ],
  );
  assert.equal(bar.commands.length, 0);

  const overlay = await bar.client.callTool({ name: 'busybar_show_message', arguments: { message: 'WM overlay' } });
  assert.equal(overlay.isError, true);
  assert.match(firstText(overlay), /needs busybar-wm/);
});
