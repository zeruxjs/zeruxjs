/**
 * Redirect status codes supported by ZeruxJS route handlers.
 *
 * Use temporary redirects for request-preserving route moves, permanent redirects
 * for stable canonical URL moves, and see-other redirects after form submissions.
 */
export enum RedirectType {
    Temporary = 307,
    Permanent = 308,
    Found = 302,
    SeeOther = 303
}

export interface RedirectResponse {
    readonly __zeruxRedirect: true;
    readonly location: string;
    readonly statusCode: RedirectType;
}

const REDIRECT_STATUS_CODES = new Set<number>([
    RedirectType.Temporary,
    RedirectType.Permanent,
    RedirectType.Found,
    RedirectType.SeeOther
]);

/**
 * Creates a redirect response that can be returned from a ZeruxJS route handler.
 *
 * @param location - Absolute URL or application path for the redirect target.
 * @param type - Redirect status code to send. Defaults to a temporary 307 redirect.
 * @returns A redirect response payload handled by the ZeruxJS runtime.
 */
export function redirect(
    location: string | URL,
    type: RedirectType = RedirectType.Temporary
): RedirectResponse {
    const normalizedLocation = location.toString();

    if (!normalizedLocation) {
        throw new Error("redirect requires a non-empty location.");
    }

    if (!REDIRECT_STATUS_CODES.has(type)) {
        throw new Error(`Unsupported redirect status code "${type}".`);
    }

    return {
        __zeruxRedirect: true,
        location: normalizedLocation,
        statusCode: type
    };
}

/**
 * Checks whether a value is a ZeruxJS redirect response.
 *
 * @param value - Value returned by a route handler or middleware utility.
 * @returns True when the value should be sent as an HTTP redirect response.
 */
export function isRedirectResponse(value: unknown): value is RedirectResponse {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as RedirectResponse).__zeruxRedirect === true &&
        typeof (value as RedirectResponse).location === "string" &&
        REDIRECT_STATUS_CODES.has((value as RedirectResponse).statusCode)
    );
}
