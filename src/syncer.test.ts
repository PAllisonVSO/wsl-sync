import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { isExcluded, needsUpdate, fullSync, syncFile, SyncStats } from './syncer';
import { SyncPair } from './config';

let tmpDir: string;

function makePair(overrides: Partial<SyncPair> = {}): SyncPair {
  return {
    id: 'test',
    source: path.join(tmpDir, 'src'),
    dest: path.join(tmpDir, 'dest'),
    exclude: [],
    debounceMs: 0,
    enabled: true,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wsl-sync-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// --- isExcluded ---

describe('isExcluded', () => {
  it('matches exact directory name', () => {
    expect(isExcluded('/src/node_modules/foo.js', '/src', ['node_modules'])).toBe(true);
  });

  it('matches wildcard extension', () => {
    expect(isExcluded('/src/debug.log', '/src', ['*.log'])).toBe(true);
  });

  it('does not match unrelated file', () => {
    expect(isExcluded('/src/index.ts', '/src', ['node_modules', '*.log'])).toBe(false);
  });

  it('matches nested directory segment', () => {
    expect(isExcluded('/src/a/node_modules/b/c.js', '/src', ['node_modules'])).toBe(true);
  });
});

// --- needsUpdate ---

describe('needsUpdate', () => {
  it('returns true when dest does not exist', async () => {
    const src = path.join(tmpDir, 'a.txt');
    await fsp.writeFile(src, 'hello');
    expect(await needsUpdate(src, path.join(tmpDir, 'nonexistent.txt'))).toBe(true);
  });

  it('returns false when files are identical', async () => {
    const src = path.join(tmpDir, 'a.txt');
    const dest = path.join(tmpDir, 'b.txt');
    await fsp.writeFile(src, 'hello');
    await fsp.copyFile(src, dest);
    const { atime, mtime } = await fsp.stat(src);
    await fsp.utimes(dest, atime, mtime);
    expect(await needsUpdate(src, dest)).toBe(false);
  });

  it('returns true when sizes differ', async () => {
    const src = path.join(tmpDir, 'a.txt');
    const dest = path.join(tmpDir, 'b.txt');
    await fsp.writeFile(src, 'hello world');
    await fsp.writeFile(dest, 'hi');
    expect(await needsUpdate(src, dest)).toBe(true);
  });

  it('returns true when src is newer', async () => {
    const src = path.join(tmpDir, 'a.txt');
    const dest = path.join(tmpDir, 'b.txt');
    await fsp.writeFile(dest, 'hello');
    // Set dest mtime to 5 seconds ago
    const past = new Date(Date.now() - 5000);
    await fsp.utimes(dest, past, past);
    await fsp.writeFile(src, 'hello');
    expect(await needsUpdate(src, dest)).toBe(true);
  });
});

// --- fullSync ---

describe('fullSync', () => {
  it('copies files from source to dest', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.writeFile(path.join(pair.source, 'a.txt'), 'aaa');
    await fsp.mkdir(path.join(pair.source, 'sub'));
    await fsp.writeFile(path.join(pair.source, 'sub', 'b.txt'), 'bbb');

    const stats = await fullSync(pair);
    expect(stats.copied).toBe(2);
    expect(stats.errors).toBe(0);
    expect(fs.readFileSync(path.join(pair.dest, 'a.txt'), 'utf-8')).toBe('aaa');
    expect(fs.readFileSync(path.join(pair.dest, 'sub', 'b.txt'), 'utf-8')).toBe('bbb');
  });

  it('skips excluded files', async () => {
    const pair = makePair({ exclude: ['*.log'] });
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.writeFile(path.join(pair.source, 'app.ts'), 'code');
    await fsp.writeFile(path.join(pair.source, 'debug.log'), 'log');

    const stats = await fullSync(pair);
    expect(stats.copied).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(fs.existsSync(path.join(pair.dest, 'debug.log'))).toBe(false);
  });

  it('removes orphaned dest files', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.writeFile(path.join(pair.source, 'keep.txt'), 'keep');

    // Pre-populate dest with an extra file
    await fsp.mkdir(pair.dest, { recursive: true });
    await fsp.writeFile(path.join(pair.dest, 'keep.txt'), 'keep');
    await fsp.writeFile(path.join(pair.dest, 'orphan.txt'), 'gone');

    const stats = await fullSync(pair);
    expect(stats.deleted).toBe(1);
    expect(fs.existsSync(path.join(pair.dest, 'orphan.txt'))).toBe(false);
    expect(fs.existsSync(path.join(pair.dest, 'keep.txt'))).toBe(true);
  });

  it('skips up-to-date files', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.writeFile(path.join(pair.source, 'a.txt'), 'aaa');

    // First sync copies
    await fullSync(pair);
    // Second sync skips
    const stats = await fullSync(pair);
    expect(stats.copied).toBe(0);
    expect(stats.skipped).toBe(1);
  });
});

// --- syncFile ---

describe('syncFile', () => {
  it('copies a new file on add', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.mkdir(pair.dest, { recursive: true });
    const srcFile = path.join(pair.source, 'new.txt');
    await fsp.writeFile(srcFile, 'new content');

    await syncFile('add', srcFile, pair);
    expect(fs.readFileSync(path.join(pair.dest, 'new.txt'), 'utf-8')).toBe('new content');
  });

  it('updates a changed file', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.mkdir(pair.dest, { recursive: true });
    const srcFile = path.join(pair.source, 'f.txt');
    await fsp.writeFile(srcFile, 'v1');
    await syncFile('add', srcFile, pair);

    await fsp.writeFile(srcFile, 'v2-longer');
    await syncFile('change', srcFile, pair);
    expect(fs.readFileSync(path.join(pair.dest, 'f.txt'), 'utf-8')).toBe('v2-longer');
  });

  it('deletes a file on unlink', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.dest, { recursive: true });
    const destFile = path.join(pair.dest, 'gone.txt');
    await fsp.writeFile(destFile, 'data');

    await syncFile('unlink', path.join(pair.source, 'gone.txt'), pair);
    expect(fs.existsSync(destFile)).toBe(false);
  });

  it('creates directory on addDir', async () => {
    const pair = makePair();
    await fsp.mkdir(pair.dest, { recursive: true });

    await syncFile('addDir', path.join(pair.source, 'newdir'), pair);
    expect(fs.statSync(path.join(pair.dest, 'newdir')).isDirectory()).toBe(true);
  });

  it('removes directory on unlinkDir', async () => {
    const pair = makePair();
    const destDir = path.join(pair.dest, 'olddir');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(path.join(destDir, 'f.txt'), 'x');

    await syncFile('unlinkDir', path.join(pair.source, 'olddir'), pair);
    expect(fs.existsSync(destDir)).toBe(false);
  });

  it('skips excluded files', async () => {
    const pair = makePair({ exclude: ['*.log'] });
    await fsp.mkdir(pair.source, { recursive: true });
    await fsp.mkdir(pair.dest, { recursive: true });
    const srcFile = path.join(pair.source, 'debug.log');
    await fsp.writeFile(srcFile, 'log data');

    await syncFile('add', srcFile, pair);
    expect(fs.existsSync(path.join(pair.dest, 'debug.log'))).toBe(false);
  });
});
