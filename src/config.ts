import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SyncPair {
  id: string;
  source: string;
  dest: string;
  exclude: string[];
  debounceMs: number;
  enabled: boolean;
}

export interface Config {
  pairs: SyncPair[];
  pidFile: string;
  logFile: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'wsl-sync');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
  pairs: [],
  pidFile: path.join(CONFIG_DIR, 'daemon.pid'),
  logFile: path.join(CONFIG_DIR, 'daemon.log'),
};

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    console.error(`Failed to parse config at ${CONFIG_FILE}, using defaults.`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function generateId(source: string): string {
  const parent = path.basename(path.dirname(source));
  const base = path.basename(source);
  return [parent, base]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
