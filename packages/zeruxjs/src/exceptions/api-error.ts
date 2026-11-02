import { HttpError } from './http_error.js';
import { getRequestCorrelation } from '../observability.js';
export const APPLICATION_ERROR_CODES = Object.freeze({400:'BAD_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',405:'METHOD_NOT_ALLOWED',408:'REQUEST_TIMEOUT',409:'CONFLICT',413:'PAYLOAD_TOO_LARGE',415:'UNSUPPORTED_MEDIA_TYPE',422:'VALIDATION_FAILED',429:'RATE_LIMITED',500:'INTERNAL_ERROR',503:'UNAVAILABLE'} as const);
export interface ErrorEnvelope { error:{code:string;message:string;requestId?:string} }
const messages:Record<number,string>={400:'Invalid request',401:'Authentication required',403:'Forbidden',404:'Not found',405:'Method not allowed',408:'Request timeout',409:'Conflict',413:'Payload too large',415:'Unsupported media type',422:'Validation failed',429:'Too many requests',500:'Internal server error',503:'Service unavailable'};
/** Explicit API error; raw cause/details stay internal. Client messages are always fixed. */
export class ApplicationError extends HttpError {
  constructor(status:number,cause?:unknown){if(!Number.isInteger(status)||status<400||status>599)throw new TypeError('Invalid application error status');super(status,messages[status]??'Request failed');if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause});}
}
export function normalizeApiError(error:unknown):{status:number;body:ErrorEnvelope}{
  let status=500;
  if(error instanceof HttpError&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599)status=error.status;
  else if(error&&typeof error==='object'&&'statusCode'in error&&error.statusCode===413)status=413;
  const context=getRequestCorrelation();
  return {status,body:{error:{code:APPLICATION_ERROR_CODES[status as keyof typeof APPLICATION_ERROR_CODES]??(status>=500?'INTERNAL_ERROR':'BAD_REQUEST'),message:messages[status]??(status>=500?'Internal server error':'Request failed'),...(context?{requestId:context.requestId}:{})}}};
}
/** JSON must be explicitly preferred; absent/wildcard Accept preserves legacy response behavior. */
export function acceptsApiError(accept:unknown):boolean{
  if(typeof accept!=='string'||accept.length>4096)return false;
  let json=0,html=0;
  for(const part of accept.split(',').slice(0,32)){const [type,...params]=part.trim().toLowerCase().split(';');const qparam=params.map(p=>p.trim()).find(p=>p.startsWith('q='));const q=qparam?Number(qparam.slice(2)):1;if(!Number.isFinite(q)||q<0||q>1)continue;if(type==='application/json'||type==='application/problem+json')json=Math.max(json,q);if(type==='text/html')html=Math.max(html,q);}
  return json>0&&json>=html;
}
