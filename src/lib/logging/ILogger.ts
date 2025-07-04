export interface LogContext {
  [key: string]: string | number | boolean | undefined;
  userId?: string;
  requestId?: string;
  operation?: string;
  duration?: number;
  success?: boolean;
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  levelName: string;
  message: string;
  context: LogContext;
  service: string;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  fatal(message: string, error?: Error, context?: LogContext): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

export interface LogOutput {
  write(entry: LogEntry): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface LoggerConfig {
  level: LogLevel;
  service: string;
  outputs: LogOutput[];
  includeTimestamp?: boolean;
  includeLevel?: boolean;
  includeService?: boolean;
}
