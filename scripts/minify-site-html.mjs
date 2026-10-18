/** Compact structural HTML without changing attribute values or whitespace-sensitive content.
 * @param {string} html Rendered, trusted HTML. @returns {string} Compact HTML.
 * Script/style/pre/textarea payloads remain byte-for-byte intact. No globals or I/O.
 */
export function minifySiteHtml(html) {
  const tokens =
    html.match(
      /<(pre|textarea|script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</gi,
    ) ?? [];
  return tokens
    .map((token) => {
      if (/^<(pre|textarea|script|style)\b/i.test(token)) return token;
      if (token.startsWith("<!--"))
        return /^<!--\s*(?:\[if|!)/i.test(token) ? token : "";
      if (!token.startsWith("<")) return token.replace(/\s+/g, " ");
      let quote = "",
        space = false,
        result = "";
      for (const character of token) {
        if (quote) {
          result += character;
          if (character === quote) quote = "";
          continue;
        }
        if (character === '"' || character === "'") {
          if (space) result += " ";
          space = false;
          quote = character;
          result += character;
        } else if (/\s/.test(character)) space = true;
        else {
          if (space && character !== ">" && character !== "/") result += " ";
          space = false;
          result += character;
        }
      }
      return result;
    })
    .join("")
    .trim();
}
