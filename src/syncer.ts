import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { SyncPair } from './config';
import { log } from './logger';

export interface SyncStats {
  copied: number;
  deleted: number;
  skipped: number;
  errors: number;
}

export function isExcluded(filePath: string, source: string, exclude: string[]): boolean {
  const relative = path.relative(source, filePath);
  const parts = relative.split(path.sep);
  return exclude.some((pattern) => {
    return parts.some((part) => {
      if (pattern.startsWith('*.')) return part.endsWith(pattern.slice(1));
      return part === pattern;
    });
  });
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function needsUpdate(srcPath: string, destPath: string): Promise<boolean> {
  try {
    await fsp.access(destPath);
  } catch {
    return true;
  }
  const [srcStat, destStat] = await Promise.all([fsp.stat(srcPath), fsp.stat(destPath)]);
  return srcStat.size !== destStat.size || srcStat.mtimeMs > destStat.mtimeMs + 1000;
}

async function copyFile(srcPath: string, destPath: string): Promise<void> {
  await ensureDir(path.dirname(destPath));
  await fsp.copyFile(srcPath, destPath);
  const { atime, mtime } = await fsp.stat(srcPath);
  await fsp.utimes(destPath, atime, mtime);
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDir(full)));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export async function fullSync(pair: SyncPair): Promise<SyncStats> {
  const stats: SyncStats = { copied: 0, deleted: 0, skipped: 0, errors: 0 };

  try {
    await fsp.access(pair.source);
  } catch {
    log.warn(`[${pair.id}] Source does not exist: ${pair.source}`);
    return stats;
  }

  await ensureDir(pair.dest);

  // Copy source → dest
  const srcFiles = await walkDir(pair.source);
  for (const srcPath of srcFiles) {
    if (isExcluded(srcPath, pair.source, pair.exclude)) {
      stats.skipped++;
      continue;
    }
    const relative = path.relative(pair.source, srcPath);
    const destPath = path.join(pair.dest, relative);
    try {
      if (await needsUpdate(srcPath, destPath)) {
        await copyFile(srcPath, destPath);
        log.debug(`[${pair.id}] copied ${relative}`);
        stats.copied++;
      } else {
        stats.skipped++;
      }
    } catch (err) {
      log.error(`[${pair.id}] Failed to copy ${relative}: ${(err as Error).message}`);
      stats.errors++;
    }
  }

  // Remove orphaned dest files with no corresponding source
  const destFiles = await walkDir(pair.dest);
  for (const destPath of destFiles) {
    const relative = path.relative(pair.dest, destPath);
    const srcPath = path.join(pair.source, relative);
    if (isExcluded(srcPath, pair.source, pair.exclude)) continue;
    try {
      await fsp.access(srcPath);
    } catch {
      try {
        await fsp.unlink(destPath);
        log.info(`[${pair.id}] orphan removed → ${relative}`);
        stats.deleted++;
      } catch (err) {
        log.error(`[${pair.id}] Failed to remove orphan ${relative}: ${(err as Error).message}`);
        stats.errors++;
      }
    }
  }

  return stats;
}

export async function syncFile(
  eventType: 'add' | 'change' | 'unlink' | 'unlinkDir' | 'addDir',
  filePath: string,
  pair: SyncPair
): Promise<void> {
  if (isExcluded(filePath, pair.source, pair.exclude)) {
    log.debug(`[${pair.id}] excluded: ${path.relative(pair.source, filePath)}`);
    return;
  }

  const relative = path.relative(pair.source, filePath);
  const destPath = path.join(pair.dest, relative);

  try {
    switch (eventType) {
      case 'add':
      case 'change':
        if (await needsUpdate(filePath, destPath)) {
          await copyFile(filePath, destPath);
          log.success(`[${pair.id}] ${eventType === 'add' ? 'added' : 'updated'} → ${relative}`);
        }
        break;
      case 'unlink':
        try {
          await fsp.access(destPath);
          await fsp.unlink(destPath);
          log.info(`[${pair.id}] deleted → ${relative}`);
        } catch {
          // dest already gone
        }
        break;
      case 'addDir':
        await ensureDir(destPath);
        log.debug(`[${pair.id}] mkdir → ${relative}`);
        break;
      case 'unlinkDir':
        try {
          await fsp.access(destPath);
          await fsp.rm(destPath, { recursive: true, force: true });
          log.info(`[${pair.id}] rmdir → ${relative}`);
        } catch {
          // dest already gone
        }
        break;
    }
  } catch (err) {
    log.error(`[${pair.id}] Error handling ${eventType} for ${relative}: ${(err as Error).message}`);
  }
}
