import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import {
  SeverityNumber,
  type Logger as OtelLogger,
} from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { getCorrelationId } from '../common/correlation-id.storage';
import { redactLogLine } from './redact';

const SEVERITY: Record<LogLevel, [SeverityNumber, string]> = {
  verbose: [SeverityNumber.TRACE, 'TRACE'],
  debug: [SeverityNumber.DEBUG, 'DEBUG'],
  log: [SeverityNumber.INFO, 'INFO'],
  warn: [SeverityNumber.WARN, 'WARN'],
  error: [SeverityNumber.ERROR, 'ERROR'],
  fatal: [SeverityNumber.FATAL, 'FATAL'],
};

const RANK: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

let provider: LoggerProvider | undefined;

/**
 * Nest's console logger, plus a copy of each line at or above `minLevel`
 * shipped to PostHog Logs over OTLP. The console output is unchanged, so the
 * host's own log view keeps working; PostHog gets the redacted copy.
 */
export class PostHogLogger extends ConsoleLogger {
  constructor(
    private readonly otel: OtelLogger,
    private readonly minLevel: LogLevel,
  ) {
    super();
  }

  log(message: unknown, ...rest: unknown[]): void {
    super.log(message, ...rest);
    this.ship('log', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    super.warn(message, ...rest);
    this.ship('warn', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...rest);
    this.ship('error', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    super.fatal(message, ...rest);
    this.ship('fatal', message, rest);
  }

  private ship(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (RANK[level] < RANK[this.minLevel]) return;
    try {
      // Nest passes the context last, and for error() a stack before it.
      const context =
        typeof rest[rest.length - 1] === 'string'
          ? (rest[rest.length - 1] as string)
          : undefined;
      const stack =
        level === 'error' && rest.length > 1 && typeof rest[0] === 'string'
          ? rest[0]
          : undefined;
      const text =
        message instanceof Error
          ? `${message.name}: ${message.message}`
          : typeof message === 'string'
            ? message
            : JSON.stringify(message);
      const [severityNumber, severityText] = SEVERITY[level];
      const attributes: Record<string, string> = {};
      if (context) attributes['log.context'] = context;
      const correlationId = getCorrelationId();
      if (correlationId) attributes['correlation_id'] = correlationId;
      const trace =
        stack ?? (message instanceof Error ? message.stack : undefined);
      if (trace) attributes['exception.stacktrace'] = redactLogLine(trace);
      this.otel.emit({
        severityNumber,
        severityText,
        body: redactLogLine(text ?? ''),
        attributes,
      });
    } catch {
      // Shipping a log line must never be the thing that breaks a request.
    }
  }
}

const LEVELS = new Set<string>(['log', 'warn', 'error', 'fatal']);

/**
 * Built from the environment rather than ConfigService because the logger has
 * to exist before Nest does, to catch the bootstrap lines. Returns null when
 * PostHog logs are off, and the app keeps Nest's default logger.
 */
export function createPostHogLogger(
  env: NodeJS.ProcessEnv = process.env,
): PostHogLogger | null {
  const key = env.POSTHOG_KEY?.trim();
  const level = (env.POSTHOG_LOGS_LEVEL ?? 'log').trim();
  if (!key || level === 'off' || !LEVELS.has(level)) return null;
  const host = (env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(
    /\/$/,
    '',
  );

  provider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': env.OTEL_SERVICE_NAME || 'prydd-backend',
      'deployment.environment': env.NODE_ENV || 'development',
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${host}/i/v1/logs`,
          headers: { Authorization: `Bearer ${key}` },
        }),
        scheduledDelayMillis: 5_000,
      }),
    ],
  });
  return new PostHogLogger(
    provider.getLogger('prydd-backend'),
    level as LogLevel,
  );
}

export async function shutdownPostHogLogs(): Promise<void> {
  const running = provider;
  provider = undefined;
  if (running) await running.shutdown().catch(() => undefined);
}
