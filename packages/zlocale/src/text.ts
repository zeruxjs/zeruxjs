import { dataEntries } from "./validation.js";
const MAX_OUTPUT = 1_000_000;
/** Validate plain bounded text. @param value Input. @returns Text. No globals. */
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_OUTPUT)
    throw new TypeError("zlocale: expected bounded text");
  return value;
}
/** Escape HTML text/quoted attribute characters. @param value Plain string. @returns Escaped string; not a URL/HTML sanitizer. No globals. */
export function escapeHtml(value: string): string {
  return text(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
/** Substitute %{name} with own scalar values. @param template Plain template. @param values Own string/finite number values. @returns Plain text, never HTML. No globals. */
export function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  const fields = new Map(dataEntries(values));
  let size = 0;
  const result = text(template).replace(/%\{([^{}]+)\}/g, (_, key: string) => {
    if (!fields.has(key))
      throw new TypeError(`zlocale: missing interpolation value: ${key}`);
    const value = fields.get(key);
    if (
      typeof value !== "string" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      throw new TypeError(
        "zlocale: interpolation values must be text or finite numbers",
      );
    const replacement = String(value);
    size += replacement.length;
    if (size > MAX_OUTPUT)
      throw new RangeError("zlocale: interpolation output limit exceeded");
    return replacement;
  });
  if (result.length > MAX_OUTPUT)
    throw new RangeError("zlocale: interpolation output limit exceeded");
  return result;
}
/** Format %%/%s/%d/%f, optional positions and precision. @param format Plain format. @param args Scalar arguments. @returns Bounded plain text. No globals or locale state. */
export function sprintf(format: string, ...args: (string | number)[]): string {
  const source = text(format);
  if (args.length > 1000)
    throw new RangeError("zlocale: too many sprintf arguments");
  let cursor = 0,
    output = "",
    index = 0,
    mode: "position" | "sequence" | undefined;
  while (index < source.length) {
    const percent = source.indexOf("%", index);
    if (percent < 0) {
      output += source.slice(index);
      break;
    }
    output += source.slice(index, percent);
    const match = /^%(?:([1-9]\d{0,3})\$)?(?:\.(\d{1,2}))?([%sdf])/.exec(
      source.slice(percent),
    );
    if (!match) throw new TypeError("zlocale: unsupported sprintf placeholder");
    index = percent + match[0].length;
    if (match[3] === "%") {
      if (match[1] || match[2])
        throw new TypeError("zlocale: invalid percent placeholder");
      output += "%";
      continue;
    }
    const nextMode = match[1] ? "position" : "sequence";
    if (mode && mode !== nextMode)
      throw new TypeError(
        "zlocale: cannot mix positional and sequential placeholders",
      );
    mode = nextMode;
    const argument = match[1] ? Number(match[1]) - 1 : cursor++;
    if (argument >= args.length)
      throw new TypeError("zlocale: missing sprintf argument");
    const value = args[argument];
    if (
      typeof value !== "string" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      throw new TypeError("zlocale: unsupported sprintf argument");
    let replacement: string;
    if (match[3] === "s") {
      replacement = String(value);
      if (match[2] !== undefined)
        replacement = replacement.slice(0, Number(match[2]));
    } else {
      if (typeof value !== "number")
        throw new TypeError("zlocale: numeric placeholder requires number");
      replacement =
        match[3] === "d"
          ? String(Math.trunc(value))
          : value.toFixed(match[2] === undefined ? 6 : Number(match[2]));
    }
    if (output.length + replacement.length > MAX_OUTPUT)
      throw new RangeError("zlocale: sprintf output limit exceeded");
    output += replacement;
  }
  if (output.length > MAX_OUTPUT)
    throw new RangeError("zlocale: sprintf output limit exceeded");
  return output;
}
