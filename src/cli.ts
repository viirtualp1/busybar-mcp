import { BusyBar } from '@busy-app/busy-lib';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  CLIENTS,
  hasDesktopExtension,
  hasDesktopJsonEntry,
  openExtension,
  uninstallDesktopJson,
  type ClientId,
  type Launch,
  type Outcome,
} from './install/clients.js';
import {
  hasClaudeHooks,
  hasCodexNotify,
  installClaudeHooks,
  installCodexNotify,
  uninstallClaudeHooks,
  uninstallCodexNotify,
} from './install/hooks.js';
import { hasSkill, installSkills, uninstallSkills, SKILL } from './install/skill.js';
import { notify } from './notify.js';
import { checkForUpdate } from './update.js';
import { applySettings, HOME_DIR, readSettings, SERVER_FILE, SETTINGS_FILE, writeSettings, type Settings } from './settings.js';
import { VERSION } from './version.js';

type Flags = {
  yes: boolean;
  only?: ClientId[];
  desktopJson: boolean;
  /** Undefined: ask (or yes with --yes). */
  notify?: boolean;
  settings: Settings;
};

const HELP = `busybar-mcp ${VERSION} — MCP server for the BUSY Bar

Usage:
  npx busybar-mcp install     set up Claude Code, Codex and Claude Desktop
  npx busybar-mcp@latest update   update every install on this machine
  npx busybar-mcp uninstall   remove it from all of them
  npx busybar-mcp doctor      show where it is installed and whether the Bar answers
  npx busybar-mcp             run the MCP server on stdio (what the clients call)

Install options:
  --yes                       don't ask, take defaults and flags
  --addr <ip|url>             Bar address (default 10.0.4.20, USB)
  --password <pw>             HTTP access password, if the Bar has one
  --token <token>             BUSY cloud token (with --addr https://api.busy.app)
  --github-token <token>      otherwise \`gh auth token\` is used
  --only <ids>                comma-separated: claude-code,codex,claude-desktop
  --desktop-json              Claude Desktop: write the config file instead of opening the extension
  --no-notify                 don't show a summary on the Bar when Claude Code / Codex finish an answer
`;

const bundleFile = fileURLToPath(import.meta.url);

const extensionFile = join(dirname(bundleFile), 'busybar.mcpb');

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, desktopJson: false, settings: {} };
  const value = (i: number) => {
    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      throw new Error(`${argv[i]} needs a value`);
    }

    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--yes':
      case '-y':
        flags.yes = true;
        break;
      case '--desktop-json':
        flags.desktopJson = true;
        break;
      case '--notify':
        flags.notify = true;
        break;
      case '--no-notify':
        flags.notify = false;
        break;
      case '--addr':
        flags.settings.BUSY_ADDR = value(i++);
        break;
      case '--password':
        flags.settings.BUSY_HTTP_PASSWORD = value(i++);
        break;
      case '--token':
        flags.settings.BUSY_TOKEN = value(i++);
        break;
      case '--github-token':
        flags.settings.GITHUB_TOKEN = value(i++);
        break;
      case '--only':
        flags.only = value(i++).split(',').map((id) => id.trim()) as ClientId[];
        break;
      default:
        throw new Error(`Unknown option ${argv[i]}`);
    }
  }

  return flags;
}

async function reachBar(settings: Settings) {
  const bar = new BusyBar({
    addr: settings.BUSY_ADDR || '10.0.4.20',
    token: settings.BUSY_TOKEN,
    HTTPAccessPassword: settings.BUSY_HTTP_PASSWORD,
    timeout: 3000,
  });

  try {
    await bar.systemStatusGet();
    return 'answers';
  } catch (err) {
    return `does not answer (${err instanceof Error ? err.message : String(err)})`;
  }
}

async function askSettings(current: Settings, notifyFlag?: boolean) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question: string, fallback = '') => {
    const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();

    return answer || fallback;
  };

  try {
    const addr = await ask('BUSY Bar address (IP on your Wi-Fi, 10.0.4.20 over USB)', current.BUSY_ADDR || '10.0.4.20');
    const cloud = /api\.busy\.app/i.test(addr);
    const settings: Settings = {
      ...current,
      BUSY_ADDR: addr,
      BUSY_TOKEN: cloud ? await ask('BUSY cloud token', current.BUSY_TOKEN) : current.BUSY_TOKEN,
      BUSY_HTTP_PASSWORD: cloud ? current.BUSY_HTTP_PASSWORD : await ask('HTTP access password (empty if none)', current.BUSY_HTTP_PASSWORD),
      GITHUB_TOKEN: await ask('GitHub token (empty to use `gh auth token`)', current.GITHUB_TOKEN),
    };
    const notifyAnswer =
      notifyFlag ?? !/^n/i.test(await ask('Show a summary on the Bar when Claude Code / Codex finish an answer? (Y/n)', 'Y'));

    return { settings, notify: notifyAnswer };
  } finally {
    rl.close();
  }
}

function print(outcomes: Outcome[]) {
  for (const { client, ok, detail } of outcomes) {
    console.log(`  ${ok ? '✔' : '✘'} ${client}: ${detail}`);
  }
}

function targets(only?: ClientId[]) {
  return CLIENTS.filter((client) => (only ? only.includes(client.id) : client.detect()));
}

/** The skill, and the answer-ready notification where the client has a hook for it. */
function extras(id: ClientId, launch: Launch, withNotify: boolean): Outcome[] {
  const skill = installSkills(id === 'codex' ? 'codex' : 'claude');

  if (!withNotify) {
    return [...skill, ...(id === 'codex' ? [uninstallCodexNotify()] : [uninstallClaudeHooks()])];
  }

  return [...skill, id === 'codex' ? installCodexNotify(launch) : installClaudeHooks(launch)];
}

async function install(flags: Flags) {
  let settings: Settings = { ...readSettings(), ...flags.settings };
  let withNotify = flags.notify ?? true;

  if (!flags.yes && process.stdin.isTTY) {
    ({ settings, notify: withNotify } = await askSettings(settings, flags.notify));
  }

  writeSettings(settings);
  console.log(`\nSettings saved to ${SETTINGS_FILE}`);
  console.log(`Bar at ${settings.BUSY_ADDR || '10.0.4.20'} ${await reachBar(settings)}`);

  mkdirSync(HOME_DIR, { recursive: true });
  copyFileSync(bundleFile, SERVER_FILE);

  // GUI apps don't inherit the shell's PATH (nvm, Homebrew), so point at this exact node.
  const launch: Launch = { command: process.execPath, args: [SERVER_FILE] };
  const outcomes: Outcome[] = [];
  const chosen = targets(flags.only);

  if (chosen.length === 0) {
    console.log('\nNo Claude Code, Codex or Claude Desktop found. Use --only to pick one anyway.');
    return;
  }

  for (const client of chosen) {
    if (client.id !== 'claude-desktop') {
      outcomes.push(await client.install(launch));
      outcomes.push(...extras(client.id, launch, withNotify));
      continue;
    }

    if (flags.desktopJson || !existsSync(extensionFile)) {
      outcomes.push(await client.install(launch));
      continue;
    }

    if (hasDesktopJsonEntry()) {
      await uninstallDesktopJson();
    }

    outcomes.push(await openExtension(extensionFile));
  }

  console.log('\nInstalled:');
  print(outcomes);
  console.log('\nStart a new Claude Code / Codex session to see the busybar tools.');
}

/** Brings every install this machine already has up to this version, keeping the choices made at install. */
async function update() {
  mkdirSync(HOME_DIR, { recursive: true });
  copyFileSync(bundleFile, SERVER_FILE);

  const launch: Launch = { command: process.execPath, args: [SERVER_FILE] };
  const outcomes: Outcome[] = [];

  for (const client of CLIENTS) {
    if (client.id === 'claude-desktop' || !client.detect() || !client.status().startsWith('installed')) {
      continue;
    }

    const id = client.id === 'codex' ? 'codex' : 'claude';
    outcomes.push(await client.install(launch));

    if (hasSkill(id)) {
      outcomes.push(...installSkills(id));
    }

    if (id === 'claude' && hasClaudeHooks()) {
      outcomes.push(installClaudeHooks(launch));
    }

    if (id === 'codex' && hasCodexNotify()) {
      outcomes.push(installCodexNotify(launch));
    }
  }

  if (hasDesktopJsonEntry()) {
    outcomes.push(await CLIENTS.find((client) => client.id === 'claude-desktop')!.install(launch));
  } else if (hasDesktopExtension() && existsSync(extensionFile)) {
    outcomes.push(await openExtension(extensionFile));
  }

  if (outcomes.length === 0) {
    console.log('Nothing installed to update. Run `npx busybar-mcp install` first.');
    return;
  }

  console.log(`Updated to ${VERSION}:`);
  print(outcomes);
  console.log('\nStart a new Claude Code / Codex session to use it.');
}

async function uninstall(flags: Flags) {
  const outcomes: Outcome[] = [];

  for (const client of flags.only ? targets(flags.only) : CLIENTS) {
    outcomes.push(await client.uninstall());

    if (client.id === 'claude-code') {
      outcomes.push(uninstallClaudeHooks(), ...uninstallSkills('claude'));
    }

    if (client.id === 'codex') {
      outcomes.push(uninstallCodexNotify(), ...uninstallSkills('codex'));
    }
  }

  // With --only, the other clients still run the server copy and read the settings.
  if (!flags.only) {
    rmSync(HOME_DIR, { recursive: true, force: true });
    outcomes.push({ client: 'Files', ok: true, detail: `removed ${HOME_DIR}` });
  }

  console.log('Uninstalled:');
  print(outcomes);
  console.log('\nIf you installed the Claude Desktop extension, remove it in Settings → Extensions.');
}

async function doctor() {
  const settings = readSettings();

  console.log(`busybar-mcp ${VERSION}`);
  console.log(`  server:   ${existsSync(SERVER_FILE) ? SERVER_FILE : 'not installed'}`);
  console.log(`  settings: ${existsSync(SETTINGS_FILE) ? SETTINGS_FILE : 'none'}`);
  console.log(`  node:     ${process.execPath}`);

  for (const client of CLIENTS) {
    console.log(`  ${client.name}: ${client.detect() ? client.status() : 'not found'}`);
  }

  console.log(`  notifications: Claude Code ${hasClaudeHooks() ? 'on' : 'off'}, Codex ${hasCodexNotify() ? 'on' : 'off'}`);
  console.log(`  skill: Claude Code ${hasSkill('claude') ? 'on' : 'off'}, Codex ${hasSkill('codex') ? 'on' : 'off'}`);

  console.log(`  Bar at ${settings.BUSY_ADDR || '10.0.4.20'} ${await reachBar(settings)}`);

  const newer = await checkForUpdate({ force: true });
  console.log(newer ? `  update: ${newer.latest} is out (${newer.url}); run npx busybar-mcp@latest update` : '  update: up to date');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  try {
    switch (command) {
      case undefined:
      case 'serve': {
        applySettings();
        const { startServer } = await import('./server.js');
        await startServer();
        break;
      }
      case 'install':
        await install(parseFlags(rest));
        break;
      case 'update':
        await update();
        break;
      case 'uninstall':
        await uninstall(parseFlags(rest));
        break;
      case 'doctor':
        await doctor();
        break;
      case 'skill':
        process.stdout.write(SKILL);
        break;
      case 'notify':
        applySettings();
        await notify(rest);
        break;
      case '--version':
      case '-v':
        console.log(VERSION);
        break;
      default:
        console.log(HELP);
        process.exitCode = command === 'help' || command === '--help' || command === '-h' ? 0 : 1;
    }
  } catch (err) {
    console.error(`busybar-mcp: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main();
