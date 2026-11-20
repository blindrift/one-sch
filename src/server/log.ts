import 'server-only';

// 이름에 이 단어가 들어간 키의 값은 로그·감사 로그에 남기지 않는다.
const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|hash|session_?state/i;
const MAX_DEPTH = 6;

export const REDACTED = '[REDACTED]';

export function maskSensitive(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : maskSensitive(v, depth + 1);
  }
  return out;
}

function serializeError(err: Error): Record<string, unknown> {
  return { name: err.name, message: err.message, stack: err.stack };
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(fields ? (maskSensitive(fields) as Record<string, unknown>) : {}),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') write('debug', msg, fields);
  },
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
