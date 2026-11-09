import { BusyBar } from '@busy-app/busy-lib';
import { isCloudAddr, loadBarConfig } from 'busybar-kit/config';

type BarConfig = ReturnType<typeof loadBarConfig>['bar'];
type Connection = { config: BarConfig; client: BusyBar };
type Connections = { primary: Connection; lan?: Connection; warnings: string[] };

const USB_PROBE_MS = 1000;

export function createConnections(env: NodeJS.ProcessEnv = process.env, timeout = 10_000): Connections {
  const { bar, warnings } = loadBarConfig(env);
  const lanAddr = env.BUSY_LAN_ADDR?.trim();
  const lan = bar.isUsb && lanAddr && isLanAddress(lanAddr)
    ? makeConnection(loadBarConfig({ ...env, BUSY_ADDR: lanAddr, BUSY_TOKEN: '' }).bar, timeout)
    : undefined;

  if (bar.isUsb && lanAddr && !lan) {
    warnings.push('BUSY_LAN_ADDR must be a local BUSY Bar IP address or HTTP(S) URL.');
  }

  return {
    primary: makeConnection(bar, timeout),
    lan,
    warnings: warnings.filter((warning) => !warning.startsWith('Wi-Fi needs')),
  };
}

export async function selectConnection({ primary, lan }: Connections) {
  if (!lan) {
    return primary;
  }

  try {
    await primary.client.systemVersionGet({ timeout: USB_PROBE_MS });
  } catch (error) {
    if (!(error instanceof Error && 'status' in error)) {
      return lan;
    }
  }

  return primary;
}

export function isLanAddress(addr: string) {
  if (isCloudAddr(addr)) {
    return false;
  }

  try {
    const url = new URL(addr.includes('://') ? addr : `http://${addr}`);

    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function makeConnection(config: BarConfig, timeout: number): Connection {
  return {
    config,
    client: new BusyBar({
      addr: config.busyAddr,
      token: config.busyToken || undefined,
      HTTPAccessPassword: config.busyHttpPassword || undefined,
      timeout,
    }),
  };
}
