export function normalizedRelativePath(path:string) {return path.replace(/\\/g,'/').replace(/^\.\//,'');}
export function globRegex(glob:string):RegExp { const escaped=glob.replace(/[|\\{}()[\]^$+?.]/g,'\\$&').replace(/\*\*\//g,'\u0000').replace(/\*\*/g,'\u0001').replace(/\*/g,'[^/]*').replace(/\u0000/g,'(?:.*/)?').replace(/\u0001/g,'.*');return new RegExp(`^${escaped}$`); }
