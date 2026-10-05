export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Marks the start of a pipeline stage (rendered as a progress line by human loggers). */
  step(message: string): void;
  child(prefix: string): Logger;
}

export interface LogRecord {
  level: LogLevel | 'step';
  message: string;
  time: string;
}

/** Logger that keeps records in memory; used by tests and to persist run logs. */
export class MemoryLogger implements Logger {
  readonly records: LogRecord[];
  private readonly prefix: string;

  constructor(records: LogRecord[] = [], prefix = '') {
    this.records = records;
    this.prefix = prefix;
  }

  private push(level: LogRecord['level'], message: string): void {
    this.records.push({ level, message: this.prefix + message, time: new Date().toISOString() });
  }

  debug(message: string): void {
    this.push('debug', message);
  }
  info(message: string): void {
    this.push('info', message);
  }
  warn(message: string): void {
    this.push('warn', message);
  }
  error(message: string): void {
    this.push('error', message);
  }
  step(message: string): void {
    this.push('step', message);
  }
  child(prefix: string): Logger {
    return new MemoryLogger(this.records, `${this.prefix}${prefix}: `);
  }
}

/** Fans out to several loggers (e.g. the terminal and the run's persisted log). */
export class TeeLogger implements Logger {
  private readonly targets: Logger[];
  constructor(...targets: Logger[]) {
    this.targets = targets;
  }
  debug(m: string) {
    for (const t of this.targets) t.debug(m);
  }
  info(m: string) {
    for (const t of this.targets) t.info(m);
  }
  warn(m: string) {
    for (const t of this.targets) t.warn(m);
  }
  error(m: string) {
    for (const t of this.targets) t.error(m);
  }
  step(m: string) {
    for (const t of this.targets) t.step(m);
  }
  child(prefix: string): Logger {
    return new TeeLogger(...this.targets.map((t) => t.child(prefix)));
  }
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  step() {},
  child() {
    return silentLogger;
  },
};
