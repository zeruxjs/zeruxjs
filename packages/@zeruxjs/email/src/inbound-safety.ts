/** Advisory inbound-mail analysis. This is NOT a malware scanner, spam filter, or proof of SPF/DKIM/DMARC. */
export type InboundRisk='low'|'review'|'high';
export type InboundSafetyFlag=
  |'active_html'|'unsafe_url'|'remote_content'|'suspicious_link'|'executable_attachment'
  |'macro_attachment'|'encrypted_archive'|'oversized_attachment'|'possible_spam'
  |'missing_sender'|'header_control_characters'|'body_truncated'|'attachment_content_omitted'
  |'external_spam'|'external_phishing'|'external_malware'|'external_review'|'attachment_scanner_blocked'|'attachment_scanner_suspicious';
export interface InboundSafety {
  /** Deterministic advisory score; NOT a calibrated probability. */
  score:number;
  risk:InboundRisk;
  flags:InboundSafetyFlag[];
  /** Authentication claims inside received headers are never trusted here. */
  authentication:'unverified';
  engine:'zerux-heuristic-v1';
  externalVerdict?:'clean'|'spam'|'phishing'|'malware'|'review';
}
export interface InboundSafetyInput {
  subject?:string;from?:string[];html?:string;text?:string;
  attachments?:{filename?:string;size?:number;contentType?:string}[];
  bodyTruncated?:boolean;attachmentContentOmitted?:boolean;
  externalVerdict?:InboundSafety['externalVerdict'];attachmentVerdicts?:Array<'clean'|'suspicious'|'blocked'|'unscanned'>;
}
const risks:Record<InboundSafetyFlag,number>={
  active_html:35,unsafe_url:40,remote_content:8,suspicious_link:30,executable_attachment:60,
  macro_attachment:40,encrypted_archive:16,oversized_attachment:15,possible_spam:15,
  missing_sender:15,header_control_characters:15,body_truncated:5,attachment_content_omitted:5,
  external_spam:45,external_phishing:75,external_malware:100,external_review:20,attachment_scanner_blocked:95,attachment_scanner_suspicious:50
};
/** Pure offline signals only. Integrate an actual antivirus and trusted auth-results verifier separately. */
export function inspectInboundSafety(input:InboundSafetyInput):InboundSafety {
  const flags=new Set<InboundSafetyFlag>();
  const html=input.html??'';
  if(/<\s*(script|iframe|object|embed|form|svg|base|meta|link)\b|\bon\w+\s*=|data\s*:\s*text\/html/i.test(html))flags.add('active_html');
  if(/(?:href|src)\s*=\s*['"\s]*(?:javascript:|data:|vbscript:|file:)/i.test(html))flags.add('unsafe_url');
  if(/<\s*(img|video|audio)\b[^>]*\b(?:src|poster)\s*=\s*['"]?https?:/i.test(html))flags.add('remote_content');
  for(const match of html.matchAll(/<a\s+[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text=match[2].replace(/<[^>]*>/g,'').trim();
    const shown=text.match(/(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\b/i);
    if(shown){try{const actual=new URL(match[1]).hostname.toLowerCase();const claimed=shown[1].toLowerCase();
      if(actual!==claimed&&!actual.endsWith('.'+claimed))flags.add('suspicious_link');}catch{flags.add('unsafe_url');}}
  }
  if(!(input.from??[]).length)flags.add('missing_sender');
  if(/[\r\n\0]/.test(input.subject??'')||(input.from??[]).some(s=>/[\r\n\0]/.test(s)))flags.add('header_control_characters');
  if(/(?:urgent.{0,30}verify|verify.{0,30}password|claim.{0,20}prize|wire transfer.{0,20}urgent)/i.test(`${input.subject??''} ${input.text?.slice(0,2000)??''}`))flags.add('possible_spam');
  for(const attachment of input.attachments??[]) {
    const name=attachment.filename??'';
    if(/\.(exe|scr|com|bat|cmd|ps1|vbs|js|jse|wsf|hta|msi|dll|lnk|jar|sh)$/i.test(name))flags.add('executable_attachment');
    if(/\.(docm|xlsm|pptm|xlam)$/i.test(name))flags.add('macro_attachment');
    if(/\.(7z|zip|rar|pdf)$/i.test(name)&&/password|encrypted/i.test(`${input.subject??''} ${name}`))flags.add('encrypted_archive');
    if((attachment.size??0)>8*1024*1024)flags.add('oversized_attachment');
  }
  if(input.externalVerdict&&input.externalVerdict!=='clean')
    flags.add(({spam:'external_spam',phishing:'external_phishing',malware:'external_malware',review:'external_review'} as const)[input.externalVerdict]);
  if(input.attachmentVerdicts?.includes('blocked'))flags.add('attachment_scanner_blocked');
  if(input.attachmentVerdicts?.includes('suspicious'))flags.add('attachment_scanner_suspicious');
  if(input.bodyTruncated)flags.add('body_truncated');
  if(input.attachmentContentOmitted)flags.add('attachment_content_omitted');
  const score=Math.min(100,[...flags].reduce((sum,flag)=>sum+risks[flag],0));
  return {score,risk:score>=60?'high':score>=20?'review':'low',flags:[...flags].sort(),authentication:'unverified',engine:'zerux-heuristic-v1',
    ...(input.externalVerdict?{externalVerdict:input.externalVerdict}:{})};
}
