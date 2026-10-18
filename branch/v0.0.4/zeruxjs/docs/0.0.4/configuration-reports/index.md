# Report-studio configuration

Connect report definitions and data sources to explicit authorization and tenant scope.


## Prerequisites

Reports visualize internal analytics. Install `@zeruxjs/reports`, configure a reporting database/analytics service, and decide who may read, edit, export or query sensitive data. Report setup is disabled unless `enabled: true`; startup also depends on analytics. A chart configuration is not a query authorization policy.

## Start with a protected config

```js title="zerux.config.js"
/** @type {import('zeruxjs').ZeruxConfig} */
export default {
  analytics: { analytics: 'reporting', enabled: true },
  reports: {
    enabled: true,
    prefix: '/_reports',
    site: 'storefront',
    maxSourceRows: 500,
    authorize: async () => false,
  },
};
```

The deny-all callback is intentional until connected to the application's real authenticated session policy. Replace it with an implementation that checks the request, action and resource ID; do not change it to unconditional true just to make the dashboard visible. The `reporting` database connection and analytics setup must exist separately.

## Authorization and tenant scope

`authorize(request, action, resourceId)` controls actions including read, edit, export, sensitive data and campaign reporting. Resolve identity on the server. `site` restricts analytics queries for a single-site deployment. For multi-tenant use, implement `resolveScope(request)` so each authorized request obtains its verified site, store and optional data source. Filtering the frontend's chart selector is not tenant isolation.

`dashboardHost` limits the dashboard host but does not authenticate users. Definition updates require the appropriate origin/version semantics. Treat a stale saved revision as a conflict. Persist chart definitions in a shared versioned store; a volatile fallback loses edits on restart.

## Data sources and result coverage

The default raw-event connector is bounded. `maxSourceRows` is a sampling/input limit, not a promise that the chart represents every matching event. Inspect result coverage/truncation indicators and label partial charts honestly. Supply a database/warehouse-backed `source` when production reports require complete bounded aggregation over more rows. A callback returning arbitrary rows still needs site/authorization filtering.

`source.events` supplies events; optional aggregate/numeric methods can avoid materializing every event in the application process. `campaigns` is a separate callback contract for delivery/performance/trend reports. Applications must provide those adapters; setting `campaigns` to an empty object does not create campaign storage.

## TypeScript and callbacks

```ts
import type { ZeruxConfig } from 'zeruxjs';
type ReportsSetup = NonNullable<ZeruxConfig['reports']>;
const reports = {
  enabled: true, site: 'storefront',
  authorize: async (_request, _action, _resourceId) => false,
} satisfies ReportsSetup;
export default { reports } satisfies ZeruxConfig;
```

`satisfies` checks the callback signature. The declared `source`/store interfaces in runtime startup are deliberately structural; for a standalone implementation use the stronger public contracts in `@zeruxjs/reports` where available. Validate saved report JSON before executing a query; a TypeScript cast does not validate persisted documents.

## Production verification

Check anonymous denial, editor versus reader permissions, cross-tenant saved report access, export limits, stale revision rejection and source truncation. Test database outage separately from authorization failure. Reports are optional and can degrade while the rest of the application remains available; an empty or unavailable dashboard is not proof that no analytics events exist.

## Exact option shapes

The fields below come from the current source declarations. Optional is not a default value. A callback is application code, not a string naming a role.

### ReportsStartupConfig

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `prefix` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `authorize` | `(request:Request,action?:'read'\|'edit'\|'export'\|'sensitive'\|'campaign',resourceId?:string)=>boolean\|Promise<boolean>` | Yes | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `dashboardHost` | `string` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `store` | `{load():Promise<any>;save(document:any,expectedVersion:number):Promise<boolean>}` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `source` | `{events(query:any):Promise<any[]>;aggregate?:(query:any)=>Promise<any>;aggregateNumeric?:(query:any)=>Promise<any>;supportsNumericField?:(field:string)=>boolean}` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `resolveScope` | `(request:Request)=>Promise<{site:string;store:{load():Promise<any>;save(document:any,expectedVersion:number):Promise<boolean>};source?:ReportsStartupConfig['source']}>\|{site:string;store:{load():Promise<any>;save(document:any,expectedVersion:number):Promise<boolean>};source?:ReportsStartupConfig['source']}` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `campaigns` | `{report:(code:string,options:{cursor:string\|null;limit:number;site?:string})=>Promise<any>;performance?:(code:string,site?:string)=>Promise<unknown>;dailyTrends?:(code:string,from:string,to:string,site?:string)=>Promise<unknown>;activity?:(code:string,from:string,to:string,site?:string)=>Promise<unknown>}` | No | Application-supplied callback or adapter; see the setup and lifecycle discussion. |
| `maxSourceRows` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `site` | `string` | No | Restrict every report query to one analytics site, independent of saved chart definitions. |


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
