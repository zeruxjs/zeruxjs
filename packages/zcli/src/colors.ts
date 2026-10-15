/** ANSI colors without external dependencies. Honors NO_COLOR and non-TTY output. */
type Color = ((value: unknown) => string) & {bold:Color;yellow:Color;green:Color;red:Color;cyan:Color;blue:Color;dim:Color};
function enabled() { return !process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout.isTTY)); }
function format(code:string) {
  const call = ((value:unknown) => enabled()?`\x1b[${code}m${String(value)}\x1b[0m`:String(value)) as Color;
  Object.defineProperties(call, {
    bold:{get:()=>format(code==='0'?'1':`1;${code}`)},
    yellow:{get:()=>format(`33;${code}`)},green:{get:()=>format(`32;${code}`)},red:{get:()=>format(`31;${code}`)},
    cyan:{get:()=>format(`36;${code}`)},blue:{get:()=>format(`34;${code}`)},dim:{get:()=>format(`2;${code}`)}
  });
  return call;
}
export const color = format('0');
