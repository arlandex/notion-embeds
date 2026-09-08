import {CardStorage} from './storage-v2.mjs';
import {CardSession,emptyFields} from './card-session.mjs';
import {mountArtifact} from './artifact.mjs';
const $=id=>document.getElementById(id);
let config,auth,session,editor,edits=0,busy=false;
const authKey='c3-auth-dopwoavnxsgwvvypqgpa';
let storageWarning='';
function readAuth(){try{return JSON.parse(localStorage.getItem(authKey)||'null');}catch{return null;}}
function remember(){try{localStorage.setItem(authKey,JSON.stringify(auth));storageWarning='';}catch{storageWarning=' This browser blocked remembered sign-in; you will need to sign in after reopening.';}}
const say=text=>{$('status').textContent=text+storageWarning;};
function lock(value){busy=value;for(const id of ['save','new','versions','design','signout','mycards'])$(id).disabled=value;}
async function authRequest(path,body){
 const response=await fetch(config.url+'/auth/v1/'+path,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok)throw Error(data.msg||data.error_description||data.message||'Sign-in failed');
 return data;
}
async function accessToken(){
 const refresh=async()=>{
  const stored=readAuth();
  if(stored?.refresh_token)auth=stored;
  if(!auth)return null;
  if(auth.expires_at*1000<Date.now()+60000){
   auth=await authRequest('token?grant_type=refresh_token',{refresh_token:auth.refresh_token});
   auth.expires_at=Date.now()/1000+auth.expires_in;remember();
  }
  return auth.access_token;
 };
 return navigator.locks ? navigator.locks.request(authKey,refresh) : refresh();
}
function updateHistory(){
 $('versions').replaceChildren(new Option('Version history',''));
 for(const row of session.history)$('versions').add(new Option('Version '+row.version+' · '+new Date(row.created_at).toLocaleString(),row.version));
}
async function render(){
 editor?.destroy();
 editor=mountArtifact($('artifact'),session.html,session.fields,()=>{edits++;say('Unsaved changes · Press Save version.');});
 await editor.ready;
 session.edit(await editor.snapshot());
 updateHistory();
}
async function collect(){session.edit(await editor.snapshot());}
function discardAllowed(){
 if(session.pending){say('A save is awaiting confirmation. Press Retry save before switching cards.');return false;}
 return !session.dirty&&!edits || confirm('Discard unsaved changes?');
}
function link(){
 const routeCard=document.documentElement.dataset.cardId;
 const target=routeCard===session.cardId ? location.pathname : new URL('?card='+session.cardId,document.baseURI).href;
 history.replaceState(null,'',target);
}
async function openWorkspace(){
  session=new CardSession(new CardStorage({url:config.url,publishableKey:config.publishableKey,getAccessToken:accessToken}));
  const id=new URLSearchParams(location.search).get('card') || document.documentElement.dataset.cardId;
  if(id)await session.open(id);
  else {const response=await fetch('./c3-template.html');if(!response.ok)throw Error('Template unavailable');session.newBlank(await response.text(),{});}
  $('login').hidden=true;$('workspace').hidden=false;await render();link();
  say(session.version?'Loaded saved version '+session.version:'New card · Edit fields and save your first version.');
  if(!id)await showLibrary();
}
$('login').onsubmit=async event=>{
 event.preventDefault();const button=$('login').querySelector('button');button.disabled=true;
 try{
  say('Signing in…');auth=await authRequest('token?grant_type=password',{email:$('email').value,password:$('password').value});
  $('password').value='';auth.expires_at=Date.now()/1000+auth.expires_in;remember();
  await openWorkspace();
 }catch(error){say(error.message);}finally{button.disabled=false;}
};
$('save').onclick=async()=>{
 if(busy)return;lock(true);
 try{
  const started=edits;await collect();say('Saving and verifying…');
  const saved=await session.save();updateHistory();
  if(edits===started)edits=0;
  say('Version '+saved.version+' saved and verified · '+new Date(saved.time).toLocaleString()+(saved.hasUnsavedChanges||edits?' · New edits remain unsaved.':''));
  $('save').textContent='Save version';
 }catch(error){say('Save not confirmed: '+error.message+' Keep this page open and retry.');$('save').textContent='Retry save';}
 finally{lock(false);}
};
$('new').onclick=async()=>{
 if(busy)return;lock(true);
 try{await collect();if(!discardAllowed())return;
 session.newBlank(session.html,emptyFields(session.fields));await render();edits=0;link();showEditor();say('New independent card · Edit fields and save your first version.');
 }catch(error){say(error.message);}finally{lock(false);}
};
$('versions').onchange=async event=>{
 if(!event.target.value||busy)return;lock(true);
 try{await collect();if(!discardAllowed())return;session.restore(Number(event.target.value));await render();edits=0;say('Older version loaded · Save version keeps it as a new version.');}
 catch(error){say(error.message);}finally{lock(false);}
};
$('design').onchange=async event=>{
 const file=event.target.files[0];if(!file||busy)return;lock(true);
 try{if(file.size>2000000)throw Error('HTML must be smaller than 2 MB');await collect();session.useDesign(await file.text(),session.fields);await render();edits++;say('Updated design · Save version to keep it.');}
 catch(error){say(error.message);}finally{event.target.value='';lock(false);}
};
$('signout').onclick=async()=>{
 if(busy)return;lock(true);
 try{
 await collect();if(!discardAllowed())return;
 localStorage.removeItem(authKey);storageWarning='';auth=null;editor.destroy();editor=null;session=null;edits=0;$('workspace').hidden=true;$('login').hidden=false;say('Signed out on this page.');
 }catch(error){say(error.message);}finally{lock(false);}
};

function showEditor(){ $('library').hidden=true; $('editing').hidden=false; }
async function showLibrary(){
 $('editing').hidden=true; $('library').hidden=false;
 const list=$('cardlist');list.replaceChildren();$('library-status').textContent='Loading saved cards…';
 try{
  const latest=new Map();let offset=0;
  for(;;){
   const rows=await session.storage.request('card_versions?select=card_id,version,fields,created_at&order=created_at.desc,card_id.asc,version.desc&limit=500&offset='+offset);
   for(const row of rows){const prev=latest.get(row.card_id);if(!prev||row.version>prev.version)latest.set(row.card_id,row);}
   if(rows.length<500)break;offset+=rows.length;
  }
  for(const row of [...latest.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at))){
   const button=document.createElement('button');button.type='button';
   button.textContent=(String(row.fields['card-title']||'Untitled card'))+' · Version '+row.version;
   button.onclick=async()=>{if(busy)return;lock(true);try{await session.open(row.card_id);await render();edits=0;link();showEditor();say('Loaded saved version '+session.version);}catch(e){say(e.message);}finally{lock(false);}};
   list.append(button);
  }
  $('library-status').textContent=latest.size?latest.size+' saved cards. Select a card to continue editing.':'No saved cards yet. Create your first card.';
 }catch(e){$('library-status').textContent='Could not load cards: '+e.message+' Press My cards to retry.';}
}
$('mycards').onclick=async()=>{
 if(busy)return;lock(true);
 try{if(!$('editing').hidden){await collect();if(edits||session.pending||(session.version>0&&session.dirty)){if(!discardAllowed())return;}}
 await showLibrary();}catch(e){say(e.message);}finally{lock(false);}
};
$('createcard').onclick=async()=>{
 if(busy)return;lock(true);
 try{const r=await fetch('./c3-template.html');if(!r.ok)throw Error('Template unavailable');session.newBlank(await r.text(),{});await render();edits=0;link();showEditor();say('New card · Give it a name, edit and press Save version. Find it later in My cards.');}
 catch(e){say(e.message);}finally{lock(false);}
};

window.addEventListener('beforeunload',event=>{if(session&&(session.dirty||session.pending||edits)){event.preventDefault();event.returnValue='';}});
try{
 const response=await fetch('./config.json',{cache:'no-store'});
 if(!response.ok)throw Error('Cloud setup is still in progress. Your existing saved cards have not changed.');
 config=await response.json();config.url=new URL(config.url).origin;
 if(!config.url.startsWith('https://')||!config.publishableKey)throw Error('Cloud configuration is incomplete.');
 auth=readAuth();
 if(auth?.refresh_token){say('Restoring your sign-in…');try{await accessToken();await openWorkspace();}catch(error){$('login').hidden=false;say('Could not restore your session: '+error.message);}}
 else {$('login').hidden=false;say('Sign in to continue.');}
}catch(error){say(error.message);}
