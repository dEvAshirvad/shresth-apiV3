import * as winston from 'winston';
import env from '@/configs/env';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

const customLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  request: 3,
  info: 4,
  debug: 5,
};

winston.addColors({
  fatal: 'red',
  error: 'red',
  warn: 'yellow',
  request: 'cyan',
  info: 'green',
  debug: 'blue',
});

// Helper function to create level filter
const levelFilter = (level: string) =>
  winston.format((info) => {
    return info.level === level ? info : false;
  })();

const customFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level} ${message}`;
});

// Console format for development (custom format with colors)
const consoleFormat = combine(
  timestamp({
    format: 'DD-MM-YYYY HH:mm:ss',
  }),
  errors({ stack: true }),
  colorize(),
  customFormat
);

// File format (JSON)
const fileFormat = combine(timestamp(), errors({ stack: true }), json());

const logger = winston.createLogger({
  level: env.LOG_LEVEL || 'debug',
  levels: customLevels,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // Fatal logs
    new winston.transports.File({
      filename: 'logs/fatal.log',
      format: combine(levelFilter('fatal'), fileFormat),
    }),
    // Error logs
    new winston.transports.File({
      filename: 'logs/error.log',
      format: combine(levelFilter('error'), fileFormat),
    }),
    // Warn logs
    new winston.transports.File({
      filename: 'logs/warn.log',
      format: combine(levelFilter('warn'), fileFormat),
    }),
    // Info logs
    new winston.transports.File({
      filename: 'logs/info.log',
      format: combine(levelFilter('info'), fileFormat),
    }),
    // Debug logs
    new winston.transports.File({
      filename: 'logs/debug.log',
      format: combine(levelFilter('debug'), fileFormat),
    }),
    // Request logs (only in development)
    ...(env.NODE_ENV === 'development'
      ? [
          new winston.transports.File({
            filename: 'logs/request.log',
            format: combine(levelFilter('request'), fileFormat),
          }),
        ]
      : []),
  ],
  exceptionHandlers: [
    new winston.transports.File({
      filename: 'logs/exceptions.log',
      format: fileFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: 'logs/rejections.log',
      format: fileFormat,
    }),
  ],
});

if (env.NODE_ENV === 'production') {
  logger.clear();
  logger.add(
    new winston.transports.Console({
      format: json(),
    })
  );
}

export default logger;
