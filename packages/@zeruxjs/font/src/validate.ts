export function cssToken(value: string): string { if (!value || /[;{}\r\n\\]/.test(value)) throw new TypeError('Invalid CSS token'); return value; }
export function fontUrl(value: string): string { if (!/^(https?:\/\/|\/|\.\/|\.\.\/|data:font\/)/i.test(value) || /["'()\s<>\\]/.test(value) || /^(?:\/\/|\/\\)/.test(value)) throw new TypeError('Invalid font source'); return value; }
export function escapeHtml(value: string): string { return value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;'); }
export function fontFamily(value:string):string { return JSON.stringify(cssToken(value)); }
export function fontFormat(value:string):string { if(!/^[a-z0-9-]+$/i.test(value))throw new TypeError('Invalid font format'); return value; }
