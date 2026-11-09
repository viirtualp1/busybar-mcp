import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarCollector } from '../src/discover.ts';

/** Builds an mDNS response the way lwIP does: answers and additionals, names compressed against earlier ones. */
function response() {
  const out: number[] = [0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 3];
  const offsets = new Map<string, number>();
  const name = (value: string) => {
    const labels = value.split('.');

    for (let i = 0; i < labels.length; i++) {
      const rest = labels.slice(i).join('.');
      const known = offsets.get(rest);

      if (known !== undefined) {
        out.push(0xc0 | (known >> 8), known & 0xff);
        return;
      }

      offsets.set(rest, out.length);
      const bytes = Buffer.from(labels[i]);
      out.push(bytes.length, ...bytes);
    }

    out.push(0);
  };
  const record = (owner: string, type: number, data: () => void) => {
    name(owner);
    out.push(0, type, 0x80, 1, 0, 0, 0x11, 0x94);
    const lengthAt = out.length;
    out.push(0, 0);
    const start = out.length;
    data();
    const length = out.length - start;
    out[lengthAt] = length >> 8;
    out[lengthAt + 1] = length & 0xff;
  };
  const instance = 'busybar-0cfa22001984._http._tcp.local';

  record('_http._tcp.local', 12, () => name(instance));
  record(instance, 33, () => {
    out.push(0, 0, 0, 0, 0, 80);
    name('busybar.local');
  });
  record(instance, 16, () => {
    const entries = ['path=/', 'name=Nikita\'s Bar'].map((entry) => Buffer.from(entry));
    for (const entry of entries) out.push(entry.length, ...entry);
  });
  record('busybar.local', 1, () => out.push(192, 168, 1, 127));

  return Buffer.from(out);
}

test('reads a Bar out of one mDNS response with compressed names', () => {
  const collector = new BarCollector();
  collector.add(response());

  assert.deepEqual(collector.bars(), [
    { id: 'busybar-0cfa22001984', name: "Nikita's Bar", host: 'busybar.local', addr: '192.168.1.127' },
  ]);
});

test('asks for SRV, TXT and the host address when only the PTR has arrived', () => {
  const full = response();
  const collector = new BarCollector();
  const ptrOnly = Buffer.from(full);
  ptrOnly.writeUInt16BE(1, 6);
  ptrOnly.writeUInt16BE(0, 10);

  const followUps = collector.add(ptrOnly);

  assert.deepEqual(followUps.map(([, type]) => type), [33, 16]);
  assert.deepEqual(collector.bars(), []);
});

test('ignores other HTTP services, the USB network and garbage', () => {
  const collector = new BarCollector();
  const printer = Buffer.from(response().toString('latin1').replace(/busybar-0cfa22001984/g, 'printer-00000000000'), 'latin1');

  collector.add(printer);
  collector.add(Buffer.from([1, 2, 3]));

  assert.deepEqual(collector.bars(), []);
});
