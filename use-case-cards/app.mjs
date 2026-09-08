import {CardStorage} from './storage.mjs';
import {CardSession,emptyFields} from './card-session.mjs';
import {mountArtifact} from './artifact.mjs';
const $=id=>document.getElementById(id);
let config,auth,session,editor,edits=0,busy=false;
const say=text=>{$('status').textContent=text;};
function lock(value){busy=value;for(const id of ['save','new','versions','design','signout'])$(id).disabled=value;}
async function authRequest(path,body){
 const response=await fetch(config.url+'/auth/v1/'+path,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok)throw Error(data.msg||data.error_description||data.message||'Sign-in failed');
 return data;
}
async function accessToken(){
 if(!auth)return null;
 if(auth.expires_at*1000<Date.now()+60000){
  auth=await authRequest('token?grant_type=refresh_token',{refresh_token:auth.refresh_token});
  auth.expires_at=Date.now()/1000+auth.expires_in;
 }
 return auth.access_token;
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
function link(){history.replaceState(null,'','?card='+session.cardId);}
$('login').onsubmit=async event=>{
 event.preventDefault();const button=$('login').querySelector('button');button.disabled=true;
 try{
  say('Signing in…');auth=await authRequest('token?grant_type=password',{email:$('email').value,password:$('password').value});
  $('password').value='';auth.expires_at=Date.now()/1000+auth.expires_in;
  session=new CardSession(new CardStorage({url:config.url,publishableKey:config.publishableKey,getAccessToken:accessToken}));
  const id=new URLSearchParams(location.search).get('card');
  if(id)await session.open(id);
  else {const response=await fetch('./c3-template.html');if(!response.ok)throw Error('Template unavailable');session.newBlank(await response.text(),{});}
  $('login').hidden=true;$('workspace').hidden=false;await render();link();
  say(session.version?'Loaded saved version '+session.version:'New card · Edit fields and save your first version.');
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
 session.newBlank(session.html,emptyFields(session.fields));await render();edits=0;link();say('New independent card · Edit fields and save your first version.');
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
 auth=null;editor.destroy();editor=null;session=null;edits=0;$('workspace').hidden=true;$('login').hidden=false;say('Signed out on this page.');
 }catch(error){say(error.message);}finally{lock(false);}
};
window.addEventListener('beforeunload',event=>{if(session&&(session.dirty||session.pending||edits)){event.preventDefault();event.returnValue='';}});
try{
 const response=await fetch('./config.json',{cache:'no-store'});
 if(!response.ok)throw Error('Cloud setup is still in progress. Your existing saved cards have not changed.');
 config=await response.json();config.url=new URL(config.url).origin;
 if(!config.url.startsWith('https://')||!config.publishableKey)throw Error('Cloud configuration is incomplete.');
 $('login').hidden=false;say('Sign in to continue.');
}catch(error){say(error.message);}
