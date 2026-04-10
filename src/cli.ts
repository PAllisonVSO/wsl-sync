#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  generateId,
  SyncPair,
} from './config';
import { initLogger, log } from './logger';
import { startWatching, stopWatching } from './daemon';
import { fullSync } from './syncer';
import { writePid, readPid, clearPid, isRunning } from './pid';

const program = new Command();

program
  .name('wsl-sync')
  .description('WSL2 folder watcher → Windows file sync')
  .version('1.0.0')
  .showHelpAfterError(true)
  .configureHelp({
    subcommandTerm(cmd) {
      const args = cmd.registeredArguments.map((a) => a.name()).join(' ');
      const opts = cmd.options
        .filter((o) => !o.hidden)
        .map((o) => {
          const flag = o.long ?? o.short;
          return o.required ? flag : `[${flag}]`;
        })
        .join(' ');
      return [cmd.name(), args, opts].filter(Boolean).join(' ');
    },
  });

program
  .command('add')
  .description('Add a new source→destination sync pair')
  .requiredOption('-s, --source <path>', 'Source folder to watch (WSL2 path)')
  .requiredOption('-d, --dest <path>', 'Destination folder (e.g. /mnt/c/Users/...)')
  .option('-i, --id <id>', 'Custom ID for this pair (auto-generated if omitted)')
  .option('-e, --exclude <patterns...>', 'Patterns to exclude (e.g. node_modules *.log)', [])
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '500')
  .action((opts) => {
    const config = loadConfig();
    const source = path.resolve(opts.source);
    const dest = path.resolve(opts.dest);
    const id = opts.id ?? generateId(source);

    if (config.pairs.find((p) => p.id === id)) {
      log.error(`A pair with id "${id}" already exists. Use --id to specify a different one.`);
      process.exit(1);
    }

    const pair: SyncPair = {
      id,
      source,
      dest,
      exclude: opts.exclude,
      debounceMs: parseInt(opts.debounce, 10),
      enabled: true,
    };

    config.pairs.push(pair);
    saveConfig(config);

    log.success(`Added sync pair "${id}"`);
    log.info(`  Source : ${source}`);
    log.info(`  Dest   : ${dest}`);
    if (pair.exclude.length > 0) log.info(`  Exclude: ${pair.exclude.join(', ')}`);
    log.info(`  Debounce: ${pair.debounceMs}ms`);
  });

program
  .command('edit <id>')
  .usage('<id> [options]')
  .description('Edit an existing sync pair')
  .option('-s, --source <path>', 'New source folder')
  .option('-d, --dest <path>', 'New destination folder')
  .option('-e, --exclude <patterns...>', 'Replace exclude patterns')
  .option('--debounce <ms>', 'New debounce delay in milliseconds')
  .action((id, opts) => {
    const config = loadConfig();
    const pair = config.pairs.find((p) => p.id === id);
    if (!pair) { log.error(`No pair found: ${id}`); process.exit(1); }

    if (opts.source) pair.source = path.resolve(opts.source);
    if (opts.dest) pair.dest = path.resolve(opts.dest);
    if (opts.exclude) pair.exclude = opts.exclude;
    if (opts.debounce) pair.debounceMs = parseInt(opts.debounce, 10);

    saveConfig(config);
    log.success(`Updated pair "${id}"`);
    log.info(`  Source  : ${pair.source}`);
    log.info(`  Dest    : ${pair.dest}`);
    log.info(`  Exclude : ${pair.exclude.length > 0 ? pair.exclude.join(', ') : '(none)'}`);
    log.info(`  Debounce: ${pair.debounceMs}ms`);
  });

program
  .command('remove <id>')
  .alias('rm')
  .description('Remove a sync pair by ID')
  .action((id) => {
    const config = loadConfig();
    const before = config.pairs.length;
    config.pairs = config.pairs.filter((p) => p.id !== id);
    if (config.pairs.length === before) {
      log.error(`No pair found with id "${id}"`);
      process.exit(1);
    }
    saveConfig(config);
    log.success(`Removed pair "${id}"`);
  });

program
  .command('enable <id>')
  .description('Enable a sync pair')
  .action((id) => {
    const config = loadConfig();
    const pair = config.pairs.find((p) => p.id === id);
    if (!pair) { log.error(`No pair found: ${id}`); process.exit(1); }
    pair.enabled = true;
    saveConfig(config);
    log.success(`Enabled "${id}"`);
  });

program
  .command('disable <id>')
  .description('Disable a sync pair (keeps config, stops watching)')
  .action((id) => {
    const config = loadConfig();
    const pair = config.pairs.find((p) => p.id === id);
    if (!pair) { log.error(`No pair found: ${id}`); process.exit(1); }
    pair.enabled = false;
    saveConfig(config);
    log.warn(`Disabled "${id}"`);
  });

program
  .command('list')
  .alias('ls')
  .description('List all configured sync pairs')
  .action(() => {
    const config = loadConfig();
    if (config.pairs.length === 0) {
      log.warn('No sync pairs configured. Use `wsl-sync add` to create one.');
      return;
    }
    log.raw('');
    for (const pair of config.pairs) {
      const status = pair.enabled ? chalk.green('● enabled') : chalk.gray('○ disabled');
      log.raw(`  ${status}  ${chalk.bold(pair.id)}`);
      log.raw(`    ${chalk.dim('source :')} ${pair.source}`);
      log.raw(`    ${chalk.dim('dest   :')} ${pair.dest}`);
      if (pair.exclude.length > 0) log.raw(`    ${chalk.dim('exclude:')} ${pair.exclude.join(', ')}`);
      log.raw(`    ${chalk.dim('debounce:')} ${pair.debounceMs}ms`);
      log.raw('');
    }
    log.raw(`  Config: ${chalk.dim(getConfigPath())}`);
    log.raw('');
  });

program
  .command('sync [id]')
  .description('Run a one-shot full sync (all pairs, or a specific pair by ID)')
  .option('--dry-run', 'Show what would be synced without copying', false)
  .action(async (id, opts) => {
    initLogger();
    const config = loadConfig();
    const pairs = id
      ? config.pairs.filter((p) => p.id === id)
      : config.pairs.filter((p) => p.enabled);

    if (pairs.length === 0) {
      log.warn(id ? `No pair found: ${id}` : 'No enabled pairs to sync.');
      return;
    }

    for (const pair of pairs) {
      if (opts.dryRun) {
        log.info(`[DRY RUN] Would sync "${pair.id}": ${pair.source} → ${pair.dest}`);
        continue;
      }
      log.info(`Syncing "${pair.id}"...`);
      const stats = await fullSync(pair);
      log.success(`"${pair.id}" — copied: ${stats.copied}, skipped: ${stats.skipped}, errors: ${stats.errors}`);
    }
  });

program
  .command('start')
  .description('Start watching all enabled sync pairs')
  .option('--no-sync-on-start', 'Skip the initial full sync when starting')
  .option('--daemon', 'Run as a background daemon (detach from terminal)')
  .option('--debug', 'Enable verbose debug logging')
  .action(async (opts) => {
    const config = loadConfig();
    initLogger(config.logFile, opts.debug);

    if (opts.daemon) {
      const pid = readPid(config.pidFile);
      if (pid && isRunning(pid)) {
        log.warn(`Daemon already running (PID ${pid})`);
        process.exit(0);
      }
      const { spawn } = require('child_process');
      const logStream = fs.openSync(config.logFile, 'a');
      const child = spawn(
        process.execPath,
        [process.argv[1], 'start', ...(opts.syncOnStart ? [] : ['--no-sync-on-start'])],
        { detached: true, stdio: ['ignore', logStream, logStream] }
      );
      child.unref();
      log.success(`Daemon started (PID ${child.pid})`);
      log.info(`Log: ${config.logFile}`);
      fs.writeFileSync(config.pidFile, String(child.pid), 'utf-8');
      process.exit(0);
    }

    writePid(config.pidFile);
    log.info('wsl-sync starting...');

    const shutdown = async () => {
      log.info('\nShutting down...');
      await stopWatching();
      clearPid(config.pidFile);
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await startWatching(config.pairs, opts.syncOnStart !== false);
  });

program
  .command('stop')
  .description('Stop a running background daemon')
  .action(() => {
    const config = loadConfig();
    const pid = readPid(config.pidFile);
    if (!pid || !isRunning(pid)) {
      log.warn('No daemon appears to be running.');
      clearPid(config.pidFile);
      return;
    }
    process.kill(pid, 'SIGTERM');
    clearPid(config.pidFile);
    log.success(`Stopped daemon (PID ${pid})`);
  });

program
  .command('status')
  .description('Show daemon status and configured pairs')
  .action(() => {
    const config = loadConfig();
    const pid = readPid(config.pidFile);
    log.raw('');
    if (pid && isRunning(pid)) {
      log.raw(`  ${chalk.green('● Daemon running')}  ${chalk.dim(`PID ${pid}`)}`);
      log.raw(`    Log: ${chalk.dim(config.logFile)}`);
    } else {
      log.raw(`  ${chalk.gray('○ Daemon stopped')}`);
    }
    log.raw('');
    log.raw(`  ${chalk.bold(String(config.pairs.length))} pair(s) configured:`);
    for (const pair of config.pairs) {
      const badge = pair.enabled ? chalk.green('on ') : chalk.gray('off');
      log.raw(`    [${badge}] ${chalk.bold(pair.id)}  ${chalk.dim(pair.source + ' → ' + pair.dest)}`);
    }
    log.raw('');
  });

program
  .command('config')
  .description('Show config file location and contents')
  .action(() => {
    const configPath = getConfigPath();
    log.raw(chalk.dim(configPath));
    if (fs.existsSync(configPath)) {
      log.raw(fs.readFileSync(configPath, 'utf-8'));
    } else {
      log.warn('No config file yet. Use `wsl-sync add` to create one.');
    }
  });

// Treat trailing '?' as --help for any command
const args = process.argv.slice(2);
if (args.length >= 1 && args[args.length - 1] === '?') {
  const cmdName = args[0] === '?' ? undefined : args[0];
  if (cmdName) {
    const cmd = program.commands.find(
      (c) => c.name() === cmdName || c.aliases().includes(cmdName)
    );
    if (cmd) {
      cmd.help();
    }
  }
  program.help();
}

program.parse(process.argv);
