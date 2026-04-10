import * as fs from 'fs';
import chalk from 'chalk';

let logFilePath: string | null = null;
let debugEnabled = false;

export function initLogger(logFile?: string, debug = false): void {
  logFilePath = logFile ?? null;
  debugEnabled = debug;
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeToFile(level: string, msg: string): void {
  if (!logFilePath) return;
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${msg}\n`;
  try {
    fs.appendFileSync(logFilePath, line, 'utf-8');
  } catch {
    // best-effort
  }
}

export const log = {
  info(msg: string): void {
    console.log(chalk.cyan('ℹ'), chalk.white(msg));
    writeToFile('info', msg);
  },
  success(msg: string): void {
    console.log(chalk.green('✔'), chalk.green(msg));
    writeToFile('success', msg);
  },
  warn(msg: string): void {
    console.warn(chalk.yellow('⚠'), chalk.yellow(msg));
    writeToFile('warn', msg);
  },
  error(msg: string): void {
    console.error(chalk.red('✖'), chalk.red(msg));
    writeToFile('error', msg);
  },
  debug(msg: string): void {
    if (!debugEnabled) return;
    console.log(chalk.gray('⟩'), chalk.gray(msg));
    writeToFile('debug', msg);
  },
  raw(msg: string): void {
    console.log(msg);
  },
};
