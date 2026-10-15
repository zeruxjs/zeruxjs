export function tokenize(value: string): string[] { return value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
