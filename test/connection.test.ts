import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConnections, selectConnection } from '../src/connection.js';

test('prefers USB, falls back to LAN before sending commands, and returns to USB', async (t) => {
  const requests: Array<{ url: string; method: string | undefined }> = [];
  let usb = true;
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    requests.push({ url: url.href, method: init?.method });

    if (url.hostname === '10.0.4.20' && !usb) {
      throw new TypeError('USB disconnected');
    }

    if (url.hostname === '192.168.1.50' && url.pathname === '/api/audio/play') {
      assert.equal(new Headers(init?.headers).get('x-api-token'), 'lan-password');
      throw new TypeError('Connection lost after write');
    }

    return Response.json({ api_semver: '1.0.0' });
  });

  const connections = createConnections({
    BUSY_LAN_ADDR: '192.168.1.50',
    BUSY_HTTP_PASSWORD: 'lan-password',
  });
  assert.equal((await selectConnection(connections)).config.busyAddr, '10.0.4.20');

  usb = false;
  const selected = await selectConnection(connections);
  assert.equal(selected.config.busyAddr, '192.168.1.50');
  await assert.rejects(selected.client.audioPlay({ application_name: 'test', stock_path: 'test.snd' }));
  assert.deepEqual(requests.filter(({ method }) => method === 'POST'), [
    { url: 'http://192.168.1.50/api/audio/play', method: 'POST' },
  ]);

  usb = true;
  assert.equal((await selectConnection(connections)).config.busyAddr, '10.0.4.20');
});

test('a reachable USB device with an HTTP error does not send commands to LAN', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
  const connections = createConnections({ BUSY_LAN_ADDR: '192.168.1.50' });

  assert.equal((await selectConnection(connections)).config.busyAddr, '10.0.4.20');
});

test('an explicit WM address keeps its existing routing', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const connections = createConnections({ BUSY_ADDR: 'http://127.0.0.1:4111', BUSY_LAN_ADDR: '192.168.1.50' });

  assert.equal((await selectConnection(connections)).config.busyAddr, 'http://127.0.0.1:4111');
  assert.equal(fetch.mock.callCount(), 0);
});
