/** Compatibility regex exports are shared objects, not immutable policy capabilities.
 * Hosts must bound candidate input and keep arbitrary user-supplied patterns out of configuration; native regex work cannot be force-cancelled by a cooperative deadline.
 * Original expressions, flags, source attribution and diagnostic behavior are retained.
 */
/**
 * [Base64](https://en.wikipedia.org/wiki/Base64) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const BASE64_REGEX: RegExp =
  /^(?:[\da-z+/]{4})*(?:[\da-z+/]{2}==|[\da-z+/]{3}=)?$/iu;

/**
 * [BIC](https://en.wikipedia.org/wiki/ISO_9362) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const BIC_REGEX: RegExp = /^[A-Z]{6}(?!00)[\dA-Z]{2}(?:[\dA-Z]{3})?$/u;

/**
 * [Cuid2](https://github.com/paralleldrive/cuid2) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const CUID2_REGEX: RegExp = /^[a-z][\da-z]*$/u;

/**
 * [Decimal](https://en.wikipedia.org/wiki/Decimal) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
// Compatibility expression; previous external ReDoS lint exclusions are not used here.
export const DECIMAL_REGEX: RegExp = /^[+-]?(?:\d*\.)?\d+$/u;

/**
 * [Digits](https://en.wikipedia.org/wiki/Numerical_digit) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const DIGITS_REGEX: RegExp = /^\d+$/u;

/**
 * [Domain name](https://en.wikipedia.org/wiki/Domain_name) regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * ASCII-only validation. Internationalized domain names (IDNs) are not
 * supported, including Punycode-encoded labels.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const DOMAIN_REGEX: RegExp =
  /^(?=.{1,253}$)(?:(?![Xx][Nn]--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/u;

/**
 * [Email address](https://en.wikipedia.org/wiki/Email_address) regex.
 * Text syntax only, without DNS/SMTP, mailbox verification or full address-standard conformance.
 */
export const EMAIL_REGEX: RegExp =
  /^[\w+-]+(?:\.[\w+-]+)*@[\da-z]+(?:[.-][\da-z]+)*\.[a-z]{2,}$/iu;

/**
 * Emoji regex from [emoji-regex-xs](https://github.com/slevithan/emoji-regex-xs) v1.0.0 (MIT license).
 *
 * Hint: We decided against the newer `/^\p{RGI_Emoji}+$/v` regex because it is
 * not supported in older runtimes and does not match all emoji.
 * Preserve the credited compatibility expression and license; native Unicode property data affects coverage and full RGI parity is not claimed.
 */
export const EMOJI_REGEX: RegExp =
  // Compatibility expression; previous external ReDoS lint exclusions are not used here.
  /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|(?![\p{Emoji_Modifier_Base}\u{1F1E6}-\u{1F1FF}])\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|(?![\p{Emoji_Modifier_Base}\u{1F1E6}-\u{1F1FF}])\p{Emoji_Presentation}))*)+$/u;

/**
 * [Hexadecimal](https://en.wikipedia.org/wiki/Hexadecimal) regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const HEXADECIMAL_REGEX: RegExp = /^(?:0[hx])?[\da-fA-F]+$/u;

/**
 * [Hex color](https://en.wikipedia.org/wiki/Web_colors#Hex_triplet) regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const HEX_COLOR_REGEX: RegExp =
  /^#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/u;

/**
 * [IMEI](https://en.wikipedia.org/wiki/International_Mobile_Equipment_Identity) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const IMEI_REGEX: RegExp = /^\d{15}$|^\d{2}-\d{6}-\d{6}-\d$/u;

/**
 * [IPv4](https://en.wikipedia.org/wiki/IPv4) regex.
 * Address text syntax only; private, loopback and other restricted destinations still require a separate host egress policy.
 */
export const IPV4_REGEX: RegExp =
  // Compatibility expression; previous external ReDoS lint exclusions are not used here.
  /^(?:(?:[1-9]|1\d|2[0-4])?\d|25[0-5])(?:\.(?:(?:[1-9]|1\d|2[0-4])?\d|25[0-5])){3}$/u;

/**
 * [IPv6](https://en.wikipedia.org/wiki/IPv6) regex.
 * Address text syntax only; private, loopback and other restricted destinations still require a separate host egress policy.
 */
export const IPV6_REGEX: RegExp =
  /^(?:(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,7}:|(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,5}(?::[\da-f]{1,4}){1,2}|(?:[\da-f]{1,4}:){1,4}(?::[\da-f]{1,4}){1,3}|(?:[\da-f]{1,4}:){1,3}(?::[\da-f]{1,4}){1,4}|(?:[\da-f]{1,4}:){1,2}(?::[\da-f]{1,4}){1,5}|[\da-f]{1,4}:(?::[\da-f]{1,4}){1,6}|:(?:(?::[\da-f]{1,4}){1,7}|:)|fe80:(?::[\da-f]{0,4}){0,4}%[\da-z]+|::(?:f{4}(?::0{1,4})?:)?(?:(?:25[0-5]|(?:2[0-4]|1?\d)?\d)\.){3}(?:25[0-5]|(?:2[0-4]|1?\d)?\d)|(?:[\da-f]{1,4}:){1,4}:(?:(?:25[0-5]|(?:2[0-4]|1?\d)?\d)\.){3}(?:25[0-5]|(?:2[0-4]|1?\d)?\d))$/iu;

/**
 * [IP](https://en.wikipedia.org/wiki/IP_address) regex.
 * Address text syntax only; private, loopback and other restricted destinations still require a separate host egress policy.
 */
export const IP_REGEX: RegExp =
  /^(?:(?:[1-9]|1\d|2[0-4])?\d|25[0-5])(?:\.(?:(?:[1-9]|1\d|2[0-4])?\d|25[0-5])){3}$|^(?:(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,7}:|(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,5}(?::[\da-f]{1,4}){1,2}|(?:[\da-f]{1,4}:){1,4}(?::[\da-f]{1,4}){1,3}|(?:[\da-f]{1,4}:){1,3}(?::[\da-f]{1,4}){1,4}|(?:[\da-f]{1,4}:){1,2}(?::[\da-f]{1,4}){1,5}|[\da-f]{1,4}:(?::[\da-f]{1,4}){1,6}|:(?:(?::[\da-f]{1,4}){1,7}|:)|fe80:(?::[\da-f]{0,4}){0,4}%[\da-z]+|::(?:f{4}(?::0{1,4})?:)?(?:(?:25[0-5]|(?:2[0-4]|1?\d)?\d)\.){3}(?:25[0-5]|(?:2[0-4]|1?\d)?\d)|(?:[\da-f]{1,4}:){1,4}:(?:(?:25[0-5]|(?:2[0-4]|1?\d)?\d)\.){3}(?:25[0-5]|(?:2[0-4]|1?\d)?\d))$/iu;

/**
 * [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) date regex.
 * Syntactic compatibility ranges only; no calendar/leap-year existence check, zone conversion or Date construction is performed.
 */
export const ISO_DATE_REGEX: RegExp =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:[12]\d|0[1-9]|3[01])$/u;

/**
 * [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) date-time regex.
 * Syntactic compatibility ranges only; no calendar/leap-year existence check, zone conversion or Date construction is performed.
 */
export const ISO_DATE_TIME_REGEX: RegExp =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:[12]\d|0[1-9]|3[01])[T ](?:0\d|1\d|2[0-3]):[0-5]\d$/u;

/**
 * [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) time regex.
 * Syntactic compatibility ranges only; no calendar/leap-year existence check, zone conversion or Date construction is performed.
 */
export const ISO_TIME_REGEX: RegExp = /^(?:0\d|1\d|2[0-3]):[0-5]\d$/u;

/**
 * [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) time with seconds regex.
 * Syntactic compatibility ranges only; no calendar/leap-year existence check, zone conversion or Date construction is performed.
 */
export const ISO_TIME_SECOND_REGEX: RegExp =
  /^(?:0\d|1\d|2[0-3])(?::[0-5]\d){2}$/u;

/**
 * [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) timestamp regex. Allows a
 * space as a date/time separator and an optional space before the UTC offset.
 * Syntactic compatibility ranges only; no calendar/leap-year existence check, zone conversion or Date construction is performed.
 */
export const ISO_TIMESTAMP_REGEX: RegExp =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:[12]\d|0[1-9]|3[01])[T ](?:0\d|1\d|2[0-3])(?::[0-5]\d){2}(?:\.\d{1,9})?(?:Z| ?[+-](?:0\d|1\d|2[0-3])(?::?[0-5]\d)?)$/u;

/**
 * [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) week regex.
 * Syntactic compatibility ranges only; no calendar/leap-year existence check, zone conversion or Date construction is performed.
 */
export const ISO_WEEK_REGEX: RegExp = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/u;

/**
 * [JWS compact serialization](https://datatracker.ietf.org/doc/html/rfc7515#section-3.1)
 * regex.
 *
 * Hint: Empty payload and signature segments are allowed because the
 * Base64URL-encoded representation of an empty octet sequence is an empty
 * string.
 * Text serialization shape only; no key selection, signature verification or token-claim validation occurs.
 */
export const JWS_COMPACT_REGEX: RegExp =
  /^(?:[\w-]{2,3}|(?:[\w-]{4})+(?:[\w-]{2,3})?)\.(?:[\w-]{2,3}|(?:[\w-]{4})+(?:[\w-]{2,3})?)?\.(?:[\w-]{2,3}|(?:[\w-]{4})+(?:[\w-]{2,3})?)?$/u;

/**
 * [ISRC](https://en.wikipedia.org/wiki/International_Standard_Recording_Code) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const ISRC_REGEX: RegExp =
  /^(?:[A-Z]{2}[A-Z\d]{3}\d{7}|[A-Z]{2}-[A-Z\d]{3}-\d{2}-\d{5})$/u;

/**
 * [MAC](https://en.wikipedia.org/wiki/MAC_address) 48 bit regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const MAC48_REGEX: RegExp =
  /^(?:[\da-fA-F]{2}:){5}[\da-fA-F]{2}$|^(?:[\da-fA-F]{2}-){5}[\da-fA-F]{2}$|^(?:[\da-fA-F]{4}\.){2}[\da-fA-F]{4}$/u;

/**
 * [MAC](https://en.wikipedia.org/wiki/MAC_address) 64 bit regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const MAC64_REGEX: RegExp =
  /^(?:[\da-fA-F]{2}:){7}[\da-fA-F]{2}$|^(?:[\da-fA-F]{2}-){7}[\da-fA-F]{2}$|^(?:[\da-fA-F]{4}\.){3}[\da-fA-F]{4}$|^(?:[\da-fA-F]{4}:){3}[\da-fA-F]{4}$/u;

/**
 * [MAC](https://en.wikipedia.org/wiki/MAC_address) regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const MAC_REGEX: RegExp =
  /^(?:[\da-fA-F]{2}:){5}[\da-fA-F]{2}$|^(?:[\da-fA-F]{2}-){5}[\da-fA-F]{2}$|^(?:[\da-fA-F]{4}\.){2}[\da-fA-F]{4}$|^(?:[\da-fA-F]{2}:){7}[\da-fA-F]{2}$|^(?:[\da-fA-F]{2}-){7}[\da-fA-F]{2}$|^(?:[\da-fA-F]{4}\.){3}[\da-fA-F]{4}$|^(?:[\da-fA-F]{4}:){3}[\da-fA-F]{4}$/u;

/**
 * [Nano ID](https://github.com/ai/nanoid) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const NANO_ID_REGEX: RegExp = /^[\w-]+$/u;

/**
 * [Octal](https://en.wikipedia.org/wiki/Octal) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const OCTAL_REGEX: RegExp = /^(?:0o)?[0-7]+$/u;

/**
 * [RFC 5322 email address](https://datatracker.ietf.org/doc/html/rfc5322#section-3.4.1) regex.
 *
 * Hint: This regex was taken from the [HTML Living Standard Specification](https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address) and does not perfectly represent RFC 5322.
 * Text syntax only, without DNS/SMTP, mailbox verification or full address-standard conformance.
 */
export const RFC_EMAIL_REGEX: RegExp =
  // eslint-disable-next-line no-useless-escape -- Preserve the compatibility expression.
  /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * [Slug](https://en.wikipedia.org/wiki/Clean_URL#Slug) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const SLUG_REGEX: RegExp = /^[\da-z]+(?:[-_][\da-z]+)*$/u;

/**
 * [ULID](https://github.com/ulid/spec) regex.
 *
 * Hint: We decided against the `i` flag for better JSON Schema compatibility.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const ULID_REGEX: RegExp = /^[\da-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}$/u;

/**
 * [UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier) regex.
 * Shared mutable compatibility pattern; matching never proves ownership or authorization and does not fetch or execute the candidate text.
 */
export const UUID_REGEX: RegExp =
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
