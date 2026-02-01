import pino from 'pino';
import { config } from './config.js';
import { getCorrelationId } from './middleware/correlation.js';

const baseLogger = pino({
  level: config.logLevel,
  transport: config.isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      }
    : undefined,
});

export const logger = new Proxy(baseLogger, {
  get(target, prop) {
    const value = target[prop as keyof typeof target];
    if (typeof value === 'function' && ['info', 'error', 'warn', 'debug', 'trace', 'fatal'].includes(prop as string)) {
      return (...args: unknown[]) => {
        const correlationId = getCorrelationId();
        if (correlationId) {
          if (typeof args[0] === 'object' && args[0] !== null) {
            args[0] = { ...args[0] as object, correlationId };
          } else if (typeof args[0] === 'string') {
            args.unshift({ correlationId });
          }
        }
        return (value as Function).apply(target, args);
      };
    }
    return value;
  },
});

export function createChildLogger(bindings: Record<string, unknown>) {
  return baseLogger.child(bindings);
}
