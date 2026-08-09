/**
 * Structured JSON logging.
 *
 * One line per event, machine-parseable, with a `requestId` threaded through
 * child loggers so a single question's whole journey can be reassembled from
 * the stream. Retrieval quality is undebuggable without this.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Injectable so tests can capture output instead of writing to stdout. */
  sink?: (line: string) => void;
  bindings?: Record<string, unknown>;
  /** Injectable so log assertions are not time-dependent. */
  now?: () => Date;
}

function serialiseError(value: unknown): Record<string, unknown> {
  if (!(value instanceof Error)) return { message: String(value) };
  const out: Record<string, unknown> = { name: value.name, message: value.message };
  if (value.stack) out.stack = value.stack;
  if ('code' in value) out.code = (value as { code: unknown }).code;
  if (value.cause !== undefined) out.cause = value.cause instanceof Error ? value.cause.message : value.cause;
  return out;
}

/** JSON.stringify that survives circular references rather than throwing mid-log. */
function safeStringify(payload: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
    }
    return value;
  });
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? ((line: string) => process.stdout.write(line + '\n'));
  const bindings = options.bindings ?? {};
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_RANK[level];

  function emit(entryLevel: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    if (LEVEL_RANK[entryLevel] < threshold) return;

    const { err, ...rest } = fields;
    const payload: Record<string, unknown> = {
      ts: now().toISOString(),
      level: entryLevel,
      event,
      ...bindings,
      ...rest,
    };
    if (err !== undefined) payload.err = serialiseError(err);

    sink(safeStringify(payload));
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Discards everything. Keeps test output readable. */
export const silentLogger: Logger = createLogger({ level: 'error', sink: () => {} });
