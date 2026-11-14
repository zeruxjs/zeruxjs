import type { EmailTemplate } from './types.js';
import { escapeHtml } from './html.js';
/** Read a supported own-property placeholder path without evaluating source code.
 * @param {string} path - Supported dot-separated placeholder path.
 * @param {Record<string, unknown>} data - Trusted own-property data; getters/toString can run and are not isolated.
 * @returns {string} Scalar text, or empty for missing/object values; trusted getters are not sandboxed.
 */
function replacement(path: string, data: Record<string, unknown>) {
  let value: unknown = data;
  // Traverse only supported own-property segments; never compile placeholder text.
  for (const key of path.split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new TypeError('Forbidden placeholder');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, key)
    ) {
      value = '';
      break;
    }
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value === 'object') {
    return '';
  }
  return String(value ?? '');
}
/** Replace supported placeholders with scalar data and optional HTML escaping.
 * @param {string} template - Authored registry template or bounded interpolation text.
 * @param {Record<string, unknown>} data - Trusted own-property data; getters/toString can run and are not isolated.
 * @param {boolean} html - Escape substituted values for HTML when true; default false.
 * @returns {string} Rendered text; HTML mode escapes placeholder values only.
 */
export function interpolateTemplate(
  template: string,
  data: Record<string, unknown>,
  html = false
): string {
  if (typeof template !== 'string' || template.length > 1_000_000) {
    throw new RangeError('Invalid template length');
  }
  return template.replace(
    /\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_]\w*)*)\s*\}\}/g,
    (_match, key: string) => {
      /** Scalar placeholder value encoded only when HTML interpolation is requested. */
      const value = replacement(key, data);
      return html ? escapeHtml(value) : value;
    }
  );
}
/** Validate registry identity, subject and at least one authored body.
 * @param {EmailTemplate} template - Authored registry template or bounded interpolation text.
 * @returns {void} Malformed template rejects before that template is stored.
 */
function validate(template: EmailTemplate) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_:-]{0,99}$/.test(template.id) ||
    !template.subject ||
    template.subject.length > 998 ||
    (!template.html && !template.text)
  ) {
    throw new TypeError('Invalid email template');
  }
}
/** Create a process-local inert template catalog with detached stored values.
 * @param {EmailTemplate[]} initial - Initial authored templates, default empty.
 * @returns {EmailTemplateRegistry} Registry with explicit mutation; initial duplicates reject.
 */
export function createTemplateRegistry(initial: EmailTemplate[] = []) {
  /** Instance-local detached authored catalog; no code is compiled or executed. */
  const templates = new Map<string, EmailTemplate>();
  /** Explicit local template registry; mutation does not imply durable revisions. */
  const api = {
    /** Store one detached template while rejecting duplicate identities.
     * @param {EmailTemplate} template - Authored registry template or bounded interpolation text.
     * @returns {void} New template registered in this instance.
     */
    register(template: EmailTemplate) {
      validate(template);
      if (templates.has(template.id)) {
        throw new Error(`Template exists: ${template.id}`);
      }
      templates.set(template.id, structuredClone(template));
    },
    /** Replace one template explicitly after validation.
     * @param {EmailTemplate} template - Authored registry template or bounded interpolation text.
     * @returns {void} Detached replacement stored without distributed revision semantics.
     */
    set(template: EmailTemplate) {
      validate(template);
      templates.set(template.id, structuredClone(template));
    },
    /** Return a detached template without exposing internal mutable state.
     * @param {string} id - Explicit registered template identity.
     * @returns {EmailTemplate | undefined} Stored template clone, or undefined.
     */
    get(id: string) {
      /** Stored private template returned only as a detached clone. */
      const result = templates.get(id);
      return result ? structuredClone(result) : undefined;
    },
    /** Remove a template from this local registry.
     * @param {string} id - Explicit registered template identity.
     * @returns {boolean} True only if an existing template was removed.
     */
    delete(id: string) {
      return templates.delete(id);
    },
    /** Return detached templates in insertion order.
     * @returns {EmailTemplate[]} Private authored template copies.
     */
    list() {
      return Array.from(templates.values(), (t) => structuredClone(t));
    },
    /** Render scalar placeholders; body HTML remains authored template content.
     * @param {string} id - Explicit registered template identity.
     * @param {Record<string, unknown>} data - Trusted own-property data; getters/toString can run and are not isolated.
     * @returns {{subject: string, html: string | undefined, text: string | undefined, layout: EmailTemplate["layout"]}} Rendered subject/body/layout; transport validation and sanitization are separate.
     */
    render(id: string, data: Record<string, unknown> = {}) {
      /** Registered authored template looked up before interpolation; unknown IDs reject. */
      const template = templates.get(id);
      if (!template) {
        throw new Error(`Unknown email template: ${id}`);
      }
      return {
        subject: interpolateTemplate(template.subject, data),
        html:
          template.html === undefined
            ? undefined
            : interpolateTemplate(template.html, data, true),
        text:
          template.text === undefined
            ? undefined
            : interpolateTemplate(template.text, data),
        layout: template.layout,
      };
    },
  };
  // Register in authored order while preserving duplicate rejection.
  for (const template of initial) {
    api.register(template);
  }
  return api;
}
export type EmailTemplateRegistry = ReturnType<typeof createTemplateRegistry>;
