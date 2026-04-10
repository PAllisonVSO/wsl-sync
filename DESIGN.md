# wsl-fsync — Design Document

**Version:** 1.0.0 | **Date:** 2026-04-10

## Purpose

Real-time, one-way file sync from WSL2 (inotify) to Windows (/mnt/c/) destinations.
No rsync required. Pure Node.js copy engine with mtime/size delta detection.

## Why WSL2-native

Windows filesystem watchers (ReadDirectoryChangesW) do not receive inotify events
for the WSL2 VHDX. The watcher must run inside WSL2 itself. From WSL2, Windows
drives are already mounted at /mnt/c/, /mnt/d/ etc via 9P.

## Components

- cli.ts      — Commander.js subcommands
- config.ts   — JSON config CRUD at ~/.config/wsl-fsync/config.json
- daemon.ts   — Chokidar watcher per pair + per-file debounce timer map
- syncer.ts   — fullSync (initial) + syncFile (incremental) with delta detection
- logger.ts   — Chalk console output + optional file logging
- pid.ts      — PID file management for daemon start/stop/status

## Delta Detection

needsUpdate(src, dest):
  → copy if dest missing, sizes differ, or src.mtime > dest.mtime + 1000ms
  → 1s tolerance handles NTFS 2s granularity and 9P clock skew
  → mtime is stamped on dest after copy to keep checks stable

## Debounce

Each pair maintains a Map<filePath, setTimeout>. Rapid events (editor save +
formatter) collapse into one sync per file. Timer resets on each new event.

## Daemon

Foreground: SIGINT/SIGTERM trigger graceful shutdown (clear timers, close watchers).
Background: spawn() with detached:true + stdio→logfile. PID written to pidFile.
