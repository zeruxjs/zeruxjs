import type {EmailAddress, EmailRecipients, RecipientRule} from './types.js';
import {addressString,recipientList} from './validation.js';
function canonical(address:string){return address.trim().toLowerCase();}
function matches(pattern:string,email:string):boolean{
  const value=canonical(email);const mask=canonical(pattern);
  if(!mask||mask.length>320||!/^[@a-z0-9._+*%-]+$/.test(mask))throw new TypeError('Invalid email filter pattern');
  // Restrict wildcards to whole domain or prefix: no regex injection.
  if(mask.startsWith('*@'))return value.endsWith(mask.slice(1));
  if(mask.startsWith('@'))return value.endsWith(mask);
  if(mask.includes('*'))throw new TypeError('Wildcard must be *@domain');
  return value===mask;
}
export function createRecipientFilter(initial:RecipientRule[]=[],blocked:string[]=[]){
  let rules:RecipientRule[]=[];const suppressed=new Set<string>();
  const api={
    addRule(rule:RecipientRule){if(!['allow','block'].includes(rule.action)||!rule.pattern)throw new TypeError('Invalid recipient rule');matches(rule.pattern,'test@example.com');if(rule.account&&!/^[a-z][a-z0-9_-]{0,63}$/.test(rule.account))throw new TypeError('Invalid account selector');rules.push({...rule});},
    setRules(next:RecipientRule[]){rules=[];next.forEach(api.addRule);},
    listRules(){return rules.map(r=>({...r}));},
    suppress(email:string){const value=canonical(addressString(email));matches(value,value);suppressed.add(value);},
    unsuppress(email:string){return suppressed.delete(canonical(email));},
    listSuppressions(){return [...suppressed].sort();},
    evaluate(recipients:EmailRecipients,account?:string){
      const accepted:EmailAddress[]=[],rejected:{address:EmailAddress;reason:string}[]=[];
      for(const address of recipientList(recipients)){
        const value=addressString(address),rule=[...rules].reverse().find(r=>(!r.account||r.account===account)&&matches(r.pattern,value));
        if(suppressed.has(canonical(value)))rejected.push({address,reason:'suppressed'});
        else if(rule?.action==='block')rejected.push({address,reason:rule.reason??'blocked'});
        else accepted.push(address);
      }
      return {accepted,rejected};
    },
  };
  initial.forEach(api.addRule);blocked.forEach(api.suppress);
  return api;
}
export type RecipientFilter=ReturnType<typeof createRecipientFilter>;
