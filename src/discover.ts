// Finds BUSY Bars on the local network with mDNS, so nobody has to look up an IP address.
// The firmware's web server announces itself as `busybar-<usb mac>._http._tcp.local` with a `name=<device name>` TXT.
import { createSocket, type Socket } from 'node:dgram';

export type FoundBar = { id: string; name?: string; host: string; addr: string };

type Record = { name: string; type: number; data: Buffer; offset: number; message: Buffer };

const MDNS_GROUP = '224.0.0.251';

const MDNS_PORT = 5353;

const SERVICE = '_http._tcp.local';

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 } as const;

function encodeName(name: string) {
  const parts = name.split('.').filter(Boolean).map((label) => {
    const bytes = Buffer.from(label, 'utf8');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });

  return Buffer.concat([...parts, Buffer.from([0])]);
}

function query(name: string, type: number) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(type, 0);
  question.writeUInt16BE(1, 2);

  return Buffer.concat([header, encodeName(name), question]);
}

/** A DNS name at `offset`, following compression pointers; returns it and where the name ends in place. */
function readName(message: Buffer, offset: number): [string, number] {
  const labels: string[] = [];
  let at = offset;
  let end = -1;

  for (let hops = 0; hops < 64 && at < message.length; hops++) {
    const length = message[at];

    if (length === 0) {
      return [labels.join('.'), end >= 0 ? end : at + 1];
    }

    if ((length & 0xc0) === 0xc0) {
      if (end < 0) {
        end = at + 2;
      }

      at = message.readUInt16BE(at) & 0x3fff;
      continue;
    }

    labels.push(message.toString('utf8', at + 1, at + 1 + length));
    at += length + 1;
  }

  throw new Error('Bad DNS name');
}

function parse(message: Buffer) {
  const records: Record[] = [];
  const questions = message.readUInt16BE(4);
  const total = message.readUInt16BE(6) + message.readUInt16BE(8) + message.readUInt16BE(10);
  let at = 12;

  for (let i = 0; i < questions; i++) {
    at = readName(message, at)[1] + 4;
  }

  for (let i = 0; i < total; i++) {
    const [name, next] = readName(message, at);
    const type = message.readUInt16BE(next);
    const length = message.readUInt16BE(next + 8);
    const offset = next + 10;
    records.push({ name: name.toLowerCase(), type, data: message.subarray(offset, offset + length), offset, message });
    at = offset + length;
  }

  return records;
}

function txtName(data: Buffer) {
  let at = 0;

  while (at < data.length) {
    const entry = data.toString('utf8', at + 1, at + 1 + data[at]);
    at += data[at] + 1;

    if (entry.startsWith('name=')) {
      return entry.slice(5);
    }
  }

  return undefined;
}

function open() {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });

    socket.once('error', reject);
    socket.bind(MDNS_PORT, () => {
      try {
        socket.addMembership(MDNS_GROUP);
        socket.setMulticastTTL(255);
        resolve(socket);
      } catch (err) {
        socket.close();
        reject(err);
      }
    });
  });
}

/** What a set of mDNS responses says about BUSY Bars; the network part only collects the packets. */
export class BarCollector {
  readonly instances = new Map<string, { name?: string; host?: string }>();

  readonly hosts = new Map<string, string>();

  /** Feeds one response; returns the follow-up questions worth asking (SRV/TXT for new Bars, A for their hosts). */
  add(message: Buffer) {
    const followUps: Array<[string, number]> = [];
    let records: Record[];

    try {
      records = parse(message);
    } catch {
      return followUps;
    }

    for (const record of records) {
      if (record.type === TYPE.PTR && record.name === SERVICE.toLowerCase()) {
        const [instance] = readName(record.message, record.offset);
        const key = instance.toLowerCase();

        if (key.startsWith('busybar-') && !this.instances.has(key)) {
          this.instances.set(key, {});
          followUps.push([instance, TYPE.SRV], [instance, TYPE.TXT]);
        }
      }

      if (record.type === TYPE.SRV && this.instances.has(record.name)) {
        const [target] = readName(record.message, record.offset + 6);
        this.instances.get(record.name)!.host = target.toLowerCase();

        if (!this.hosts.has(target.toLowerCase())) {
          followUps.push([target, TYPE.A]);
        }
      }

      if (record.type === TYPE.TXT && this.instances.has(record.name)) {
        this.instances.get(record.name)!.name = txtName(record.data);
      }

      if (record.type === TYPE.A && record.data.length === 4) {
        this.hosts.set(record.name, [...record.data].join('.'));
      }
    }

    return followUps;
  }

  /** Bars with an address; the USB network (10.0.4.x) is left out because it is not Wi-Fi. */
  bars(): FoundBar[] {
    return [...this.instances.entries()]
      .map(([instance, { name, host }]) => ({
        id: instance.split('.')[0],
        name,
        host: host ?? '',
        addr: host ? (this.hosts.get(host) ?? '') : '',
      }))
      .filter((bar) => bar.addr && !bar.addr.startsWith('10.0.4.'));
  }
}

/**
 * Asks the network for BUSY Bars and listens for `timeoutMs`. Never throws: no network, a blocked port or a missing
 * permission all just mean nothing was found.
 */
export async function findBars(timeoutMs = 2500): Promise<FoundBar[]> {
  let socket: Socket;

  try {
    socket = await open();
  } catch {
    return [];
  }

  const collector = new BarCollector();
  const asked = new Set<string>();
  const send = (name: string, type: number) => socket.send(query(name, type), MDNS_PORT, MDNS_GROUP);

  socket.on('message', (message) => {
    for (const [name, type] of collector.add(message)) {
      if (!asked.has(`${type}:${name}`)) {
        asked.add(`${type}:${name}`);
        send(name, type);
      }
    }
  });

  try {
    send(SERVICE, TYPE.PTR);
    await new Promise((done) => setTimeout(done, timeoutMs / 3));
    send(SERVICE, TYPE.PTR);
    await new Promise((done) => setTimeout(done, (timeoutMs * 2) / 3));
  } finally {
    socket.close();
  }

  return collector.bars();
}
