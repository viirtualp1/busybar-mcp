import { isCloudAddr, isUsbAddr } from 'busybar-kit/config';
import { z } from 'zod';

const snapshotSchema = z.object({
  protocol: z.literal('busybar-wm/control/v1'),
  activeApp: z.string().nullable(),
  pinnedApp: z.string().nullable(),
  apps: z.array(z.object({
    name: z.string(),
    rank: z.number(),
    autostart: z.boolean(),
    ready: z.boolean(),
    running: z.boolean(),
  })),
});

const PATH = '/wm/v1/control';
const TIMEOUT_MS = 3000;
const WM_REQUIRED = 'This tool needs busybar-wm. Set BUSY_ADDR to the window manager address.';

export async function wmSnapshot(addr: string) {
  if (isUsbAddr(addr) || isCloudAddr(addr)) {
    throw new WmUnavailable(WM_REQUIRED);
  }

  const response = await request(addr);
  const snapshot = snapshotSchema.safeParse(response);

  if (!snapshot.success) {
    throw new WmUnavailable(WM_REQUIRED);
  }

  return snapshot.data;
}

export async function wmCommand(
  addr: string,
  command: { action: string; [key: string]: unknown },
  { optional = false } = {},
) {
  try {
    await wmSnapshot(addr);
  } catch (error) {
    if (optional && error instanceof WmUnavailable) {
      return;
    }

    throw error;
  }

  return request(addr, command);
}

class WmUnavailable extends Error {}

async function request(addr: string, command?: object) {
  const base = /^https?:\/\//i.test(addr) ? addr : `http://${addr}`;
  const url = new URL(PATH, base);
  const headers = new Headers({ Accept: 'application/json' });
  const token = process.env.WM_API_TOKEN;
  let response: Response;

  if (command) {
    headers.set('Content-Type', 'application/json');

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  try {
    const send = () => fetch(url, {
      headers,
      method: command ? 'POST' : 'GET',
      body: command ? JSON.stringify(command) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    response = await send();

    if (!command && token && response.status === 401 && isControlResponse(response)) {
      await response.body?.cancel();
      headers.set('Authorization', `Bearer ${token}`);
      response = await send();
    }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'could not connect';

    throw new WmUnavailable(`busybar-wm at ${url.origin}: ${reason}. Check that the WM is running and BUSY_ADDR points to it.`);
  }

  if (!isControlResponse(response)) {
    await response.body?.cancel();
    throw new WmUnavailable(WM_REQUIRED);
  }

  const value: unknown = await response.json();

  if (!response.ok) {
    const details = z.object({ error: z.string() }).safeParse(value);

    throw new Error(details.success ? `busybar-wm: ${details.data.error}` : `busybar-wm returned HTTP ${response.status}.`);
  }

  return value;
}

function isControlResponse(response: Response) {
  return response.headers.get('x-busybar-wm-control') === '1' &&
    response.headers.get('content-type')?.includes('application/json');
}
