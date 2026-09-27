// Finding boards and putting firmware on them.
//
//   USB  — any ESP32-C3 plugged into this computer (/dev/cu.usbmodem*).
//   WiFi — boards already running a chipvibe game and on the network.
//          Each advertises itself over mDNS as "chipvibe-xxxx" once its
//          OTA receiver is armed.

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { exec } from './proc.mjs';

const PIO_PYTHON = path.join(os.homedir(), '.platformio', 'penv', 'bin', 'python');
const ESPOTA = path.join(
  os.homedir(),
  '.platformio',
  'packages',
  'framework-arduinoespressif32',
  'tools',
  'espota.py',
);
const OTA_PASSWORD = 'chipvibe'; // matches firmware/board/net.cpp

export async function usbPorts() {
  try {
    return (await readdir('/dev'))
      .filter((n) => /^cu\.(usbmodem|usbserial|wchusbserial|SLAB_USBtoUART)/.test(n))
      .map((n) => `/dev/${n}`)
      .sort();
  } catch {
    return [];
  }
}

/** Browse mDNS for chipvibe boards for `ms` milliseconds (macOS dns-sd). */
export function networkBoards(ms = 2500) {
  return new Promise((resolve) => {
    const found = new Set();
    let child;
    try {
      child = spawn('dns-sd', ['-B', '_arduino._tcp', 'local.'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve([]);
      return;
    }
    let buf = '';
    child.stdout.on('data', (c) => {
      buf += c.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const m = /\bAdd\b.*_arduino\._tcp\.\s+(chipvibe-[0-9a-f]{4})\s*$/.exec(line);
        if (m) found.add(m[1]);
      }
    });
    child.on('error', () => resolve([]));
    setTimeout(() => {
      child.kill();
      resolve([...found].sort().map((name) => ({ name, host: `${name}.local` })));
    }, ms);
  });
}

export async function targets() {
  const [usb, wifi] = await Promise.all([usbPorts(), networkBoards()]);
  return {
    usb: usb.map((port) => ({ kind: 'usb', id: port, label: `USB · ${port.replace('/dev/cu.', '')}` })),
    wifi: wifi.map((b) => ({ kind: 'wifi', id: b.host, label: `WiFi · ${b.name}` })),
  };
}

/** Flash the already-compiled firmware to one target. Caller holds buildLock. */
export async function flash(target, { bin, onLine, signal }) {
  if (target.kind === 'usb') {
    if (!(await usbPorts()).includes(target.id)) {
      throw new Error(`${target.id} isn't plugged in any more.`);
    }
    const r = await exec('pio', ['run', '-e', 'board', '-t', 'upload', '--upload-port', target.id], {
      onLine,
      signal,
      echo: false,
    });
    if (r.code !== 0) {
      throw new Error(
        'USB upload failed. If this board has never had chipvibe on it: hold BOOT, tap RST, ' +
          'let go of BOOT, and try again.',
      );
    }
    return;
  }
  if (target.kind === 'wifi') {
    if (!/^chipvibe-[0-9a-f]{4}\.local$/.test(target.id)) throw new Error('Unknown WiFi board.');
    const r = await exec(
      PIO_PYTHON,
      [ESPOTA, '-i', target.id, '-p', '3232', '-a', OTA_PASSWORD, '-f', bin, '-r'],
      { onLine, signal, echo: false },
    );
    if (r.code !== 0) {
      throw new Error(`Couldn't reach ${target.id} over WiFi. Is it switched on? Use USB if not.`);
    }
    return;
  }
  throw new Error('Unknown kind of board.');
}
