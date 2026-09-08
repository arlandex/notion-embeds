// Authentication lives in the host application, never the artifact iframe.
export function canonical(value) {
 if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if (value !== null && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export class CardStorage {
 constructor({url,publishableKey,getAccessToken,fetchImpl=fetch}) {
  const origin=new URL(url);
  if(origin.protocol!=='https:') throw Error('HTTPS is required');
  this.url=origin.origin;this.key=publishableKey;this.token=getAccessToken;this.fetch=(...args)=>fetchImpl(...args);
 }
 async request(path,body) {
  const token=await this.token();
  if(!token) throw Error('Sign in before opening or saving cards');
  const response=await this.fetch(this.url+'/rest/v1/'+path,{
   method:body===undefined?'GET':'POST',cache:'no-store',
   headers:{apikey:this.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const result=await response.json();
  if(!response.ok) throw Error(result.message||'Storage request failed');
  return result;
 }
 async versions(cardId) {
  return this.request('card_versions?card_id=eq.'+encodeURIComponent(cardId)+'&select=*&order=version.desc');
 }
 // Keep this returned operation unchanged until it is confirmed. Retrying it
 // after a lost response reuses the same idempotency key and snapshot.
 prepare({cardId,expectedVersion,html,fields,isNew=false}) {
  const snapshot=JSON.parse(JSON.stringify(fields));
  return {isNew,body:isNew?{p_id:cardId,p_html:html,p_fields:snapshot,p_request:crypto.randomUUID()}:
   {p_card:cardId,p_expected:expectedVersion,p_html:html,p_fields:snapshot,p_request:crypto.randomUUID()}};
 }
 async commit(operation) {
  const saved=await this.request('rpc/'+(operation.isNew?'create_card':'save_card_version'),operation.body);
  const rows=await this.request('card_versions?card_id=eq.'+encodeURIComponent(saved.card_id)+'&version=eq.'+saved.version+'&select=*');
  const check=rows[0];
  if(rows.length!==1||check.request_id!==operation.body.p_request||check.html!==operation.body.p_html||canonical(check.fields)!==canonical(operation.body.p_fields))
   throw Error('Save could not be verified. Keep this page open and retry.');
  return check;
 }
}
