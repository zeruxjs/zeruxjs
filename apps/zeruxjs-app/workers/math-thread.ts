interface MathThreadPayload {
  value?: number;
}

export default function mathThread(payload: MathThreadPayload) {
  const value = Number.isFinite(payload.value) ? Number(payload.value) : 0;

  return {
    value,
    squared: value * value,
    pid: process.pid
  };
}
