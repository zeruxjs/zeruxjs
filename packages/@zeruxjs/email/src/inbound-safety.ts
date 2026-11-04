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
/** A bounded lexical heuristic, not an HTML sanitizer/parser or a security verdict. */
function inspectMarkup(raw:string,flags:Set<InboundSafetyFlag>):void {
  const html=raw.slice(0,1024*1024);if(html.length!==raw.length)flags.add('body_truncated');
  if(/data\s*:\s*text\/html/i.test(html))flags.add('active_html');
  const active=new Set(['script','iframe','object','embed','form','svg','base','meta','link']);
  let index=0,anchor:{href:string;text:string}|undefined;
  const compare=()=>{
    if(!anchor)return;
    try{
      const actual=new URL(anchor.href).hostname.toLowerCase();
      for(const word of anchor.text.split(/\s+/)){
        if(word.length>2048)continue;
        let start=0,end=word.length;while(start<end&&!/[a-z0-9]/i.test(word[start]))start++;while(end>start&&!/[a-z0-9]/i.test(word[end-1]))end--;
        const value=word.slice(start,end);if(!value.includes('.'))continue;
        try{const shown=new URL(/^https?:\/\//i.test(value)?value:'https://'+value).hostname.toLowerCase();
          if(!/^[a-z0-9.-]+$/.test(shown))continue;
          if(actual!==shown&&!actual.endsWith('.'+shown))flags.add('suspicious_link');break;
        }catch{ /* Not an apparent URL in the display text. */ }
      }
    }catch{flags.add('unsafe_url');}
  };
  while(index<html.length){
    const open=html.indexOf('<',index);
    if(open<0){if(anchor)anchor.text+=(html.slice(index, index+8192-anchor.text.length));break;}
    if(anchor&&anchor.text.length<8192)anchor.text+=html.slice(index,Math.min(open,index+8192-anchor.text.length));
    const close=html.indexOf('>',open+1);if(close<0)break;
    const tag=html.slice(html.lastIndexOf('<',close-1)+1,close);index=close+1;
    if(tag.length>8192){flags.add('body_truncated');continue;}
    const name=/^\s*(\/?)([a-z][a-z0-9]*)\b/i.exec(tag);if(!name)continue;
    const element=name[2].toLowerCase();
    if(name[1]){if(element==='a'){compare();anchor=undefined;}continue;}
    if(active.has(element))flags.add('active_html');
    const attrs=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
    let cursor=name[0].length,href:string|undefined;
    while(cursor<tag.length){if(/\s/.test(tag[cursor])){cursor++;continue;}attrs.lastIndex=cursor;const attr=attrs.exec(tag);if(!attr){cursor++;continue;}cursor=attrs.lastIndex;
      const key=attr[1].toLowerCase(),value=(attr[2]??attr[3]??attr[4]??'').trim();
      if(key.startsWith('on')&&key.length>2)flags.add('active_html');
      if(['href','src'].includes(key)&&/^(?:javascript|data|vbscript|file):/i.test(value))flags.add('unsafe_url');
      if(['img','video','audio'].includes(element)&&['src','poster'].includes(key)&&/^https?:/i.test(value))flags.add('remote_content');
      if(element==='a'&&key==='href'&&/^https?:\/\//i.test(value))href=value;
    }
    if(element==='a'&&href){compare();anchor={href,text:''};}
  }
  compare();
}
/** Pure offline signals only. Integrate an actual antivirus and trusted auth-results verifier separately. */
export function inspectInboundSafety(input:InboundSafetyInput):InboundSafety {
  const flags=new Set<InboundSafetyFlag>();
  inspectMarkup(input.html??'',flags);
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
