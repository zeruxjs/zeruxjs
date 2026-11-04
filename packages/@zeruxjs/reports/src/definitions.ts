import {validateReports} from './model.js';
import type {ReportsDocument} from './types.js';
export {validateReports} from './model.js';
export {validateReportLayout,resolveReportLayout} from './layout.js';
export type {ReportLayoutV1} from './layout.js';
export type {ReportsDocument,ReportDefinition,ReportPage,ChartDefinition,ChartData} from './types.js';
/** Definition-only transfer; no results, credentials, runtime callbacks or version bypass. */
export function exportReportDefinition(document:ReportsDocument):string {
 const value=JSON.stringify({format:'zerux-report',schemaVersion:1,document:validateReports(document)});
 if(new TextEncoder().encode(value).byteLength>262144)throw new RangeError('Definition export exceeds 256 KiB');return value;
}
export function importReportDefinition(text:string):ReportsDocument {
 if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>262144)throw new RangeError('Definition import exceeds 256 KiB');
 const input=JSON.parse(text);if(!input||input.format!=='zerux-report'||input.schemaVersion!==1||Object.keys(input).some(k=>!['format','schemaVersion','document'].includes(k)))throw new TypeError('Unsupported report definition format');return validateReports(input.document);
}
