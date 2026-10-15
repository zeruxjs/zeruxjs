import type { ZeruxConfig } from "./index.js";
import type { ZeruxRequestContext } from "./bootstrap/types.js";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeConfig {
    default?: ThemeMode;
    cookieName?: string;
    disablePrefrenceHeader?: boolean;
    disablePreferenceHeader?: boolean;
    scriptPosition?: "head" | "body-top" | "body";
    scriptType?: "module" | "nomodule";
    scriptLoadType?: "async" | "defer";
}

export interface ResolvedThemeConfig {
    default: ThemeMode;
    cookieName: string;
    disablePrefrenceHeader: boolean;
    scriptPosition: "head" | "body-top" | "body";
    scriptType: "module" | "nomodule";
    scriptLoadType: "async" | "defer";
}

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

const isThemeMode = (value: unknown): value is ThemeMode =>
    value === "light" || value === "dark" || value === "system";

const normalizeConfig = (config?: ZeruxConfig | null): ResolvedThemeConfig => {
    const theme = (config?.theme ?? {}) as ThemeConfig;

    return {
        default: isThemeMode(theme.default) ? theme.default : "system",
        cookieName: typeof theme.cookieName === "string" && theme.cookieName.trim()
            ? theme.cookieName.trim()
            : "theme",
        disablePrefrenceHeader: theme.disablePrefrenceHeader ?? theme.disablePreferenceHeader ?? false,
        scriptPosition: theme.scriptPosition === "body-top" || theme.scriptPosition === "body"
            ? theme.scriptPosition
            : "head",
        scriptType: theme.scriptType === "nomodule" ? "nomodule" : "module",
        scriptLoadType: theme.scriptLoadType === "defer" ? "defer" : "async"
    };
};

const parseCookieHeader = (value?: string | string[]) => {
    const header = Array.isArray(value) ? value.join(";") : value ?? "";
    const cookies = new Map<string, string>();

    for (const part of header.split(";")) {
        const [rawName, ...rawValue] = part.trim().split("=");
        if (!rawName) continue;
        try {
            cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
        } catch {
            cookies.set(rawName, rawValue.join("="));
        }
    }

    return cookies;
};

const browserCookie = (name: string) => {
    if (typeof document === "undefined") return undefined;
    return parseCookieHeader(document.cookie).get(name);
};

const requestCookie = (context: ZeruxRequestContext | undefined, name: string) =>
    parseCookieHeader(context?.req.headers.cookie).get(name);

const isRequestContext = (value?: ZeruxRequestContext | ZeruxConfig): value is ZeruxRequestContext =>
    Boolean(value && "req" in value && "config" in value);

const resolveConfigInput = (value?: ZeruxRequestContext | ZeruxConfig) =>
    isRequestContext(value) ? value.config : value;

export const getThemeConfig = (config?: ZeruxConfig | null): ResolvedThemeConfig =>
    normalizeConfig(config);

export const getThemeMode = (contextOrConfig?: ZeruxRequestContext | ZeruxConfig): ThemeMode => {
    const context = isRequestContext(contextOrConfig) ? contextOrConfig : undefined;
    const config = normalizeConfig(resolveConfigInput(contextOrConfig));
    const value = context
        ? requestCookie(context, config.cookieName)
        : browserCookie(config.cookieName);

    return isThemeMode(value) ? value : config.default;
};

export const getThemeByPrefersColor = (context?: ZeruxRequestContext): ResolvedTheme => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    const rawHeader = context?.req.headers["sec-ch-prefers-color-scheme"];
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const normalized = typeof header === "string" ? header.replace(/"/g, "").toLowerCase() : "";

    return normalized === "dark" ? "dark" : "light";
};

export const getResolvedTheme = (mode: ThemeMode, context?: ZeruxRequestContext): ResolvedTheme =>
    mode === "system" ? getThemeByPrefersColor(context) : mode;

export const getThemeLabel = (mode: ThemeMode): string => ({
    system: "System",
    dark: "Dark",
    light: "Light"
})[mode];

export const getThemeIcon = (mode?: ThemeMode, context?: ZeruxRequestContext): string => {
    const activeMode = mode ?? getThemeMode(context);
    const icons: Record<ThemeMode, string> = {
        system: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>`,
        dark: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6.36 6.36 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`,
        light: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`
    };

    return icons[activeMode];
};

export const setTheme = (mode: ThemeMode, configInput?: ZeruxConfig): void => {
    if (typeof document === "undefined") return;

    const config = normalizeConfig(configInput);
    const selectedMode = isThemeMode(mode) ? mode : config.default;
    const resolvedTheme = getResolvedTheme(selectedMode);
    const classList = document.documentElement.classList;

    classList.remove(...THEME_MODES);
    classList.add(selectedMode);
    if (selectedMode === "system") {
        classList.add(resolvedTheme);
    }

    document.documentElement.style.colorScheme = resolvedTheme;
    document.cookie = `${encodeURIComponent(config.cookieName)}=${encodeURIComponent(selectedMode)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new CustomEvent("zerux:themechange", {
        detail: {
            mode: selectedMode,
            theme: resolvedTheme
        }
    }));
};
