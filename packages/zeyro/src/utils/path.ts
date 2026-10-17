export function normalizedRelativePath(path:string) {return path.replace(/\\/g,'/').replace(/^\.\//,'');}
// eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation or output sanitization.
export function globRegex(glob:string):RegExp { const escaped=glob.replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*\*\//g,'\u0000').replace(/\*\*/g,'\u0001').replace(/\*/g,'[^/]*').replace(/\u0000/g,'(?:.*/)?').replace(/\u0001/g,'.*');return new RegExp(`^${escaped}$`); }
