import type {AnalyticsManager} from '@zeruxjs/analytics';
import type {RequestIdStore} from '@zeruxjs/analytics';
export type Scalar=string|number|boolean|null;
export type Values=Record<string,Scalar>;
export interface TagEvent {name:string;properties:Values;site?:string;pathname?:string;sessionId?:string;requestId:string;requestUtcDay:string;source:'web'|'server';data?:Values}
export interface Condition {field:string;operator:'eq'|'neq'|'contains'|'exists'|'gte'|'lte';value?:Scalar}
export interface Trigger {id:string;name:string;type:'event'|'all'|'pageview'|'click'|'form'|'history';event?:string;conditions?:Condition[];enabled?:boolean}
export interface Variable {id:string;name:string;type:'constant'|'event'|'dataLayer'|'context';key?:string;value?:Scalar}
export interface TagDefinition {id:string;name:string;type:'analytics'|'ga4'|'webhook';triggerIds:string[];enabled?:boolean;eventName?:string;measurementId?:string;credentialRef?:string;destinationRef?:string;clientIdVariable?:string;parameters?:Record<string,Scalar|string>}
/** A historical release is immutable; revisions (container.version) advance on every edit. */
export interface TagRelease {id:number;at:string;action:'initial'|'publish'|'rollback';container:TagContainer}
export interface TagGovernance {release:number;published:TagContainer;history:TagRelease[]}
export interface TagContainer {id:string;version:number;name:string;triggers:Trigger[];tags:TagDefinition[];variables:Variable[];governance?:TagGovernance}
export interface TagContainerStore {load():Promise<TagContainer>;save(container:TagContainer,expectedVersion:number):Promise<boolean>}
export interface TagRuntimeOptions {
  analytics:AnalyticsManager;
  /** A shared atomic store is REQUIRED for cross-instance request-ID uniqueness. */
  requestIds:RequestIdStore;
  store?:TagContainerStore;
  container?:TagContainer;
  prefix?:string;
  /** Absolute public origin for a separate tagging subdomain; browser sends here. */
  publicOrigin?:string;
  site?:string;
  allowedOrigins?:string[];
  serverToken?:string;
  /** Secrets resolved server-side; never included in an exposed container. */
  credentials?:Record<string,{secret:string}>;
  destinations?:Record<string,{url:string;headers?:Record<string,string>}>;
  fetch?:typeof fetch;
  /** No admin routes are created unless an application authorizer is supplied. */
  authorizeAdmin?:(request:Request)=>boolean|Promise<boolean>;
  /** An independent permission check; without this callback no one may publish or roll back. */
  authorizePublish?:(request:Request)=>boolean|Promise<boolean>;
  /** Browser event consent is a client assertion; still enforce consent at collection ingress. */
  requireBrowserConsent?:boolean;
  /** Bind approved origins to fixed site identities; never trust browser-supplied site names. */
  siteByOrigin?:Record<string,string>;
  botPolicy?:'allow'|'drop-known';
  dashboardHost?:string;
  debug?:boolean;
  /** Initial telemetry setting, independent of email consent. */
  defaultConsent?:'granted'|'denied';
  onDebug?:(data:{requestId:string;event:string;matchedTriggers:string[];firedTags:string[];failures:string[]})=>void;
  /** Fail-soft sink, store and ID warnings. Never receives credentials, URLs or event payloads. */
  onWarning?:(message:string)=>void;
  maxBodyBytes?:number;
  maxEventsPerMinute?:number;
}
