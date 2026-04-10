# wsl-fsync

Real-time, one-way file sync from WSL2 to Windows.

Watches directories inside WSL2 using inotify and copies changed files to `/mnt/c/` (or any Windows mount) automatically. No rsync required — pure Node.js with mtime/size delta detection.

## Why?

Windows filesystem watchers (`ReadDirectoryChangesW`) cannot see inotify events on the WSL2 virtual disk. If you develop in WSL2 but need files on the Windows side (e.g. for a Windows-native tool, deployment folder, or shared drive), this tool bridges that gap.

## Install

```bash
npm install && npm run build
npm link   # makes `wsl-fsync` available globally
```

## Quick start

```bash
# 1. Add a sync pair
wsl-fsync add --source ~/dev/myproject/dist --dest /mnt/c/Users/You/sync/myproject

# 2. Start watching (runs initial full sync, then watches for changes)
wsl-fsync start

# 3. That's it — edits in ~/dev/myproject/dist are copied to Windows in real time
```

## Commands

### Managing sync pairs

```
wsl-fsync add -s <source> -d <dest>   Add a new sync pair
wsl-fsync remove <id>                 Remove a pair by ID
wsl-fsync enable <id>                 Enable a disabled pair
wsl-fsync disable <id>                Disable a pair (keeps config)
wsl-fsync list                        List all configured pairs
```

**`add` options:**

| Flag | Description |
|------|-------------|
| `-s, --source <path>` | **(required)** Source folder to watch (WSL2 path) |
| `-d, --dest <path>` | **(required)** Destination folder (e.g. `/mnt/c/Users/...`) |
| `-i, --id <id>` | Custom ID for this pair (auto-generated from path if omitted) |
| `-e, --exclude <patterns...>` | Glob patterns to exclude (e.g. `node_modules *.log`) |
| `--debounce <ms>` | Debounce delay in milliseconds (default: `500`) |

### Syncing

```
wsl-fsync sync [id]                   One-shot full sync (all enabled pairs, or one by ID)
wsl-fsync sync --dry-run              Show what would be synced without copying
wsl-fsync start                       Start watching all enabled pairs
wsl-fsync start --daemon              Run in the background (logs to ~/.config/wsl-fsync/daemon.log)
wsl-fsync start --no-sync-on-start   Skip the initial full sync
wsl-fsync start --debug               Verbose logging
wsl-fsync stop                        Stop the background daemon
wsl-fsync status                      Show daemon status and configured pairs
```

### Other

```
wsl-fsync config                      Show config file location and contents
wsl-fsync <command> ?                 Show detailed help for a command
wsl-fsync <command> --help            Same as above
```

## How it works

1. **Watcher** — [chokidar](https://github.com/paulmillr/chokidar) watches each source directory for file changes via inotify
2. **Debounce** — Rapid events (e.g. editor save + formatter) are collapsed per-file using a configurable timer
3. **Delta detection** — Files are only copied when the destination is missing, sizes differ, or the source mtime is newer (with 1s tolerance for NTFS granularity)
4. **Orphan cleanup** — Full sync removes destination files that no longer exist in the source

## Config

All configuration is stored in `~/.config/wsl-fsync/config.json`. You can edit it directly or use the CLI commands.

```
~/.config/wsl-fsync/
  config.json    # sync pair definitions
  daemon.pid     # PID file when running as daemon
  daemon.log     # log output when running as daemon
```

## Development

```bash
npm install
npm run build     # compile TypeScript → dist/
npm test          # run tests
npm run dev       # run directly via ts-node
```
