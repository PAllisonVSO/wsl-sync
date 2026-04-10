import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import { SyncPair } from './config';
import { syncFile, fullSync } from './syncer';
import { log } from './logger';

interface WatcherEntry {
  pair: SyncPair;
  watcher: FSWatcher;
  pending: Map<string, ReturnType<typeof setTimeout>>;
}

const watchers: WatcherEntry[] = [];

export async function startWatching(pairs: SyncPair[], syncOnStart = true): Promise<void> {
  for (const pair of pairs) {
    if (!pair.enabled) {
      log.info(`[${pair.id}] Skipping (disabled)`);
      continue;
    }

    log.info(`[${pair.id}] Starting watcher: ${pair.source} → ${pair.dest}`);

    if (syncOnStart) {
      log.info(`[${pair.id}] Running initial sync...`);
      const stats = await fullSync(pair);
      log.success(
        `[${pair.id}] Initial sync complete — ` +
        `copied: ${stats.copied}, skipped: ${stats.skipped}, errors: ${stats.errors}`
      );
    }

    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    const watcher = chokidar.watch(pair.source, {
      ignoreInitial: true,
      persistent: true,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
      ignored: (filePath: string) => {
        const basename = path.basename(filePath);
        return pair.exclude.some((pattern) => {
          if (pattern.startsWith('*.')) return basename.endsWith(pattern.slice(1));
          return basename === pattern;
        });
      },
    });

    type EventType = 'add' | 'change' | 'unlink' | 'unlinkDir' | 'addDir';

    const handleEvent = (eventType: EventType, filePath: string) => {
      const existing = pending.get(filePath);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pending.delete(filePath);
        syncFile(eventType, filePath, pair).catch((err) => {
          log.error(`[${pair.id}] Sync error for ${filePath}: ${(err as Error).message}`);
        });
      }, pair.debounceMs);
      pending.set(filePath, timer);
    };

    watcher
      .on('add', (p) => handleEvent('add', p))
      .on('change', (p) => handleEvent('change', p))
      .on('unlink', (p) => handleEvent('unlink', p))
      .on('addDir', (p) => handleEvent('addDir', p))
      .on('unlinkDir', (p) => handleEvent('unlinkDir', p))
      .on('error', (err) => log.error(`[${pair.id}] Watcher error: ${err}`))
      .on('ready', () => log.success(`[${pair.id}] Watching for changes...`));

    watchers.push({ pair, watcher, pending });
  }

  if (watchers.length === 0) {
    log.warn('No active sync pairs to watch. Use `wsl-sync add` to configure pairs.');
    return;
  }

  log.info(`Watching ${watchers.length} pair(s). Press Ctrl+C to stop.`);
}

export async function stopWatching(): Promise<void> {
  for (const entry of watchers) {
    for (const timer of entry.pending.values()) clearTimeout(timer);
    await entry.watcher.close();
    log.info(`[${entry.pair.id}] Watcher stopped.`);
  }
  watchers.length = 0;
}
