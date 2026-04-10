# wsl-sync

A WSL2 folder watcher that syncs files to Windows destinations in real time.

## Install

```bash
npm install && npm run build
npm link   # optional: makes `wsl-sync` available globally
```

## Quick start

```bash
wsl-sync add --source ~/dev/myproject/dist --dest /mnt/c/Users/Stone/sync/myproject
wsl-sync start
```

## Commands

| Command | Description |
|---|---|
| `add -s <src> -d <dest>` | Add a sync pair |
| `remove <id>` | Remove a pair |
| `enable / disable <id>` | Toggle a pair |
| `list` | List all pairs |
| `sync [id]` | One-shot full sync |
| `start [--daemon]` | Start watching |
| `stop` | Stop background daemon |
| `status` | Show daemon + pair status |
| `config` | Show config file |

See README.md for full options.
