const LOG_LEVELS = { none: 0, error: 1, info: 2, debug: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

const log = (level, ...args) => {
  if (LOG_LEVELS[level] <= CURRENT_LOG_LEVEL) {
    console.log(`[${level.toUpperCase()}]`, ...args);
  }
};

module.exports = { log, LOG_LEVELS, CURRENT_LOG_LEVEL };
