/* L'Imperial Product Selection: private cross-device Google Sheets team sync.
   Tokens live only in memory. The Apps Script backend verifies them and roles. */
'use strict';
(() => {
 const KEY='li-team-sync-client-config-v1';const APP_ORIGIN=location.origin;
 const DEFAULT_CONFIG={scriptUrl:'https://script.google.com/macros/s/AKfycbzlXPtmjhHpTot4R0ItabhBOQBrNamB2TUegdq6Lde-uX930U1hIohNqRsvUzMW5LYc1g/exec',clientId:'97172665640-k7lq4tqtl8jl3udei8f4f7tml8agfil4.apps.googleusercontent.com'};let config={...DEFAULT_CONFIG};try{config={...DEFAULT_CONFIG,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch(_){config={...DEFAULT_CONFIG}}
 let iframe=null,bridgePopup=null,bridgePeer=null,bridgeOrigin='',bridgeNonce='',bridgeMode='iframe',signInStarted=false,ready=false,token='',email='',role='',displayName='';
 let records=[],brands=[],users=[],lastError='',status='not-connected',reqs=new Map(),pending=0,lastFetched='',fixClientOpen=false;
 const versions=new Map();let gsiLoaded=false,gsiClient='',callbacks=null,interval=null,oneTapOffered=false,credentialInFlight=false;
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 function self(){return {email,role,name:displayName}}
 function hasRole(){return ['Super Admin','Admin','Manager'].includes(role)}
 function normalizeConfigValue(value){return String(value??'').replace(/[\s\u200B-\u200D\uFEFF]+/g,'')}
 function settingsValid(){return /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(normalizeConfigValue(config.clientId))&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(normalizeConfigValue(config.scriptUrl))}
 function statusView(){return {status,email,role,lastError,ready,lastFetched,connected:!!token&&ready}}
 function info(text){const n=document.getElementById('teamSyncNotice');if(n)n.textContent=text}
 function paint(){if(typeof VIEW!=='undefined'&&VIEW==='team')render()}
 function saveConfig(next){const clientId=normalizeConfigValue(next.clientId),scriptUrl=normalizeConfigValue(next.scriptUrl);if(!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId))throw Error('Enter the Web OAuth Client ID from Google Cloud');if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(scriptUrl))throw Error('Enter the deployed Apps Script Web App /exec URL');config={clientId,scriptUrl};localStorage.setItem(KEY,JSON.stringify(config));status='configured';lastError='';disconnect(false);paint();return true}
 function repairClientMarkup(){
  const projectUrl='https://console.cloud.google.com/auth/clients?project=limperialproductselection-sync';
  return '<div class="row-actions" style="margin-top:10px"><button type="button" class="btn quiet small" data-sync-action="fixClient">'+(fixClientOpen?'Hide OAuth diagnostics':'Fix Google Sign-In (401 invalid_client)')+'</button></div>'+
   (fixClientOpen?'<div class="candidate-row" style="margin-top:12px"><h3>Check the Google OAuth Client ID</h3><p class="tiny">Google error 401 means this Client ID is not recognized or is not configured correctly. Open the Cloud Console client in the correct project and use its Copy button. A Client ID is public; never enter the Client Secret.</p><p class="tiny"><a href="'+projectUrl+'" target="_blank" rel="noopener">Open Google Cloud → Clients</a></p><form id="liOAuthClientRepair"><div class="field"><label>Active Web OAuth Client ID</label><input name="clientId" type="text" autocomplete="off" value="'+esc(config.clientId||'')+'" required></div><div class="row-actions"><button class="btn" type="submit">Save verified Client ID</button></div></form><p class="tiny">This changes the login configuration on this computer only. It preserves the Apps Script URL, catalogs, and existing selections. After the correct ID is verified, it can be published as the common default for all staff.</p></div>':'');
 }
 function newNonce(){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
 function bridgeURL(){const url=new URL(config.scriptUrl);url.searchParams.set('li_session',bridgeNonce);return url.toString()}
 function frame(){if(!settingsValid())throw Error('Configure Apps Script URL and OAuth Client ID first');if(iframe||(bridgePopup&&!bridgePopup.closed))return;
  bridgeMode='iframe';bridgeNonce=newNonce();iframe=document.createElement('iframe');iframe.setAttribute('aria-hidden','true');iframe.setAttribute('title','Secure LImperial Google Sync');iframe.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-10000px;';iframe.referrerPolicy='no-referrer';iframe.src=bridgeURL();document.body.appendChild(iframe)}
 function openBridgePopup(){if(!settingsValid())return;ready=false;bridgePeer=null;bridgeOrigin='';bridgeMode='popup';bridgeNonce=newNonce();if(iframe){iframe.remove();iframe=null}
  const windowRef=window.open(bridgeURL(),'liProductSelectionSync','popup=yes,width=570,height=490');
  if(!windowRef){lastError='Chrome blocked the secure connection window. Allow pop-ups for this app and try again.';status='error';paint();return}
  bridgePopup=windowRef;lastError='';status='connecting';signInStarted=false;paint()}
 function acceptedOrigin(origin){try{const u=new URL(origin);return u.protocol==='https:'&&(u.hostname==='script.google.com'||u.hostname==='script.googleusercontent.com'||u.hostname.endsWith('.googleusercontent.com'))}catch(_){return false}}
 window.addEventListener('message',event=>{const d=event.data||{};if(!bridgeNonce||!acceptedOrigin(event.origin)||d.liNonce!==bridgeNonce)return;
  if(d.kind==='LI_SYNC_READY'){bridgeOrigin=event.origin;bridgePeer=event.source;ready=true;status=token?'connecting':'ready';paintStatusOnly();showGoogleButton();return}
  if(d.kind==='LI_SYNC_RESPONSE'&&event.source===bridgePeer&&typeof d.id==='string'&&reqs.has(d.id)){const task=reqs.get(d.id);reqs.delete(d.id);clearTimeout(task.timer);task.resolve(d.result)}});
 async function ensureReady(){frame();if(bridgeMode==='popup'&&bridgePopup?.closed)throw Error('Secure connection window was closed. Reopen it in Team selections.');
  if(ready)return;const start=Date.now();while(!ready&&Date.now()-start<18000){if(bridgeMode==='popup'&&bridgePopup?.closed)break;await new Promise(r=>setTimeout(r,180))}
  if(!ready)throw Error(bridgeMode==='popup'?'Secure Google connection window did not respond. Check if it shows a Google permission or browser error.':'Google Apps Script could not connect inside Chrome. After updating Code.gs and Bridge.html, try the separate secure connection window below.')}
 async function call(op,payload={}){if(!token)throw Error('Sign in with Google first');await ensureReady();const id='req_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reqs.delete(id);reject(Error('Team server did not respond'))},32000);
   reqs.set(id,{timer,resolve:result=>{if(result?.ok)resolve(result.data);else reject(Error(result?.error||'Team sync request failed'))}});
   bridgePeer.postMessage({kind:'LI_SYNC_REQUEST',liNonce:bridgeNonce,id,token,op,payload},bridgeOrigin);
  })}
 function loadGsi(){return new Promise((resolve,reject)=>{if(window.google?.accounts?.id){gsiLoaded=true;resolve();return}let s=document.getElementById('liGoogleIdentity');if(!s){s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.id='liGoogleIdentity';document.head.appendChild(s)}const check=()=>{if(window.google?.accounts?.id){gsiLoaded=true;resolve()}else reject(Error('Google Sign-In did not load. Check your connection.'))};s.addEventListener('load',check,{once:true});s.addEventListener('error',()=>reject(Error('Cannot load Google Sign-In')),{once:true})})}
 function initializeGoogleIdentity(){
  if(!window.google?.accounts?.id||!settingsValid())return false;
  if(gsiClient!==config.clientId){
    google.accounts.id.initialize({
      client_id:config.clientId,
      callback:credential=>onCredential(credential),
      auto_select:true
    });
    gsiClient=config.clientId;
  }
  return true;
}
function offerReturningGoogleSignIn(){
  // Google, not localStorage, owns the remembered account and its consent.
  // One Tap may require a click or be unavailable because of browser settings.
  if(oneTapOffered||token||!initializeGoogleIdentity())return;
  oneTapOffered=true;
  try{google.accounts.id.prompt()}catch(err){
    console.warn('Automatic Google sign-in not available; manual button remains',err);
  }
}
function showGoogleButton(force=false){
  const slot=document.getElementById('liGoogleSignIn');
  if(!slot||!window.google?.accounts?.id||!settingsValid())return false;
  initializeGoogleIdentity();
  if(force||slot.dataset.liClientId!==config.clientId||!slot.querySelector('iframe')){
    slot.innerHTML='';google.accounts.id.renderButton(slot,{type:'standard',shape:'pill',theme:'outline',text:'signin_with',size:'large',width:260});
    slot.dataset.liClientId=config.clientId;
  }
  return true;
}
function paintConnectionError(message){
  const n=document.getElementById('teamSyncConnectError');
  if(n){n.textContent=message||'';n.hidden=!message}
  paintStatusOnly();
}
async function connectButton(force=false){
  if(!settingsValid())return;
  try{
    await loadGsi();
    if(!showGoogleButton(force))throw Error('Could not display Google Sign-In. Refresh the Team selections page.');
    offerReturningGoogleSignIn();
    signInStarted=true;
    paintStatusOnly();
    // The sign-in button does not depend on the private Apps Script iframe.
    // Prepare the bridge separately; never replace the button when it responds.
    if(!ready)ensureReady().then(()=>{lastError='';paintConnectionError('')}).catch(err=>{
      if(!token){lastError=err.message;status='error';paintConnectionError(lastError)}
    });
  }catch(err){
    lastError=err.message;status='error';signInStarted=false;
    paint();
  }
}
function paintStatusOnly(){
  const t=document.getElementById('teamSyncNotice');
  if(t)t.textContent=token?(email?'Signed in as '+email+' · '+role:'Verifying Google sign-in…'):
    ready?'Google connection ready. Sign in to share selections.':'Sign in with Google to access team selections';
}
async function onCredential(credential){
  if(credentialInFlight||!credential?.credential)return;
  credentialInFlight=true;
  token=credential.credential;
  status='connecting';lastError='';paintStatusOnly();
  try{
    await refresh();
    status='connected';lastError='';paint();
    if(!interval)interval=setInterval(()=>{
      if(token&&document.visibilityState!=='hidden')refresh().catch(e=>{status='error';lastError=e.message;paint()});
    },45000);
  }catch(err){
    status='error';
    lastError='Google recognized your account, but Team selections could not authorize it: '+err.message;
    token='';email='';role='';displayName='';paint();
  }finally{credentialInFlight=false}
}
 function disconnect(keepConfig=true,explicitSignOut=false){
  if(explicitSignOut&&window.google?.accounts?.id){
    try{google.accounts.id.disableAutoSelect();google.accounts.id.cancel?.()}catch(_){}
  }
  window.LICentralCatalog?.onSignedOut();token='';email='';role='';displayName='';records=[];brands=[];users=[];versions.clear();ready=false;bridgeOrigin='';if(iframe){iframe.remove();iframe=null}if(bridgePopup){try{bridgePopup.close()}catch(_){ }bridgePopup=null}bridgePeer=null;bridgeNonce='';bridgeMode='iframe';signInStarted=false;for(const req of reqs.values()){clearTimeout(req.timer);req.resolve({ok:false,error:'Disconnected'})}reqs.clear();if(interval){clearInterval(interval);interval=null}status=keepConfig?'not-connected':'configured';paint()}
 async function refresh(){const data=await call('list');email=data.user.email;role=data.user.role;displayName=data.user.name;records=data.selections||[];brands=data.brands||[];users=data.users||[];window.LICentralCatalog?.onSignedIn(data);lastFetched=new Date().toLocaleTimeString();versions.clear();for(const r of records)versions.set(r.recordId,r.revision);
  // Create lightweight brand records for shared suppliers without overwriting local private catalogs.
  const existing=new Set(BRANDS.map(x=>x.id));let changed=false;for(const b of brands){if(!existing.has(b.id)){BRANDS.push({id:b.id,name:b.name,category:b.category||'Other',shared:true});changed=true}}if(changed)persistBrandDirectory();
  return data}
 function productFromLocal(r){if(typeof PACK==='undefined'||!PACK||r.brandId!==ACTIVE_BRAND_ID)return null;if(r.kind==='catalog')return PACK.items.find(x=>x.id===r.itemId)||null;return allVariants().find(x=>x.id===r.itemId)||null}
 function recordId(kind,id){return email+'|'+ACTIVE_BRAND_ID+'|'+kind+'|'+id}
 function snapshot(kind,id){if(!PACK)return null;const item=kind==='catalog'?PACK.items.find(x=>x.id===id):allVariants().find(x=>x.id===id);if(!item)return null;const entry=kind==='catalog'?candidateEntry(item):variantEntry(item);
  return {recordId:recordId(kind,id),brandId:ACTIVE_BRAND_ID,kind,itemId:id,item:{id,code:item.code||'',name:item.name||item.type||'',type:item.type||'',dimension:item.dimension||'',source:item.source||'',sourceRef:item.sourceRef||'',page:item.page||null,photoRef:item.sourceRef||(item.sprite?.atlas?item.sprite.atlas+'#'+item.sprite.index:'')},entry,expectedRevision:versions.get(recordId(kind,id))||0}}
 async function publish(kind,id){if(!token||!email)return;const data=snapshot(kind,id);if(!data)return;if(!hasRole()&&(data.entry.decision==='Approved'||data.entry.supplierStatus==='Confirmed')){lastError='Only management can approve or confirm products for the team.';status='error';paint();return}
  pending++;try{const response=await call('upsert',data);versions.set(response.recordId,response.revision);status='connected';lastError='';await refresh();paint()}catch(err){status='error';lastError=err.message+' — local copy preserved';paint()}finally{pending--}}
 function itemChanged(kind,id){if(!token)return;publish(kind,id).catch(err=>{lastError=err.message;status='error';paint()})}
 async function itemRemoved(kind,id){if(!token)return;const recordKey=recordId(kind,id),version=versions.get(recordKey);if(!version)return;try{await call('remove',{recordId:recordKey,expectedRevision:version});await refresh();paint()}catch(err){status='error';lastError=err.message;paint()}}
 function localSaved(){/* Local drafts are never automatically bulk-published. Specific edited records publish through itemChanged(). */}
 async function publishCurrent(){if(!token)return alert('Sign in first');if(!confirm('Publish the current '+brandNow().name+' selections to authorized staff? Existing locally saved designs will become visible to the team.'))return;
  const items=[];for(const id of Object.keys(S.catalog||{}))items.push(['catalog',id]);for(const [id,e] of Object.entries(S.variants||{}))if(e.decision==='Select'||e.decision==='Approved')items.push(['variant',id]);let done=0,failed=0;
  for(const [kind,id] of items){try{const data=snapshot(kind,id);if(!data)continue;if(!hasRole()&&(data.entry.decision==='Approved'||data.entry.supplierStatus==='Confirmed')){failed++;continue}const res=await call('upsert',data);versions.set(res.recordId,res.revision);done++}catch(e){failed++;lastError=e.message}}
  await refresh();status=failed?'error':'connected';paint();alert('Published '+done+' selection(s).'+(failed?' '+failed+' could not sync; review their status or conflicts.':''))}
 function canRemoveShared(r){return !!r&&(hasRole()||String(r.ownerEmail||'').toLowerCase()===String(email||'').toLowerCase())}
 async function removeShared(id){
  const r=records.find(x=>x.recordId===id&&!x.deleted);
  if(!token||!canRemoveShared(r))return;
  if(!confirm('Remove '+(r.code||r.name||'this item')+' from Team selections? This will not delete the catalog product or local selections.'))return;
  try{
    await call('remove',{recordId:r.recordId,expectedRevision:r.revision});
    await refresh();status='connected';lastError='';paint();
  }catch(err){status='error';lastError='Unable to remove shared selection: '+err.message;paint();}
 }
 async function moderate(id,action){if(!hasRole())return;const r=records.find(x=>x.recordId===id);if(!r)return;const decision=action==='approve'?'Approved':action==='reject'?'Rejected':'Select';const supplierStatus=action==='approve'?'Confirmed':r.supplierStatus;
  try{await call('moderate',{recordId:id,expectedRevision:r.revision,decision,supplierStatus});await refresh();status='connected';lastError='';paint()}catch(err){status='error';lastError=err.message;paint()}}
 async function addUser(form){const data=new FormData(form);try{await call('setUser',{email:String(data.get('email')||''),name:String(data.get('name')||''),role:String(data.get('role')||'Staff'),active:true});await refresh();paint();alert('Staff access updated')}catch(e){status='error';lastError=e.message;paint()}}
 async function brandCreated(brand){if(!token)return;try{await call('brand',{brand:{id:brand.id,name:brand.name,category:brand.category}});await refresh()}catch(err){status='error';lastError='Brand created only locally: '+err.message;paint()}}
 async function importShared(recordId){const record=records.find(r=>r.recordId===recordId);if(!record)return alert('Shared selection not found');
  if(record.brandId!==ACTIVE_BRAND_ID){alert('First open the '+(brands.find(b=>b.id===record.brandId)?.name||record.brandId)+' brand in Brands, then import this selection.');return}
  if(!PACK){alert('Import the private catalog pack for this brand first, then try again.');return}
  let item=PACK.items.find(x=>x.id===record.itemId)||PACK.items.find(x=>x.code&&x.code===record.code);
  if(!item){item={id:ACTIVE_BRAND_ID+'-team-'+record.itemId,code:record.code,name:record.name,type:record.type||'Catalog item',dimension:record.dimension,source:'team',page:record.item?.page||null,sprite:null,photoKind:'missing-photo',verification:'Team record; verify exact supplier photo and code'};
    PACK.items.push(item);PACK.sources.team=PACK.sources.team||{name:'Team shared selections',kind:'shared',productRows:0};PACK.sources.team.productRows++;
    try{await persistActivePack()}catch(e){PACK.items.pop();alert('Unable to save imported team item: '+e.message);return}}
  if(S.catalog[item.id]&&!confirm('Replace your local selection details for '+(item.code||item.name)+' with this team record?'))return;
  S.catalog[item.id]=Object.assign({},record.entry||{},{code:record.code,decision:record.decision,supplierStatus:record.supplierStatus,qty:record.qty});
  if(!S.shortlist.includes(item.id))S.shortlist.push(item.id);
  save();alert('Selection copied to this brand on your computer. It now appears in My selections and can be used in order preparation.');setView('selected')}
 function rowsHTML(){const map=new Map(brands.map(b=>[b.id,b.name]));const visible=records.filter(r=>!r.deleted).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,200);
  return visible.map(r=>{const item=productFromLocal(r);const img=item&&typeof photo==='function'?photo(item.sprite,'selection-thumb'):'<div class="team-photo-placeholder">📦<small>Photo on catalog device</small></div>';return `<article class="candidate-row team-selection-row"><div class="selection-card-head">${img}<div class="selection-card-copy"><div class="tiny">${esc(map.get(r.brandId)||r.brandId)} · ${esc(r.kind)}</div><strong>${esc(r.code||r.itemId)}</strong><div>${esc(r.name||r.item?.name||'Product')}</div><div class="tiny">${esc(r.dimension||'')} · ${esc(r.ownerEmail)}</div><div class="tiny">${esc(r.updatedAt)} · Revision ${r.revision}</div></div></div><div class="team-tags"><span class="pill ${r.decision==='Approved'?'green':'gold'}">${esc(r.decision)}</span><span class="pill">${esc(r.supplierStatus)}</span><span class="tiny">Qty ${esc(r.qty)}</span></div><div class="tiny">${esc(r.notes||'')}</div>${r.brandId===ACTIVE_BRAND_ID?`<div class="row-actions"><button class="btn quiet small" data-sync-action="import" data-record-id="${esc(r.recordId)}">Use in this brand's selections</button></div>`:''}${hasRole()&&r.decision!=='Approved'&&r.decision!=='Rejected'?`<div class="row-actions"><button class="btn small" data-sync-action="approve" data-record-id="${esc(r.recordId)}">Approve & confirm</button><button class="btn danger small" data-sync-action="reject" data-record-id="${esc(r.recordId)}">Reject</button></div>`:''}${canRemoveShared(r)?`<div class="row-actions"><button type="button" class="btn danger small" data-sync-action="removeShared" data-record-id="${esc(r.recordId)}">Remove from Team selections</button></div>`:''}</article>`}).join('')||'<div class="empty"><h3>No shared selections yet</h3><p>Select products in the app and publish them to your team.</p></div>'}
 function render(){const root=document.getElementById('app');if(!root)return;
  if(!settingsValid()){root.innerHTML=`<div class="candidate-row" style="max-width:760px"><h2>Secure Google Sheets team synchronization</h2><p>Configure your dedicated Google Apps Script service and Google OAuth Client ID. The Google Sheet is private; users must be authorized before seeing any selection.</p><form id="liSyncConfigForm"><div class="field"><label>Apps Script Web App /exec URL</label><input name="scriptUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" required></div><div class="field" style="margin-top:12px"><label>Google OAuth Web Client ID</label><input name="clientId" placeholder="123...apps.googleusercontent.com" required></div><div class="row-actions"><button type="submit" class="btn">Save connection settings</button></div></form><p class="tiny">An Apps Script deployment is required before real-time sharing can begin. Do not paste a password, service account key, or API secret.</p></div>`;return}
  root.innerHTML=`<div class="candidate-row"><div class="variant-top"><div><h2>Shared Team Selections</h2><p class="tiny" id="teamSyncNotice">${esc(status==='connected'?'Signed in as '+email+' · '+role:'Sign in with Google to access team selections')}</p>${lastError?`<p class="alert">${esc(lastError)}</p>${!token?'<div class="row-actions"><button class="btn secondary small" data-sync-action="openBridgePopup">Open secure Google connection window</button><a class="btn quiet small" href="'+esc(config.scriptUrl)+'" target="_blank" rel="noopener">Check deployed Web App URL</a></div>':''}`:''}</div><div class="row-actions">${role==='Super Admin'?'<button class="btn quiet small" data-sync-action="reconfigure">Connection settings</button>':''}${token?'<button class="btn quiet small" data-sync-action="signout">Sign out</button>':''}</div></div>${!token?'<div id="liGoogleSignIn" style="min-height:50px;margin:12px 0"></div><p id="teamSyncConnectError" class="alert" hidden></p><div class="row-actions"><button class="btn secondary small" data-sync-action="retrySignIn">Show Google Sign-In</button><button class="btn quiet small" data-sync-action="openBridgePopup">Open secure connection window</button></div>':`<div class="row-actions"><button class="btn secondary small" data-sync-action="refresh">↻ Refresh team selections</button><button class="btn small" data-sync-action="publish">Share my current ${esc(brandNow().name)} selections</button><span class="tiny">Last refreshed: ${esc(lastFetched||'—')} · ${records.length} records</span></div>`}<p class="tiny">Approved staff can browse private supplier catalogs after Google sign-in. New selections and edits sync while signed in; previously saved local drafts are not bulk-published automatically.</p></div>${token?`<div class="subheading"><h2>Team review</h2><span class="tiny">All brands · authorized users only</span></div><div class="row-list">${rowsHTML()}</div>${adminCatalogForm()}${role==='Super Admin'?`<div class="candidate-row"><h3>Manage team access</h3><form id="liTeamAddUser"><div class="variant-fields"><div class="field"><label>Staff email</label><input type="email" name="email" required></div><div class="field"><label>Display name</label><input name="name"></div><div class="field"><label>Role</label><select name="role"><option>Staff</option><option>Manager</option><option>Admin</option><option>Super Admin</option></select></div></div><div class="row-actions"><button class="btn" type="submit">Authorize staff</button></div></form><p class="tiny">Only Super Admin can manage user access. Existing: ${users.length} users.</p></div>`:''}`:''}`;
  if(!token){const slot=document.getElementById('liGoogleSignIn');if(slot)slot.insertAdjacentHTML('afterend',repairClientMarkup());showGoogleButton();if(!signInStarted&&status!=='error'){signInStarted=true;connectButton().catch(e=>{status='error';lastError=e.message;paint()})}}}
 document.addEventListener('submit',e=>{if(e.target.id==='liSyncConfigForm'){e.preventDefault();const d=new FormData(e.target);try{saveConfig({clientId:String(d.get('clientId')||''),scriptUrl:String(d.get('scriptUrl')||'')})}catch(err){alert(err.message)}return}if(e.target.id==='liOAuthClientRepair'){e.preventDefault();const d=new FormData(e.target);try{const clientId=String(d.get('clientId')||'');fixClientOpen=false;gsiClient='';saveConfig({...config,clientId})}catch(err){fixClientOpen=true;alert(err.message)}return}if(e.target.id==='liTeamAddUser'){e.preventDefault();addUser(e.target)}if(e.target.id==='liPublishCatalog'){e.preventDefault();publishCentralCatalog(e.target)}});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-sync-action]');if(!b)return;const act=b.dataset.syncAction;if(act==='fixClient'){fixClientOpen=!fixClientOpen;paint();return}if(act==='retrySignIn'){connectButton(true);return}if(act==='openBridgePopup'){openBridgePopup();return}if(act==='refresh')refresh().then(()=>{status='connected';paint()}).catch(err=>{status='error';lastError=err.message;paint()});if(act==='publish')publishCurrent();if(act==='import')importShared(b.dataset.recordId);if(act==='removeShared')removeShared(b.dataset.recordId);if(act==='approve'||act==='reject')moderate(b.dataset.recordId,act);if(act==='signout'){disconnect(true,true);paint()}if(act==='reconfigure'&&role==='Super Admin'){if(confirm('Change the connection settings for this device? Existing local selections will remain.')){localStorage.removeItem(KEY);config={};disconnect(false);paint()}}});
 function adminCatalogForm(){if(role!=='Super Admin')return '';return '<div class="candidate-row"><h3>Publish private supplier catalog</h3><p class="tiny">Upload the prepared JSON pack to private Google Drive once. Staff will receive its photos automatically after signing in.</p><form id="liPublishCatalog"><div class="variant-fields"><div class="field"><label>Supplier</label><select name="brandId">'+brands.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('')+'</select></div><div class="field span2"><label>Private Drive catalog-pack link</label><input name="driveFile" required placeholder="https://drive.google.com/file/d/.../view"></div></div><label class="tiny"><input type="checkbox" name="confirmUntagged" value="1"> Confirm legacy pack without an internal brand label (Asfour)</label><div class="row-actions"><button type="submit" class="btn secondary">Publish catalog</button></div></form></div>'}
 async function publishCentralCatalog(form){if(role!=='Super Admin')return;const d=new FormData(form),brandId=String(d.get('brandId')||''),driveFile=String(d.get('driveFile')||'').trim();if(!confirm('Publish this private Drive catalog to authorized staff?'))return;try{const result=await call('publishCatalog',{brandId,driveFile,confirmUntagged:d.has('confirmUntagged')});await refresh();if(result.brandId===ACTIVE_BRAND_ID)window.LICentralCatalog?.ensureBrand(brandId,true).catch(()=>{});alert(result.itemCount+' products published for '+brandId);paint()}catch(err){alert('Catalog publishing failed: '+err.message)}}
 function init(){
  // Ask Google to restore an authorized account once per app load. No token is
  // saved to localStorage, and a manual button remains when auto sign-in fails.
  if(!settingsValid())return;
  loadGsi().then(()=>{
    initializeGoogleIdentity();
    offerReturningGoogleSignIn();
  }).catch(err=>console.warn('Google auto sign-in unavailable',err));
}
 window.LITeamSync={init,render,itemChanged,itemRemoved,localSaved,brandCreated,status:statusView,getRoles:()=>self(),refresh,disconnect,request:call};
})();
