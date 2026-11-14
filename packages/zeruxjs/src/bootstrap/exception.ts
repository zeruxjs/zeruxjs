import { exceptionHandler } from '../exceptions/exception_handler.js';
import type { Logger } from './logger.js';

let registered = false;

/** Install the legacy process-global exception observers once; applications still own shutdown policy.
 * @param {Logger} logger - Framework redacted logger.
 * @returns {void} Registers listeners only on the first call.
 */
export const registerProcessExceptionHandlers = (logger: Logger) => {
  if (registered) {
    return;
  }
  registered = true;

  process.on('uncaughtException', (error) => {
    /** Fixed public-safe summary used for the default process log, excluding raw exception data. */
    const normalized = exceptionHandler(error);
    logger.error(`Uncaught exception (${normalized.status})`, normalized.body);
  });

  process.on('unhandledRejection', (reason) => {
    /** Fixed public-safe summary used for the default process log, excluding raw exception data. */
    const normalized = exceptionHandler(reason);
    logger.error(`Unhandled rejection (${normalized.status})`, normalized.body);
  });
};
