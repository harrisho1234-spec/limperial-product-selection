/* L'Imperial Product Selection: Supabase staff authentication & confidential costs.
   Supabase RLS verifies membership and prevents non-Admin cost retrieval.
   The private Google Apps Script bridge accepts verified Supabase access tokens.
   Public browser configuration contains a publishable key only, never secrets. */
(function(){
 'use strict';
 const PROJECT_URL='https://msxvnaintafqdgheutfu.supabase.co';
 const PUBLISHABLE_KEY='sb_publishable_RpLdBcXql9MpBZCU-GLqPQ_G3VKM8zd';
 const MEMBERS='product_selection_members';
 const COSTS='product_selection_supplier_costs';
 const ADMIN_ROLES=['Admin','Super Admin'];
 // One session for staff login and Admin cost access; isolated per browser session.
 const COST_AUTH_STORAGE='li-product-selection-supabase-session-v1';
 let client=null,sdkLoading=null;
 async function ensureClient(){
  if(client)return client;
  if(!sdkLoading)sdkLoading=new Promise((resolve,reject)=>{
   if(window.supabase?.createClient){resolve(window.supabase);return}
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.js';
   script.async=true;
   script.onload=()=>window.supabase?.createClient?resolve(window.supabase):reject(new Error('Supabase library unavailable.'));
   script.onerror=()=>reject(new Error('Could not load secure Supabase sign-in. Check the internet connection.'));
   document.head.appendChild(script);
  }).catch(error=>{sdkLoading=null;throw error});
  const sdk=await sdkLoading;
  let storage=null;
  try{storage=window.sessionStorage}catch(_){}
  client=sdk.createClient(PROJECT_URL,PUBLISHABLE_KEY,{
   auth:{persistSession:!!storage,storage:storage||undefined,storageKey:COST_AUTH_STORAGE,
    autoRefreshToken:true,detectSessionInUrl:false}
  });
  return client;
 }
 let visible=false,known=new Map(),lastIdentity=null,loginOpen=false;
 async function verifiedAccount(){
  const api=await ensureClient();
  const {data:{user}={},error}=await api.auth.getUser();
  if(error||!user?.id||!user.email)throw Error('Please sign in with your Supabase staff account.');
  const {data:member,error:memberError}=await api.from(MEMBERS)
   .select('user_id,role,active,display_name').eq('user_id',user.id).maybeSingle();
  if(memberError)throw Error('Could not verify your Product Selection access.');
  if(!member?.active||!['Super Admin','Admin','Manager','Staff'].includes(member.role))
   throw Error('Your Supabase account is not approved for Product Selection.');
  const {data:{session}={},error:sessionError}=await api.auth.getSession();
  if(sessionError||!session?.access_token)throw Error('Your Supabase session expired. Please sign in again.');
  return {id:user.id,email:String(user.email).trim().toLowerCase(),role:member.role,
    name:member.display_name||user.email,accessToken:session.access_token,
    expiresAt:session.expires_at?session.expires_at*1000:0};
 }
 async function signInAccount(email,password){
  const api=await ensureClient();
  const res=await api.auth.signInWithPassword({email:String(email||'').trim().toLowerCase(),password});
  if(res.error)throw Error('Unable to sign in. Check your Supabase staff email and password.');
  try{return await verifiedAccount()}
  catch(error){await api.auth.signOut().catch(()=>{});throw error}
 }
 window.LISupabaseAuth={getClient:ensureClient,verify:verifiedAccount,signIn:signInAccount,
  signOut:async()=>{const api=await ensureClient();await api.auth.signOut()}};


 function googleRole(){return window.LITeamSync?.getRoles?.()||{}}
 function isExistingAdmin(){return ADMIN_ROLES.includes(googleRole().role)&&!!window.LITeamSync?.status?.().connected}
 function safeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
 function norm(s){return String(s??'').trim().replace(/\s+/g,' ')}
 function itemKey(record){
  const brand_id=String(record?.brandId||record?.brand_id||'').trim().toLowerCase();
  const item_kind=record?.kind==='variant'?'variant':'catalog';
  const item_id=String(record?.itemId||record?.item_id||record?.id||'').trim();
  return {brand_id,item_kind,item_id};
 }
 function detailValues(record){
  const entry=record?.entry||{};
  return [
   norm(record.targetSize||entry.targetSize),
   norm(record.finish||entry.finish),
   norm(record.crystal||entry.crystal),
   norm(record.request||entry.request)
  ];
 }
 async function specKey(record){
  const values=detailValues(record);
  if(!values.some(Boolean))return '';
  const bytes=new TextEncoder().encode(JSON.stringify(values));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return 'sha256:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 }
 async function identity(){
  const verified=await verifiedAccount();
  if(!ADMIN_ROLES.includes(verified.role))throw Error('Only Admin and Super Admin can see supplier costs.');
  if(!isExistingAdmin())throw Error('Admin Product Selection access is required.');
  const role=googleRole();
  if(verified.email!==String(role.email||'').trim().toLowerCase()||verified.role!==role.role)
   throw Error('Your authorized Product Selection session must match Supabase.');
  lastIdentity={id:verified.id,email:verified.email,role:verified.role};
  return lastIdentity;
 }
 function gate(){
  let el=document.getElementById('liCostAuthGate');
  if(!el){
   el=document.createElement('section');el.id='liCostAuthGate';el.className='li-cost-gate';el.hidden=true;
   el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
   el.innerHTML='<div class="li-cost-card">'+
    '<h2>Admin supplier-cost access</h2>'+
    '<p class="tiny">Use your existing Supabase staff login. Only Admin and Super Admin can retrieve costs.</p>'+
    '<form id="liCostLoginForm"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="username" required></div>'+
    '<div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div>'+
    '<p class="li-cost-error" id="liCostLoginError" role="alert" hidden></p>'+
    '<div class="row-actions"><button class="btn" type="submit">Sign in for costs</button>'+
    '<button type="button" class="btn quiet" data-cost-action="cancel">Cancel</button></div></form></div>';
   document.body.appendChild(el);
  }
  return el;
 }
 function showLogin(){
  if(!isExistingAdmin())return;
  const el=gate();el.hidden=false;loginOpen=true;
  const form=el.querySelector('#liCostLoginForm');
  form.elements.email.value=googleRole().email||'';
  form.elements.password.value='';
  el.querySelector('#liCostLoginError').hidden=true;
 }
 function hideLogin(){const el=document.getElementById('liCostAuthGate');if(el)el.hidden=true;loginOpen=false}
 async function requireAdmin(){
  if(!isExistingAdmin())throw Error('This export is available only to Admin and Super Admin.');
  try{
   const me=await identity();
   if(me)return true;
  }catch(err){
   console.warn('Cost session verification required:',err.message);
  }
  return false;
 }
 function format(amount,currency='USD'){
  if(amount===null||amount===undefined||amount==='')return '';
  const n=Number(amount);
  if(!Number.isFinite(n))return '';
  try{return new Intl.NumberFormat('en-US',{style:'currency',currency:currency||'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(n)}
  catch(_){return n.toFixed(2)+' '+(currency||'USD')}
 }
 async function lookup(records){
  const me=await identity();
  if(!me)throw Error('Supabase sign-in required to retrieve costs.');
  if(!records.length)return [];
  const keys=await Promise.all(records.map(async r=>({...itemKey(r),spec_key:await specKey(r)})));
  if(keys.some(k=>!k.brand_id||!k.item_id))throw Error('Missing catalog identity for a supplier cost lookup.');
  const all=[],brands=[...new Set(keys.map(k=>k.brand_id))],ids=[...new Set(keys.map(k=>k.item_id))];
  for(let i=0;i<ids.length;i+=45){
   const {data,error}=await client.from(COSTS)
    .select('brand_id,item_kind,item_id,spec_key,unit_cost,currency')
    .in('brand_id',brands).in('item_id',ids.slice(i,i+45)).limit(2000);
   if(error)throw Error('Protected supplier-cost lookup was denied. Check Admin membership.');
   all.push(...(data||[]));
  }
  const byKey=new Map(all.map(c=>[[c.brand_id,c.item_kind,c.item_id,c.spec_key].join('|'),c]));
  return keys.map(k=>byKey.get([k.brand_id,k.item_kind,k.item_id,k.spec_key].join('|'))||null);
 }
 async function toggle(records,reread){
  if(!isExistingAdmin())return;
  if(visible){visible=false;known.clear();reread?.();return}
  if(!(await requireAdmin()))return;
  try{
   const prices=await lookup(records);
   known=new Map(records.map((r,i)=>[String(r.recordId||r.id),prices[i]]));
   visible=true;reread?.();
  }catch(err){visible=false;known.clear();alert(err.message)}
 }
 function isVisible(){return visible&&isExistingAdmin()}
 function rowMarkup(record){
  if(!isVisible())return '';
  const price=known.get(String(record.recordId||record.id));
  const current=price?format(price.unit_cost,price.currency):'Not entered';
  return '<div class="li-cost-row"><b>Unit Cost:</b> '+safeHtml(current)+
    ' <button class="btn quiet small" type="button" data-sync-action="setCost" data-record-id="'+safeHtml(record.recordId||record.id)+'">Set cost</button></div>';
 }
 async function setForRecord(record,reread){
  if(!(await requireAdmin()))return;
  const current=(await lookup([record]))[0];
  const value=prompt('Supplier unit cost for this exact product/specification (USD). Leave blank to cancel.',current?.unit_cost??'');
  if(value===null||!String(value).trim())return;
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0||!String(value).match(/^\d+(?:\.\d{1,4})?$/)){alert('Enter a valid nonnegative supplier cost, up to four decimals.');return}
  const me=await identity(),k=itemKey(record);
  const row={...k,spec_key:await specKey(record),supplier_code:String(record.code||record.item?.code||'').trim()||null,
   unit_cost:amount,currency:'USD',updated_by:me.id,updated_at:new Date().toISOString()};
  const {error}=await client.from(COSTS).upsert(row,{onConflict:'brand_id,item_kind,item_id,spec_key'});
  if(error)throw Error('Supabase rejected this cost update.');
  if(visible){const fresh=await lookup([record]);known.set(String(record.recordId||record.id),fresh[0]);reread?.()}
 }
 async function signOut(){
  visible=false;known.clear();lastIdentity=null;hideLogin();
  try{window.sessionStorage?.removeItem(COST_AUTH_STORAGE)}catch(_){}
  if(client)await client.auth.signOut().catch(()=>{});
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-cost-action="cancel"]'))hideLogin();
 });
 document.addEventListener('submit',async e=>{
  if(e.target.id!=='liCostLoginForm')return;
  e.preventDefault();
  const form=e.target,btn=form.querySelector('button[type=submit]'),err=document.getElementById('liCostLoginError');
  btn.disabled=true;err.hidden=true;
  try{
   await ensureClient();
   const data=new FormData(form),email=String(data.get('email')||'').trim(),password=String(data.get('password')||'');
   if(email.toLowerCase()!==String(googleRole().email||'').toLowerCase())throw Error('Use the same email shown in Product Selection.');
   await signInAccount(email,password);
   await identity();hideLogin();
   alert('Admin cost access verified. Choose With Cost again to export or Show Costs to review.');
  }catch(error){err.textContent=error.message;err.hidden=false}
  finally{form.elements.password.value='';btn.disabled=false}
 });
 window.LISelectionCosts={requireAdmin,lookup,toggle,isVisible,rowMarkup,setForRecord,signOut,format};
})();
