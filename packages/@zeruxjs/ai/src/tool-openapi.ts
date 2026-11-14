import { snapshotToolJson } from './tools.js';
/** Inert approved operation descriptor; binding an executable handler is a separate host step. */
export interface ApprovedToolOperation {
  /** Unique public operation identifier, validated across this import. */
  operationId: string;
  /** Uppercase allowlisted HTTP verb; no request is executed by this descriptor. */
  method: string;
  /** Literal absolute path without query, traversal, references or path parameters. */
  path: string;
  /** Bounded public text, never HTML or executable instructions. */
  description: string;
  /** Detached bounded object schema; execution still needs a real host validator. */
  inputSchema: Record<string, unknown>;
}
/**
 * Stage explicitly approved operations from a trusted in-memory OpenAPI subset.
 * @param {unknown} document - Host-loaded OpenAPI 3.0.3 or 3.1.0 inert JSON document.
 * @param {object} policy - Explicit trust assertion and synchronous per-operation approval.
 * @param {true} policy.trusted - Host assertion of provenance, not authentication of uploads.
 * @param {(operation: Readonly<ApprovedToolOperation>) => boolean} policy.approve - Pure synchronous approval; receives a detached schema.
 * @returns {readonly ApprovedToolOperation[]} Complete approved set; no registration or requests occur.
 * @throws {TypeError} On unsupported document/path/schema, duplicates, budgets or async approval.
 */
export function approvedOpenApiToolOperations(
  document: unknown,
  policy: {
    /** Required host provenance assertion; does not verify an uploaded document. */
    trusted: true;
    /**
     * Approve this descriptor without registering or executing it.
     * @param {Readonly<ApprovedToolOperation>} operation - Detached candidate with inert schema.
     * @returns {boolean} Explicit synchronous allow/deny decision.
     */
    approve(operation: Readonly<ApprovedToolOperation>): boolean;
  }
): readonly ApprovedToolOperation[] {
  if (policy?.trusted !== true || typeof policy.approve !== 'function') {
    throw new TypeError(
      'Trusted source and explicit operation approval required'
    );
  }
  /** Detached, bounded document snapshot; source trust is asserted separately by the host. */
  const doc = snapshotToolJson(document, 1048576) as any;
  if (
    !doc ||
    !['3.0.3', '3.1.0'].includes(doc.openapi) ||
    !doc.paths ||
    typeof doc.paths !== 'object' ||
    Array.isArray(doc.paths)
  ) {
    throw new TypeError('Unsupported OpenAPI document');
  }
  /** Staged approved descriptors; no caller-visible registry is mutated during validation. */
  const approved: ApprovedToolOperation[] = [];
  /** Operation identity set rejects duplicates across the complete imported document. */
  const names = new Set<string>();
  let count = 0;
  // Validate every path before returning any descriptor; partial imports never escape.
  for (const [path, item] of Object.entries(doc.paths)) {
    if (
      !path.startsWith('/') ||
      path.length > 512 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
      /[\x00-\x20\\?#]/.test(path) ||
      path.includes('..') ||
      /[{}]/.test(path) ||
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item)
    ) {
      throw new TypeError('Invalid operation path');
    }
    if (Object.hasOwn(item, '$ref') || Object.hasOwn(item, 'parameters')) {
      throw new TypeError('Unsupported path parameters/reference');
    }
    // Inspect only supported methods, counting denied operations toward the work budget.
    for (const [verb, raw] of Object.entries(item)) {
      if (
        !['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(
          verb
        )
      ) {
        continue;
      }
      if (++count > 128) {
        throw new TypeError('OpenAPI operation budget exceeded');
      }
      /** Current operation data, already detached from accessors by the JSON snapshot. */
      const value = raw as any;
      if (
        !value ||
        typeof value.operationId !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value.operationId) ||
        names.has(value.operationId) ||
        value.parameters !== undefined ||
        value.$ref ||
        value.requestBody?.$ref ||
        (value.requestBody !== undefined &&
          !value.requestBody?.content?.['application/json']?.schema)
      ) {
        throw new TypeError('Unsupported operation');
      }
      names.add(value.operationId);
      /** Explicit JSON object schema, or an empty object contract for bodyless operations. */
      const schema = value.requestBody?.content?.['application/json']
        ?.schema ?? { type: 'object', properties: {} };
      /** Inert schema text used only to detect unsupported reference keywords. */
      const serialized = JSON.stringify(schema);
      if (
        /"\$(?:ref|dynamicRef)"\s*:/.test(serialized) ||
        schema.type !== 'object'
      ) {
        throw new TypeError('Unsupported operation schema');
      }
      /** Public inert description; the first provided summary/description takes precedence. */
      const description =
        value.summary ?? value.description ?? value.operationId;
      if (typeof description !== 'string' || description.length > 1024) {
        throw new TypeError('Invalid operation description');
      }
      /** Candidate descriptor retained only after a synchronous host approval decision. */
      const operation = {
        operationId: value.operationId,
        method: verb.toUpperCase(),
        path,
        description,
        inputSchema: snapshotToolJson(schema, 65536) as Record<string, unknown>,
      };
      /** Host policy result; asynchronous approval is rejected rather than treated as truthy. */
      const decision: unknown = policy.approve(
        Object.freeze({
          ...operation,
          inputSchema: snapshotToolJson(schema, 65536) as Record<
            string,
            unknown
          >,
        })
      );
      if (
        decision &&
        typeof (decision as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(decision).catch(() => {});
      }
      if (decision !== true && decision !== false) {
        throw new TypeError('Approval must be synchronous');
      }
      if (decision) {
        approved.push(operation);
      }
    }
  }
  return approved;
}
