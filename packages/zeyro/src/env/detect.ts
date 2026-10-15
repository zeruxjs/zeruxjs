export function environment() { return { node:typeof process !== 'undefined' && Boolean(process.versions?.node), browser:typeof window !== 'undefined', dom:typeof document !== 'undefined' }; }
