/** Shared server/browser matching; classification never grants authorization. */
export const sanitizePathname = (pathname: string) => {
    if (!pathname || pathname === "/") return "/";
    const normalized = pathname.replace(/\/+/g, "/");
    return normalized.endsWith("/") && normalized !== "/" ? normalized.slice(0, -1) : normalized;
};

export const compileRoutePattern = (pattern: string) => {
    const sanitized = sanitizePathname(pattern);
    if (sanitized === "/") {
        return {
            regex: /^\/$/,
            keys: [] as string[]
        };
    }

    const keys: string[] = [];
    const source = sanitized
        .split("/")
        .filter(Boolean)
        .map((segment) => {
            if (segment.startsWith(":") && segment.endsWith("*")) {
                const key = segment.slice(1, -1);
                keys.push(key);
                return `(?<${key}>.+)`;
            }

            if (segment.startsWith(":")) {
                const key = segment.slice(1);
                keys.push(key);
                return `(?<${key}>[^/]+)`;
            }

            if (segment.startsWith("{") && segment.endsWith("}")) {
                const folder = segment.slice(1, -1);
                const literal = segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const publicSegment = folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                return `(?:${literal}|${publicSegment})`;
            }

            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");

    return {
        regex: new RegExp(`^/${source}$`),
        keys
    };
};

const getRoutePriority = (route: {pattern:string}) => {
    const segments = route.pattern.split("/").filter(Boolean);
    const staticSegments = segments.filter((segment) => !segment.startsWith(":")).length;
    const wildcardSegments = segments.filter((segment) => segment.startsWith(":") && segment.endsWith("*")).length;

    return {
        segmentCount: segments.length,
        staticSegments,
        wildcardSegments
    };
};

export const compareRoutePatterns = (left:{pattern:string},right:{pattern:string}) => {
    const a=getRoutePriority(left),b=getRoutePriority(right);
    return b.segmentCount-a.segmentCount||b.staticSegments-a.staticSegments||a.wildcardSegments-b.wildcardSegments||left.pattern.localeCompare(right.pattern);
};
