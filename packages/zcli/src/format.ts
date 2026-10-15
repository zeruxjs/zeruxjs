export function stripTerminalCodes(text:string):string{return text.replace(/\x1b\[[0-9;]*m/g,'');}
export function formatError(error:unknown) {return error instanceof Error ? `${error.name}: ${error.message}` : String(error);}
