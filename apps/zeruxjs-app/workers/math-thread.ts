interface MathThreadPayload {
  /** Optional fixed-calculation numeric input; nonfinite values use zero. */
  value?: number;
}

/** Run the fixed authored calculation inside the framework-owned worker thread.
 * @param {MathThreadPayload} payload - Optional finite number; no source text, module path or command is accepted.
 * @returns {object} Input, square and actual worker process ID; invalid numeric input uses zero.
 */
export default function mathThread(payload: MathThreadPayload) {
  /** Finite scalar chosen before the fixed multiplication; never evaluated as code. */
  const value = Number.isFinite(payload.value) ? Number(payload.value) : 0;

  return {
    value,
    squared: value * value,
    pid: process.pid,
  };
}
