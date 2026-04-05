import { exceptionHandler } from "../exceptions/exception_handler.js";
import type { Logger } from "./logger.js";

let registered = false;

export const registerProcessExceptionHandlers = (logger: Logger) => {
    if (registered) return;
    registered = true;

    process.on("uncaughtException", (error) => {
        const normalized = exceptionHandler(error);
        logger.error(`Uncaught exception (${normalized.status})`, normalized.body);
    });

    process.on("unhandledRejection", (reason) => {
        const normalized = exceptionHandler(reason);
        logger.error(`Unhandled rejection (${normalized.status})`, normalized.body);
    });
};
