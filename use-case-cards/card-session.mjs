import {canonical} from './storage.mjs';

// UI-independent version lifecycle. A failed save retains its exact operation.
export class CardSession {
 constructor(storage) {
  this.storage=storage; this.cardId=null; this.version=0;
  this.html=''; this.fields={}; this.pending=null; this.saving=false;
  this.saved=null; this.history=[];
 }
 get dirty() {
  return !this.saved || this.html!==this.saved.html || canonical(this.fields)!==canonical(this.saved.fields);
 }
 async open(cardId) {
  if(this.pending || this.saving) throw Error('Resolve the pending save before opening another card.');
  const rows=await this.storage.versions(cardId);
  if(!rows.length) throw Error('Card unavailable. Your current work is still open.');
  this.cardId=cardId; this.history=rows; this.version=rows[0].version;
  this.html=rows[0].html; this.fields=structuredClone(rows[0].fields);
  this.saved=structuredClone(rows[0]);
 }
 newBlank(html, blankFields) {
  if(this.pending || this.saving) throw Error('Resolve the pending save before creating another card.');
  this.cardId=crypto.randomUUID(); this.version=0; this.history=[];
  this.html=html; this.fields=structuredClone(blankFields); this.saved=null;
 }
 edit(fields) { this.fields=structuredClone(fields); }
 useDesign(html, fields) {
  this.html=html; this.fields=structuredClone(fields);
 }
 restore(version) {
  if(this.pending || this.saving) throw Error('Resolve the pending save before restoring a version.');
  const row=this.history.find(row=>row.version===version);
  if(!row) throw Error('Version unavailable');
  this.html=row.html; this.fields=structuredClone(row.fields);
  // Keep the latest version as the write baseline: restore appends, never overwrites.
 }
 async save() {
  if(this.saving) throw Error('Save already in progress');
  if(!this.cardId) throw Error('Open or create a card first');
  this.saving=true;
  try {
   this.pending ||= this.storage.prepare({cardId:this.cardId,expectedVersion:this.version,
    html:this.html,fields:this.fields,isNew:this.version===0});
   const row=await this.storage.commit(this.pending);
   this.version=row.version; this.saved=structuredClone(row);
   this.history=[row,...this.history.filter(v=>v.version!==row.version)];
   this.pending=null;
   return {version:row.version,time:row.created_at,hasUnsavedChanges:this.dirty};
  } finally { this.saving=false; }
 }
}

export function emptyFields(fields) {
 return Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,
  typeof value==='boolean'?false:Array.isArray(value)?[]:'']));
}
