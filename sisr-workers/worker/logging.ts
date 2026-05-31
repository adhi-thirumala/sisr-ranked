export type LogFields = Record<string, unknown>;

export function logInfo(event: string, fields?: LogFields): void {
  writeLog('info', event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  writeLog('warn', event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  writeLog('error', event, fields);
}

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  return { errorMessage: String(error) };
}

export function requestIdFrom(request: Request): string {
  return request.headers.get('x-rir-request-id') || crypto.randomUUID();
}

export function shortId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function routePath(request: Request): string {
  return new URL(request.url).pathname;
}

function writeLog(level: 'info' | 'warn' | 'error', event: string, fields?: LogFields): void {
  const cleaned = stripUndefined(fields) ?? {};
  const record = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    message: buildMessage(event, cleaned),
    ...cleaned,
  });

  if (level === 'error') console.error(record);
  else if (level === 'warn') console.warn(record);
  else console.log(record);
}

function buildMessage(event: string, fields: LogFields): string {
  const explicit = fields.message;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;

  const parts = Object.entries(fields)
    .filter(([key]) => key !== 'message')
    .map(([key, value]) => `${key}=${formatValue(value)}`);

  return parts.length > 0 ? `${event} ${parts.join(' ')}` : event;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stripUndefined(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
