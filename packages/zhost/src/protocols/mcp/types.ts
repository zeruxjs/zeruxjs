export interface McpTool {name:string;description?:string;inputSchema?:Record<string,unknown>;handler:(args:Record<string,unknown>)=>unknown|Promise<unknown>}
export interface JsonRpcRequest {jsonrpc:'2.0';id?:string|number|null;method:string;params?:unknown}
export interface JsonRpcResponse {jsonrpc:'2.0';id:string|number|null;result?:unknown;error?:{code:number;message:string}}
export interface McpResource {uri:string;name:string;description?:string;mimeType?:string;text:string}
