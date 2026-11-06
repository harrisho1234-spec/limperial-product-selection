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
 function settingsValid(){return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(normalizeConfigValue(config.scriptUrl))}
 function clearRememberedSession(){try{sessionStorage.removeItem(SESSION_KEY)}catch(_){}}
 function tokenExpiresAt(t){try{const p=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return p.aud==='authenticated'&&p.iss==='https://msxvnaintafqdgheutfu.supabase.co/auth/v1'&&Number.isFinite(Number(p.exp))?Number(p.exp)*1000:0}catch(_){return 0}}
 function rememberVerifiedSession(){/* Supabase Auth manages refresh and persistence. */}
 function restoreRememberedSession(){return false}
 function invalidIdentity(err){return /INVALID_SUPABASE_IDENTITY|ACCESS_DENIED|TOKEN_REVOKED/i.test(String(err?.message||''))}
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
  if(allowed){if(!hasUnlockedOnce){hasUnlockedOnce=true;window.LIAppAuthorized?.({email,role})}return}
  const identity=window.LISelectionIdentity?.status();
  const mode=identity?.signedIn?'verifying':'signin';
  if(content.dataset.liGateMode!==mode){
    content.dataset.liGateMode=mode;
    content.innerHTML=mode==='signin'?
      '<form id="liSupabaseLogin" class="li-auth-form">'+
      '<label class="field">Staff email<input name="email" type="email" autocomplete="username" required placeholder="staff@example.com"></label>'+
      '<label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>'+
      '<button type="submit" class="btn">Sign in</button></form>'+
      '<p class="tiny">Only authorized accounts can access private supplier catalogs.</p>'+
      '<p id="liSupabaseSignInError" class="alert" role="alert" hidden></p>':
      '<p>Signed in. Verifying your role and the private supplier catalog service…</p>'+
      '<div class="row-actions"><button type="button" class="btn secondary" data-sync-action="retryConnection">Retry connection</button>'+
      '<button type="button" class="btn quiet" data-sync-action="signout">Sign out</button></div>';
  }
  if(mode==='verifying'&&lastError){
    const err=content.querySelector('.alert');
    if(err){err.textContent=lastError;err.hidden=false}
  }
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
 async function call(op,payload={}){if(!token)throw Error('Sign in with Supabase first');await ensureReady();const id='req_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
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
function paintStatusOnly(){const t=document.getElementById('teamSyncNotice');if(t)t.textContent=token?(email&&role?'Signed in as '+email+' · '+role:'Verifying Supabase role and team access…'):'Sign in using Supabase to access team selections';syncAccessGate()}
async function onCredential(credential){if(!credential?.credential)return;token=credential.credential;clearRememberedSession();await authenticateCurrentToken()}
 function disconnect(keepConfig=true,explicitSignOut=false){teamCostView='without';teamCostLookup=new Map();if(explicitSignOut)window.LISelectionIdentity?.signOut?.().catch(err=>console.warn(err));
  if(explicitSignOut&&window.google?.accounts?.id){
    try{google.accounts.id.disableAutoSelect();google.accounts.id.cancel?.()}catch(_){}
  }
  window.LICentralCatalog?.onSignedOut();clearRememberedSession();if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}reconnectAttempts=0;token='';email='';role='';displayName='';records=[];brands=[];users=[];versions.clear();ready=false;bridgeOrigin='';if(iframe){iframe.remove();iframe=null}if(bridgePopup){try{bridgePopup.close()}catch(_){ }bridgePopup=null}bridgePeer=null;bridgeNonce='';bridgeMode='iframe';signInStarted=false;for(const req of reqs.values()){clearTimeout(req.timer);req.resolve({ok:false,error:'Disconnected'})}reqs.clear();if(interval){clearInterval(interval);interval=null}status=keepConfig?'not-connected':'configured';hasUnlockedOnce=false;paint()}
 function sanitizeTeamRecordPrice(record){
   if(!record||record.brandId!=='asfour')return record;
   const item=record.item||{};
   const source=item.source||((String(record.itemId||'').startsWith('price-')||String(record.recordId||'').includes('|catalog|price-'))?'price':'');
   if(source!=='price'||typeof cleanAsfourProductName!=='function')return record;
   const name=cleanAsfourProductName(record.name,source,record.brandId);
   const itemName=cleanAsfourProductName(item.name,source,record.brandId);
   if(name===record.name&&itemName===item.name)return record;
   return {...record,name,item:{...item,name:itemName}};
 }
 async function refresh(){const data=await call('list');const r=window.LISelectionIdentity?.status()?.role;if(!r||data.user.role!==r)throw Error('Product Selection permissions do not match Supabase. Ask Super Admin to reconcile your role.');email=data.user.email;role=data.user.role;displayName=data.user.name;records=(data.selections||[]).map(sanitizeTeamRecordPrice);brands=data.brands||[];users=data.users||[];window.LICentralCatalog?.onSignedIn(data);lastFetched=new Date().toLocaleTimeString();versions.clear();for(const r of records)versions.set(r.recordId,r.revision);
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
   if(item?.sprite&&(item.sprite.data||(item.sprite.atlas&&SPRITES[item.sprite.atlas]))){
     const picked=window.LITLPicker?.parseRef(record.item?.sourceRef);
     const matches=picked&&(picked.parentId===item.id||picked.parentId===item.sourceItemId);
     const sprite=matches?{...item.sprite,cropRect:picked.crop}:item.sprite;
     return {sprite,urls:SPRITES};
   }
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
  return {recordId:recordId(kind,id),brandId:ACTIVE_BRAND_ID,kind,itemId:id,item:{id,code:item.code||'',name:typeof cleanAsfourProductName==='function'?cleanAsfourProductName(item.name||item.type||'',item.source,ACTIVE_BRAND_ID):(item.name||item.type||''),type:item.type||'',dimension:item.dimension||'',source:item.source||'',sourceRef:item.sourceRef||'',sourceItemId:item.sourceItemId||item.id,page:item.page||null,photoRef:item.sprite?.atlas?item.sprite.atlas+'#'+item.sprite.index:(item.sourceRef||'')},entry,expectedRevision:versions.get(recordId(kind,id))||0}}
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
 async function assignSupabaseMember(address,assignedRole,active,name){
   if(role!=='Super Admin'||!window.LISelectionIdentity?.status()?.signedIn)throw Error('Super Admin sign-in required');
   const {error}=await window.LISelectionIdentity.client().rpc('product_selection_assign_member',{
    target_email:address,assigned_role:assignedRole,target_active:active,target_name:name
   });
   if(error)throw Error('Unable to update Supabase account: '+error.message+'. Make sure the staff member already has a Supabase Auth account.');
 }
 async function syncExistingMembers(){
  if(role!=='Super Admin'||userManageBusy)return;
  if(!confirm('Synchronize existing Team Management roles into Supabase? Only authorized staff accounts already in Supabase Auth will be updated.'))return;
  userManageBusy=true;userManageIsError=false;userManageNotice='Synchronizing staff permissions…';renderTeamManagement();
  let done=0;const failures=[];
  try{
   await refresh();
   for(const user of users){
     try{await assignSupabaseMember(user.email,user.role,!!user.active,user.name||'');done++}
     catch(err){failures.push((user.email||'Unknown')+': '+err.message)}
   }
   userManageIsError=failures.length>0;
   userManageNotice='Supabase permissions synchronized: '+done+'/'+users.length+
     (failures.length?' · '+failures.join('; '):'');
  }catch(err){userManageIsError=true;userManageNotice='Sync failed: '+err.message}
  finally{userManageBusy=false;renderTeamManagement()}
 }
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
    await assignSupabaseMember(address,userRole,true,name);
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
    await assignSupabaseMember(address,nextRole,active,name);
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
  // Match the supplied nine-column Team Selections workbook.
  // CSV cannot embed photos; the Product photo cells remain empty.
  const headers=['No.','Product photo','Product code','Product / description','Original size','Requested size','Qty','Crystal / finish','Custom request'];
  const data=items.map(r=>[r.number,'',r.code,r.description,r.original,r.requested,r.qty,r.finish,r.request]);
  const safe=v=>{
    let value=String(v??'');
    if(/^\s*[=+\-@]/.test(value))value="'"+value;
    return '"'+value.replace(/"/g,'""')+'"';
  };
  const csv=[headers,...data].map(row=>row.map(safe).join(',')).join('\r\n');
  const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='LImperial_Team_Selections_'+(teamBrandFilter==='all'?'All_Brands':teamBrandFilter.replace(/[^a-z0-9_-]/gi,'_'))+'_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
let teamCostView='without',teamCostLookup=new Map();
 async function loadTeamCosts(){
  if(!['Super Admin','Admin'].includes(role)||!window.LISelectionCosts?.authorized()){teamCostView='without';teamCostLookup=new Map();return}
  teamCostLookup=await window.LISelectionCosts.fetchRows(filteredTeamRecords());
 }
 async function setTeamCost(recordId){
  if(!['Super Admin','Admin'].includes(role)||!window.LISelectionCosts?.authorized())return alert('Supplier cost access denied.');
  const rec=records.find(r=>r.recordId===recordId&&!r.deleted);if(!rec)return;
  const old=window.LISelectionCosts.costFor(rec,teamCostLookup);
  const amount=prompt('Supplier unit cost in USD for '+(rec.code||rec.itemId),old?.unit_cost??'');
  if(amount===null)return;
  try{await window.LISelectionCosts.save(rec,amount,'USD');await loadTeamCosts();paint()}catch(e){alert(e.message)}
 }
 let exportingTeamExcel=false;
async function exportTeamExcel(mode='without'){
  if(!['with','without'].includes(mode))throw Error('Invalid export mode');
  if(mode==='with'&&!window.LISelectionCosts?.authorized())return alert('Supplier costs require Supabase Admin or Super Admin access.');
  if(!token||!email||!role)return alert('Sign in with Google to export authorized team selections.');
  if(exportingTeamExcel)return;
  const items=exportTeamRows();
  if(!items.length)return alert('No team selections match this brand filter.');
  exportingTeamExcel=true;
  const button=document.querySelector('[data-sync-action="exportTeamExcel"][data-mode="'+mode+'"]')||document.querySelector('[data-sync-action="exportTeamExcel"]');
  const previousLabel=button?.textContent||'⬇ Export Excel';
  if(button){button.disabled=true;button.textContent='Preparing Excel…'}
  try{
    if(!window.ExcelJS){
      if(mode==='with')throw Error('Excel library unavailable; confidential cost export cancelled.');
      exportTeamCsv(items);
      alert('The Excel library did not load. A CSV without photos has been downloaded instead.');
      return;
    }
    const protectedCosts=mode==='with'?await window.LISelectionCosts.fetchRows(items.map(i=>i.record)):null;
    // Use the already-authorized catalog photos from the existing secure loader.
    if(button)button.textContent='Loading approved photos…';
    const recordList=items.map(x=>x.record);
    const otherBrands=[...new Set(recordList.map(r=>r.brandId))].filter(id=>id!==ACTIVE_BRAND_ID);
    await Promise.allSettled(otherBrands.map(id=>window.LICentralCatalog?.ensureTeamPhotos?.(id,recordList)));
    if(items.some(x=>x.record.brandId===ACTIVE_BRAND_ID))
      await window.LICentralCatalog?.ensureBrand?.(ACTIVE_BRAND_ID).catch(()=>{});
    if(button)button.textContent='Preparing Excel…';
    const book=new window.ExcelJS.Workbook();
    book.creator="L'Imperial Product Selection Studio";
    const sheet=book.addWorksheet('Team Selections',{
      views:[{state:'frozen',ySplit:1}],
      pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1}
    });
    // Match the supplied example exactly: one header row and nine columns.
    // No report title, metadata, staff, status or exported-date columns.
    sheet.columns=[{width:7},{width:22},{width:27},{width:35},{width:20},{width:22},{width:9},{width:23},{width:42},...(mode==='with'?[{width:18},{width:20}]:[])];
    sheet.getRow(1).values=['No.','Product photo','Product code','Product / description','Original size','Requested size','Qty','Crystal / finish','Custom request',...(mode==='with'?['Unit Cost','Total Cost']:[])];
    sheet.getRow(1).font={bold:true,color:{argb:'FF17304D'},size:11};
    sheet.getRow(1).alignment={vertical:'middle'};
    sheet.getRow(1).height=28;
    for(let n=0;n<items.length;n++){
      const info=items[n],i=n+2,row=sheet.getRow(i);
      row.values=[info.number,'',info.code,info.description,info.original,info.requested,info.qty,info.finish,info.request];
      if(mode==='with'){
        const cost=window.LISelectionCosts.costFor(info.record,protectedCosts);
        const total=window.LISelectionCosts.unitTotal(info,cost);
        row.values=[...row.values,total.unit===null?'':total.unit,total.total===null?'':total.total];
        if(cost){
          const currency=String(total.currency||'USD').replace(/[^A-Z]/g,'');
          const fmt=currency==='USD'?'"$"#,##0.00':('"'+currency+' " #,##0.00');
          sheet.getCell(i,10).numFmt=fmt;
          sheet.getCell(i,11).numFmt=fmt;
        }
      }
      row.height=83;
      row.alignment={vertical:'middle',wrapText:true};
      for(let col=1;col<=(mode==='with'?11:9);col++){
        sheet.getCell(i,col).border={bottom:{style:'thin',color:{argb:'FFE7E7E7'}}};
      }
      // Never embed original price-list PDFs or unapproved external URLs.
      // A missing approved image leaves an empty cell, as in the example.
      const image=teamImageForRecord(info.record);
      if(image?.sprite&&typeof imageFromSprite==='function'){
        try{
          const data=await imageFromSprite(image.sprite,image.urls);
          if(data){
            const imageId=book.addImage({base64:data,extension:'png'});
            sheet.addImage(imageId,{tl:{col:1.06,row:i-1+0.05},ext:{width:92,height:92},editAs:'oneCell'});
          }
        }catch(err){console.warn('Unable to include approved product photo',err)}
      }
    }
    const buf=await book.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='LImperial_Team_Selections_'+(teamBrandFilter==='all'?'All_Brands':teamBrandFilter.replace(/[^a-z0-9_-]/gi,'_'))+'_'+new Date().toISOString().slice(0,10)+(mode==='with'?'_With_Cost':'')+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }catch(err){
    console.error('Team Excel export failed',err);
    if(mode==='with'){alert('Protected Excel export failed: '+err.message)}
    else try{exportTeamCsv(items);alert('Excel export failed; downloaded CSV without embedded photos instead.')}catch(e){alert('Unable to export team selections: '+e.message)}
  }finally{
    exportingTeamExcel=false;
    if(button){button.disabled=false;button.textContent=previousLabel}
  }
}
 function teamBrandFilterToolbar(){
  const options=teamBrandOptions();
  const all=records.filter(r=>!r.deleted).length;
  const filtered=filteredTeamRecords().length;
  const costControl=['Admin','Super Admin'].includes(role)&&window.LISelectionCosts?.authorized()?
    '<label for="liTeamCostView">View</label><select id="liTeamCostView" aria-label="Supplier cost visibility">'+
    '<option value="without"'+(teamCostView==='without'?' selected':'')+'>Without Cost</option>'+
    '<option value="with"'+(teamCostView==='with'?' selected':'')+'>With Cost</option></select>':'';
  return '<div class="team-brand-toolbar"><label for="liTeamBrandFilter">Brand</label>'+
   '<select id="liTeamBrandFilter" aria-label="Filter team selections by brand">'+
   '<option value="all"'+(teamBrandFilter==='all'?' selected':'')+'>All brands ('+all+')</option>'+
   options+'</select>'+costControl+
   (['Admin','Super Admin'].includes(role)&&window.LISelectionCosts?.authorized()?'<div class="li-cost-export-menu"><button type="button" class="btn secondary small" data-sync-action="exportTeamExcel" data-mode="without"'+(!filtered?' disabled':'')+'>⬇ Without Cost</button><button type="button" class="btn secondary small" data-sync-action="exportTeamExcel" data-mode="with"'+(!filtered?' disabled':'')+'>⬇ With Cost</button></div>':
    '<button type="button" class="btn secondary small" data-sync-action="exportTeamExcel" data-mode="without"'+(!filtered?' disabled':'')+'>⬇ Export Excel</button>')+
   '<span class="tiny" role="status">Showing '+Math.min(filtered,200)+' of '+filtered+' selection'+(filtered===1?'':'s')+'</span></div>';
 }

 const TEAM_DUP_OPEN=new Map();
 function teamCodeKey(record){
   const value=String(record?.code||record?.entry?.code||record?.item?.code||'').trim();
   return value?value.replace(/\s+/g,'').toUpperCase():'';
 }
 const teamSpecFields=[
   {key:'description',label:'Description'},
   {key:'original',label:'Original size'},
   {key:'requested',label:'Requested size'},
   {key:'finish',label:'Finish'},
   {key:'crystal',label:'Crystal'},
   {key:'request',label:'Custom instructions'},
   {key:'notes',label:'Additional notes'}
 ];
 function teamSelectionSpecification(record){
   const e=record?.entry||{},item=record?.item||{};
   const pick=(...values)=>{
     for(const v of values)if(v!==null&&v!==undefined&&String(v).trim())return String(v).trim();
     return '';
   };
   return {
     description:pick(record.name,item.name,item.type),
     original:pick(record.dimension,record.originalSize,item.dimension,e.originalSize,item.originalSize),
     requested:pick(record.targetSize,e.targetSize),
     finish:pick(record.finish,e.finish),
     crystal:pick(record.crystal,e.crystal),
     request:pick(record.request,e.request),
     notes:pick(record.notes)
   };
 }
 function teamDuplicateGroups(visible){
   const map=new Map(),groups=[];
   for(const record of visible){
     const code=teamCodeKey(record),brand=String(record.brandId||'').toLowerCase();
     // Missing product codes are never presumed to describe the same design.
     if(!code){
       groups.push({key:'',code:'',brand,records:[record]});
       continue;
     }
     const key=brand+'::'+code;
     let group=map.get(key);
     if(!group){group={key,code:String(record.code||record.entry?.code||record.item?.code||'').trim(),brand,records:[]};map.set(key,group);groups.push(group)}
     group.records.push(record);
   }
   return groups;
 }
 function teamDuplicateDifferences(group){
   const specs=group.records.map(teamSelectionSpecification);
   const normalize=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
   return teamSpecFields.filter(field=>
     new Set(specs.map(spec=>normalize(spec[field.key]))).size>1
   );
 }
 function renderTeamDuplicateGroup(group,renderRow){
   const different=teamDuplicateDifferences(group),first=group.records[0];
   // Prefer any available authorized photo among the staff submissions.
   let image=null,photoRecord=first;
   for(const record of group.records){
     image=teamImageForRecord(record);
     if(image?.sprite){photoRecord=record;break}
   }
   const img=image?.sprite&&typeof photo==='function'?
     photo(image.sprite,'selection-thumb',image.urls):photoPlaceholder(photoRecord);
   const brand=brands.find(b=>b.id===first.brandId)?.name||
    (typeof BRANDS!=='undefined'?BRANDS.find(b=>b.id===first.brandId)?.name:null)||first.brandId||'Supplier';
   const pending=group.records.filter(r=>!['Approved','Rejected'].includes(r.decision)).length;
   const open=TEAM_DUP_OPEN.has(group.key)?TEAM_DUP_OPEN.get(group.key):different.length>0;
   const differenceLabels=different.map(f=>f.label).join(', ');
   const note=different.length?
     'Different details: '+esc(differenceLabels):
     'Same product specifications across these submissions';
   const displayValue=v=>v?esc(v):'<span class="team-dup-unspecified">Not specified</span>';
   const compare=different.length?'<div class="team-dup-comparison">'+
     '<div class="team-dup-comparison-title">Compare the differences before approving</div>'+
     '<div class="team-dup-table-scroll"><table class="team-dup-table"><thead><tr><th>Selected by</th><th>Qty</th>'+
     different.map(f=>'<th>'+esc(f.label)+'</th>').join('')+'</tr></thead><tbody>'+
     group.records.map(r=>{
       const spec=teamSelectionSpecification(r);
       return '<tr><td>'+esc(r.ownerEmail||'—')+'</td><td>'+esc(r.qty??r.entry?.qty??'—')+'</td>'+
        different.map(f=>'<td>'+displayValue(spec[f.key])+'</td>').join('')+'</tr>';
     }).join('')+'</tbody></table></div></div>':
     '<p class="team-dup-same">No differences in product or requested specifications. Staff quantities and approvals remain separate.</p>';
   return '<details class="team-duplicate-group" data-team-duplicate-key="'+esc(group.key)+'"'+(open?' open':'')+'>'+
     '<summary class="team-duplicate-summary"><div class="team-duplicate-photo">'+img+'</div>'+
     '<span class="team-duplicate-title"><b>'+esc(brand)+' · '+esc(group.code)+'</b>'+
     '<span>'+group.records.length+' team submissions · '+pending+' awaiting review</span>'+
     '<span class="'+(different.length?'team-dup-different':'team-dup-identical')+'">'+note+'</span></span>'+
     '<span class="team-duplicate-expand">'+(open?'Review entries':'Open entries')+'</span></summary>'+
     '<div class="team-duplicate-body">'+compare+
     '<div class="team-duplicate-records" role="list">'+group.records.map(renderRow).join('')+'</div></div></details>';
 }

 function rowsHTML(){
  const map=new Map(brands.map(b=>[b.id,b.name]));
  const visible=filteredTeamRecords().slice(0,200);
  preloadVisibleTeamPhotos(visible);
  const header='<div class="team-list-head" aria-hidden="true"><span>Photo</span><span>Product / Supplier</span><span>Selected by</span><span>Status / Qty</span><span>Review actions</span></div>';
  const renderRow=r=>{
   const image=teamImageForRecord(r);
   const img=image?.sprite&&typeof photo==='function'?
    photo(image.sprite,'selection-thumb',image.urls):photoPlaceholder(r);
   const brand=map.get(r.brandId)||(typeof BRANDS!=='undefined'?BRANDS.find(b=>b.id===r.brandId)?.name:null)||r.brandId;
   const canApprove=hasRole()&&r.decision!=='Approved'&&r.decision!=='Rejected';
   const canImport=r.brandId===ACTIVE_BRAND_ID;
   const canRemove=canRemoveShared(r);
   const approve=canApprove?
    '<button class="btn small" data-sync-action="approve" data-record-id="'+esc(r.recordId)+'">Approve &amp; confirm</button>'+
    '<button class="btn danger small" data-sync-action="reject" data-record-id="'+esc(r.recordId)+'">Reject</button>':'';
   const importAction=canImport?
    '<button class="btn quiet small" data-sync-action="import" data-record-id="'+esc(r.recordId)+'">Use in selections</button>':'';
   const removeAction=canRemove?
    '<button type="button" class="btn danger small" data-sync-action="removeShared" data-record-id="'+esc(r.recordId)+'">Remove from Team selections</button>':'';
   const decision=String(r.decision||'Review');
   const status=String(r.supplierStatus||'Not requested');
   const recordName=String(r.name||r.item?.name||'Product');
   const owner=String(r.ownerEmail||'—');
   const spec=teamSelectionSpecification(r);
   const costAllowed=['Super Admin','Admin'].includes(role)&&window.LISelectionCosts?.authorized();
   const rowCost=costAllowed&&teamCostView==='with'?window.LISelectionCosts.costFor(r,teamCostLookup):null;
   const values=rowCost?window.LISelectionCosts.unitTotal(r,rowCost):null;
   const costLine=costAllowed&&teamCostView==='with'?'<div class="tiny">Supplier cost: '+
    (values?.unit!=null?esc((values.currency||'USD')+' '+values.unit.toFixed(2))+
      ' · Total '+esc((values.currency||'USD')+' '+(values.total??0).toFixed(2)):'Not entered')+'</div>':'';
   const editCost=costAllowed?'<button type="button" class="btn quiet small" data-sync-action="setSupplierCost" data-record-id="'+esc(r.recordId)+'">Set supplier cost</button>':'';
   const showSpec=(name,val)=>val?'<div class="team-list-request-line"><b>'+name+':</b> '+esc(val)+'</div>':'';
   const specInfo=showSpec('Requested size',spec.requested)+showSpec('Finish',spec.finish)+
    showSpec('Crystal',spec.crystal)+showSpec('Custom instructions',spec.request)+
    showSpec('Additional notes',spec.notes);
   const details='<details class="team-list-details"><summary>More details'+(canRemove?' &amp; remove':'')+'</summary>'+
    '<div class="team-list-detail-content">'+
    '<span class="tiny">Last updated: '+esc(r.updatedAt||'—')+' · Revision '+esc(r.revision??'—')+'</span>'+
    (specInfo?'<div class="team-list-request-details">'+specInfo+'</div>':'')+
    (editCost?'<div class="row-actions">'+editCost+'</div>':'')+
    (removeAction?'<div class="row-actions">'+removeAction+'</div>':'')+
    '</div></details>';
   return '<article class="team-list-row" role="listitem">'+
    '<div class="team-list-top">'+
     '<div class="team-list-photo" title="Product preview from authorized supplier catalog">'+img+'</div>'+
     '<div class="team-list-product"><div class="tiny">'+esc(brand)+' · '+esc(r.kind)+'</div>'+
      '<strong title="'+esc(r.code||r.itemId||'')+'">'+esc(r.code||r.itemId)+'</strong>'+
      '<div class="team-list-description" title="'+esc(recordName)+'">'+esc(recordName)+'</div>'+
      (r.dimension?'<span class="tiny">'+esc(r.dimension)+'</span>':'')+costLine+'</div>'+
     '<div class="team-list-owner"><span class="team-list-mobile-label">Selected by</span>'+
      '<span title="'+esc(owner)+'">'+esc(owner)+'</span></div>'+
     '<div class="team-list-state"><div class="team-list-badges">'+
      '<span class="pill '+(decision==='Approved'?'green':decision==='Rejected'?'warn':'gold')+'">'+esc(decision)+'</span>'+
      '<span class="pill">'+esc(status)+'</span></div>'+
      '<span class="team-list-qty">Qty '+esc(r.qty??'—')+'</span></div>'+
     '<div class="team-list-actions">'+(approve||importAction||
       '<span class="tiny">Reviewed</span>')+(approve&&importAction?importAction:'')+'</div>'+
    '</div>'+details+'</article>';
  };
  const groups=teamDuplicateGroups(visible);
  const rows=groups.map(group=>
    group.records.length===1?renderRow(group.records[0]):renderTeamDuplicateGroup(group,renderRow)
  ).join('');
  return visible.length?'<div class="team-list" role="list">'+header+rows+'</div>':
    '<div class="empty"><h3>No shared selections for this brand</h3><p>Choose All brands or another supplier, or share products from My selections.</p></div>';
 }
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
     '<p class="tiny">Supabase email is the account identifier. To change it, authorize the new email and deactivate the old one.</p>'+
     '<div class="row-actions"><button type="submit" class="btn small"'+(userManageBusy?' disabled':'')+'>Save changes</button>'+
     '<button type="button" class="btn quiet small" data-sync-action="cancelUserEdit"'+(userManageBusy?' disabled':'')+'>Cancel</button></div></form></article>';
  }).join('');
  root.innerHTML='<div class="tm-page"><div class="candidate-row"><div class="variant-top">'+
   '<div><h2>Manage team access</h2><p class="muted">Manage Supabase staff access. Changes update Supabase roles and the private Google Sheets allowlist.</p></div>'+
   '<div class="row-actions"><button class="btn secondary small" type="button" data-sync-action="syncSupabaseMembers"'+(userManageBusy?' disabled':'')+'>Sync existing roles to Supabase</button><button class="btn secondary small" type="button" data-sync-action="refreshUsers"'+(userManageBusy?' disabled':'')+'>↻ Refresh accounts</button></div></div>'+
   '<div class="tm-stats"><span><b>'+activeCount+'</b> Active</span><span><b>'+(list.length-activeCount)+'</b> Inactive</span>'+
   '<span><b>'+list.length+'</b> Total accounts</span></div>'+
   (userManageNotice?'<p role="status" class="'+(userManageIsError?'alert':'tm-success')+'">'+esc(userManageNotice)+'</p>':'')+
   '<div class="tm-directory">'+(cards||'<p>No authorized users returned. Refresh accounts to try again.</p>')+'</div></div>'+
   '<div class="candidate-row tm-add-card"><h2>Authorize new team member</h2>'+
   '<p class="tiny">New users must sign in with the email approved here. Only Super Admin can create, edit, or deactivate accounts.</p>'+
   '<form id="liTeamAddUser"><div class="tm-fields">'+
   '<label class="field"><span>Staff email</span><input name="email" type="email" autocomplete="off" maxlength="255" placeholder="staff@example.com" required></label>'+
   '<label class="field"><span>Display name</span><input name="name" maxlength="100" placeholder="Employee name"></label>'+
   '<label class="field"><span>Assigned role</span><select name="role">'+roleOptions('Staff')+'</select></label></div>'+
   '<div class="row-actions"><button class="btn" type="submit"'+(userManageBusy?' disabled':'')+'>Authorize user</button></div></form></div></div>';
 }
 function render(){const root=document.getElementById('app');if(!root)return;if(!token){root.innerHTML='<div class="candidate-row">Sign in using the secure Supabase form above.</div>';return}
  if(!settingsValid()){root.innerHTML=`<div class="candidate-row" style="max-width:760px"><h2>Secure Google Sheets team synchronization</h2><p>Configure your dedicated Google Apps Script service and Google OAuth Client ID. The Google Sheet is private; users must be authorized before seeing any selection.</p><form id="liSyncConfigForm"><div class="field"><label>Apps Script Web App /exec URL</label><input name="scriptUrl" type="url" placeholder="https://script.google.com/macros/s/.../exec" required></div><div class="field" style="margin-top:12px"><label>Google OAuth Web Client ID</label><input name="clientId" placeholder="123...apps.googleusercontent.com" required></div><div class="row-actions"><button type="submit" class="btn">Save connection settings</button></div></form><p class="tiny">An Apps Script deployment is required before real-time sharing can begin. Do not paste a password, service account key, or API secret.</p></div>`;return}
  root.innerHTML=`<div class="candidate-row"><div class="variant-top"><div><h2>Shared Team Selections</h2><p class="tiny" id="teamSyncNotice">${esc(email&&role?'Signed in as '+email+' · '+role:token?'Verifying Google sign-in and team access…':'Sign in with Google to access team selections')}</p>${lastError?`<p class="alert">${esc(lastError)}</p><div class="row-actions"><button class="btn secondary small" data-sync-action="openBridgePopup">Open secure Google connection window</button><a class="btn quiet small" href="'+esc(config.scriptUrl)+'" target="_blank" rel="noopener">Check deployed Web App URL</a></div>`:''}</div><div class="row-actions">${role==='Super Admin'?'<button class="btn quiet small" data-sync-action="reconfigure">Connection settings</button>':''}${token?'<button class="btn quiet small" data-sync-action="signout">Sign out</button>':''}</div></div>${!token?'<div id="liGoogleSignIn" style="min-height:50px;margin:12px 0"></div><p id="teamSyncConnectError" class="alert" hidden></p><div class="row-actions"><button class="btn secondary small" data-sync-action="retrySignIn">Show Google Sign-In</button><button class="btn quiet small" data-sync-action="openBridgePopup">Open secure connection window</button></div>':email&&role?`<div class="row-actions"><button class="btn secondary small" data-sync-action="refresh">↻ Refresh team selections</button><button class="btn small" data-sync-action="publish">Share my current ${esc(brandNow().name)} selections</button><span class="tiny">Last refreshed: ${esc(lastFetched||'—')} · ${records.length} records</span></div>`:'<div class="row-actions"><button class="btn secondary small" data-sync-action="retryConnection">Retry team connection</button><span class="tiny">Google account received; checking team authorization</span></div>'}<p class="tiny">Approved staff can browse private supplier catalogs after Google sign-in. New selections and edits sync while signed in; previously saved local drafts are not bulk-published automatically.</p></div>${email&&role?`<div class="subheading"><h2>Team review</h2><span class="tiny">Authorized users only</span></div>${teamBrandFilterToolbar()}<div class="row-list">${rowsHTML()}</div>${adminCatalogForm()}`:''}`;
  if(!token){const slot=document.getElementById('liGoogleSignIn');if(slot)slot.insertAdjacentHTML('afterend',repairClientMarkup());showGoogleButton();if(!signInStarted&&status!=='error'){signInStarted=true;connectButton().catch(e=>{status='error';lastError=e.message;paint()})}}}
 document.addEventListener('submit',e=>{if(e.target.id==='liSupabaseLogin'){
  e.preventDefault();
  const form=e.target,button=form.querySelector('[type="submit"]');
  const d=new FormData(form);
  if(button){button.disabled=true;button.textContent='Signing in…'}
  lastError='';
  window.LISelectionIdentity.signIn(String(d.get('email')||''),String(d.get('password')||''))
   .then(()=>{status='connecting';paint()})
   .catch(err=>{status='auth-required';lastError=err.message;const p=document.getElementById('liSupabaseSignInError');if(p){p.hidden=false;p.textContent=err.message}})
   .finally(()=>{if(button){button.disabled=false;button.textContent='Sign in'}});
  return;
 }if(e.target.id==='liSyncConfigForm'){e.preventDefault();const d=new FormData(e.target);try{saveConfig({clientId:String(d.get('clientId')||''),scriptUrl:String(d.get('scriptUrl')||'')})}catch(err){alert(err.message)}return}if(e.target.id==='liOAuthClientRepair'){e.preventDefault();const d=new FormData(e.target);try{const clientId=String(d.get('clientId')||'');fixClientOpen=false;gsiClient='';saveConfig({...config,clientId})}catch(err){fixClientOpen=true;alert(err.message)}return}if(e.target.id==='liTeamAddUser'){e.preventDefault();addUser(e.target);return}if(e.target.matches('[data-team-edit-form]')){e.preventDefault();saveEditedUser(e.target);return}if(e.target.id==='liPublishCatalog'){e.preventDefault();publishCentralCatalog(e.target)}});
 document.addEventListener('toggle',event=>{
   const detail=event.target;
   if(detail?.matches?.('details[data-team-duplicate-key]'))
     TEAM_DUP_OPEN.set(detail.dataset.teamDuplicateKey,detail.open);
 },true);
 document.addEventListener('change',e=>{
  if(e.target?.id==='liTeamCostView'){
   teamCostView=e.target.value==='with'&&window.LISelectionCosts?.authorized()?'with':'without';
   if(teamCostView==='with')loadTeamCosts().then(()=>paint()).catch(e=>{teamCostView='without';alert(e.message);paint()});
   else{teamCostLookup=new Map();paint()}
   return;
  }
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
  if(act==='syncSupabaseMembers'&&role==='Super Admin'&&VIEW==='team-management'){syncExistingMembers();return}
  if(act==='refreshUsers'&&role==='Super Admin'&&VIEW==='team-management'&&!userManageBusy){
   userManageBusy=true;userManageNotice='Refreshing authorized accounts…';userManageIsError=false;renderTeamManagement();
   refresh().then(()=>{status='connected';userManageNotice='Team directory refreshed.';userManageIsError=false})
    .catch(err=>{userManageIsError=true;userManageNotice='Unable to refresh users: '+err.message})
    .finally(()=>{userManageBusy=false;renderTeamManagement()});return;
  }
  if(act==='fixClient'){fixClientOpen=!fixClientOpen;paint();return}if(act==='retrySignIn'){connectButton(true);return}if(act==='retryConnection'){reconnectAttempts=0;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}if(!ready&&bridgeMode==='iframe'&&iframe)iframe.dataset.liBridgeFailed='yes';authenticateCurrentToken();return}if(act==='openBridgePopup'){openBridgePopup();return}if(act==='refresh')refresh().then(()=>{status='connected';lastError='';rememberVerifiedSession();window.LICentralCatalog?.onConnected?.();paint()}).catch(err=>{status='offline';lastError='Team connection problem: '+err.message;paint();scheduleRetry()});if(act==='publish')publishCurrent();if(act==='exportTeamExcel')exportTeamExcel(b.dataset.mode==='with'?'with':'without');if(act==='setSupplierCost')setTeamCost(b.dataset.recordId);if(act==='import')importShared(b.dataset.recordId);if(act==='removeShared')removeShared(b.dataset.recordId);if(act==='approve'||act==='reject')moderate(b.dataset.recordId,act);if(act==='signout'){disconnect(true,true);paint()}if(act==='reconfigure'&&role==='Super Admin'){if(confirm('Change the connection settings for this device? Existing local selections will remain.')){localStorage.removeItem(KEY);config={};disconnect(false);paint()}}});
 function adminCatalogForm(){if(role!=='Super Admin')return '';return '<div class="candidate-row"><h3>Publish private supplier catalog</h3><p class="tiny">Upload the prepared JSON pack to private Google Drive once. Staff will receive its photos automatically after signing in.</p><form id="liPublishCatalog"><div class="variant-fields"><div class="field"><label>Supplier</label><select name="brandId">'+brands.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('')+'</select></div><div class="field span2"><label>Private Drive catalog-pack link</label><input name="driveFile" required placeholder="https://drive.google.com/file/d/.../view"></div></div><label class="tiny"><input type="checkbox" name="confirmUntagged" value="1"> Confirm legacy pack without an internal brand label (Asfour)</label><div class="row-actions"><button type="submit" class="btn secondary">Publish catalog</button></div></form></div>'}
 async function publishCentralCatalog(form){if(role!=='Super Admin')return;const d=new FormData(form),brandId=String(d.get('brandId')||''),driveFile=String(d.get('driveFile')||'').trim();if(!confirm('Publish this private Drive catalog to authorized staff?'))return;try{const result=await call('publishCatalog',{brandId,driveFile,confirmUntagged:d.has('confirmUntagged')});await refresh();if(result.brandId===ACTIVE_BRAND_ID)window.LICentralCatalog?.ensureBrand(brandId,true).catch(()=>{});alert(result.itemCount+' products published for '+brandId);paint()}catch(err){alert('Catalog publishing failed: '+err.message)}}
 function init(){
  syncAccessGate();
  if(!settingsValid()){lastError='Apps Script bridge URL is not configured';paint();return}
  const identity=window.LISelectionIdentity;
  if(!identity){lastError='Supabase login library was not loaded';paint();return}
  identity.onChange(next=>{
    const currentToken=next.signedIn?next.accessToken:'';
    if(currentToken===token)return;
    if(currentToken){token=currentToken;authenticateCurrentToken()}
    else if(token){disconnect(true,false);status='auth-required';paint()}
    else paint();
  });
  identity.init().then(next=>{
    if(next.signedIn&&next.accessToken){
      token=next.accessToken;authenticateCurrentToken();
    }else{status='auth-required';paint()}
  }).catch(err=>{status='auth-required';lastError=err.message;paint()});
 }
 window.LITeamSync={init,render,renderTeamManagement,itemChanged,itemRemoved,localSaved,brandCreated,status:statusView,getRoles:()=>self(),refresh,disconnect,request:call};
})();
