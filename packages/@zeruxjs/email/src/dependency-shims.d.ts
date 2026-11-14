declare module 'nodemailer' {
  /** Minimal upstream SMTP type shim; actual runtime validation/lifecycle stay in the manager. */
  const client: {
    /** Minimal package-consumed native SMTP construction contract, not a full SDK declaration.
     * @param {Record<string, unknown>} options - Validated private native transport settings; secrets remain server-owned.
     * @returns {object} Native send/verify/close handle; runtime ownership follows the account policy.
     */
    createTransport(options: Record<string, unknown>): {
      /** Minimal native submission surface used by the manager; returned details remain private.
       * @param {Record<string, unknown>} message - Allowlisted envelope/body/attachment payload.
       * @returns {Promise<{messageId?: string, accepted?: unknown[], rejected?: unknown[], response?: string}>} Native envelope report; fulfillment is not inbox delivery.
       */
      sendMail(message: Record<string, unknown>): Promise<{
        /** Private native message identity; not evidence of delivery. */
        messageId?: string;
        /** Private native accepted envelope values requiring classification. */
        accepted?: unknown[];
        /** Private native rejected envelope values requiring classification. */
        rejected?: unknown[];
        /** Private raw SMTP response; never sanitized public telemetry. */
        response?: string;
      }>;
      /** Observe native readiness without submitting a message.
       * @returns {Promise<boolean>} Native readiness result; does not prove later send success.
       */
      verify(): Promise<boolean>;
      /** Release the actual manager-owned native transport.
       * @returns {void} Native synchronous close request; borrowed handles are preserved.
       */
      close(): void;
    };
  };
  export default client;
}
declare module 'juice' {
  /** Minimal maintained CSS-inliner signature; input/output are markup data, not server code. */
  const juice: (html: string, options?: Record<string, unknown>) => string;
  export default juice;
}
declare module 'sanitize-html' {
  /** Minimal maintained HTML-sanitizer signature; explicit policy is supplied by html.ts. */
  const sanitize: (html: string, options?: Record<string, unknown>) => string;
  export default sanitize;
}
declare module 'html-to-text' {
  /** Minimal maintained plain-text conversion surface used by email rendering.
   * @param {string} html - Authored private HTML to convert as data.
   * @param {Record<string, unknown>} options - Explicit supported converter settings.
   * @returns {string} Converted plain text; no remote request is implied.
   */
  export function convert(
    html: string,
    options?: Record<string, unknown>
  ): string;
}
declare module 'imapflow' {
  /** Minimal upstream native IMAP constructor; its any surface is validated by the owning receiver. */
  export const ImapFlow: new (options: any) => any;
}
declare module 'node-pop3' {
  /** Minimal upstream POP3 constructor; host endpoint/auth policy remains receiver-owned. */
  const Pop3Command: new (options: any) => any;
  export default Pop3Command;
}
declare module 'mailparser' {
  /** Minimal maintained MIME-parser signature; raw bytes remain untrusted data under receiver limits. */
  export const simpleParser: (raw: Buffer) => Promise<any>;
}
