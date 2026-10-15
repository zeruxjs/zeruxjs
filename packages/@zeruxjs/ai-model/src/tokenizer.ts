export function tokenize(text:string):string[]{return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[];}
