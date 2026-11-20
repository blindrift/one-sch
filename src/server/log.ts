import 'server-only';

// 이 이름(대소문자·'-'·'_' 무시, 전체 일치)의 키 값은 로그·감사 로그에 남기지 않는다.
// 부분 일치는 mustChangePassword 같은 정상 필드까지 지우므로 쓰지 않는다. 새 비밀 필드는 여기에 추가한다.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'temporarypassword',
  'token',
  'rawtoken',
  'sessiontoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'secret',
  'clientsecret',
  'authsecret',
  'cookie',
  'cookies',
  'setcookie',
  'authorization',
  'sessionstate',
]);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''));
}
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
    // boolean 은 비밀값이 될 수 없으므로 그대로 둔다.
    out[k] = isSensitiveKey(k) && typeof v !== 'boolean' ? REDACTED : maskSensitive(v, depth + 1);
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
