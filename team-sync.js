/* L'Imperial Product Selection: Supabase staff authentication and private team sync.
   The Apps Script bridge verifies Supabase access tokens and preserves Google Sheet records. */
'use strict';
(() => {
 const KEY='li-team-sync-client-config-v1';const SESSION_KEY='li-team-browser-session-v1';const APP_ORIGIN=location.origin;
 const DEFAULT_CONFIG={scriptUrl:'https://script.google.com/macros/s/AKfycbzlXPtmjhHpTot4R0ItabhBOQBrNamB2TUegdq6Lde-uX930U1hIohNqRsvUzMW5LYc1g/exec',clientId:'97172665640-k7lq4tqtl8jl3udei8f4f7tml8agfil4.apps.googleusercontent.com'};let config={...DEFAULT_CONFIG}; // Fixed trusted backend: never send a Supabase bearer token to a browser-configured URL.
 let iframe=null,bridgePopup=null,bridgePeer=null,bridgeOrigin='',bridgeNonce='',bridgeMode='iframe',signInStarted=false,ready=false,token='',email='',role='',displayName='';
 let records=[],brands=[],users=[],serverFeatures={},lastError='',status='not-connected',reqs=new Map(),pending=0,lastFetched='',fixClientOpen=false,hasUnlockedOnce=false;
 let editingUserEmail='',userManageBusy=false,userManageNotice='',userManageIsError=false;
 const TEAM_BRAND_FILTER_KEY='li-team-brand-filter-v1';
 let teamBrandFilter='all';
 try{teamBrandFilter=localStorage.getItem(TEAM_BRAND_FILTER_KEY)||'all'}catch(_){teamBrandFilter='all'}
 const versions=new Map();let gsiLoaded=false,gsiClient='',callbacks=null,interval=null,oneTapOffered=false,credentialInFlight=false,reconnectTimer=null,reconnectAttempts=0;
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 function self(){return {email,role,name:displayName}}
 // Display the exact staff name configured in User & Access, not the login email.
 // ownerEmail remains the immutable identity for approvals, sync and audit history.
 function teamOwnerName(record){
  const address=String(record?.ownerEmail||'').trim().toLowerCase();
  const directoryUser=users.find(u=>String(u.email||'').trim().toLowerCase()===address);
  const assigned=String(record?.ownerName||record?.ownerDisplayName||directoryUser?.name||
    (address===String(email||'').trim().toLowerCase()?displayName:'')||'').trim();
  return assigned&&assigned.toLowerCase()!==address?assigned:'Name not set';
 }
 function hasRole(){return ['Super Admin','Admin','Manager'].includes(role)}
 function normalizeConfigValue(value){return String(value??'').replace(/[\s\u200B-\u200D\uFEFF]+/g,'')}
 function settingsValid(){return normalizeConfigValue(config.scriptUrl)===DEFAULT_CONFIG.scriptUrl}
 function clearRememberedSession(){try{sessionStorage.removeItem(SESSION_KEY)}catch(_){}}
 function tokenExpiresAt(t){try{const p=JSON.parse(atob(String(t).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return Number.isFinite(Number(p.exp))?Number(p.exp)*1000:0}catch(_){return 0}}
 // Supabase SDK persists and refreshes the access token in sessionStorage.
 // Never restore a legacy Google credential into a Supabase session.
 function rememberVerifiedSession(){clearRememberedSession()}
 function restoreRememberedSession(){clearRememberedSession();return false}
 function invalidIdentity(err){return /SUPABASE_ACCESS_DENIED|INVALID_SUPABASE_TOKEN|ACCESS_DENIED|SIGN_IN_REQUIRED/i.test(String(err?.message||''))}
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
    status='auth-required';lastError='Supabase sign-in needs renewal or this account is not authorized: '+err.message;
   }else{
    status='offline';lastError=/SIGN_IN_EXPIRED|INVALID_GOOGLE_IDENTITY/.test(String(err?.message||''))?'Team server still requires Google tokens. Deploy the Supabase auth replacement in Apps Script; selections remain safe.':'Supabase verified your account, but Team Sync could not connect: '+err.message+'. Retry after the server is updated.';
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
  const mode=token?'verifying':'signin';
  if(content.dataset.liGateMode!==mode){
   content.dataset.liGateMode=mode;
   content.innerHTML='<h2 style="font-size:22px;margin:0 0 10px">L\'Imperial Staff Login</h2>'+
    '<p id="liGateAuthStatus" class="li-auth-status" role="status"></p>'+
    '<div id="liGateError" class="li-auth-error" role="alert" hidden></div>'+
    '<form id="liSupabaseSignIn"><div class="field"><label>Staff email</label>'+
    '<input name="email" type="email" autocomplete="username" required placeholder="name@example.com"></div>'+
    '<div class="field" style="margin-top:12px"><label>Password</label>'+
    '<input name="password" type="password" autocomplete="current-password" required></div>'+
    '<div class="li-auth-actions"><button type="submit" class="btn">Sign in with Supabase</button></div></form>'+
    '<div class="li-auth-actions"><button type="button" class="btn secondary small" data-sync-action="retryConnection">Retry secure connection</button><button type="button" class="btn quiet small" data-sync-action="openBridgePopup">Open connection window</button>'+
    '<button type="button" class="btn quiet small" data-sync-action="signout">Change account</button></div>';
  }
  const stat=document.getElementById('liGateAuthStatus');
  if(stat)stat.textContent=token?
   'Supabase account verified. Checking the private Team Sync server…':
   'Use the email and password for your approved Supabase staff account.';
  const error=document.getElementById('liGateError');
  if(error){error.textContent=lastError||'';error.hidden=!lastError}
  const retry=document.querySelector('#liAuthGate [data-sync-action="retryConnection"]');
  if(retry)retry.hidden=!token;
  const change=document.querySelector('#liAuthGate [data-sync-action="signout"]');
  if(change)change.hidden=!token;
  const form=document.getElementById('liSupabaseSignIn');
  if(form)form.hidden=!!token;
 }
 function info(text){const n=document.getElementById('teamSyncNotice');if(n)n.textContent=text}
 function paint(){syncAccessGate();if(typeof VIEW!=='undefined'&&VIEW==='team'&&statusView().connected)render()}
 function saveConfig(){throw Error('The private Team Sync endpoint is centrally managed. Update the approved GitHub configuration after deploying Apps Script; never enter an arbitrary URL here.')}
 function repairClientMarkup(){
  const projectUrl='https://console.cloud.google.com/auth/clients?project=limperialproductselection-sync';
  return '<div class="row-actions" style="margin-top:10px"><button type="button" class="btn quiet small" data-sync-action="fixClient">'+(fixClientOpen?'Hide OAuth diagnostics':'Fix Google Sign-In (401 invalid_client)')+'</button></div>'+
   (fixClientOpen?'<div class="candidate-row" style="margin-top:12px"><h3>Check the Google OAuth Client ID</h3><p class="tiny">Google error 401 means this Client ID is not recognized or is not configured correctly. Open the Cloud Console client in the correct project and use its Copy button. A Client ID is public; never enter the Client Secret.</p><p class="tiny"><a href="'+projectUrl+'" target="_blank" rel="noopener">Open Google Cloud → Clients</a></p><form id="liOAuthClientRepair"><div class="field"><label>Active Web OAuth Client ID</label><input name="clientId" type="text" autocomplete="off" value="'+esc(config.clientId||'')+'" required></div><div class="row-actions"><button class="btn" type="submit">Save verified Client ID</button></div></form><p class="tiny">This changes the login configuration on this computer only. It preserves the Apps Script URL, catalogs, and existing selections. After the correct ID is verified, it can be published as the common default for all staff.</p></div>':'');
 }
 function newNonce(){const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
 function bridgeURL(){const url=new URL(config.scriptUrl);url.searchParams.set('li_session',bridgeNonce);return url.toString()}
 function frame(){if(!settingsValid())throw Error('Configure Apps Script URL and OAuth Client ID first');if(iframe||(bridgePopup&&!bridgePopup.closed))return;
  bridgeMode='iframe';bridgeNonce=newNonce();iframe=document.createElement('iframe');iframe.setAttribute('aria-hidden','true');iframe.setAttribute('title','Secure LImperial Team Sync');iframe.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-10000px;';iframe.referrerPolicy='no-referrer';iframe.src=bridgeURL();document.body.appendChild(iframe)}
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
function paintStatusOnly(){const t=document.getElementById('teamSyncNotice');if(t)t.textContent=token?(email&&role?'Signed in as '+email+' · '+role:'Verifying Supabase sign-in and team access…'):'Sign in with your Supabase staff account';syncAccessGate()}
async function onSupabaseIdentity(identity){
  if(!identity?.accessToken)throw Error('Supabase authentication is required');
  token=identity.accessToken;
  status='connecting';lastError='';syncAccessGate();
  await authenticateCurrentToken();
 }
 async function supabaseLogin(form){
  const button=form.querySelector('button[type=submit]');if(button){button.disabled=true;button.textContent='Verifying account…'}
  lastError='';syncAccessGate();
  try{
    const d=new FormData(form);
    const who=await window.LISupabaseAuth.signIn(String(d.get('email')||''),String(d.get('password')||''));
    form.elements.password.value='';
    await onSupabaseIdentity(who);
  }catch(error){
    lastError=String(error?.message||error);status='auth-required';token='';email='';role='';displayName='';
    syncAccessGate();
  }finally{if(button){button.disabled=false;button.textContent='Sign in with Supabase'}}
 }
 function disconnect(keepConfig=true,explicitSignOut=false){
  if(explicitSignOut&&window.google?.accounts?.id){
    try{google.accounts.id.disableAutoSelect();google.accounts.id.cancel?.()}catch(_){}
  }
  window.LICentralCatalog?.onSignedOut();clearRememberedSession();if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}reconnectAttempts=0;token='';email='';role='';displayName='';records=[];brands=[];users=[];serverFeatures={};versions.clear();ready=false;bridgeOrigin='';if(iframe){iframe.remove();iframe=null}if(bridgePopup){try{bridgePopup.close()}catch(_){ }bridgePopup=null}bridgePeer=null;bridgeNonce='';bridgeMode='iframe';signInStarted=false;for(const req of reqs.values()){clearTimeout(req.timer);req.resolve({ok:false,error:'Disconnected'})}reqs.clear();if(interval){clearInterval(interval);interval=null}status=keepConfig?'not-connected':'configured';hasUnlockedOnce=false;paint()}
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
 async function refresh(){const data=await call('list');email=data.user.email;role=data.user.role;displayName=data.user.name;records=(data.selections||[]).map(sanitizeTeamRecordPrice);brands=data.brands||[];users=data.users||[];serverFeatures=data.features||{};window.LICentralCatalog?.onSignedIn(data);lastFetched=new Date().toLocaleTimeString();versions.clear();for(const r of records)versions.set(r.recordId,r.revision);
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
  // Prevent accidental repeat submissions by the same staff member.
  if(!records.some(r=>r.recordId===data.recordId&&!r.deleted)){
    const proposed={...data,ownerEmail:email,code:data.item?.code||data.entry?.code||'',name:data.item?.name||'',dimension:data.item?.dimension||''};
    const signature=teamExactDuplicateSignature(proposed);
    const existing=signature&&records.find(r=>!r.deleted&&r.recordId!==data.recordId&&teamExactDuplicateSignature(r)===signature);
    if(existing&&!confirm('Possible repeated selection for '+(data.item?.code||data.itemId)+
      ' under your name.\nExisting quantity: '+existing.qty+
      '.\nCancel to update your existing selection quantity (or ask an Admin).\nOK to keep this as a separate submission.'))return;
  }
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
 async function syncSupabaseMember(address,details){
  if(role!=='Super Admin')throw Error('Only Super Admin can edit staff access.');
  const api=await window.LISupabaseAuth.getClient();
  const {data:profile,error:profileErr}=await api.from('app_users')
    .select('user_id,email').eq('email',address).maybeSingle();
  if(profileErr||!profile?.user_id)throw Error('Create the staff account in Supabase Auth first, then add it to the Product Selection team.');
  const {data:previous,error:readErr}=await api.from('product_selection_members')
    .select('user_id,role,active,display_name').eq('user_id',profile.user_id).maybeSingle();
  if(readErr)throw Error('Could not read the existing Product Selection membership.');
  const values={role:details.role,active:!!details.active,display_name:details.name||address,updated_at:new Date().toISOString()};
  const write=previous?
    await api.from('product_selection_members').update(values).eq('user_id',profile.user_id):
    await api.from('product_selection_members').insert({user_id:profile.user_id,...values});
  if(write.error)throw Error('Supabase denied the account change: '+write.error.message);
  return async()=>{
   const rollback=previous?
    await api.from('product_selection_members').update({role:previous.role,active:previous.active,
     display_name:previous.display_name}).eq('user_id',profile.user_id):
    await api.from('product_selection_members').delete().eq('user_id',profile.user_id);
   if(rollback.error)throw Error('Supabase rollback failed: '+rollback.error.message);
  };
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
    const undo=await syncSupabaseMember(address,{name,role:userRole,active:true});
    try{await call('setUser',{email:address,name,role:userRole,active:true})}
    catch(e){await undo();throw e}
    await refresh();status='connected';userManageNotice='Supabase account authorized: '+address;userManageIsError=false;
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
    const undo=await syncSupabaseMember(address,{name,role:nextRole,active});
    try{await call('setUser',{email:address,name,role:nextRole,active})}
    catch(e){await undo();throw e}
    await refresh();status='connected';editingUserEmail='';
    userManageNotice='Updated Supabase membership for '+address+'.';userManageIsError=false;
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
function exportTeamCsv(items,withCost=false,costs=[]){
  // Match the supplied nine-column Team Selections workbook.
  // CSV cannot embed photos; the Product photo cells remain empty.
  const headers=['No.','Product photo','Product code','Product / description','Original size','Requested size','Qty','Crystal / finish','Custom request'];
  if(withCost)headers.push('Unit Cost','Total Cost');
  const data=items.map((r,i)=>{
   const row=[r.number,'',r.code,r.description,r.original,r.requested,r.qty,r.finish,r.request];
   if(withCost){
     const cost=costs[i],unit=cost?Number(cost.unit_cost):null,qty=Number(r.qty);
     row.push(cost&&Number.isFinite(unit)?unit:'',cost&&Number.isFinite(unit)&&Number.isFinite(qty)?Number((unit*qty).toFixed(4)):'');
   }
   return row;
  });
  const safe=v=>{
    let value=String(v??'');
    if(/^\s*[=+\-@]/.test(value))value="'"+value;
    return '"'+value.replace(/"/g,'""')+'"';
  };
  const csv=[headers,...data].map(row=>row.map(safe).join(',')).join('\r\n');
  const blob=new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='LImperial_Team_Selections_'+(teamBrandFilter==='all'?'All_Brands':teamBrandFilter.replace(/[^a-z0-9_-]/gi,'_'))+'_'+new Date().toISOString().slice(0,10)+(withCost?'_With_Cost':'')+'.csv';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
let exportingTeamExcel=false;
async function exportTeamExcel(withCost=false){
  if(!token||!email||!role)return alert('Sign in to export authorized team selections.');
  if(exportingTeamExcel)return;
  const items=exportTeamRows();
  if(!items.length)return alert('No team selections match this brand filter.');
  if(withCost&&!['Super Admin','Admin'].includes(role))return alert('Only Admin and Super Admin may export supplier costs.');
  if(withCost){
    if(!window.LISelectionCosts||!(await window.LISelectionCosts.requireAdmin()))return;
  }
  exportingTeamExcel=true;
  const button=document.querySelector(withCost?'[data-sync-action="exportTeamExcelWithCost"]':'[data-sync-action="exportTeamExcel"]');
  const originalLabel=button?.textContent||'⬇ Export Excel';
  let costData=null;
  if(button){button.disabled=true;button.textContent='Preparing Excel…'}
  try{
    // Cost data is NEVER requested for standard staff exports.
    if(withCost)costData=await window.LISelectionCosts.lookup(items.map(x=>x.record));
    if(!window.ExcelJS){
      exportTeamCsv(items,withCost,costData||[]);
      alert('The Excel library did not load. A CSV without photos has been downloaded instead.');
      return;
    }
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
    sheet.columns=[{width:7},{width:22},{width:27},{width:35},{width:20},{width:22},{width:9},{width:23},{width:42},
      ...(withCost?[{width:18},{width:18}]:[])];
    sheet.getRow(1).values=['No.','Product photo','Product code','Product / description','Original size','Requested size','Qty','Crystal / finish','Custom request',
      ...(withCost?['Unit Cost','Total Cost']:[])];
    sheet.getRow(1).font={bold:true,color:{argb:'FF17304D'},size:11};
    sheet.getRow(1).alignment={vertical:'middle'};
    sheet.getRow(1).height=28;
    for(let n=0;n<items.length;n++){
      const info=items[n],i=n+2,row=sheet.getRow(i);
      row.values=[info.number,'',info.code,info.description,info.original,info.requested,info.qty,info.finish,info.request];
      if(withCost){
        const cost=costData[n];
        const amount=cost?Number(cost.unit_cost):null,qty=Number(info.qty);
        row.getCell(10).value=cost&&Number.isFinite(amount)?amount:null;
        row.getCell(11).value=cost&&Number.isFinite(amount)&&Number.isFinite(qty)?Number((amount*qty).toFixed(4)):null;
        row.getCell(10).numFmt='"$"#,##0.00';
        row.getCell(11).numFmt='"$"#,##0.00';
      }
      row.height=83;
      row.alignment={vertical:'middle',wrapText:true};
      for(let col=1;col<=(withCost?11:9);col++){
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
    link.href=url;link.download='LImperial_Team_Selections_'+(teamBrandFilter==='all'?'All_Brands':teamBrandFilter.replace(/[^a-z0-9_-]/gi,'_'))+'_'+new Date().toISOString().slice(0,10)+(withCost?'_With_Cost':'')+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }catch(err){
    console.error('Team Excel export failed',err);
    if(withCost&&!costData)alert('Secure cost lookup failed; nothing was exported.');
    else try{exportTeamCsv(items,withCost,costData||[]);alert('Excel export failed; downloaded CSV without embedded photos instead.')}catch(e){alert('Unable to export team selections: '+e.message)}
  }finally{
    exportingTeamExcel=false;
    if(button){button.disabled=false;button.textContent=originalLabel}
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
   (['Super Admin','Admin'].includes(role)?
     '<details class="li-export-choice"><summary class="btn secondary small"'+(!filtered?' aria-disabled="true"':'')+'>⬇ Export Excel ▾</summary>'+
     '<div class="li-export-menu"><button type="button" class="btn quiet small" data-sync-action="exportTeamExcel"'+(!filtered?' disabled':'')+'>Without Cost</button>'+
     '<button type="button" class="btn quiet small" data-sync-action="exportTeamExcelWithCost"'+(!filtered?' disabled':'')+'>With Cost · Admin only</button></div></details>'+
     '<button type="button" class="btn quiet small" data-sync-action="toggleTeamCosts">Show / hide costs</button>':
     '<button type="button" class="btn secondary small" data-sync-action="exportTeamExcel"'+(!filtered?' disabled':'')+'>⬇ Export Excel</button>')+
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
 // Purely visual review markers. Decisions are still read from the existing
 // persisted records; no client-side approval state is changed here.
 function teamReviewBadge(decision,compact=false){
   if(decision!=='Approved'&&decision!=='Rejected')return '';
   const approved=decision==='Approved';
   return '<span class="team-review-badge '+(approved?'team-review-approved':'team-review-rejected')+
     (compact?' team-review-badge-compact':'')+'" aria-label="Review status: '+decision+'">'+
     '<span aria-hidden="true">'+(approved?'✓':'✕')+'</span> '+decision+'</span>';
 }

 const TEAM_DUP_CANDIDATES=new Map();
 function teamExactDuplicateSignature(record){
  const entry=record.entry||{},item=record.item||{};
  const norm=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
  const code=teamCodeKey(record);
  if(!code)return '';
  return JSON.stringify([
    norm(record.brandId),code,norm(record.ownerEmail),norm(entry.roundId||'round-1'),
    norm(record.name||item.name),norm(record.dimension||entry.originalSize),
    norm(entry.targetSize),norm(entry.finish),norm(entry.crystal),norm(entry.request||record.notes)
  ]);
 }
 function teamExactDuplicateClusters(rows){
  const map=new Map();
  for(const record of rows){
   const key=teamExactDuplicateSignature(record);if(!key)continue;
   if(!map.has(key))map.set(key,[]);
   map.get(key).push(record);
  }
  return [...map.values()].filter(group=>group.length>1);
 }
 function duplicateReviewMarkup(group){
  const clusters=teamExactDuplicateClusters(group.records);
  if(!clusters.length)return '';
  return '<div class="team-dup-review-box"><h4>Possible duplicate selections</h4>'+
   '<p class="tiny">Only identical specifications from the same staff member are flagged. Different sizes or staff members stay separate.</p>'+
   clusters.map((cluster,index)=>{
     const key=group.key+'::'+index;
     TEAM_DUP_CANDIDATES.set(key,cluster.map(r=>({recordId:r.recordId,expectedRevision:r.revision})));
     const approved=cluster.filter(r=>r.decision==='Approved').length;
     const recordedQty=cluster.reduce((n,r)=>n+(Number(r.qty)||0),0);
     const allSeparate=cluster.every(r=>r.entry?.duplicateKeepSeparate===true);
     const sameStatus=cluster.every(r=>r.decision===cluster[0].decision && r.supplierStatus===cluster[0].supplierStatus);
     const label=teamOwnerName(cluster[0])+' · '+cluster.length+' entries · recorded qty '+recordedQty;
     const safeKey=esc(key);
     const actions=['Super Admin','Admin'].includes(role)&&serverFeatures.duplicateReview===true&&!allSeparate?
       '<div class="team-dup-review-actions">'+
        (sameStatus?'<button type="button" class="btn small" data-sync-action="mergeExactDuplicates" data-duplicate-key="'+safeKey+'">Merge entries…</button>':
         '<span class="tiny">Mixed decisions: review each status before merging.</span>')+
        '<button type="button" class="btn secondary small" data-sync-action="keepDuplicatesSeparate" data-duplicate-key="'+safeKey+'">Keep separate</button>'+
       '</div>':'';
     return '<div class="team-dup-review-entry">'+
       '<span class="team-dup-review-description">'+
         (allSeparate?'<span class="team-dup-reviewed-label">✓ Kept separate</span>':'<span class="team-dup-alert-label">! Possible repeat</span>')+
         '<b>'+esc(label)+'</b>'+
         '<small>'+approved+' approved; no quantities changed automatically</small>'+
       '</span>'+actions+'</div>';
   }).join('')+'</div>';
 }
 async function editTeamQuantity(recordId){
  if(!['Super Admin','Admin'].includes(role)||serverFeatures.teamQtyEdit!==true)return;
  const r=records.find(x=>x.recordId===recordId&&!x.deleted);if(!r)return;
  const value=prompt('Edit Team Selection quantity for '+(r.code||r.name||'product')+
    ' · '+teamOwnerName(r)+'\nCurrent qty: '+r.qty+'\nEnter the new TOTAL quantity (whole number 0–9999):',String(r.qty));
  if(value===null)return;
  if(!/^\d{1,4}$/.test(value.trim())||Number(value)>9999){alert('Enter a whole number from 0 to 9999.');return}
  const newQty=Number(value);
  if(newQty===Number(r.qty))return;
  const reason=prompt('Reason for changing quantity (recorded in the private audit history):','Correction after review');
  if(reason===null)return;
  if(reason.trim().length<3){alert('Please provide a reason of at least 3 characters.');return}
  if(!confirm('Change '+(r.code||r.name)+' quantity from '+r.qty+' to '+newQty+
   '?\nDecision remains '+r.decision+'.\nOwner remains '+teamOwnerName(r)+'.'))return;
  try{
    await call('editTeamQty',{recordId:r.recordId,expectedRevision:r.revision,qty:newQty,reason:reason.trim()});
    await refresh();status='connected';lastError='';paint();
  }catch(error){lastError='Unable to edit Team quantity: '+error.message;status='error';paint()}
 }
 async function reviewExactDuplicateGroup(key,action){
  if(!['Super Admin','Admin'].includes(role)||serverFeatures.duplicateReview!==true)return;
  const refs=TEAM_DUP_CANDIDATES.get(key);if(!refs||refs.length<2)return;
  const chosen=refs.map(x=>records.find(r=>r.recordId===x.recordId&&!r.deleted));
  if(chosen.some(x=>!x)){alert('Selections changed. Refresh Team Selections first.');return}
  const owner=teamOwnerName(chosen[0]),code=chosen[0].code||'this code';
  const allSame=chosen.every(r=>r.decision===chosen[0].decision&&r.supplierStatus===chosen[0].supplierStatus);
  if(action==='merge'&&!allSame){alert('These submissions have different review decisions or supplier statuses. Review them separately first.');return}
  const total=chosen.reduce((n,r)=>n+(Number(r.qty)||0),0);
  let finalQty;
  if(action==='merge'){
    const value=prompt('Merge '+chosen.length+' exact matching entries for '+owner+' / '+code+'.\n'+
      'Existing recorded total: '+total+'.\nEnter the FINAL quantity to retain.\n'+
      'Use the intended quantity (e.g. 2 for an accidental repeat); do not automatically sum duplicates.',String(chosen[0].qty));
    if(value===null)return;
    if(!/^\d{1,4}$/.test(value.trim())||Number(value)>9999){alert('Enter a whole number from 0 to 9999.');return}
    finalQty=Number(value);
  }
  const reason=prompt(action==='merge'?
      'Reason for merging (preserved in the private audit):':
      'Why are these separate orders/selections? (saved in audit):',
      action==='merge'?'Accidental duplicate selection':'Separate projects or intended orders');
  if(reason===null)return;
  if(reason.trim().length<3){alert('Please enter a reason (at least 3 characters).');return}
  if(!confirm(action==='merge'?
    'Merge '+chosen.length+' entries for '+owner+' / '+code+'?\nRecorded total: '+total+
    '\nFINAL quantity: '+finalQty+'\nDuplicate source rows will be archived (not permanently erased).\nApprovals will not change.':
    'Mark '+chosen.length+' matching entries as intentionally separate?\nAll recorded quantities and approvals will stay unchanged.'))return;
  const payload={records:refs,reason:reason.trim()};
  try{
    if(action==='merge'){
      const target=[...chosen].sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')))[0];
      await call('mergeDuplicates',{...payload,targetRecordId:target.recordId,finalQty});
    }else await call('keepDuplicatesSeparate',payload);
    await refresh();status='connected';lastError='';paint();
  }catch(error){lastError='Duplicate review failed: '+error.message;status='error';paint()}
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
   const approvedCount=group.records.filter(r=>r.decision==='Approved').length;
   const rejectedCount=group.records.filter(r=>r.decision==='Rejected').length;
   const pending=group.records.length-approvedCount-rejectedCount;
   const reviewCounts='<span class="team-review-summary" aria-label="Review decisions in group">'+
     (approvedCount?'<span class="team-review-count team-review-count-approved">✓ '+approvedCount+' approved</span>':'')+
     (rejectedCount?'<span class="team-review-count team-review-count-rejected">✕ '+rejectedCount+' rejected</span>':'')+
     (pending?'<span class="team-review-count team-review-count-pending">'+pending+' pending</span>':'')+
     '</span>';
   const duplicateReview=duplicateReviewMarkup(group);
   const unreviewedDuplicateCount=teamExactDuplicateClusters(group.records).filter(c=>!c.every(r=>r.entry?.duplicateKeepSeparate===true)).length;
   const open=TEAM_DUP_OPEN.has(group.key)?TEAM_DUP_OPEN.get(group.key):different.length>0||unreviewedDuplicateCount>0;
   const differenceLabels=different.map(f=>f.label).join(', ');
   // A shared product code is a family of submissions, not proof of duplicates.
   // Different dimensions, requested sizes, finish or crystal are valid variants.
   const signature=r=>{const v=teamSelectionSpecification(r),norm=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();
     return [v.original,v.requested,v.finish,v.crystal].map(norm).join('|')};
   const variationCount=new Set(group.records.map(signature)).size;
   const hasVariations=variationCount>1;
   const note=different.length?
     (hasVariations?'Different sizes/specifications: ':'Details differ: ')+esc(differenceLabels):
     'Same specifications; review before treating submissions as duplicates';
   const displayValue=v=>v?esc(v):'<span class="team-dup-unspecified">Not specified</span>';
   const compare=different.length?'<div class="team-dup-comparison">'+
     '<div class="team-dup-comparison-title">Compare product variations before approving (same code does not mean duplicate)</div>'+
     '<div class="team-dup-table-scroll"><table class="team-dup-table"><thead><tr><th>Selected by</th><th>Review</th><th>Qty</th>'+
     different.map(f=>'<th>'+esc(f.label)+'</th>').join('')+'</tr></thead><tbody>'+
     group.records.map(r=>{
       const spec=teamSelectionSpecification(r);
       return '<tr><td>'+esc(teamOwnerName(r))+'</td><td>'+ (teamReviewBadge(r.decision,true)||'<span class="team-review-pending-label">Pending review</span>') +'</td><td>'+esc(r.qty??r.entry?.qty??'—')+'</td>'+
        different.map(f=>'<td>'+displayValue(spec[f.key])+'</td>').join('')+'</tr>';
     }).join('')+'</tbody></table></div></div>':
     '<p class="team-dup-same">No differences in product or requested specifications. Staff quantities and approvals remain separate.</p>';
   return '<details class="team-duplicate-group" data-team-duplicate-key="'+esc(group.key)+'"'+(open?' open':'')+'>'+
     '<summary class="team-duplicate-summary"><div class="team-duplicate-photo">'+img+'</div>'+
     '<span class="team-duplicate-title"><b>'+esc(brand)+' · '+esc(group.code)+'</b>'+
     '<span>'+(hasVariations?variationCount+' product variations':group.records.length+' team submissions')+' · '+pending+' awaiting review</span>'+reviewCounts+
     (unreviewedDuplicateCount?'<span class="team-dup-summary-warning">! '+unreviewedDuplicateCount+' possible repeated selection'+(unreviewedDuplicateCount===1?'':'s')+'</span>':'')+
     '<span class="'+(different.length?'team-dup-different':'team-dup-identical')+'">'+note+'</span></span>'+
     '<span class="team-duplicate-expand">'+(open?'Review entries':'Open entries')+'</span></summary>'+
     '<div class="team-duplicate-body">'+duplicateReview+compare+
     '<div class="team-duplicate-records" role="list">'+group.records.map(renderRow).join('')+'</div></div></details>';
 }

 function rowsHTML(){
  const map=new Map(brands.map(b=>[b.id,b.name]));
  const visible=filteredTeamRecords().slice(0,200);
  TEAM_DUP_CANDIDATES.clear();
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
   const editQtyAction=['Super Admin','Admin'].includes(role)&&serverFeatures.teamQtyEdit===true?
    '<button type="button" class="btn secondary small" data-sync-action="editTeamQty" data-record-id="'+esc(r.recordId)+'">Edit Qty</button>':'';
   const importAction=canImport?
    '<button class="btn quiet small" data-sync-action="import" data-record-id="'+esc(r.recordId)+'">Use in selections</button>':'';
   const removeAction=canRemove?
    '<button type="button" class="btn danger small" data-sync-action="removeShared" data-record-id="'+esc(r.recordId)+'">Remove from Team selections</button>':'';
   const decision=String(r.decision||'Review');
   const reviewed=decision==='Approved'||decision==='Rejected';
   const rowDecisionClass=decision==='Approved'?' team-list-row-approved':decision==='Rejected'?' team-list-row-rejected':'';
   const status=String(r.supplierStatus||'Not requested');
   const recordName=String(r.name||r.item?.name||'Product');
   const owner=teamOwnerName(r);
   const spec=teamSelectionSpecification(r);
   const showSpec=(name,val)=>val?'<div class="team-list-request-line"><b>'+name+':</b> '+esc(val)+'</div>':'';
   const specInfo=showSpec('Requested size',spec.requested)+showSpec('Finish',spec.finish)+
    showSpec('Crystal',spec.crystal)+showSpec('Custom instructions',spec.request)+
    showSpec('Additional notes',spec.notes);
   const details='<details class="team-list-details"><summary>More details'+(canRemove?' &amp; remove':'')+'</summary>'+
    '<div class="team-list-detail-content">'+
    '<span class="tiny">Last updated: '+esc(r.updatedAt||'—')+' · Revision '+esc(r.revision??'—')+'</span>'+
    (specInfo?'<div class="team-list-request-details">'+specInfo+'</div>':'')+
    (removeAction?'<div class="row-actions">'+removeAction+'</div>':'')+
    '</div></details>';
   return '<article class="team-list-row'+rowDecisionClass+'" role="listitem">'+
    '<div class="team-list-top">'+
     '<div class="team-list-photo" title="Product preview from authorized supplier catalog">'+img+'</div>'+
     '<div class="team-list-product"><div class="tiny">'+esc(brand)+' · '+esc(r.kind)+'</div>'+
      '<strong title="'+esc(r.code||r.itemId||'')+'">'+esc(r.code||r.itemId)+'</strong>'+
      '<div class="team-list-description" title="'+esc(recordName)+'">'+esc(recordName)+'</div>'+
      (r.dimension?'<span class="tiny">'+esc(r.dimension)+'</span>':'')+'</div>'+
     '<div class="team-list-owner"><span class="team-list-mobile-label">Selected by</span>'+
      '<span title="'+esc(owner)+'">'+esc(owner)+'</span></div>'+
     '<div class="team-list-state"><div class="team-list-badges">'+
      (reviewed?teamReviewBadge(decision):'<span class="pill gold">'+esc(decision)+'</span>')+
      '<span class="pill">'+esc(status)+'</span></div>'+
      '<span class="team-list-qty">Qty '+esc(r.qty??'—')+'</span>'+
      (['Super Admin','Admin'].includes(role)?(window.LISelectionCosts?.rowMarkup?.(r)||''):'')+'</div>'+
     '<div class="team-list-actions">'+(approve||importAction||
       '<span class="tiny">Reviewed</span>')+(approve&&importAction?importAction:'')+editQtyAction+'</div>'+
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
     '<p class="tiny">Supabase email is the account identifier. To change it, create the new Supabase account and deactivate the old one.</p>'+
     '<div class="row-actions"><button type="submit" class="btn small"'+(userManageBusy?' disabled':'')+'>Save changes</button>'+
     '<button type="button" class="btn quiet small" data-sync-action="cancelUserEdit"'+(userManageBusy?' disabled':'')+'>Cancel</button></div></form></article>';
  }).join('');
  root.innerHTML='<div class="tm-page"><div class="candidate-row"><div class="variant-top">'+
   '<div><h2>Manage team access</h2><p class="muted">Manage Product Selection Supabase roles and access, mirrored to the private Team Sync directory.</p></div>'+
   '<button class="btn secondary small" type="button" data-sync-action="refreshUsers"'+(userManageBusy?' disabled':'')+'>↻ Refresh accounts</button></div>'+
   '<div class="tm-stats"><span><b>'+activeCount+'</b> Active</span><span><b>'+(list.length-activeCount)+'</b> Inactive</span>'+
   '<span><b>'+list.length+'</b> Total accounts</span></div>'+
   (userManageNotice?'<p role="status" class="'+(userManageIsError?'alert':'tm-success')+'">'+esc(userManageNotice)+'</p>':'')+
   '<div class="tm-directory">'+(cards||'<p>No authorized users returned. Refresh accounts to try again.</p>')+'</div></div>'+
   '<div class="candidate-row tm-add-card"><h2>Authorize new team member</h2>'+
   '<p class="tiny">New users must already exist in Supabase Auth and app_users; authorize them here to access Product Selection. Only Super Admin can edit access.</p>'+
   '<form id="liTeamAddUser"><div class="tm-fields">'+
   '<label class="field"><span>Supabase email</span><input name="email" type="email" autocomplete="off" maxlength="255" placeholder="staff@example.com" required></label>'+
   '<label class="field"><span>Display name</span><input name="name" maxlength="100" placeholder="Employee name"></label>'+
   '<label class="field"><span>Assigned role</span><select name="role">'+roleOptions('Staff')+'</select></label></div>'+
   '<div class="row-actions"><button class="btn" type="submit"'+(userManageBusy?' disabled':'')+'>Authorize user</button></div></form></div></div>';
 }
 function render(){
  const root=document.getElementById('app');if(!root)return;
  if(!statusView().connected){
    root.innerHTML='<div class="candidate-row"><h2>Supabase staff access</h2><p class="muted">Sign in with an approved staff account above. Your previous Team selections and approvals remain in the private Team Sync database and its verified backup.</p>'+
      (lastError?'<p class="alert">'+esc(lastError)+'</p>':'')+'</div>';
    return;
  }
  root.innerHTML='<div class="candidate-row"><div class="variant-top"><div><h2>Shared Team Selections</h2>'+
    '<p class="tiny" id="teamSyncNotice">Signed in as '+esc(email)+' · '+esc(role)+'</p></div>'+
    '<div class="row-actions"><button class="btn quiet small" data-sync-action="signout">Sign out</button></div></div>'+
    '<div class="row-actions"><button class="btn secondary small" data-sync-action="refresh">↻ Refresh team selections</button>'+
    '<button class="btn small" data-sync-action="publish">Share my current '+esc(brandNow().name)+' selections</button>'+
    '<span class="tiny">Last refreshed: '+esc(lastFetched||'—')+' · '+records.length+' records</span></div>'+
    '<p class="tiny">Authenticated staff can browse approved private supplier catalogs. Product selections and approvals remain synchronized through the existing protected Google Sheet.</p>'+ (['Super Admin','Admin'].includes(role)&&serverFeatures.teamQtyEdit!==true?'<p class="tiny">Quantity editing and duplicate review will activate after the new private Google Apps Script backend is deployed.</p>':'')+'</div>'+
    '<div class="subheading"><h2>Team review</h2><span class="tiny">Authorized users only</span></div>'+
    teamBrandFilterToolbar()+'<div class="row-list">'+rowsHTML()+'</div>'+adminCatalogForm();
 }
 document.addEventListener('submit',e=>{if(e.target.id==='liSupabaseSignIn'){e.preventDefault();supabaseLogin(e.target);return}if(e.target.id==='liSyncConfigForm'){e.preventDefault();const d=new FormData(e.target);try{saveConfig({clientId:String(d.get('clientId')||''),scriptUrl:String(d.get('scriptUrl')||'')})}catch(err){alert(err.message)}return}if(e.target.id==='liOAuthClientRepair'){e.preventDefault();const d=new FormData(e.target);try{const clientId=String(d.get('clientId')||'');fixClientOpen=false;gsiClient='';saveConfig({...config,clientId})}catch(err){fixClientOpen=true;alert(err.message)}return}if(e.target.id==='liTeamAddUser'){e.preventDefault();addUser(e.target);return}if(e.target.matches('[data-team-edit-form]')){e.preventDefault();saveEditedUser(e.target);return}if(e.target.id==='liPublishCatalog'){e.preventDefault();publishCentralCatalog(e.target)}});
 document.addEventListener('toggle',event=>{
   const detail=event.target;
   if(detail?.matches?.('details[data-team-duplicate-key]'))
     TEAM_DUP_OPEN.set(detail.dataset.teamDuplicateKey,detail.open);
 },true);
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
  if(act==='fixClient'){fixClientOpen=!fixClientOpen;paint();return}if(act==='retrySignIn'){connectButton(true);return}if(act==='retryConnection'){reconnectAttempts=0;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}if(!ready&&bridgeMode==='iframe'&&iframe)iframe.dataset.liBridgeFailed='yes';authenticateCurrentToken();return}if(act==='openBridgePopup'){openBridgePopup();return}if(act==='refresh')refresh().then(()=>{status='connected';lastError='';rememberVerifiedSession();window.LICentralCatalog?.onConnected?.();paint()}).catch(err=>{status='offline';lastError='Team connection problem: '+err.message;paint();scheduleRetry()});if(act==='publish')publishCurrent();if(act==='exportTeamExcel')exportTeamExcel(false);if(act==='exportTeamExcelWithCost')exportTeamExcel(true);
  if(act==='editTeamQty')editTeamQuantity(b.dataset.recordId);
  if(act==='mergeExactDuplicates')reviewExactDuplicateGroup(b.dataset.duplicateKey,'merge');
  if(act==='keepDuplicatesSeparate')reviewExactDuplicateGroup(b.dataset.duplicateKey,'separate');
  if(act==='toggleTeamCosts'&&['Super Admin','Admin'].includes(role))window.LISelectionCosts?.toggle?.(filteredTeamRecords(),paint).catch(err=>alert(err.message));
  if(act==='setCost'&&['Super Admin','Admin'].includes(role)){const target=records.find(x=>x.recordId===b.dataset.recordId);if(target)window.LISelectionCosts?.setForRecord?.(target,paint).catch(err=>alert(err.message))}if(act==='import')importShared(b.dataset.recordId);if(act==='removeShared')removeShared(b.dataset.recordId);if(act==='approve'||act==='reject')moderate(b.dataset.recordId,act);if(act==='signout'){window.LISelectionCosts?.signOut?.().catch(err=>console.warn('Supabase logout:',err));disconnect(true,true);paint()}if(act==='reconfigure'&&role==='Super Admin'){if(confirm('Change the connection settings for this device? Existing local selections will remain.')){localStorage.removeItem(KEY);config={};disconnect(false);paint()}}});
 function adminCatalogForm(){if(role!=='Super Admin')return '';return '<div class="candidate-row"><h3>Publish private supplier catalog</h3><p class="tiny">Upload the prepared JSON pack to private Google Drive once. Staff will receive its photos automatically after signing in.</p><form id="liPublishCatalog"><div class="variant-fields"><div class="field"><label>Supplier</label><select name="brandId">'+brands.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('')+'</select></div><div class="field span2"><label>Private Drive catalog-pack link</label><input name="driveFile" required placeholder="https://drive.google.com/file/d/.../view"></div></div><label class="tiny"><input type="checkbox" name="confirmUntagged" value="1"> Confirm legacy pack without an internal brand label (Asfour)</label><div class="row-actions"><button type="submit" class="btn secondary">Publish catalog</button></div></form></div>'}
 async function publishCentralCatalog(form){if(role!=='Super Admin')return;const d=new FormData(form),brandId=String(d.get('brandId')||''),driveFile=String(d.get('driveFile')||'').trim();if(!confirm('Publish this private Drive catalog to authorized staff?'))return;try{const result=await call('publishCatalog',{brandId,driveFile,confirmUntagged:d.has('confirmUntagged')});await refresh();if(result.brandId===ACTIVE_BRAND_ID)window.LICentralCatalog?.ensureBrand(brandId,true).catch(()=>{});alert(result.itemCount+' products published for '+brandId);paint()}catch(err){alert('Catalog publishing failed: '+err.message)}}
 function init(){
  syncAccessGate();
  if(!settingsValid()){lastError='Private catalog connection URL is invalid. Contact the Super Admin.';syncAccessGate();return}
  if(!window.LISupabaseAuth){lastError='Supabase login module missing. Reopen the installed app.';syncAccessGate();return}
  window.LISupabaseAuth.getClient().then(async api=>{
    api.auth.onAuthStateChange((event,session)=>{
      if(event==='TOKEN_REFRESHED'&&session?.access_token&&token){
        token=session.access_token;
      }else if(event==='SIGNED_OUT'&&token){disconnect(true)}
    });
    const {data:{session}={},error}=await api.auth.getSession();
    if(error||!session?.access_token)return;
    try{
      const account=await window.LISupabaseAuth.verify();
      await onSupabaseIdentity(account);
    }catch(error){lastError=String(error?.message||error);status='auth-required';syncAccessGate()}
  }).catch(error=>{lastError='Supabase connection unavailable: '+error.message;status='error';syncAccessGate()});
}
 window.LITeamSync={init,render,renderTeamManagement,itemChanged,itemRemoved,localSaved,brandCreated,status:statusView,getRoles:()=>self(),refresh,disconnect,request:call};
})();
