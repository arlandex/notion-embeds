// The original HTML is stored unchanged; this is its isolated editing view.
// No database keys, session tokens, or network access enter this frame.
export function mountArtifact(frame, html, fields = {}, onChange = () => {}) {
 const doc = new DOMParser().parseFromString(html, 'text/html');
 const nonce = crypto.randomUUID().replaceAll('-', '');
 doc.querySelectorAll('script,base,iframe,object,embed,meta[http-equiv],link').forEach(e => e.remove());
 for (const e of doc.querySelectorAll('*')) {
  for (const a of [...e.attributes]) {
   if (/^on/i.test(a.name) || ['srcdoc','action','formaction'].includes(a.name.toLowerCase())) e.removeAttribute(a.name);
  }
 }
 const policy = doc.createElement('meta');
 policy.httpEquiv = 'Content-Security-Policy';
 policy.content = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`;
 doc.head.prepend(policy);
 // Serialize before adding the nonce: browsers may hide nonce attributes when
 // serializing DOM nodes, which would prevent the trusted bridge from running.
 const bridgeMarkup = `<script nonce="${nonce}">(${editorBridge.toString()})('${nonce}');</script>`;
 frame.setAttribute('sandbox', 'allow-scripts');
 frame.setAttribute('referrerpolicy', 'no-referrer');
 const channel = new MessageChannel();
 let sequence = 0, destroyed = false;
 const pending = new Map();
 const request = (action, value) => new Promise((resolve, reject) => {
  if (destroyed) return reject(Error('Editor closed'));
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error('Editor did not respond. Keep this page open.')); }, 10000);
  pending.set(id, {resolve, reject, timer});
  channel.port1.postMessage({id, action, value});
 });
 channel.port1.onmessage = ({data}) => {
  if (data?.event === 'changed') return onChange();
  if (data?.event === 'height' && Number.isFinite(data.value)) {
   frame.style.height = Math.min(100000, Math.max(300, data.value)) + 'px';
   return;
  }
  const job = pending.get(data?.id);
  if (!job) return;
  clearTimeout(job.timer); pending.delete(data.id);
  data.error ? job.reject(Error(data.error)) : job.resolve(data.value);
 };
 let connected;
 const ready = new Promise((resolve, reject) => {
  connected = event => {
   if(event.source!==frame.contentWindow || event.data?.ready!==nonce) return;
   window.removeEventListener('message',connected);
   frame.contentWindow.postMessage({type:'c3-connect'}, '*', [channel.port2]);
   request('apply', fields).then(resolve, reject);
  };
  window.addEventListener('message',connected);
 });
 frame.srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML.replace('</body>',bridgeMarkup+'</body>');
 return {
  ready,
  async snapshot() { await ready; return request('snapshot'); },
  async apply(value) { await ready; return request('apply', value); },
  destroy() {
   destroyed = true; window.removeEventListener('message',connected); channel.port1.close();
   for (const job of pending.values()) { clearTimeout(job.timer); job.reject(Error('Editor closed')); }
   pending.clear(); frame.removeAttribute('srcdoc');
  }
 };
}

function editorBridge(nonce) {
 let port;
 const elements = [...document.querySelectorAll('input:not([type=button]):not([type=submit]):not([type=reset]):not([type=file]),textarea,select,[contenteditable=true]')];
 const keys = new Set();
 const keyed = elements.map((e, index) => {
  const key = e.dataset.c3Field || e.id || 'field-' + index;
  if (keys.has(key)) throw Error('Duplicate editable field identifier: ' + key);
  keys.add(key); return [key, e];
 });
 function snapshot() {
  return Object.fromEntries(keyed.map(([key,e]) => [key,
   e.matches('[contenteditable=true]') ? e.textContent :
   e.type === 'checkbox' || e.type === 'radio' ? e.checked :
   e.tagName === 'SELECT' && e.multiple ? [...e.selectedOptions].map(o => o.value) : e.value]));
 }
 function fit() {
  for (const e of document.querySelectorAll('textarea')) { e.style.height='auto'; e.style.height=(e.scrollHeight+2)+'px'; }
  port?.postMessage({event:'height', value:document.documentElement.scrollHeight});
 }
 function apply(values) {
  for (const [key,e] of keyed) {
   if (!Object.hasOwn(values,key)) continue;
   const value = values[key];
   if (e.matches('[contenteditable=true]')) e.textContent = String(value ?? '');
   else if (e.type === 'checkbox' || e.type === 'radio') e.checked = value === true;
   else if (e.tagName === 'SELECT' && e.multiple) for (const o of e.options) o.selected = Array.isArray(value) && value.includes(o.value);
   else e.value = String(value ?? '');
  }
  fit(); return snapshot();
 }
 // Only the parent supplies a private message port. The frame never gets credentials.
 window.addEventListener('message', function connect(event) {
  if (event.source !== parent || event.data?.type !== 'c3-connect' || !event.ports[0] || port) return;
  port = event.ports[0];
  port.onmessage = ({data}) => {
   try {
    const value = data.action === 'snapshot' ? snapshot() : data.action === 'apply' ? apply(data.value) : (() => { throw Error('Unknown editor operation'); })();
    port.postMessage({id:data.id, value});
   } catch (error) { port.postMessage({id:data.id,error:error.message}); }
  };
  port.start(); fit();
 });
 document.addEventListener('input', () => { fit(); port?.postMessage({event:'changed'}); });
 document.addEventListener('change', () => { fit(); port?.postMessage({event:'changed'}); });
 document.addEventListener('submit', event => event.preventDefault());
 document.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
 new ResizeObserver(fit).observe(document.body);
 parent.postMessage({ready:nonce},'*');
}
