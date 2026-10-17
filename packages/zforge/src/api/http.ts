export interface DevtoolsApiClientOptions {
    baseUrl: string;
    app: string;
    serviceName?: string;
    identifier?: string | null;
}

const buildPath = (baseUrl: string, app: string, path: string, identifier?: string | null, serviceName = "zdev") => {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/${app}/__${serviceName}/api/${path.replace(/^\//, "")}`);
    if (identifier) {
        url.searchParams.set("identifier", identifier);
    }
    return url;
};

export const createDevtoolsApiClient = ({ baseUrl, app, identifier, serviceName }: DevtoolsApiClientOptions) => ({
    async get(path: string) {
        const response = await fetch(buildPath(baseUrl, app, path, identifier, serviceName), {
            headers: { Accept: "application/json" }
        });
        return response.json();
    }
});

export const createDevtoolsModuleApiClient = (
    options: DevtoolsApiClientOptions & { moduleId: string; requesterModuleId?: string | null }
) => ({
    async request(name: string, init?: { method?: string; body?: unknown }) {
        const service = options.serviceName || "zdev";
        const url = new URL(
            `${options.baseUrl.replace(/\/$/, "")}/${options.app}/__${service}/modules/${options.moduleId}/api/${name.replace(/^\//, "")}`
        );
        if (options.identifier) {
            url.searchParams.set("identifier", options.identifier);
        }
        if (options.requesterModuleId) {
            url.searchParams.set("requester", options.requesterModuleId);
        }

        const method = init?.method ?? "POST";
        const response = await fetch(url, {
            method,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            body: method === "GET" || method === "HEAD"
                ? undefined
                : JSON.stringify(init?.body ?? {})
        });
        return response.json();
    }
});
