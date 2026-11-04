import type {ActionClaim,ActionClaimStatus} from './action-stores.js';
const valid=(claim:ActionClaim)=>claim&&/^[A-Za-z0-9_-]{43}$/.test(claim.key)&&/^[A-Za-z0-9_-]{43}$/.test(claim.digest)&&/^[A-Za-z0-9_-]{32}$/.test(claim.owner)&&Number.isSafeInteger(claim.expiresAt);
export function validateClaimOptions(claim:ActionClaim,signal:AbortSignal,deadline:number){if(!valid(claim)||!(signal instanceof AbortSignal)||!Number.isSafeInteger(deadline)||deadline<=Date.now()||claim.expiresAt<Date.now()||deadline>claim.expiresAt)throw Error('Invalid action claim');signal.throwIfAborted();return {signal,deadline};}
export function claimStatus(value:ActionClaimStatus){if(!['claimed','committed','pending','conflict'].includes(value))throw Error('Invalid journal outcome');return value;}
