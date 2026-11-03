/* L'Imperial Product Selection: private cross-device Google Sheets team sync.
   Tokens live only in memory. The Apps Script backend verifies them and roles. */
'use strict';
(() => {
 const KEY='li-team-sync-client-config-v1';const SESSION_KEY='li-team-browser-session-v1';const APP_ORIGIN=location.origin;
 const DEFAULT_CONFIG={scriptUrl:'https://script.google.com/macros/s/AKfycbzlXPtmjhHpTot4R0ItabhBOQBrNamB2TUegdq6Lde-uX930U1hIohNqRsvUzMW5LYc1g/exec',clientId:'97172665640-k7lq4tqtl8jl3udei8f4f7tml8agfil4.apps.googleusercontent.com'};let config={...DEFAULT_CONFIG};try{config={...DEFAULT_CONFIG,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch(_){config={...DEFAULT_CONFIG}}
 let iframe=null,bridgePopup=null,bridgePeer=null,bridgeOrigin='',bridgeNonce='',bridgeMode='iframe',signInStarted=false,ready=false,token='',email='',role='',displayName='';
 let records=[],brands=[],users=[],lastError='',status='not-connected',reqs=new Map(),pending=0,lastFetched='',fixClientOpen=false,hasUnlockedOnce=false;
 let editingUserEmail='',userManageBusy=false,userManageNotice='',userManageIsError=false;
 const TEAM_BRAND_FILTER_KEY='li-team-brand-filter-v1';
 let teamBrandFilter='all';
 try{teamBrandFilter=localStorage.getItem(TEAM_BRAND_FILTER_KEY)||'all'}catch(_){teamBrandFilter='all'}
 const versions=new Map();let gsiLoaded=false,gsiClient='',callbacks=null,interval=null,oneTapOffered=false,credentialInFlight=false,reconnectTimer=null,reconnectAttempts=0;
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 function self(){return {email,role,name:displayName}}
 function hasRole(){return ['Super Admin','Admin','Manager'].includes(role)}
 function normalizeConfigValue(value){return String(value??'').replace(/[\s\u200B-\u200D\uFEFF]+/g,'')}
 function settingsValid(){return /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(normalizeConfigValue(config.clientId))&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(normalizeConfigValue(config.scriptUrl))}
 function clearRememberedSession(){try{sessionStorage.removeItem(SESSION_KEY)}catch(_){}}
 function tokenExpiresAt(t){try{const p=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return p.aud===config.clientId&&Number.isFinite(Number(p.exp))?Number(p.exp)*1000:0}catch(_){return 0}}
 function rememberVerifiedSession(){const expiry=tokenExpiresAt(token);if(!email||!role||expiry<=Date.now()+60000)return;try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({token,expires:expiry,clientId:config.clientId}))}catch(_){}}
 function restoreRememberedSession(){try{const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');if(!saved||saved.clientId!==config.clientId||saved.expires<=Date.now()+60000||saved.expires!==tokenExpiresAt(saved.token)){clearRememberedSession();return false}token=saved.token;status='connecting';return true}catch(_){clearRememberedSession();return false}}
 function invalidIdentity(err){return /SIGN_IN_EXPIRED|SIGN_IN_REQUIRED|INVALID_GOOGLE_IDENTITY|ACCESS_DENIED|invalid token|expired token/i.test(String(err?.message||''))}
 function scheduleRetry(){if(!token||reconnectTimer||reconnectAttempts>=3)return;const delay=[3000,7500,16000][reconnectAttempts++];reconnectTimer=setTimeout(()=>{reconnectTimer=null;authenticateCurrentToken()},delay)}
 async function authenticateCurrentToken(){
  if(!token||credentialInFlight)return;
  credentialInFlight=true;status='connecting';lastError='';paintStatusOnly();
  try{
   await refresh();status='connected';lastError='';reconnectAttempts=0;
   if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
   rememberVerifiedSession();window.LICentralCatalog?.onConnected?.();paint();
   if(!interval)interval=setInterval(()=>{if(!token||document.visibilityState==='hidden')return;
    refresh().then(()=>{status='connected';lastError='';rememberVerifiedSession();window.LICentralCatalog?.onConnected?.();paint()})
    .catch(err=>{status='offline';lastError='Temporary team connection problem: '+err.message;paint();scheduleRetry()})
   },90000);
  }catch(err){
   if(invalidIdentity(err)){
    window.LICentralCatalog?.onSignedOut();
    clearRememberedSession();token='';email='';role='';displayName='';
    status='auth-required';lastError='Google sign-in needs renewal or this account is not authorized: '+err.message;
   }else{
    status='offline';lastError='Google recognized your account, but Team Sync could not connect: '+err.message+'. You can retry without signing in again.';
    scheduleRetry();
   }
   paint();
  }finally{credentialInFlight=false}
 }
 function statusView(){
  const connected=status==='connected'&&!!token&&!!email&&LI_ROLES_UI.includes(role)&&ready&&tokenExpiresAt(token)>Date.now();
  return {status,email,role,lastError,ready,lastFetched,connected};
 }
 const LI_ROLES_UI=['Super Admin','Admin','Manager','Staff'];
 function syncAccessGate(){
  const gate=document.getElementById('liAuthGate'),content=document.getElementById('liAuthGateContent');
  if(!gate||!content)return;
  const allowed=statusView().connected,layout=document.querySelector('.layout');
  document.body.classList.toggle('li-auth-unlocked',allowed);
  if(layout)layout.inert=!allowed;
  const backup=document.getElementById('backupTop');if(backup)backup.disabled=!allowed;
  const signout=document.getElementById('liGlobalSignout');if(signout)signout.hidden=!allowed;
  const account=document.getElementById('liAccountLabel');if(account)account.textContent=allowed?email+' · '+role:'';
  gate.setAttribute('aria-hidden',allowed?'true':'false');
  if(allowed){
   if(!hasUnlockedOnce){
    hasUnlockedOnce=true;
    // The full application renders its own landing screen after authorization.
    // Do not call the Team selections renderer here.
    window.LIAppAuthorized?.({email,role});
   }
   return;
  }
  // Never expose navigation, downloads, or cached catalogs without a freshly
  // server-authorized email and role. A restored token is verified first.
  const mode=!settingsValid()?'config':token?'verifying':'signin';
  if(content.dataset.liGateMode!==mode){
   content.dataset.liGateMode=mode;
   if(mode==='config'){
    content.innerHTML='<p class="li-auth-error">This device needs the approved Product Selection connection settings.</p>'+
      '<form id="liSyncConfigForm"><div class="field"><label>Apps Script Web App /exec URL</label><input type="url" name="scriptUrl" required placeholder="https://script.google.com/macros/s/…/exec"></div>'+
      '<div class="field" style="margin-top:12px"><label>Google Web OAuth Client ID</label><input name="clientId" required placeholder="…apps.googleusercontent.com"></div>'+
      '<div class="li-auth-actions"><button type="submit" class="btn">Save connection settings</button></div></form>';
   }else{
    content.innerHTML='<p id="liGateAuthStatus" class="li-auth-status" role="status"></p>'+
      '<div id="liGateError" class="li-auth-error" role="alert" hidden></div>'+
      '<div id="liGateGoogleSignIn"></div>'+
      '<div class="li-auth-actions"><button type="button" class="btn secondary small" data-sync-action="retrySignIn">Show Google Sign-In</button>'+
      '<button type="button" class="btn secondary small" data-sync-action="retryConnection">Retry connection</button>'+
      '<button type="button" class="btn quiet small" data-sync-action="openBridgePopup">Open secure connection window</button>'+
      '<button type="button" class="btn quiet small" data-sync-action="signout">Change Google account</button></div>';
   }
  }
  const stat=document.getElementById('liGateAuthStatus');
  if(stat)stat.textContent=token?
   'Google account received. Verifying email and assigned role with L\'Imperial Team Sync…':
   'Use the Google account approved by your Super Admin.';
  const error=document.getElementById('liGateError');
  if(error){error.textContent=lastError||'';error.hidden=!lastError;}
  const retry=document.querySelector('#liAuthGate [data-sync-action="retryConnection"]');
  if(retry)retry.hidden=!token;
  const change=document.querySelector('#liAuthGate [data-sync-action="signout"]');
  if(change)change.hidden=!token;
  const signin=document.querySelector('#liAuthGate [data-sync-action="retrySignIn"]');
  if(signin)signin.hidden=!!token;
  const slot=document.getElementById('liGateGoogleSignIn');
  if(slot)slot.hidden=!!token;
  if(!token)showGoogleButton();
 }
 function info(text){const n=document.getElementById('teamSyncNotice');if(n)n.textContent=text}
 function paint(){syncAccessGate();if(typeof VIEW!=='undefined'&&VIEW==='team'&&statusView().connected)render()}
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
  if(d.kind==='LI_SYNC_READY'){bridgeOrigin=event.origin;bridgePeer=event.source;ready=true;status=token?'connecting':'ready';paintStatusOnly();showGoogleButton();if(token&&!credentialInFlight){authenticateCurrentToken()}return}
  if(d.kind==='LI_SYNC_RESPONSE'&&event.source===bridgePeer&&typeof d.id==='string'&&reqs.has(d.id)){const task=reqs.get(d.id);reqs.delete(d.id);clearTimeout(task.timer);task.resolve(d.result)}});
 async function ensureReady(){if(!ready&&bridgeMode==='iframe'&&iframe&&iframe.dataset.liBridgeFailed==='yes'){iframe.remove();iframe=null;bridgePeer=null;bridgeOrigin='';bridgeNonce=''}frame();if(bridgeMode==='popup'&&bridgePopup?.closed)throw Error('Secure connection window was closed. Reopen it in Team selections.');
  if(ready)return;const start=Date.now();while(!ready&&Date.now()-start<18000){if(bridgeMode==='popup'&&bridgePopup?.closed)break;await new Promise(r=>setTimeout(r,180))}
  if(!ready){if(bridgeMode==='iframe'&&iframe)iframe.dataset.liBridgeFailed='yes';throw Error(bridgeMode==='popup'?'Secure Google connection window did not respond. Check if it shows a Google permission or browser error.':'Google Apps Script could not connect inside Chrome. Use Open secure connection window below. If that also fails, check the active Code.gs / Bridge.html deployment.')} }
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
  if(!window.google?.accounts?.id||!settingsValid())return false;
  initializeGoogleIdentity();
  let rendered=false;
  for(const id of ['liGateGoogleSignIn','liGoogleSignIn']){
   const slot=document.getElementById(id);
   if(!slot||slot.hidden)continue;
   if(force||slot.dataset.liClientId!==config.clientId||!slot.querySelector('iframe')){
    slot.innerHTML='';
    google.accounts.id.renderButton(slot,{type:'standard',shape:'pill',theme:'outline',text:'signin_with',size:'large',width:260});
    slot.dataset.liClientId=config.clientId;
   }
   rendered=true;
  }
  return rendered;
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
function paintStatusOnly(){const t=document.getElementById('teamSyncNotice');if(t)t.textContent=token?(email&&role?'Signed in as '+email+' · '+role:'Verifying Google sign-in and team access…'):ready?'Google connection ready. Sign in to share selections.':'Sign in with Google to access team selections';syncAccessGate()}
async function onCredential(credential){if(!credential?.credential)return;token=credential.credential;clearRememberedSession();await authenticateCurrentToken()}
 function disconnect(keepConfig=true,explicitSignOut=false){
  if(explicitSignOut&&window.google?.accounts?.id){
    try{google.accounts.id.disableAutoSelect();google.accounts.id.cancel?.()}catch(_){}
  }
  window.LICentralCatalog?.onSignedOut();clearRememberedSession();if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}reconnectAttempts=0;token='';email='';role='';displayName='';records=[];brands=[];users=[];versions.clear();ready=false;bridgeOrigin='';if(iframe){iframe.remove();iframe=null}if(bridgePopup){try{bridgePopup.close()}catch(_){ }bridgePopup=null}bridgePeer=null;bridgeNonce='';bridgeMode='iframe';signInStarted=false;for(const req of reqs.values()){clearTimeout(req.timer);req.resolve({ok:false,error:'Disconnected'})}reqs.clear();if(interval){clearInterval(interval);interval=null}status=keepConfig?'not-connected':'configured';hasUnlockedOnce=false;paint()}
 async function refresh(){const data=await call('list');email=data.user.email;role=data.user.role;displayName=data.user.name;records=data.selections||[];brands=data.brands||[];users=data.users||[];window.LICentralCatalog?.onSignedIn(data);lastFetched=new Date().toLocaleTimeString();versions.clear();for(const r of records)versions.set(r.recordId,r.revision);
  // Create lightweight brand records for shared suppliers without overwriting local private catalogs.
  const existing=new Set(BRANDS.map(x=>x.id));let changed=false;for(const b of brands){if(!existing.has(b.id)){BRANDS.push({id:b.id,name:b.name,category:b.category||'Other',shared:true});changed=true}}if(changed)persistBrandDirectory();
  return data}
 function productFromLocal(r){
  // Photo references in Team selections are identifiers, not download URLs.
  // Render only artwork already present in the currently authorized catalog.
  if(typeof PACK==='undefined'||!PACK||r.brandId!==ACTIVE_BRAND_ID)return null;
  const own=r.kind==='catalog'?catalogItemForSelection(r.itemId):allVariants().find(x=>x.id===r.itemId);
  if(own?.sprite)return own;
  const items=r.kind==='catalog'?(PACK.items||[]):[...(PACK.variant||[]),...(PACK.items||[])];
  const unique=xs=>xs.length===1?xs[0]:null;
  const code=String(r.code||r.item?.code||'').trim().toLowerCase();
  if(code){
   const match=unique(items.filter(i=>i.sprite&&String(i.code||'').trim().toLowerCase()===code));
   if(match)return match;
  }
  // Different team members can save a duplicate with a different selection ID.
  const name=String(r.name||r.item?.name||'').trim().toLowerCase();
  if(name){
   const match=unique(items.filter(i=>i.sprite&&String(i.name||'').trim().toLowerCase()===name));
   if(match)return match;
  }
  // A saved atlas index is a lookup hint only, never an external PDF/image URL.
  const ref=String(r.photoRef||'').trim();
  if(ref){
   const match=unique(items.filter(i=>i.sprite?.atlas&&ref===i.sprite.atlas+'#'+i.sprite.index));
   if(match)return match;
  }
  return own||null;
 }
 function teamImageForRecord(record){
   const item=productFromLocal(record);
   if(item?.sprite&&(item.sprite.data||(item.sprite.atlas&&SPRITES[item.sprite.atlas])))
     return {sprite:item.sprite,urls:SPRITES};
   return window.LICentralCatalog?.teamPhotoFor?.(record)||null;
 }
 function preloadVisibleTeamPhotos(visible){
   if(!window.LITeamSync?.status()?.connected)return;
   for(const brandId of new Set(visible.map(r=>String(r.brandId||'')).filter(Boolean))){
     if(brandId!==ACTIVE_BRAND_ID)
       window.LICentralCatalog?.ensureTeamPhotos?.(brandId,visible)?.catch(()=>{});
   }
 }
 function photoPlaceholder(record){
   const state=window.LICentralCatalog?.teamPhotoStatus?.(record.brandId);
   const caption=state==='loading'||state==='pending'?'Loading supplier photos…':
     state==='unpublished'?'Supplier catalog not published':
     state==='error'?'Unable to load approved photos':
     'Photo unavailable in approved catalog';
   return '<div class="team-photo-placeholder">📦<small>'+esc(caption)+'</small></div>';
 }
 function recordId(kind,id){return email+'|'+ACTIVE_BRAND_ID+'|'+kind+'|'+id}
 function snapshot(kind,id){if(!PACK)return null;const item=kind==='catalog'?catalogItemForSelection(id):allVariants().find(x=>x.id===id);if(!item)return null;const entry=kind==='catalog'?candidateEntry(item):variantEntry(item);
  return {recordId:recordId(kind,id),brandId:ACTIVE_BRAND_ID,kind,itemId:id,item:{id,code:item.code||'',name:item.name||item.type||'',type:item.type||'',dimension:item.dimension||'',source:item.source||'',sourceRef:item.sourceRef||'',sourceItemId:item.sourceItemId||item.id,page:item.page||null,photoRef:item.sprite?.atlas?item.sprite.atlas+'#'+item.sprite.index:(item.sourceRef||'')},entry,expectedRevision:versions.get(recordId(kind,id))||0}}
 async function publish(kind,id){if(!token||!email)return;const data=snapshot(kind,id);if(!data)return;if(!hasRole()&&(data.entry.decision==='Approved'||data.entry.supplierStatus==='Confirmed')){lastError='Only management can approve or confirm products for the team.';status='error';paint();return}
  pending++;try{const response=await call('upsert',data);versions.set(response.recordId,response.revision);status='connected';lastError='';await refresh();paint()}catch(err){status='error';lastError=err.message+' — local copy preserved';paint()}finally{pending--}}
 function itemChanged(kind,id){if(!token)return;publish(kind,id).catch(err=>{lastError=err.message;status='error';paint()})}
 async function itemRemoved(kind,id){if(!token)return;const recordKey=recordId(kind,id),version=versions.get(recordKey);if(!version)return;try{await call('remove',{recordId:recordKey,expectedRevision:version});await refresh();paint()}catch(err){status='error';lastError=err.message;paint()}}
 function localSaved(){/* Local drafts are never automatically bulk-published. Specific edited records publish through itemChanged(). */}
 async function publishCurrent(){if(!token)return alert('Sign in first');if(!confirm('Publish the current '+brandNow().name+' selections to authorized staff? Existing locally saved designs will become visible to the team.'))return;
  const items=[];for(const id of Object.keys(S.catalog||{}))items.push(['catalog',id]);for(const [id,e] of Object.entries(S.variants||{}))if(e.decision==='Select'||e.decision==='Approved')items.push(['variant',id]);let done=0,failed=0;
  for(const [kind,id] of items){try{const data=snapshot(kind,id);if(!data)continue;if(!hasRole()&&(data.entry.decision==='Approved'||data.entry.supplierStatus==='Confirmed')){failed++;continue}const res=await call('upsert',data);versions.set(res.recordId,res.revision);done++}catch(e){failed++;lastError=e.message}}
  await refresh();status=failed?'error':'connected';paint();alert('Published '+done+' selection(s).'+(failed?' '+failed+' could not sync; review their status or conflicts.':''))}
 function canRemoveShared(r){return !!r&&!r.deleted&&(hasRole()||String(r.ownerEmail||'').toLowerCase()===String(email||'').toLowerCase())}
 const removingShared=new Set();
 async function removeShared(id){
  const r=records.find(x=>x.recordId===id&&!x.deleted);
  if(!token||!canRemoveShared(r)||removingShared.has(id))return;
  if(!confirm('Remove '+(r.code||r.name||'this item')+' from Team selections? This will not delete the catalog product or local selections.'))return;
  removingShared.add(id);
  const btn=[...document.querySelectorAll('[data-sync-action="removeShared"]')].find(el=>el.dataset.recordId===id);
  if(btn){btn.disabled=true;btn.textContent='Removing...'}
  try{
    await call('remove',{recordId:r.recordId,expectedRevision:r.revision});
    await refresh();status='connected';lastError='';paint();
  }catch(err){
    status='error';lastError='Unable to remove shared selection: '+err.message;
    try{await refresh()}catch(_){}
    paint();
  }finally{removingShared.delete(id)}
 }
 async function moderate(id,action){if(!hasRole())return;const r=records.find(x=>x.recordId===id);if(!r)return;const decision=action==='approve'?'Approved':action==='reject'?'Rejected':'Select';const supplierStatus=action==='approve'?'Confirmed':r.supplierStatus;
  try{await call('moderate',{recordId:id,expectedRevision:r.revision,decision,supplierStatus});await refresh();status='connected';lastError='';paint()}catch(err){status='error';lastError=err.message;paint()}}
 async function addUser(form){
  if(role!=='Super Admin'||userManageBusy)return;
  const data=new FormData(form),address=String(data.get('email')||'').trim().toLowerCase();
  const name=String(data.get('name')||'').trim(),userRole=String(data.get('role')||'Staff');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||!['Staff','Manager','Admin','Super Admin'].includes(userRole))return;
  if(users.some(u=>String(u.email||'').toLowerCase()===address)){
    userManageIsError=true;userManageNotice='This email already exists. Use Edit to update its role, name, or access status.';
    renderTeamManagement();return;
  }
  if(userRole==='Super Admin'&&!confirm('Give '+address+' full Super Admin access, including confidential supplier prices and user management?'))return;
  userManageBusy=true;userManageNotice='Authorizing '+address+'…';userManageIsError=false;renderTeamManagement();
  try{
    await call('setUser',{email:address,name,role:userRole,active:true});
    await refresh();status='connected';userManageNotice='Account authorized: '+address;userManageIsError=false;
  }catch(e){userManageIsError=true;userManageNotice='Unable to authorize account: '+e.message}
  finally{userManageBusy=false;renderTeamManagement()}
 }
 async function saveEditedUser(form){
  if(role!=='Super Admin'||userManageBusy)return;
  const address=String(form.dataset.email||'').trim().toLowerCase();
  const existing=users.find(u=>String(u.email||'').trim().toLowerCase()===address);
  if(!existing){userManageIsError=true;userManageNotice='This account is no longer in the directory. Refresh users.';renderTeamManagement();return}
  const data=new FormData(form);
  const name=String(data.get('name')||'').trim();
  const nextRole=String(data.get('role')||existing.role);
  const active=String(data.get('active')??(existing.active?'true':'false'))==='true';
  const own=address===email.toLowerCase();
  if(!['Staff','Manager','Admin','Super Admin'].includes(nextRole)||!name){
    userManageIsError=true;userManageNotice='Enter a display name and choose a valid role.';renderTeamManagement();return;
  }
  if(own&&(!active||nextRole!=='Super Admin')){
    userManageIsError=true;userManageNotice='You cannot disable or demote your own Super Admin account.';renderTeamManagement();return;
  }
  const unchanged=String(existing.name||'')===name&&existing.role===nextRole&&!!existing.active===active;
  if(unchanged){editingUserEmail='';userManageNotice='No changes needed.';userManageIsError=false;renderTeamManagement();return}
  if(!active&&existing.active&&!confirm('Deactivate '+address+'? This user will lose Product Selection access after their next authorization check.'))return;
  if(nextRole==='Super Admin'&&existing.role!=='Super Admin'&&!confirm('Grant '+address+' full Super Admin permissions, including confidential supplier prices?'))return;
  userManageBusy=true;userManageNotice='Saving '+address+'…';userManageIsError=false;renderTeamManagement();
  try{
    await call('setUser',{email:address,name,role:nextRole,active});
    await refresh();status='connected';editingUserEmail='';
    userManageNotice='Updated '+address+' successfully.';userManageIsError=false;
  }catch(e){userManageIsError=true;userManageNotice='Unable to update '+address+': '+e.message}
  finally{userManageBusy=false;renderTeamManagement()}
 }
 async function brandCreated(brand){if(!token)return;try{await call('brand',{brand:{id:brand.id,name:brand.name,category:brand.category}});await refresh()}catch(err){status='error';lastError='Brand created only locally: '+err.message;paint()}}
 async function importShared(recordId){
  const record=records.find(r=>r.recordId===recordId);
  if(!record)return alert('Shared selection not found');
  if(record.brandId!==ACTIVE_BRAND_ID){alert('First open the '+(brands.find(b=>b.id===record.brandId)?.name||record.brandId)+' brand in Brands, then import this selection.');return}
  if(!PACK){alert('The supplier catalog has not loaded yet. Try again after signing in.');return}
  const duplicate=String(record.itemId||'').startsWith('copy-');
  if(duplicate){
    const source=PACK.items.find(x=>x.id===(record.entry?.sourceItemId||record.item?.sourceItemId))
       ||PACK.items.find(x=>x.code&&x.code===record.code);
    if(!source)return alert('This selection uses a catalog item that is not available in your current catalog. Ask Super Admin to publish the source product first.');
    if(!S.catalogDuplicates)S.catalogDuplicates={};
    const newKey=S.catalogDuplicates[record.itemId]&&S.catalogDuplicates[record.itemId].sourceItemId!==source.id
      ?'copy-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9):record.itemId;
    if(S.catalogDuplicates[newKey]&&!confirm('Replace your existing duplicate details for '+(source.code||source.name)+'?'))return;
    S.catalogDuplicates[newKey]={...(record.entry||{}),sourceItemId:source.id,code:record.code,decision:record.decision,supplierStatus:record.supplierStatus,qty:record.qty};
    save();alert('Copied this separate size version to My selections. Other versions remain unchanged.');setView('selected');return;
  }
  let item=PACK.items.find(x=>x.id===record.itemId)||PACK.items.find(x=>x.code&&x.code===record.code);
  if(!item){item={id:ACTIVE_BRAND_ID+'-team-'+record.itemId,code:record.code,name:record.name,type:record.type||'Catalog item',dimension:record.dimension,source:'team',page:record.item?.page||null,sprite:null,photoKind:'missing-photo',verification:'Team record; verify exact supplier photo and code'};
    PACK.items.push(item);PACK.sources.team=PACK.sources.team||{name:'Team shared selections',kind:'shared',productRows:0};PACK.sources.team.productRows++;
    try{await persistActivePack()}catch(e){PACK.items.pop();alert('Unable to save imported team item: '+e.message);return}}
  if(S.catalog[item.id]&&!confirm('Replace your local selection details for '+(item.code||item.name)+' with this team record?'))return;
  S.catalog[item.id]=Object.assign({},record.entry||{},{code:record.code,decision:record.decision,supplierStatus:record.supplierStatus,qty:record.qty});
  if(!S.shortlist.includes(item.id))S.shortlist.push(item.id);
  save();alert('Selection copied to this brand on your computer. It now appears in My selections and can be used in order preparation.');setView('selected')
 }
 function teamBrandOptions(){
  // Use the shared authorized brand directory; also include known record brands.
  // Records remain limited to what the server permits the signed-in user to see.
  const names=new Map();
  for(const b of [...(typeof BRANDS!=='undefined'?BRANDS:[]),...brands])
   if(b?.id)names.set(String(b.id),String(b.name||b.id));
  for(const r of records)if(!r.deleted&&r.brandId&&!names.has(String(r.brandId)))
   names.set(String(r.brandId),String(r.brandId));
  if(teamBrandFilter!=='all'&&!names.has(teamBrandFilter))teamBrandFilter='all';
  const totals=new Map();
  for(const r of records)if(!r.deleted){const id=String(r.brandId||'');totals.set(id,(totals.get(id)||0)+1)}
  return [...names].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>
   '<option value="'+esc(id)+'"'+(teamBrandFilter===id?' selected':'')+'>'+esc(name)+' ('+(totals.get(id)||0)+')</option>').join('');
 }
 function filteredTeamRecords(){
  return records.filter(r=>!r.deleted&&(teamBrandFilter==='all'||String(r.brandId)===teamBrandFilter))
    .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 }
 function exportTeamRows(){
  // Export all matching, non-deleted records (the on-screen list is capped at 200).
  // Source data is already limited by the server to the signed-in user's access.
  return filteredTeamRecords().map((record,index)=>{
    const entry=record.entry||{},item=record.item||{};
    const original=String(record.dimension||item.dimension||entry.originalSize||'').trim();
    const requested=String(record.targetSize||entry.targetSize||'').trim();
    const brand=brands.find(b=>b.id===record.brandId)
      ||(typeof BRANDS!=='undefined'?BRANDS.find(b=>b.id===record.brandId):null);
    return {
      number:index+1,record,brand:brand?.name||record.brandId||'',
      code:String(record.code||entry.code||item.code||''),
      description:String(record.name||item.name||item.type||''),
      original,requested:requested&&requested!==original?requested:'',
      qty:record.qty??entry.qty??'',
      finish:[record.crystal||entry.crystal,record.finish||entry.finish].filter(Boolean).join(' / '),
      request:String(record.request||entry.request||record.notes||''),
      decision:String(record.decision||entry.decision||''),
      supplierStatus:String(record.supplierStatus||entry.supplierStatus||''),
      owner:String(record.ownerEmail||''),updated:String(record.updatedAt||'')
    };
  });
}
function exportTeamCsv(items){
  const headers=['No.','Brand','Product code','Product / description','Original size','Requested size','Qty','Crystal / finish','Custom request','Selection status','Supplier status','Submitted by','Last updated'];
  const data=items.map(r=>[r.number,r.brand,r.code,r.description,r.original,r.requested,r.qty,r.finish,r.request,r.decision,r.supplierStatus,r.owner,r.updated]);
  const safe=v=>{
    let value=String(v??'');
    // Avoid opening imported staff notes as spreadsheet formulas.
    if(/^[\s]*[=+\-@]/.test(value))value="'"+value;
    return '"'+value.replace(/"/g,'""')+'"';
  };
  const csv=[headers,...data].map(row=>row.map(safe).join(',')).join('\r\n');
  const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='LImperial_Team_Selections_'+(teamBrandFilter==='all'?'All_Brands':teamBrandFilter.replace(/[^a-z0-9_-]/gi,'_'))+'_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
let exportingTeamExcel=false;
async function exportTeamExcel(){
  if(!token||!email||!role)return alert('Sign in with Google to export authorized team selections.');
  if(exportingTeamExcel)return;
  const items=exportTeamRows();
  if(!items.length)return alert('No team selections match this brand filter.');
  exportingTeamExcel=true;
  const button=document.querySelector('[data-sync-action="exportTeamExcel"]');
  if(button){button.disabled=true;button.textContent='Preparing Excel…'}
  try{
    if(!window.ExcelJS){exportTeamCsv(items);alert('The Excel library did not load. A CSV without photos has been downloaded instead.');return}
    // Make a best effort to load each filtered brand's approved photos before export.
    if(button)button.textContent='Loading approved photos…';
    const recordList=items.map(x=>x.record);
    const otherBrands=[...new Set(recordList.map(r=>r.brandId))].filter(id=>id!==ACTIVE_BRAND_ID);
    await Promise.allSettled(otherBrands.map(id=>window.LICentralCatalog?.ensureTeamPhotos?.(id,recordList)));
    if(items.some(x=>x.record.brandId===ACTIVE_BRAND_ID))
      await window.LICentralCatalog?.ensureBrand?.(ACTIVE_BRAND_ID).catch(()=>{});
    if(button)button.textContent='Preparing Excel…';
    const book=new window.ExcelJS.Workbook();
    book.creator="L'Imperial Product Selection Studio";
    const sheet=book.addWorksheet('Team Selections',{views:[{state:'frozen',ySplit:3}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1}});
    sheet.mergeCells('A1:N1');
    const header=sheet.getCell('A1');
    header.value="L'IMPERIAL · TEAM PRODUCT SELECTIONS · "+(teamBrandFilter==='all'?'ALL BRANDS':items[0].brand.toUpperCase());
    header.font={bold:true,size:14,color:{argb:'FFFFFFFF'}};
    header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF13233A'}};
    sheet.getRow(1).height=35;
    sheet.mergeCells('A2:N2');
    sheet.getCell('A2').value='Shared team review · '+items.length+' selections · Exported '+new Date().toLocaleString()+' · Not a supplier purchase order · Supplier prices excluded';
    sheet.getCell('A2').font={italic:true,color:{argb:'FF63758B'},size:10};
    sheet.getRow(2).height=22;
    sheet.getRow(3).values=['No.','Product photo','Brand','Product code','Product / description','Original size','Requested size','Qty','Crystal / finish','Custom request','Selection status','Supplier status','Submitted by','Last updated'];
    sheet.getRow(3).font={bold:true,color:{argb:'FF17304D'}};
    sheet.getRow(3).height=28;
    sheet.columns=[{width:7},{width:22},{width:17},{width:27},{width:35},{width:20},{width:22},{width:9},{width:23},{width:42},{width:19},{width:19},{width:30},{width:27}];
    for(let n=0;n<items.length;n++){
      const info=items[n],i=n+4,row=sheet.getRow(i);
      row.values=[info.number,'',info.brand,info.code,info.description,info.original,info.requested,info.qty,info.finish,info.request,info.decision,info.supplierStatus,info.owner,info.updated];
      row.height=83;
      row.alignment={vertical:'middle',wrapText:true};
      for(let col=1;col<=14;col++)sheet.getCell(i,col).border={bottom:{style:'thin',color:{argb:'FFE7E7E7'}}};
      // Only a photo delivered by the authenticated catalog service can be embedded.
      // Never retrieve a supplier PDF or guess a public image URL.
      const image=teamImageForRecord(info.record);
      if(image?.sprite&&typeof imageFromSprite==='function'){
        try{
          const data=await imageFromSprite(image.sprite,image.urls);
          if(data){
            const imageId=book.addImage({base64:data,extension:'png'});
            sheet.addImage(imageId,{tl:{col:1.16,row:i-1+0.06},ext:{width:92,height:92},editAs:'oneCell'});
          }else sheet.getCell(i,2).value='Photo not loaded';
        }catch(_){sheet.getCell(i,2).value='Photo not loaded'}
      }else sheet.getCell(i,2).value='Photo not loaded';
    }
    const buf=await book.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='LImperial_Team_Selections_'+(teamBrandFilter==='all'?'All_Brands':teamBrandFilter.replace(/[^a-z0-9_-]/gi,'_'))+'_'+new Date().toISOString().slice(0,10)+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }catch(err){
    console.error('Team Excel export failed',err);
    try{exportTeamCsv(items);alert('Excel export failed; downloaded CSV without embedded photos instead.')}catch(e){alert('Unable to export team selections: '+e.message)}
  }finally{
    exportingTeamExcel=false;
    if(button){button.disabled=false;button.textContent='⬇ Export Excel'}
  }
}
 function teamBrandFilterToolbar(){
  const options=teamBrandOptions();
  const all=records.filter(r=>!r.deleted).length;
  const filtered=filteredTeamRecords().length;
  return '<div class="team-brand-toolbar"><label for="liTeamBrandFilter">Brand</label>'+
   '<select id="liTeamBrandFilter" aria-label="Filter team selections by brand">'+
   '<option value="all"'+(teamBrandFilter==='all'?' selected':'')+'>All brands ('+all+')</option>'+
   options+'</select>'+
   '<button type="button" class="btn secondary small" data-sync-action="exportTeamExcel"'+(!filtered?' disabled':'')+'>⬇ Export Excel</button>'+
   '<span class="tiny" role="status">Showing '+Math.min(filtered,200)+' of '+filtered+' selection'+(filtered===1?'':'s')+'</span></div>';
 }
 function rowsHTML(){const map=new Map(brands.map(b=>[b.id,b.name]));const visible=filteredTeamRecords().slice(0,200);
  preloadVisibleTeamPhotos(visible);
  return visible.map(r=>{const image=teamImageForRecord(r);const img=image?.sprite&&typeof photo==='function'?photo(image.sprite,'selection-thumb',image.urls):photoPlaceholder(r);return `<article class="candidate-row team-selection-row"><div class="selection-card-head">${img}<div class="selection-card-copy"><div class="tiny">${esc(map.get(r.brandId)||r.brandId)} · ${esc(r.kind)}</div><strong>${esc(r.code||r.itemId)}</strong><div>${esc(r.name||r.item?.name||'Product')}</div><div class="tiny">${esc(r.dimension||'')} · ${esc(r.ownerEmail)}</div><div class="tiny">${esc(r.updatedAt)} · Revision ${r.revision}</div></div></div><div class="team-tags"><span class="pill ${r.decision==='Approved'?'green':'gold'}">${esc(r.decision)}</span><span class="pill">${esc(r.supplierStatus)}</span><span class="tiny">Qty ${esc(r.qty)}</span></div><div class="tiny">${esc(r.notes||'')}</div>${r.brandId===ACTIVE_BRAND_ID?`<div class="row-actions"><button class="btn quiet small" data-sync-action="import" data-record-id="${esc(r.recordId)}">Use in this brand's selections</button></div>`:''}${hasRole()&&r.decision!=='Approved'&&r.decision!=='Rejected'?`<div class="row-actions"><button class="btn small" data-sync-action="approve" data-record-id="${esc(r.recordId)}">Approve & confirm</button><button class="btn danger small" data-sync-action="reject" data-record-id="${esc(r.recordId)}">Reject</button></div>`:''}${canRemoveShared(r)?`<div class="row-actions"><button type="button" class="btn danger small" data-sync-action="removeShared" data-record-id="${esc(r.recordId)}">Remove from Team selections</button></div>`:''}</article>`}).join('')||'<div class="empty"><h3>No shared selections for this brand</h3><p>Choose All brands or another supplier, or share products from My selections.</p></div>'}
 function roleOptions(current){
  return ['Staff','Manager','Admin','Super Admin'].map(r=>
   '<option value="'+esc(r)+'"'+(r===current?' selected':'')+'>'+esc(r)+'</option>').join('');
 }
 function renderTeamManagement(){
  const root=document.getElementById('app');if(!root)return;
  if(role!=='Super Admin'||!statusView().connected){
   root.innerHTML='<div class="candidate-row"><h2>Restricted</h2><p>Only Super Admin may manage team accounts.</p></div>';
   return;
  }
  const list=[...users].sort((a,b)=>Number(!!b.active)-Number(!!a.active)||
    String(a.name||a.email).localeCompare(String(b.name||b.email)));
  const activeCount=list.filter(u=>u.active).length;
  const cards=list.map(u=>{
   const address=String(u.email||'').trim().toLowerCase(),own=address===email.toLowerCase();
   const isEditing=editingUserEmail===address;
   const statusLabel=u.active?'Active':'Inactive';
   const card='<article class="tm-user-card"><div class="tm-user-summary"><div class="tm-user-identity">'+
    '<strong>'+esc(u.name||address)+'</strong><div class="tiny tm-email">'+esc(address)+'</div></div>'+
    '<div class="tm-user-controls"><span class="pill">'+esc(u.role)+'</span>'+
    '<span class="pill '+(u.active?'green':'warn')+'">'+statusLabel+'</span>'+
    (own?'<span class="tiny">Your account</span>':'')+
    '<button class="btn secondary small" type="button" data-sync-action="'+(isEditing?'cancelUserEdit':'editUser')+
    '" data-email="'+esc(address)+'"'+(userManageBusy?' disabled':'')+'>'+(isEditing?'Cancel':'Edit')+'</button></div></div>';
   if(!isEditing)return card+'</article>';
   return card+'<form class="tm-edit-form" data-team-edit-form="true" data-email="'+esc(address)+'">'+
     '<div class="tm-fields"><label class="field"><span>Display name</span><input name="name" value="'+esc(u.name||'')+
     '" maxlength="100" required></label><label class="field"><span>Role</span><select name="role"'+(own?' disabled':'')+'>'+roleOptions(u.role)+
     '</select></label><label class="field"><span>Access status</span><select name="active"'+(own?' disabled':'')+'>'+
     '<option value="true"'+(u.active?' selected':'')+'>Active</option>'+
     '<option value="false"'+(!u.active?' selected':'')+'>Inactive</option></select></label></div>'+
     '<p class="tiny">Google email is the account identifier. To change it, authorize the new email and deactivate the old one.</p>'+
     '<div class="row-actions"><button type="submit" class="btn small"'+(userManageBusy?' disabled':'')+'>Save changes</button>'+
     '<button type="button" class="btn quiet small" data-sync-action="cancelUserEdit"'+(userManageBusy?' disabled':'')+'>Cancel</button></div></form></article>';
  }).join('');
  root.innerHTML='<div class="tm-page"><div class="candidate-row"><div class="variant-top">'+
   '<div><h2>Manage team access</h2><p class="muted">Manage Google accounts allowed to use Product Selection. Changes are enforced by the private Apps Script authorization service.</p></div>'+
   '<button class="btn secondary small" type="button" data-sync-action="refreshUsers"'+(userManageBusy?' disabled':'')+'>↻ Refresh accounts</button></div>'+
   '<div class="tm-stats"><span><b>'+activeCount+'</b> Active</span><span><b>'+(list.length-activeCount)+'</b> Inactive</span>'+
   '<span><b>'+list.length+'</b> Total accounts</span></div>'+
   (userManageNotice?'<p role="status" class="'+(userManageIsError?'alert':'tm-success')+'">'+esc(userManageNotice)+'</p>':'')+
   '<div class="tm-directory">'+(cards||'<p>No authorized users returned. Refresh accounts to try again.</p>')+'</div></div>'+
   '<div class="candidate-row tm-add-card"><h2>Authorize new team member</h2>'+
   '<p class="tiny">New users must sign in with the email approved here. Only Super Admin can create, edit, or deactivate accounts.</p>'+
   '<form id="liTeamAddUser"><div class="tm-fields">'+
   '<label class="field"><span>Google email</span><input name="email" type="email" autocomplete="off" maxlength="255" placeholder="staff@example.com" required></label>'+
   '<label class="field"><span>Display name</span><input name="name" maxlength="100" placeholder="Employee name"></label>'+
   '<label class="field"><span>Assigned role</span><select name="role">'+roleOptions('Staff')+'</select></label></div>'+
   '<div class="row-actions"><button class="btn" type="submit"'+(userManageBusy?' disabled':'')+'>Authorize user</button></div></form></div></div>';
 }
 function render(){const root=document.getElementById('app');if(!root)return;
  if(!settingsValid()){root.innerHTML=`<div class="candidate-row" style="max-width:760px"><h2>Secure Google Sheets team synchronization</h2><p>Configure your dedicated Google Apps Script service and Google OAuth Client ID. The Google Sheet is private; users must be authorized before seeing any selection.</p><form id="liSyncConfigForm"><div class="field"><label>Apps Script Web App /exec URL</label><input name="scriptUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" required></div><div class="field" style="margin-top:12px"><label>Google OAuth Web Client ID</label><input name="clientId" placeholder="123...apps.googleusercontent.com" required></div><div class="row-actions"><button type="submit" class="btn">Save connection settings</button></div></form><p class="tiny">An Apps Script deployment is required before real-time sharing can begin. Do not paste a password, service account key, or API secret.</p></div>`;return}
  root.innerHTML=`<div class="candidate-row"><div class="variant-top"><div><h2>Shared Team Selections</h2><p class="tiny" id="teamSyncNotice">${esc(email&&role?'Signed in as '+email+' · '+role:token?'Verifying Google sign-in and team access…':'Sign in with Google to access team selections')}</p>${lastError?`<p class="alert">${esc(lastError)}</p><div class="row-actions"><button class="btn secondary small" data-sync-action="openBridgePopup">Open secure Google connection window</button><a class="btn quiet small" href="'+esc(config.scriptUrl)+'" target="_blank" rel="noopener">Check deployed Web App URL</a></div>`:''}</div><div class="row-actions">${role==='Super Admin'?'<button class="btn quiet small" data-sync-action="reconfigure">Connection settings</button>':''}${token?'<button class="btn quiet small" data-sync-action="signout">Sign out</button>':''}</div></div>${!token?'<div id="liGoogleSignIn" style="min-height:50px;margin:12px 0"></div><p id="teamSyncConnectError" class="alert" hidden></p><div class="row-actions"><button class="btn secondary small" data-sync-action="retrySignIn">Show Google Sign-In</button><button class="btn quiet small" data-sync-action="openBridgePopup">Open secure connection window</button></div>':email&&role?`<div class="row-actions"><button class="btn secondary small" data-sync-action="refresh">↻ Refresh team selections</button><button class="btn small" data-sync-action="publish">Share my current ${esc(brandNow().name)} selections</button><span class="tiny">Last refreshed: ${esc(lastFetched||'—')} · ${records.length} records</span></div>`:'<div class="row-actions"><button class="btn secondary small" data-sync-action="retryConnection">Retry team connection</button><span class="tiny">Google account received; checking team authorization</span></div>'}<p class="tiny">Approved staff can browse private supplier catalogs after Google sign-in. New selections and edits sync while signed in; previously saved local drafts are not bulk-published automatically.</p></div>${email&&role?`<div class="subheading"><h2>Team review</h2><span class="tiny">Authorized users only</span></div>${teamBrandFilterToolbar()}<div class="row-list">${rowsHTML()}</div>${adminCatalogForm()}`:''}`;
  if(!token){const slot=document.getElementById('liGoogleSignIn');if(slot)slot.insertAdjacentHTML('afterend',repairClientMarkup());showGoogleButton();if(!signInStarted&&status!=='error'){signInStarted=true;connectButton().catch(e=>{status='error';lastError=e.message;paint()})}}}
 document.addEventListener('submit',e=>{if(e.target.id==='liSyncConfigForm'){e.preventDefault();const d=new FormData(e.target);try{saveConfig({clientId:String(d.get('clientId')||''),scriptUrl:String(d.get('scriptUrl')||'')})}catch(err){alert(err.message)}return}if(e.target.id==='liOAuthClientRepair'){e.preventDefault();const d=new FormData(e.target);try{const clientId=String(d.get('clientId')||'');fixClientOpen=false;gsiClient='';saveConfig({...config,clientId})}catch(err){fixClientOpen=true;alert(err.message)}return}if(e.target.id==='liTeamAddUser'){e.preventDefault();addUser(e.target);return}if(e.target.matches('[data-team-edit-form]')){e.preventDefault();saveEditedUser(e.target);return}if(e.target.id==='liPublishCatalog'){e.preventDefault();publishCentralCatalog(e.target)}});
 document.addEventListener('change',e=>{
  if(e.target?.id!=='liTeamBrandFilter')return;
  teamBrandFilter=e.target.value||'all';
  try{localStorage.setItem(TEAM_BRAND_FILTER_KEY,teamBrandFilter)}catch(_){}
  paint();
 });
 document.addEventListener('click',e=>{const b=e.target.closest('[data-sync-action]');if(!b)return;const act=b.dataset.syncAction;
  if(act==='editUser'&&role==='Super Admin'&&VIEW==='team-management'){
   editingUserEmail=String(b.dataset.email||'').trim().toLowerCase();userManageNotice='';renderTeamManagement();return;
  }
  if(act==='cancelUserEdit'&&role==='Super Admin'&&VIEW==='team-management'){
   editingUserEmail='';userManageNotice='';renderTeamManagement();return;
  }
  if(act==='refreshUsers'&&role==='Super Admin'&&VIEW==='team-management'&&!userManageBusy){
   userManageBusy=true;userManageNotice='Refreshing authorized accounts…';userManageIsError=false;renderTeamManagement();
   refresh().then(()=>{status='connected';userManageNotice='Team directory refreshed.';userManageIsError=false})
    .catch(err=>{userManageIsError=true;userManageNotice='Unable to refresh users: '+err.message})
    .finally(()=>{userManageBusy=false;renderTeamManagement()});return;
  }
  if(act==='fixClient'){fixClientOpen=!fixClientOpen;paint();return}if(act==='retrySignIn'){connectButton(true);return}if(act==='retryConnection'){reconnectAttempts=0;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}if(!ready&&bridgeMode==='iframe'&&iframe)iframe.dataset.liBridgeFailed='yes';authenticateCurrentToken();return}if(act==='openBridgePopup'){openBridgePopup();return}if(act==='refresh')refresh().then(()=>{status='connected';lastError='';rememberVerifiedSession();window.LICentralCatalog?.onConnected?.();paint()}).catch(err=>{status='offline';lastError='Team connection problem: '+err.message;paint();scheduleRetry()});if(act==='publish')publishCurrent();if(act==='exportTeamExcel')exportTeamExcel();if(act==='import')importShared(b.dataset.recordId);if(act==='removeShared')removeShared(b.dataset.recordId);if(act==='approve'||act==='reject')moderate(b.dataset.recordId,act);if(act==='signout'){disconnect(true,true);paint()}if(act==='reconfigure'&&role==='Super Admin'){if(confirm('Change the connection settings for this device? Existing local selections will remain.')){localStorage.removeItem(KEY);config={};disconnect(false);paint()}}});
 function adminCatalogForm(){if(role!=='Super Admin')return '';return '<div class="candidate-row"><h3>Publish private supplier catalog</h3><p class="tiny">Upload the prepared JSON pack to private Google Drive once. Staff will receive its photos automatically after signing in.</p><form id="liPublishCatalog"><div class="variant-fields"><div class="field"><label>Supplier</label><select name="brandId">'+brands.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('')+'</select></div><div class="field span2"><label>Private Drive catalog-pack link</label><input name="driveFile" required placeholder="https://drive.google.com/file/d/.../view"></div></div><label class="tiny"><input type="checkbox" name="confirmUntagged" value="1"> Confirm legacy pack without an internal brand label (Asfour)</label><div class="row-actions"><button type="submit" class="btn secondary">Publish catalog</button></div></form></div>'}
 async function publishCentralCatalog(form){if(role!=='Super Admin')return;const d=new FormData(form),brandId=String(d.get('brandId')||''),driveFile=String(d.get('driveFile')||'').trim();if(!confirm('Publish this private Drive catalog to authorized staff?'))return;try{const result=await call('publishCatalog',{brandId,driveFile,confirmUntagged:d.has('confirmUntagged')});await refresh();if(result.brandId===ACTIVE_BRAND_ID)window.LICentralCatalog?.ensureBrand(brandId,true).catch(()=>{});alert(result.itemCount+' products published for '+brandId);paint()}catch(err){alert('Catalog publishing failed: '+err.message)}}
 function init(){
  syncAccessGate();
  if(!settingsValid())return;
  // Only the current browser session remembers the short-lived ID credential.
  // Apps Script verifies it again before returning any private data.
  const restored=restoreRememberedSession();
  if(restored)authenticateCurrentToken();
  loadGsi().then(()=>{initializeGoogleIdentity();showGoogleButton();if(!token)offerReturningGoogleSignIn()})
   .catch(err=>{console.warn('Google auto sign-in unavailable',err);lastError=err.message;syncAccessGate()});
}
 window.LITeamSync={init,render,renderTeamManagement,itemChanged,itemRemoved,localSaved,brandCreated,status:statusView,getRoles:()=>self(),refresh,disconnect,request:call};
})();
