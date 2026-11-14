/** Normalize duplicate/trailing slashes without decoding route parameters; matching never grants authorization.
 * @param {string} pathname - Route path.
 * @returns {string} Canonical slash form used by the existing matcher.
 */
export const sanitizePathname = (pathname: string) => {
  if (!pathname || pathname === '/') {
    return '/';
  }
  /** Slash-collapsed path; only a non-root trailing slash is removed. */
  const normalized = pathname.replace(/\/+/g, '/');
  return normalized.endsWith('/') && normalized !== '/'
    ? normalized.slice(0, -1)
    : normalized;
};

/** Compile trusted registered route syntax, not an arbitrary client regex.
 * @param {string} pattern - Authored static/dynamic/catch-all pattern.
 * @returns {{regex: RegExp, keys: string[]}} Anchored matcher and parameter names.
 */
export const compileRoutePattern = (pattern: string) => {
  /** Canonical registered pattern before segment compilation. */
  const sanitized = sanitizePathname(pattern);
  if (sanitized === '/') {
    return {
      regex: /^\/$/,
      keys: [] as string[],
    };
  }

  /** Parameter keys in route order; values retain the runtime’s encoded semantics. */
  const keys: string[] = [];
  /** Escaped literal segments and explicit named parameter groups. */
  const source = sanitized
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':') && segment.endsWith('*')) {
        /** Explicit authored dynamic/catch-all parameter name. */
        const key = segment.slice(1, -1);
        keys.push(key);
        return `(?<${key}>.+)`;
      }

      if (segment.startsWith(':')) {
        /** Explicit authored dynamic/catch-all parameter name. */
        const key = segment.slice(1);
        keys.push(key);
        return `(?<${key}>[^/]+)`;
      }

      if (segment.startsWith('{') && segment.endsWith('}')) {
        /** Brace-folder alias supported alongside its literal registration segment. */
        const folder = segment.slice(1, -1);
        /** Regex-escaped literal folder segment. */
        const literal = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        /** Regex-escaped public alias of the authored brace folder. */
        const publicSegment = folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return `(?:${literal}|${publicSegment})`;
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    regex: new RegExp(`^/${source}$`),
    keys,
  };
};

/** Compute existing static/dynamic/catch-all ordering without authorizing a route.
 * @param {{pattern: string}} route - Registered route descriptor.
 * @param {string} route.pattern - Trusted authored pattern.
 * @returns {object} Segment counts used by the precedence comparator.
 */
const getRoutePriority = (route: { pattern: string }) => {
  /** Nonempty registered pattern segments. */
  const segments = route.pattern.split('/').filter(Boolean);
  /** Number of segments without a dynamic colon prefix. */
  const staticSegments = segments.filter(
    (segment) => !segment.startsWith(':')
  ).length;
  /** Number of terminal-star parameter segments. */
  const wildcardSegments = segments.filter(
    (segment) => segment.startsWith(':') && segment.endsWith('*')
  ).length;

  return {
    segmentCount: segments.length,
    staticSegments,
    wildcardSegments,
  };
};

/** Order routes by specificity and deterministic literal tie breaking.
 * @param {{pattern: string}} left - First registered route.
 * @param {string} left.pattern - First trusted authored pattern.
 * @param {{pattern: string}} right - Second registered route.
 * @param {string} right.pattern - Second trusted authored pattern.
 * @returns {number} Stable comparator result.
 */
export const compareRoutePatterns = (
  left: { pattern: string },
  right: { pattern: string }
) => {
  /** First route’s specificity counts. */
  const a = getRoutePriority(left);
  /** Second route’s specificity counts. */
  const b = getRoutePriority(right);
  return (
    b.segmentCount - a.segmentCount ||
    b.staticSegments - a.staticSegments ||
    a.wildcardSegments - b.wildcardSegments ||
    left.pattern.localeCompare(right.pattern)
  );
};
