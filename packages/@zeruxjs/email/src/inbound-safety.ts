/** Advisory inbound-mail analysis. This is NOT a malware scanner, spam filter, or proof of SPF/DKIM/DMARC. */
export type InboundRisk = 'low' | 'review' | 'high';
export type InboundSafetyFlag =
  | 'active_html'
  | 'unsafe_url'
  | 'remote_content'
  | 'suspicious_link'
  | 'executable_attachment'
  | 'macro_attachment'
  | 'encrypted_archive'
  | 'oversized_attachment'
  | 'possible_spam'
  | 'missing_sender'
  | 'header_control_characters'
  | 'body_truncated'
  | 'attachment_content_omitted'
  | 'external_spam'
  | 'external_phishing'
  | 'external_malware'
  | 'external_review'
  | 'attachment_scanner_blocked'
  | 'attachment_scanner_suspicious';
export interface InboundSafety {
  /** Deterministic advisory score; NOT a calibrated probability. */
  score: number;
  /** Fixed local low/review/high label; not malware certification or delivery evidence. */
  risk: InboundRisk;
  /** Sorted fixed advisory labels; no source content or URLs are returned. */
  flags: InboundSafetyFlag[];
  /** Authentication claims inside received headers are never trusted here. */
  authentication: 'unverified';
  /** Fixed heuristic coverage identity zerux-heuristic-v1. */
  engine: 'zerux-heuristic-v1';
  /** Optional trusted host scanner observation; it does not authenticate sender headers. */
  externalVerdict?: 'clean' | 'spam' | 'phishing' | 'malware' | 'review';
}
export interface InboundSafetyInput {
  /** Untrusted subject used only for bounded lexical signals; never executed. */
  subject?: string;
  /** Untrusted sender mailbox claims; presence is not authentication. */
  from?: string[];
  /** Untrusted raw markup scanned lexically up to the documented text bound. */
  html?: string;
  /** Bounded untrusted body/anchor display text; never evaluated. */
  text?: string;
  /** Untrusted filename/size/type metadata; no attachment binary is executed or fetched. */
  attachments?: {
    /** Untrusted literal filename inspected for advisory executable/macro extensions. */
    filename?: string; /** Recorded attachment size for the eight-MiB advisory threshold, not enforcement. */
    size?: number; /** Untrusted MIME label; this heuristic does not verify binary format. */
    contentType?: string;
  }[];
  /** Explicit coverage flag propagated when message text was clipped. */
  bodyTruncated?: boolean;
  /** Explicit coverage flag when attachment bytes were not exposed. */
  attachmentContentOmitted?: boolean;
  /** Optional trusted host scanner observation; it does not authenticate sender headers. */
  externalVerdict?: InboundSafety['externalVerdict'];
  /** Explicit host scanner observations; arbitrary message claims cannot supply trusted results. */
  attachmentVerdicts?: Array<'clean' | 'suspicious' | 'blocked' | 'unscanned'>;
}
/** Fixed additive advisory weights; not calibrated malware probabilities. */
const risks: Record<InboundSafetyFlag, number> = {
  active_html: 35,
  unsafe_url: 40,
  remote_content: 8,
  suspicious_link: 30,
  executable_attachment: 60,
  macro_attachment: 40,
  encrypted_archive: 16,
  oversized_attachment: 15,
  possible_spam: 15,
  missing_sender: 15,
  header_control_characters: 15,
  body_truncated: 5,
  attachment_content_omitted: 5,
  external_spam: 45,
  external_phishing: 75,
  external_malware: 100,
  external_review: 20,
  attachment_scanner_blocked: 95,
  attachment_scanner_suspicious: 50,
};
/** Inspect at most 1 MiB of UTF-16 text with bounded tag/anchor fragments; this lexical advisory never executes or sanitizes HTML.
 * @param {string} raw - Untrusted HTML inspected as inert bounded text, never source code.
 * @param {Set<InboundSafetyFlag>} flags - Owned fixed-label flag set for this one inspection.
 * @returns {void} Adds only fixed local heuristic flags; no URL fetch, authentication or malware verdict.
 */
function inspectMarkup(raw: string, flags: Set<InboundSafetyFlag>): void {
  /** Clipped UTF-16 markup text; truncation is reported without fetching/executing its contents. */
  const html = raw.slice(0, 1024 * 1024);
  if (html.length !== raw.length) {
    flags.add('body_truncated');
  }
  if (/data\s*:\s*text\/html/i.test(html)) {
    flags.add('active_html');
  }
  /** Fixed markup names flagged as potentially active; not a complete HTML sanitizer. */
  const active = new Set([
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'svg',
    'base',
    'meta',
    'link',
  ]);
  let index = 0,
    anchor:
      | {
          /** Literal link target retained only within bounded local comparison. */
          href: string; /** Bounded untrusted body/anchor display text; never evaluated. */
          text: string;
        }
      | undefined;
  /** Compare an apparent displayed host to its literal target under bounded anchor text.

 * @returns {void} Adds a fixed suspicious/unsafe label only; performs no network lookup. */
  const compare = () => {
    if (!anchor) {
      return;
    }
    try {
      /** Parsed literal target hostname; URL parsing is not provider/authentication proof. */
      const actual = new URL(anchor.href).hostname.toLowerCase();
      // Compare only bounded apparent URL words; no DNS lookup or content fetch occurs.
      for (const word of anchor.text.split(/\s+/)) {
        if (word.length > 2048) {
          continue;
        }
        let start = 0,
          end = word.length;
        // Trim leading punctuation with a single monotonic pass over this bounded word.
        while (
          start < end &&
          word[start] !== undefined &&
          !/[a-z0-9]/i.test(word[start]!)
        ) {
          start++;
        }
        // Trim trailing punctuation without backtracking or evaluating text.
        while (
          end > start &&
          word[end - 1] !== undefined &&
          !/[a-z0-9]/i.test(word[end - 1]!)
        ) {
          end--;
        }
        /** Trimmed bounded apparent displayed-host word or literal attribute value. */
        const value = word.slice(start, end);
        if (!value.includes('.')) {
          continue;
        }
        try {
          /** Parsed apparent display hostname; differing literal hosts produce only an advisory. */
          const shown = new URL(
            /^https?:\/\//i.test(value) ? value : 'https://' + value
          ).hostname.toLowerCase();
          if (!/^[a-z0-9.-]+$/.test(shown)) {
            continue;
          }
          if (actual !== shown && !actual.endsWith('.' + shown)) {
            flags.add('suspicious_link');
          }
          break;
        } catch {
          /* Not an apparent URL in the display text. */
        }
      }
    } catch {
      flags.add('unsafe_url');
    }
  };
  // Advance across the clipped markup once per lexical tag; oversized tags report lost coverage.
  while (index < html.length) {
    /** Next lexical opening marker; absence ends this bounded text scan. */
    const open = html.indexOf('<', index);
    if (open < 0) {
      if (anchor) {
        anchor.text += html.slice(index, index + 8192 - anchor.text.length);
      }
      break;
    }
    if (anchor && anchor.text.length < 8192) {
      anchor.text += html.slice(
        index,
        Math.min(open, index + 8192 - anchor.text.length)
      );
    }
    /** Next lexical closing marker; incomplete tags stop scanning without evaluating input. */
    const close = html.indexOf('>', open + 1);
    if (close < 0) {
      break;
    }
    /** Last opening marker through the closing marker, bounded before attribute parsing. */
    const tag = html.slice(html.lastIndexOf('<', close - 1) + 1, close);
    index = close + 1;
    if (tag.length > 8192) {
      flags.add('body_truncated');
      continue;
    }
    /** Literal lexical tag-name match; not a browser parser result. */
    const name = /^\s*(\/?)([a-z][a-z0-9]*)\b/i.exec(tag);
    if (!name) {
      continue;
    }
    /** Lower-level tag name captured from the bounded HTML fragment. */
    const tagName = name[2];
    if (!tagName) {
      continue;
    }
    /** Lowercase lexical tag name checked only against fixed advisory sets. */
    const element = tagName.toLowerCase();
    if (name[1]) {
      if (element === 'a') {
        compare();
        anchor = undefined;
      }
      continue;
    }
    if (active.has(element)) {
      flags.add('active_html');
    }
    /** Sticky lexical attribute matcher constrained to the current bounded tag. */
    const attrs = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
    let cursor = name[0].length,
      href: string | undefined;
    // Keep each sticky attribute attempt within the current bounded tag fragment.
    while (cursor < tag.length) {
      /** Current tag character used to detect attribute whitespace. */
      const character = tag[cursor];
      if (character !== undefined && /\s/.test(character)) {
        cursor++;
        continue;
      }
      attrs.lastIndex = cursor;
      /** One sticky literal attribute match; no attribute value is executed. */
      const attr = attrs.exec(tag);
      if (!attr) {
        cursor++;
        continue;
      }
      cursor = attrs.lastIndex;
      /** Lowercase literal attribute name checked against fixed URL/handler rules. */
      const rawKey = attr[1];
      if (!rawKey) {
        continue;
      }
      /** Lowercase attribute key used by the safety allowlist. */
      const key = rawKey.toLowerCase();
      /** Trimmed bounded apparent displayed-host word or literal attribute value. */
      const value = (attr[2] ?? attr[3] ?? attr[4] ?? '').trim();
      if (key.startsWith('on') && key.length > 2) {
        flags.add('active_html');
      }
      if (
        ['href', 'src'].includes(key) &&
        /^(?:javascript|data|vbscript|file):/i.test(value)
      ) {
        flags.add('unsafe_url');
      }
      if (
        ['img', 'video', 'audio'].includes(element) &&
        ['src', 'poster'].includes(key) &&
        /^https?:/i.test(value)
      ) {
        flags.add('remote_content');
      }
      if (element === 'a' && key === 'href' && /^https?:\/\//i.test(value)) {
        href = value;
      }
    }
    if (element === 'a' && href) {
      compare();
      anchor = { href, text: '' };
    }
  }
  compare();
}
/** Combine offline lexical/file-name signals and explicitly injected scanner verdicts without claiming a calibrated security score.
 * @param {InboundSafetyInput} input - Parsed bounded metadata; callers still enforce aggregate message/attachment limits.
 * @returns {InboundSafety} Deterministic advisory flags/score with authentication always unverified.
 */
export function inspectInboundSafety(input: InboundSafetyInput): InboundSafety {
  /** Per-inspection fixed-label set; does not retain message body or literal URLs. */
  const flags = new Set<InboundSafetyFlag>();
  inspectMarkup(input.html ?? '', flags);
  if (!(input.from ?? []).length) {
    flags.add('missing_sender');
  }
  if (
    /[\r\n\0]/.test(input.subject ?? '') ||
    (input.from ?? []).some((s) => /[\r\n\0]/.test(s))
  ) {
    flags.add('header_control_characters');
  }
  if (
    /(?:urgent.{0,30}verify|verify.{0,30}password|claim.{0,20}prize|wire transfer.{0,20}urgent)/i.test(
      `${input.subject ?? ''} ${input.text?.slice(0, 2000) ?? ''}`
    )
  ) {
    flags.add('possible_spam');
  }
  // Inspect metadata only; no executable attachment bytes or archive contents are opened.
  for (const attachment of input.attachments ?? []) {
    /** Untrusted literal attachment filename used only for fixed extension advisories. */
    const name = attachment.filename ?? '';
    if (
      /\.(exe|scr|com|bat|cmd|ps1|vbs|js|jse|wsf|hta|msi|dll|lnk|jar|sh)$/i.test(
        name
      )
    ) {
      flags.add('executable_attachment');
    }
    if (/\.(docm|xlsm|pptm|xlam)$/i.test(name)) {
      flags.add('macro_attachment');
    }
    if (
      /\.(7z|zip|rar|pdf)$/i.test(name) &&
      /password|encrypted/i.test(`${input.subject ?? ''} ${name}`)
    ) {
      flags.add('encrypted_archive');
    }
    if ((attachment.size ?? 0) > 8 * 1024 * 1024) {
      flags.add('oversized_attachment');
    }
  }
  if (input.externalVerdict && input.externalVerdict !== 'clean') {
    flags.add(
      (
        {
          spam: 'external_spam',
          phishing: 'external_phishing',
          malware: 'external_malware',
          review: 'external_review',
        } as const
      )[input.externalVerdict]
    );
  }
  if (input.attachmentVerdicts?.includes('blocked')) {
    flags.add('attachment_scanner_blocked');
  }
  if (input.attachmentVerdicts?.includes('suspicious')) {
    flags.add('attachment_scanner_suspicious');
  }
  if (input.bodyTruncated) {
    flags.add('body_truncated');
  }
  if (input.attachmentContentOmitted) {
    flags.add('attachment_content_omitted');
  }
  /** Capped sum of local advisory weights; never a calibrated risk probability. */
  const score = Math.min(
    100,
    [...flags].reduce((sum, flag) => sum + risks[flag], 0)
  );
  return {
    score,
    risk: (() => {
      if (score >= 60) {
        return 'high';
      }
      if (score >= 20) {
        return 'review';
      }
      return 'low';
    })(),
    flags: [...flags].sort(),
    authentication: 'unverified',
    engine: 'zerux-heuristic-v1',
    ...(input.externalVerdict
      ? { externalVerdict: input.externalVerdict }
      : {}),
  };
}
