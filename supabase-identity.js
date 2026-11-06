/* Product Selection staging: Supabase email/password and independently managed roles.
 * The publishable key is public. Never add a service-role or secret key here.
 * This file is NOT enabled on the live branch until Apps Script accepts Supabase JWTs.
 */
'use strict';
window.LISelectionIdentity=(()=>{
 const PROJECT_URL='https://msxvnaintafqdgheutfu.supabase.co';
 const PUBLISHABLE_KEY="sb_publishable_RpLdBcXql9MpBZCU-GLqPQ_G3VKM8zd";
 const ALLOWED_ROLES=['Super Admin','Admin','Manager','Staff'];
 let client=null,session=null,member=null,initPromise=null;
 const listeners=new Set();
 const notify=()=>{for(const fn of listeners)try{fn(status())}catch(e){console.warn('Identity listener failed',e)}};
 function status(){
  return {signedIn:!!(session?.access_token&&member?.active),
    email:session?.user?.email||'',role:member?.role||'',
    name:member?.display_name||'',accessToken:session?.access_token||''};
 }
 function currentClient(){if(!client)throw Error('Supabase login is not initialized');return client}
 async function loadMembership(){
  member=null;
  if(!session?.user?.id){notify();return null}
  const {data,error}=await currentClient().from('product_selection_members')
    .select('role,display_name,active').eq('user_id',session.user.id).maybeSingle();
  if(error)throw Error('Could not verify Product Selection access: '+error.message);
  if(!data?.active||!ALLOWED_ROLES.includes(data.role))
    throw Error('Your account has no active Product Selection permission. Ask Super Admin.');
  member=data;notify();return data;
 }
 async function init(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
   if(!window.supabase?.createClient)
     throw Error('Supabase sign-in library failed to load');
   client=window.supabase.createClient(PROJECT_URL,PUBLISHABLE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'li-product-selection-auth-v1'}
   });
   const {data,error}=await client.auth.getSession();
   if(error)throw error;
   session=data.session||null;
   if(session){try{await loadMembership()}catch(err){console.warn(err);member=null}}
   client.auth.onAuthStateChange((_event,newSession)=>{
    session=newSession||null;member=null;
    // Defer DB operations outside the Supabase auth callback.
    setTimeout(async()=>{try{await loadMembership()}catch(e){console.warn(e);notify()}},0);
   });
   notify();return status();
  })();
  try{return await initPromise}catch(err){initPromise=null;throw err}
 }
 async function signIn(email,password){
  await init();
  if(!/^\S+@\S+\.\S+$/.test(String(email||'')))throw Error('Enter a valid staff email');
  if(!password)throw Error('Enter your password');
  const {data,error}=await client.auth.signInWithPassword({email:String(email).trim().toLowerCase(),password});
  if(error)throw error;
  session=data.session||null;
  try{await loadMembership()}catch(err){await client.auth.signOut();session=null;member=null;notify();throw err}
  return status();
 }
 async function signOut(){
  if(client)await client.auth.signOut();
  session=null;member=null;notify();
 }
 async function refresh(){
  await init();
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  session=data.session||null;
  await loadMembership();return status();
 }
 function onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}
 return {init,signIn,signOut,refresh,status,onChange,client:currentClient,
  canSeeCosts:()=>status().signedIn&&['Super Admin','Admin'].includes(member?.role)};
})();
