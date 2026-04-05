// @ts-check

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ajvSafeParse,
  array,
  arrayAsync,
  boolean,
  check,
  checkAsync,
  decimal,
  digits,
  email,
  endsWith,
  finite,
  hexColor,
  includes,
  integer,
  isValidationError,
  maxLength,
  maxValue,
  minLength,
  minValue,
  multipleOf,
  nonEmpty,
  nonNullable,
  null_,
  number,
  object,
  objectAsync,
  optional,
  parse,
  parseAsync,
  parseBoolean,
  parseJson,
  pipe,
  pipeAsync,
  regex,
  safeInteger,
  safeParse,
  safeParseAsync,
  slug,
  startsWith,
  string,
  toJsonSchema,
  toLowerCase,
  toUpperCase,
  trim,
  trimEnd,
  trimStart,
  union,
  url,
  uuid,
  z,
} from "@zeruxjs/validator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, "index.html");

/**
 * @param {unknown} value
 */
function sanitize(value) {
  return JSON.parse(
    JSON.stringify(
      value,
      (_, current) => {
        if (current instanceof RegExp) return current.toString();
        if (typeof current === "function") return `[Function ${current.name || "anonymous"}]`;
        if (current instanceof Error) {
          return {
            name: current.name,
            message: current.message,
            stack: current.stack,
          };
        }
        return current;
      },
      2
    )
  );
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * @param {unknown} value
 */
function pretty(value) {
  return JSON.stringify(sanitize(value), null, 2);
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function same(left, right) {
  return pretty(left) === pretty(right);
}

/**
 * @param {string} input
 */
function slugify(input) {
  return input.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}

/**
 * @param {unknown} value
 */
function compact(value) {
  const text = pretty(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * @param {unknown} value
 */
function inlineText(value) {
  return compact(value).replaceAll(/\s+/g, " ").trim();
}

/**
 * @param {string} group
 */
function sectionDescription(group) {
  if (group === "Classic API") {
    return "Core valibot-style schemas, action arrays, transforms, primitives, and object or array parsing behavior.";
  }
  if (group === "Chain API") {
    return "Zod-style chain builder coverage including fluent methods, wrappers, composition, and parse ergonomics.";
  }
  if (group === "Async API") {
    return "Async-safe parsing, async checks, and promise-based workflows that should behave the same as sync cases.";
  }
  if (group === "Error DX") {
    return "Thrown exceptions, flatten and format helpers, summaries, and developer-facing error ergonomics.";
  }
  if (group === "JSON Schema") {
    return "Schema export coverage proving the generated JSON Schema mirrors the validator shape and supported constraints.";
  }
  if (group === "AJV Compatible") {
    return "Dependency-free JSON Schema evaluation that follows the AJV-style interop surface without external runtime packages.";
  }
  return "Grouped validator checks for this feature area.";
}

/**
 * @param {string[]} values
 */
function makeOptions(values) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
}

/**
 * @param {unknown} value
 */
function inputType(value) {
  if (value !== null && typeof value === "object") return "json";
  return "single";
}

/**
 * @param {unknown} input
 */
function issueTypesFrom(input) {
  if (!input || typeof input !== "object") return [];
  if ("issues" in input && Array.isArray(input.issues)) {
    return input.issues.map((issue) => issue.type);
  }
  if ("error" in input && input.error && Array.isArray(input.error.issues)) {
    return input.error.issues.map((issue) => issue.type);
  }
  return [];
}

/**
 * @param {string[]} actual
 * @param {string[]} expected
 */
function hasIssueTypes(actual, expected) {
  return expected.every((value) => actual.includes(value));
}

/**
 * @param {unknown} thrown
 * @param {string[]} expectedIssueTypes
 */
function assertValidationError(thrown, expectedIssueTypes) {
  return (
    isValidationError(thrown) &&
    hasIssueTypes(
      thrown.issues.map((issue) => issue.type),
      expectedIssueTypes
    ) &&
    typeof thrown.summarize() === "string" &&
    !!thrown.flatten() &&
    !!thrown.format() &&
    !!thrown.toJSON()
  );
}

/**
 * @typedef {{
 *   title: string,
 *   group: string,
 *   kind: string,
 *   input?: unknown,
 *   scenario?: "valid" | "invalid" | "schema",
 *   run: () => unknown | Promise<unknown>,
 *   assert: (actual: unknown) => boolean,
 *   expectation: unknown,
 * }} TestCase
 */

/**
 * @param {TestCase} test
 */
async function executeCase(test) {
  try {
    const actual = await test.run();
    const passed = test.assert(actual);
    return {
      title: test.title,
      group: test.group,
      kind: test.kind,
      input: test.input,
      scenario: test.scenario ?? "valid",
      status: passed ? "pass" : "fail",
      expectation: test.expectation,
      actual,
    };
  } catch (error) {
    const passed = test.assert(error);
    return {
      title: test.title,
      group: test.group,
      kind: test.kind,
      input: test.input,
      scenario: test.scenario ?? "invalid",
      status: passed ? "pass" : "fail",
      expectation: test.expectation,
      actual: isValidationError(error)
        ? {
          threw: true,
          name: error.name,
          message: error.message,
          summary: error.summarize(),
          flat: error.flatten(),
          formatted: error.format(),
          json: error.toJSON(),
        }
        : {
          threw: true,
          name: error?.name,
          message: error?.message,
        },
    };
  }
}

/**
 * @param {{
 *   title: string,
 *   schema: unknown,
 *   valid: unknown,
 *   invalid: unknown,
 *   validOutput?: unknown,
 *   invalidTypes: string[],
 * }} definition
 */
function makeClassicChecks(definition) {
  const expectedValidOutput =
    definition.validOutput === undefined ? definition.valid : definition.validOutput;
  return [
    {
      title: `${definition.title} safe valid`,
      group: "Classic API",
      kind: "sync",
      input: definition.valid,
      scenario: "valid",
      run: () => safeParse(definition.schema, definition.valid),
      assert: (actual) =>
        actual.success === true && same(actual.output, expectedValidOutput),
      expectation: { success: true, output: expectedValidOutput },
    },
    {
      title: `${definition.title} safe invalid`,
      group: "Classic API",
      kind: "sync",
      input: definition.invalid,
      scenario: "invalid",
      run: () => safeParse(definition.schema, definition.invalid),
      assert: (actual) =>
        actual.success === false &&
        hasIssueTypes(issueTypesFrom(actual), definition.invalidTypes),
      expectation: { success: false, issueTypes: definition.invalidTypes },
    },
    {
      title: `${definition.title} parse valid`,
      group: "Classic API",
      kind: "sync",
      input: definition.valid,
      scenario: "valid",
      run: () => parse(definition.schema, definition.valid),
      assert: (actual) => same(actual, expectedValidOutput),
      expectation: { output: expectedValidOutput },
    },
    {
      title: `${definition.title} parse invalid throws`,
      group: "Error DX",
      kind: "sync",
      input: definition.invalid,
      scenario: "invalid",
      run: () => parse(definition.schema, definition.invalid),
      assert: (actual) => assertValidationError(actual, definition.invalidTypes),
      expectation: { throws: "ValidationError", issueTypes: definition.invalidTypes },
    },
  ];
}

/**
 * @param {{
 *   title: string,
 *   schema: ReturnType<typeof z.string> | ReturnType<typeof z.number> | ReturnType<typeof z.object> | ReturnType<typeof z.array> | ReturnType<typeof z.union> | ReturnType<typeof z.nullable> | ReturnType<typeof z.optional> | ReturnType<typeof z.nullish> | ReturnType<typeof z.from>,
 *   valid: unknown,
 *   invalid: unknown,
 *   validOutput?: unknown,
 *   invalidTypes?: string[],
 * }} definition
 */
function makeChainChecks(definition) {
  const expectedValidOutput =
    definition.validOutput === undefined ? definition.valid : definition.validOutput;
  const expectedInvalidTypes = definition.invalidTypes ?? [];
  return [
    {
      title: `${definition.title} safe valid`,
      group: "Chain API",
      kind: "sync",
      input: definition.valid,
      scenario: "valid",
      run: () => definition.schema.safeParse(definition.valid),
      assert: (actual) =>
        actual.success === true && same(actual.data, expectedValidOutput),
      expectation: { success: true, data: expectedValidOutput },
    },
    {
      title: `${definition.title} safe invalid`,
      group: "Chain API",
      kind: "sync",
      input: definition.invalid,
      scenario: "invalid",
      run: () => definition.schema.safeParse(definition.invalid),
      assert: (actual) =>
        actual.success === false &&
        hasIssueTypes(actual.error.issues.map((issue) => issue.type), expectedInvalidTypes),
      expectation: { success: false, issueTypes: expectedInvalidTypes },
    },
    {
      title: `${definition.title} parse valid`,
      group: "Chain API",
      kind: "sync",
      input: definition.valid,
      scenario: "valid",
      run: () => definition.schema.parse(definition.valid),
      assert: (actual) => same(actual, expectedValidOutput),
      expectation: { output: expectedValidOutput },
    },
    {
      title: `${definition.title} parse invalid throws`,
      group: "Error DX",
      kind: "sync",
      input: definition.invalid,
      scenario: "invalid",
      run: () => definition.schema.parse(definition.invalid),
      assert: (actual) => assertValidationError(actual, expectedInvalidTypes),
      expectation: { throws: "ValidationError", issueTypes: expectedInvalidTypes },
    },
  ];
}

/**
 * @param {{
 *   title: string,
 *   schema: unknown,
 *   valid: unknown,
 *   invalid: unknown,
 *   validOutput?: unknown,
 *   invalidTypes: string[],
 * }} definition
 */
function makeAsyncChecks(definition) {
  const expectedValidOutput =
    definition.validOutput === undefined ? definition.valid : definition.validOutput;
  return [
    {
      title: `${definition.title} safe valid`,
      group: "Async API",
      kind: "async",
      input: definition.valid,
      scenario: "valid",
      run: () => safeParseAsync(definition.schema, definition.valid),
      assert: (actual) =>
        actual.success === true && same(actual.output, expectedValidOutput),
      expectation: { success: true, output: expectedValidOutput },
    },
    {
      title: `${definition.title} safe invalid`,
      group: "Async API",
      kind: "async",
      input: definition.invalid,
      scenario: "invalid",
      run: () => safeParseAsync(definition.schema, definition.invalid),
      assert: (actual) =>
        actual.success === false &&
        hasIssueTypes(issueTypesFrom(actual), definition.invalidTypes),
      expectation: { success: false, issueTypes: definition.invalidTypes },
    },
    {
      title: `${definition.title} parse valid`,
      group: "Async API",
      kind: "async",
      input: definition.valid,
      scenario: "valid",
      run: () => parseAsync(definition.schema, definition.valid),
      assert: (actual) => same(actual, expectedValidOutput),
      expectation: { output: expectedValidOutput },
    },
    {
      title: `${definition.title} parse invalid throws`,
      group: "Error DX",
      kind: "async",
      input: definition.invalid,
      scenario: "invalid",
      run: () => parseAsync(definition.schema, definition.invalid),
      assert: (actual) => assertValidationError(actual, definition.invalidTypes),
      expectation: { throws: "ValidationError", issueTypes: definition.invalidTypes },
    },
  ];
}

/**
 * @param {{
 *   title: string,
 *   schema: unknown,
 *   valid: unknown,
 *   invalid: unknown,
 *   schemaAssert: (jsonSchema: unknown) => boolean,
 *   invalidKeywords: string[],
 * }} definition
 */
function makeJsonAjvChecks(definition) {
  return [
    {
      title: `${definition.title} toJsonSchema`,
      group: "JSON Schema",
      kind: "sync",
      input: null,
      scenario: "schema",
      run: () => toJsonSchema(definition.schema),
      assert: (actual) => definition.schemaAssert(actual),
      expectation: { schemaShape: "expected subset matched" },
    },
    {
      title: `${definition.title} ajv valid`,
      group: "AJV Compatible",
      kind: "async",
      input: definition.valid,
      scenario: "valid",
      run: () => ajvSafeParse(definition.schema, definition.valid),
      assert: (actual) =>
        actual.success === true && same(actual.data, definition.valid),
      expectation: { success: true, data: definition.valid },
    },
    {
      title: `${definition.title} ajv invalid`,
      group: "AJV Compatible",
      kind: "async",
      input: definition.invalid,
      scenario: "invalid",
      run: () => ajvSafeParse(definition.schema, definition.invalid),
      assert: (actual) =>
        actual.success === false &&
        definition.invalidKeywords.every((keyword) =>
          actual.issues.some((issue) => issue.keyword === keyword)
        ),
      expectation: { success: false, keywords: definition.invalidKeywords },
    },
  ];
}

const classicDefinitions = [
  {
    title: "string min length",
    schema: pipe(string(), minLength(3, "min 3")),
    valid: "abcd",
    invalid: "ab",
    invalidTypes: ["min_length"],
  },
  {
    title: "string max length",
    schema: pipe(string(), maxLength(5, "max 5")),
    valid: "abc",
    invalid: "toolong",
    invalidTypes: ["max_length"],
  },
  {
    title: "string startsWith",
    schema: pipe(string(), startsWith("ab", "must start ab")),
    valid: "abc",
    invalid: "xbc",
    invalidTypes: ["starts_with"],
  },
  {
    title: "string endsWith",
    schema: pipe(string(), endsWith("yz", "must end yz")),
    valid: "xxyz",
    invalid: "xyza",
    invalidTypes: ["ends_with"],
  },
  {
    title: "string includes",
    schema: pipe(string(), includes("mid", "must include mid")),
    valid: "pre-mid-post",
    invalid: "prefix",
    invalidTypes: ["includes"],
  },
  {
    title: "string regex digits+letters",
    schema: pipe(string(), regex(/^[a-z]{2}\d{2}$/u, "two letters two digits")),
    valid: "ab12",
    invalid: "ab1",
    invalidTypes: ["regex"],
  },
  {
    title: "string nonEmpty",
    schema: pipe(string(), nonEmpty("cannot be empty")),
    valid: "filled",
    invalid: "",
    invalidTypes: ["non_empty"],
  },
  {
    title: "string email",
    schema: pipe(string(), email("invalid email")),
    valid: "user@example.com",
    invalid: "user-at-example",
    invalidTypes: ["email"],
  },
  {
    title: "string url",
    schema: pipe(string(), url("invalid url")),
    valid: "https://example.com/docs",
    invalid: "not-a-url",
    invalidTypes: ["url"],
  },
  {
    title: "string uuid",
    schema: pipe(string(), uuid("invalid uuid")),
    valid: "550e8400-e29b-41d4-a716-446655440000",
    invalid: "uuid-123",
    invalidTypes: ["uuid"],
  },
  {
    title: "string hexColor",
    schema: pipe(string(), hexColor("invalid color")),
    valid: "#1a2b3c",
    invalid: "rgb(1,2,3)",
    invalidTypes: ["hex_color"],
  },
  {
    title: "string slug",
    schema: pipe(string(), slug("invalid slug")),
    valid: "hello-world-2026",
    invalid: "Hello World",
    invalidTypes: ["slug"],
  },
  {
    title: "string digits",
    schema: pipe(string(), digits("digits only")),
    valid: "123456",
    invalid: "12a456",
    invalidTypes: ["digits"],
  },
  {
    title: "string decimal",
    schema: pipe(string(), decimal("decimal only")),
    valid: "-12.50",
    invalid: "abc",
    invalidTypes: ["decimal"],
  },
  {
    title: "string trim lower",
    schema: pipe(string(), trim(), toLowerCase()),
    valid: "  HeLLo  ",
    validOutput: "hello",
    invalid: 42,
    invalidTypes: ["string"],
  },
  {
    title: "string trim edges upper",
    schema: pipe(string(), trimStart(), trimEnd(), toUpperCase()),
    valid: "  hi there   ",
    validOutput: "HI THERE",
    invalid: false,
    invalidTypes: ["string"],
  },
  {
    title: "parseBoolean transform",
    schema: pipe(string(), parseBoolean(undefined, "cannot parse boolean")),
    valid: "YES",
    validOutput: true,
    invalid: "maybe",
    invalidTypes: ["parse_boolean"],
  },
  {
    title: "parseJson transform",
    schema: pipe(string(), parseJson(undefined, "bad json")),
    valid: '{"name":"zerux","year":2026}',
    validOutput: { name: "zerux", year: 2026 },
    invalid: "{bad}",
    invalidTypes: ["parse_json"],
  },
  {
    title: "number range",
    schema: pipe(number(), minValue(10, "min 10"), maxValue(20, "max 20")),
    valid: 15,
    invalid: 25,
    invalidTypes: ["max_value"],
  },
  {
    title: "number integer",
    schema: pipe(number(), integer("must be integer")),
    valid: 12,
    invalid: 12.5,
    invalidTypes: ["integer"],
  },
  {
    title: "number safeInteger",
    schema: pipe(number(), safeInteger("must be safe integer")),
    valid: 9007199254740991,
    invalid: 9007199254740992,
    invalidTypes: ["safe_integer"],
  },
  {
    title: "number finite",
    schema: pipe(number(), finite("must be finite")),
    valid: 12,
    invalid: Infinity,
    invalidTypes: ["finite"],
  },
  {
    title: "number multipleOf",
    schema: pipe(number(), multipleOf(4, "must be multiple of 4")),
    valid: 16,
    invalid: 18,
    invalidTypes: ["multiple_of"],
  },
  {
    title: "array item min length",
    schema: array(pipe(string(), minLength(2, "tag too short")), [minLength(1, "at least one tag")]),
    valid: ["ts", "js"],
    invalid: ["x"],
    invalidTypes: ["min_length"],
  },
  {
    title: "array top level min length",
    schema: array(string(), [minLength(2, "need two values")]),
    valid: ["one", "two"],
    invalid: ["one"],
    invalidTypes: ["min_length"],
  },
  {
    title: "object classic user",
    schema: object({
      name: pipe(string(), minLength(2, "name short")),
      age: pipe(number(), minValue(18, "adult only")),
      active: optional(boolean()),
    }),
    valid: { name: "Shubham", age: 24, active: true },
    invalid: { name: "S", age: 15 },
    invalidTypes: ["min_length", "min_value"],
  },
  {
    title: "union email or username",
    schema: union([
      pipe(string(), email("need email")),
      pipe(string(), minLength(3, "need username")),
    ]),
    valid: "user@example.com",
    invalid: "no",
    invalidTypes: ["union"],
  },
  {
    title: "nonNullable display name",
    schema: nonNullable(
      union([pipe(string(), minLength(2, "display short")), null_()]),
      "display cannot be null"
    ),
    valid: "Valid",
    invalid: null,
    invalidTypes: ["non_nullable"],
  },
];

const chainDefinitions = [
  {
    title: "chain string trim min max",
    schema: z.string().trim().min(3, "min 3").max(10, "max 10"),
    valid: "  hello  ",
    validOutput: "hello",
    invalid: " hi ",
    invalidTypes: ["min_length"],
  },
  {
    title: "chain string lower email",
    schema: z.string().trim().toLowerCase().email("chain email"),
    valid: " USER@EXAMPLE.COM ",
    validOutput: "user@example.com",
    invalid: "bad",
    invalidTypes: ["email"],
  },
  {
    title: "chain number int range",
    schema: z.number().int("must be int").min(18, "too young").max(30, "too old"),
    valid: 24,
    invalid: 17.5,
    invalidTypes: ["integer", "min_value"],
  },
  {
    title: "chain number transform",
    schema: z.number().transform((value) => value * 2),
    valid: 12,
    validOutput: 24,
    invalid: "12",
    invalidTypes: ["number"],
  },
  {
    title: "chain array refine",
    schema: z.array(z.string().min(2, "tag short")).refine((input) => input.length > 0, "need tags"),
    valid: ["ts", "js"],
    invalid: [],
    invalidTypes: ["check"],
  },
  {
    title: "chain object nullable",
    schema: z.object({
      name: z.string().trim().min(2, "name short"),
      age: z.number().int("int").min(18, "adult"),
    }).nullable(),
    valid: { name: "Shubham", age: 24 },
    invalid: { name: "S", age: 12 },
    invalidTypes: ["min_length", "min_value"],
  },
  {
    title: "chain object optional field",
    schema: z.object({
      title: z.string().min(3, "title short"),
      note: z.optional(z.string().min(2, "note short")),
    }),
    valid: { title: "Hello" },
    invalid: { title: "Hi" },
    invalidTypes: ["min_length"],
  },
  {
    title: "chain union via or",
    schema: z.string().trim().min(3, "need 3").or(z.literal("ok")),
    valid: "ok",
    invalid: "no",
    invalidTypes: ["min_length"],
  },
  {
    title: "chain intersection via and",
    schema: z
      .object({ left: z.string().min(2, "left short") })
      .and(z.object({ right: z.number().min(1, "right small") })),
    valid: { left: "go", right: 2 },
    invalid: { left: "g", right: 0 },
    invalidTypes: ["min_length", "min_value"],
  },
  {
    title: "chain from classic schema",
    schema: z.from(pipe(string(), startsWith("ab", "need ab"))),
    valid: "abc",
    invalid: "xbc",
    invalidTypes: ["starts_with"],
  },
];

const asyncDefinitions = [
  {
    title: "async string check",
    schema: pipeAsync(string(), checkAsync(async (value) => value === "open-sesame", "wrong phrase")),
    valid: "open-sesame",
    invalid: "closed",
    invalidTypes: ["check"],
  },
  {
    title: "async number check",
    schema: pipeAsync(number(), checkAsync(async (value) => value > 10, "must be > 10")),
    valid: 12,
    invalid: 7,
    invalidTypes: ["check"],
  },
  {
    title: "async array of checked strings",
    schema: arrayAsync(
      pipeAsync(string(), checkAsync(async (value) => value.length >= 3, "length >= 3")),
      [minLength(1, "need at least one")]
    ),
    valid: ["node", "bun"],
    invalid: ["js"],
    invalidTypes: ["check"],
  },
  {
    title: "async object profile",
    schema: objectAsync({
      bio: pipe(string(), maxLength(10, "bio too long")),
      slug: pipeAsync(string(), checkAsync(async (value) => value.startsWith("user-"), "slug must start user-")),
    }),
    valid: { bio: "short", slug: "user-123" },
    invalid: { bio: "this is very long", slug: "member-123" },
    invalidTypes: ["max_length", "check"],
  },
];

const jsonAjvDefinitions = [
  {
    title: "json string min",
    schema: pipe(string(), minLength(3, "min 3")),
    valid: "abcd",
    invalid: "ab",
    schemaAssert: (schema) => schema.type === "string" && schema.minLength === 3,
    invalidKeywords: ["minLength"],
  },
  {
    title: "json string email",
    schema: pipe(string(), email("email")),
    valid: "user@example.com",
    invalid: "bad",
    schemaAssert: (schema) => schema.type === "string" && schema.format === "email",
    invalidKeywords: ["format"],
  },
  {
    title: "json number range",
    schema: pipe(number(), minValue(10, "min"), maxValue(20, "max")),
    valid: 15,
    invalid: 25,
    schemaAssert: (schema) => schema.type === "number" && schema.minimum === 10 && schema.maximum === 20,
    invalidKeywords: ["maximum"],
  },
  {
    title: "json integer",
    schema: pipe(number(), integer("int")),
    valid: 12,
    invalid: 12.5,
    schemaAssert: (schema) => schema.type === "integer",
    invalidKeywords: ["type"],
  },
  {
    title: "json array items",
    schema: array(pipe(string(), minLength(2, "item min"))),
    valid: ["ab", "cd"],
    invalid: ["a"],
    schemaAssert: (schema) => schema.type === "array" && schema.items.type === "string",
    invalidKeywords: ["minLength"],
  },
  {
    title: "json object required",
    schema: object({
      name: pipe(string(), minLength(2, "name")),
      age: pipe(number(), minValue(18, "age")),
    }),
    valid: { name: "Shubham", age: 24 },
    invalid: { name: "S" },
    schemaAssert: (schema) =>
      schema.type === "object" &&
      Array.isArray(schema.required) &&
      schema.required.includes("name") &&
      schema.required.includes("age"),
    invalidKeywords: ["required", "minLength"],
  },
  {
    title: "json union anyOf",
    schema: union([pipe(string(), email("email")), pipe(string(), minLength(3, "min"))]),
    valid: "user@example.com",
    invalid: "no",
    schemaAssert: (schema) => Array.isArray(schema.anyOf) && schema.anyOf.length === 2,
    invalidKeywords: ["anyOf"],
  },
  {
    title: "json pick optional-like object",
    schema: object({
      title: pipe(string(), minLength(3, "title")),
      flag: optional(boolean()),
    }),
    valid: { title: "hello" },
    invalid: { title: "hi" },
    schemaAssert: (schema) =>
      schema.type === "object" &&
      Array.isArray(schema.required) &&
      schema.required.includes("title") &&
      !schema.required.includes("flag"),
    invalidKeywords: ["minLength"],
  },
  {
    title: "json literal const",
    schema: z.literal("ok").unwrap(),
    valid: "ok",
    invalid: "no",
    schemaAssert: (schema) => schema.const === "ok",
    invalidKeywords: ["const"],
  },
  {
    title: "json chain object",
    schema: z.object({
      name: z.string().min(2, "name"),
      age: z.number().int("int").min(18, "age"),
    }).unwrap(),
    valid: { name: "Shubham", age: 24 },
    invalid: { name: "S", age: 17.5 },
    schemaAssert: (schema) =>
      schema.type === "object" &&
      schema.properties.name.type === "string" &&
      schema.properties.age.type === "integer",
    invalidKeywords: ["minLength", "type", "minimum"],
  },
];

const cases = [
  ...classicDefinitions.flatMap(makeClassicChecks),
  ...chainDefinitions.flatMap(makeChainChecks),
  ...asyncDefinitions.flatMap(makeAsyncChecks),
  ...jsonAjvDefinitions.flatMap(makeJsonAjvChecks),
];

/**
 * @param {Awaited<ReturnType<typeof executeCase>>[]} results
 */
function renderHtml(results) {
  const counts = {
    total: results.length,
    pass: results.filter((item) => item.status === "pass").length,
    fail: results.filter((item) => item.status === "fail").length,
    warn: results.filter((item) => item.status === "warn").length,
  };

  /** @type {Record<string, typeof results>} */
  const grouped = {};
  for (const item of results) {
    if (!grouped[item.group]) grouped[item.group] = [];
    grouped[item.group].push(item);
  }

  const groups = [...new Set(results.map((item) => item.group))];
  const kinds = [...new Set(results.map((item) => item.kind))];

  const nav = Object.entries(grouped)
    .map(([group, items]) => {
      const failCount = items.filter((item) => item.status !== "pass").length;
      return `<a class="jump-link" data-group="${escapeHtml(group)}" href="#${escapeHtml(slugify(group))}">${escapeHtml(group)} <span class="meta-chip">${items.length} checks</span>${failCount ? `<span class="pill fail">${failCount} issues</span>` : `<span class="pill pass">all good</span>`}</a>`;
    })
    .join("");

  const sections = Object.entries(grouped)
    .map(([group, items]) => {
      const passCount = items.filter((item) => item.status === "pass").length;
      const failCount = items.filter((item) => item.status === "fail").length;
      const warnCount = items.filter((item) => item.status === "warn").length;
      const cards = items
        .map((item) => `
          <article
            class="case"
            data-group="${escapeHtml(item.group)}"
            data-kind="${escapeHtml(item.kind)}"
            data-status="${escapeHtml(item.status)}"
            data-scenario="${escapeHtml(item.scenario ?? "valid")}"
            data-input-type="${escapeHtml(inputType(item.input ?? null))}"
            data-title="${escapeHtml(item.title.toLowerCase())}"
          >
            <div class="case-head">
              <div class="case-head-top">
                <h3 class="case-title">${escapeHtml(item.title)}</h3>
              </div>
              <div class="case-meta">
                <span class="meta-chip ${item.scenario === "valid" ? "meta-chip-valid" : item.scenario === "invalid" ? "meta-chip-invalid" : "meta-chip-schema"}">${escapeHtml(item.scenario ?? "valid")}</span>
                <span class="meta-chip ${item.status === "pass" ? "meta-chip-pass" : item.status === "fail" ? "meta-chip-fail" : "meta-chip-warn"}">${escapeHtml(item.status)}</span>
                <span class="meta-chip">${escapeHtml(item.kind)}</span>
                <span class="meta-chip">${escapeHtml(item.group)}</span>
              </div>
            </div>
            <div class="case-body">
              <div class="case-input">
                <p class="label">Input</p>
                <pre>${escapeHtml(pretty(item.input ?? null))}</pre>
              </div>
              <div class="payload-grid">
                <div class="payload-panel">
                  <p class="label">Expected Output</p>
                  <pre>${escapeHtml(pretty(item.expectation))}</pre>
                </div>
                <div class="payload-panel">
                  <p class="label">Result Output</p>
                  <pre>${escapeHtml(pretty(item.actual))}</pre>
                </div>
              </div>
            </div>
          </article>
        `)
        .join("");

      return `
        <section id="${escapeHtml(slugify(group))}" class="section-shell">
          <div class="section-heading">
            <div>
              <h2>${escapeHtml(group)}</h2>
              <p>${items.length} verified checks</p>
              <div class="section-meta">
                <span class="pill pass">${passCount} pass</span>
                <span class="pill fail">${failCount} fail</span>
                <span class="pill warn">${warnCount} warn</span>
              </div>
            </div>
          </div>
          <div class="section-overview">
            <div class="section-note">
              <p>${escapeHtml(sectionDescription(group))}</p>
            </div>
            <div class="section-stats">
              <div class="section-stat">
                <strong>${passCount}</strong>
                <span>passing checks</span>
              </div>
              <div class="section-stat">
                <strong>${failCount}</strong>
                <span>failing checks</span>
              </div>
              <div class="section-stat">
                <strong>${warnCount}</strong>
                <span>warnings</span>
              </div>
            </div>
          </div>
          <div class="case-grid">${cards}</div>
        </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZeruxJS Validator Matrix</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="hero-card">
          <div class="eyebrow">Validator Matrix</div>
          <h1>ZeruxJS Deep Test Report</h1>
          <p class="subhead">
            This report is generated from <code>index.js</code> and checks classic
            schemas, shorthand action arrays, chain-style <code>z</code> builders,
            async parsing, rich validation errors, JSON Schema generation, and the
            dependency-free AJV-compatible layer. Each card compares an expected
            assertion against the actual runtime output.
          </p>
          <div class="summary-grid">
            <div class="stat"><p class="stat-value">${counts.total}</p><p class="stat-label">total checks</p></div>
            <div class="stat"><p class="stat-value">${counts.pass}</p><p class="stat-label">passing assertions</p></div>
            <div class="stat"><p class="stat-value">${counts.fail}</p><p class="stat-label">failed assertions</p></div>
            <div class="stat"><p class="stat-value">${counts.warn}</p><p class="stat-label">warnings</p></div>
          </div>
        </div>
        <aside class="summary-card">
          <div class="eyebrow">Coverage</div>
          <ul class="summary-list">
            <li><strong>Classic and chain parsing</strong> Core schema constructors plus fluent <code>z</code> chains are exercised side by side.</li>
            <li><strong>Error developer experience</strong> Parse exceptions, flatten and format helpers, and thrown issue summaries are covered.</li>
            <li><strong>Interop surface</strong> JSON Schema export and dependency-free AJV-compatible validation are both asserted.</li>
            <li><strong>Scan first, inspect later</strong> Each case starts with a short result line, while the full JSON stays collapsible.</li>
            <li><strong>Total matrix size</strong> ${counts.total} checks generated from this single runner.</li>
          </ul>
        </aside>
      </section>
      <nav class="toolbar">
        <div class="toolbar-top">
          <p class="toolbar-label">Filter and jump through the report</p>
          <div class="toolbar-status">
            <p class="toolbar-status-text"><strong id="visible-count">${counts.total}</strong> of <strong id="total-count">${counts.total}</strong> checks visible</p>
            <span class="pill pass" id="visible-pass">${counts.pass} pass</span>
            <span class="pill fail" id="visible-fail">${counts.fail} fail</span>
            <span class="pill warn" id="visible-warn">${counts.warn} warn</span>
          </div>
        </div>
        <div class="toolbar-main">
          <div class="control">
            <label for="filter-search">Search checks</label>
            <input id="filter-search" type="search" placeholder="Search by test name" />
          </div>
          <div class="control">
            <label for="filter-input-type">Input Type</label>
            <select id="filter-input-type">
              <option value="">All input types</option>
              <option value="single">single input</option>
              <option value="json">json input</option>
            </select>
          </div>
          <div class="control">
            <label for="filter-group">Group</label>
            <select id="filter-group">
              <option value="">All groups</option>
              ${makeOptions(groups)}
            </select>
          </div>
          <div class="control">
            <label for="filter-kind">Kind</label>
            <select id="filter-kind">
              <option value="">All kinds</option>
              ${makeOptions(kinds)}
            </select>
          </div>
          <div class="control">
            <label for="filter-status">Status</label>
            <select id="filter-status">
              <option value="">All statuses</option>
              <option value="pass">pass</option>
              <option value="fail">fail</option>
              <option value="warn">warn</option>
            </select>
          </div>
          <div class="toolbar-actions">
            <button class="toolbar-button" type="button" id="reset-filters">Reset</button>
          </div>
        </div>
        <div class="jump-list">${nav}</div>
      </nav>
      ${sections}
      <p class="footer">Generated on ${escapeHtml(new Date().toISOString())}</p>
    </main>
    <script>
      (() => {
        const cases = Array.from(document.querySelectorAll(".case"));
        const sections = Array.from(document.querySelectorAll(".section-shell"));
        const jumpLinks = Array.from(document.querySelectorAll(".jump-link"));
        const searchInput = document.getElementById("filter-search");
        const inputTypeSelect = document.getElementById("filter-input-type");
        const groupSelect = document.getElementById("filter-group");
        const kindSelect = document.getElementById("filter-kind");
        const statusSelect = document.getElementById("filter-status");
        const visibleCount = document.getElementById("visible-count");
        const totalCount = document.getElementById("total-count");
        const visiblePass = document.getElementById("visible-pass");
        const visibleFail = document.getElementById("visible-fail");
        const visibleWarn = document.getElementById("visible-warn");
        const resetButton = document.getElementById("reset-filters");

        totalCount.textContent = String(cases.length);

        function updateVisibility() {
          const search = searchInput.value.trim().toLowerCase();
          const inputType = inputTypeSelect.value;
          const group = groupSelect.value;
          const kind = kindSelect.value;
          const status = statusSelect.value;

          let pass = 0;
          let fail = 0;
          let warn = 0;
          let visible = 0;

          for (const card of cases) {
            const matchesSearch = !search || card.dataset.title.includes(search);
            const matchesInputType = !inputType || card.dataset.inputType === inputType;
            const matchesGroup = !group || card.dataset.group === group;
            const matchesKind = !kind || card.dataset.kind === kind;
            const matchesStatus = !status || card.dataset.status === status;
            const isVisible = matchesSearch && matchesInputType && matchesGroup && matchesKind && matchesStatus;
            card.classList.toggle("is-hidden", !isVisible);

            if (isVisible) {
              visible += 1;
              if (card.dataset.status === "pass") pass += 1;
              if (card.dataset.status === "fail") fail += 1;
              if (card.dataset.status === "warn") warn += 1;
            }
          }

          for (const section of sections) {
            const hasVisibleCards = section.querySelector(".case:not(.is-hidden)");
            section.classList.toggle("is-hidden", !hasVisibleCards);
          }

          for (const link of jumpLinks) {
            const targetSection = sections.find((section) => section.id === link.getAttribute("href")?.slice(1));
            const sectionVisible = targetSection && !targetSection.classList.contains("is-hidden");
            link.classList.toggle("is-hidden", !sectionVisible);
          }

          visibleCount.textContent = String(visible);
          visiblePass.textContent = pass + " pass";
          visibleFail.textContent = fail + " fail";
          visibleWarn.textContent = warn + " warn";
        }

        searchInput.addEventListener("input", updateVisibility);
        inputTypeSelect.addEventListener("change", updateVisibility);
        groupSelect.addEventListener("change", updateVisibility);
        kindSelect.addEventListener("change", updateVisibility);
        statusSelect.addEventListener("change", updateVisibility);
        resetButton.addEventListener("click", () => {
          searchInput.value = "";
          inputTypeSelect.value = "";
          groupSelect.value = "";
          kindSelect.value = "";
          statusSelect.value = "";
          updateVisibility();
        });
        updateVisibility();
      })();
    </script>
  </body>
</html>`;
}

async function main() {
  const results = [];
  for (const test of cases) {
    results.push(await executeCase(test));
  }

  await writeFile(htmlPath, renderHtml(results), "utf8");

  console.log(`Executed ${results.length} checks`);
  console.log(`HTML report written to ${htmlPath}`);
}

await main();
