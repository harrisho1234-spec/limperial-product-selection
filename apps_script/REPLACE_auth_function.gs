/**
 * STAGING ONLY — replacement for the existing Code.gs function auth_(token).
 * Replace the ORIGINAL auth_ function; do NOT paste a second copy at the bottom.
 * Keep the rest of deployed Code.gs and Bridge.html unchanged.
 *
 * Before deploying add Apps Script Script Properties:
 * SUPABASE_URL = https://msxvnaintafqdgheutfu.supabase.co
 * SUPABASE_PUBLISHABLE_KEY = your project's sb_publishable_... key
 * No service_role key, client secret, or database password belongs in Apps Script.
 *
 * The bridge still receives the JWT through its nonce-bound postMessage channel.
 * Supabase Auth verifies the JWT online, then RLS checks Product Selection role.
 * The existing USERS sheet remains a separate active-email allowlist until all
 * management and sharing actions are migrated safely.
 */
function auth_(token){
 if(typeof token!=='string'||token.length<100||token.length>10000)throw Error('SIGN_IN_REQUIRED');
 const properties=PropertiesService.getScriptProperties();
 const url=String(properties.getProperty('SUPABASE_URL')||'').replace(/\/+$/,'');
 const key=String(properties.getProperty('SUPABASE_PUBLISHABLE_KEY')||'');
 if(url!=='https://msxvnaintafqdgheutfu.supabase.co'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
  throw Error('SUPABASE_LOGIN_NOT_CONFIGURED');
 const headers={apikey:key,Authorization:'Bearer '+token};
 function supabaseGet_(path){
  const response=UrlFetchApp.fetch(url+path,{
   method:'get',headers,muteHttpExceptions:true,followRedirects:false
  });
  if(response.getResponseCode()!==200)throw Error('INVALID_SUPABASE_IDENTITY');
  try{return JSON.parse(response.getContentText())}catch(err){throw Error('INVALID_SUPABASE_RESPONSE')}
 }
 // This is a real authenticated identity check by Supabase Auth, not a
 // client-supplied role, unverified JWT decode, or user-editable metadata.
 const identity=supabaseGet_('/auth/v1/user');
 const id=String(identity.id||''),email=String(identity.email||'').trim().toLowerCase();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!identity.email_confirmed_at)
  throw Error('INVALID_SUPABASE_IDENTITY');
 const roles=supabaseGet_('/rest/v1/product_selection_members?select=role%2Cactive%2Cdisplay_name&user_id=eq.'+encodeURIComponent(id));
 if(!Array.isArray(roles)||roles.length!==1||roles[0].active!==true||!LI_ROLES.includes(roles[0].role))
  throw Error('ACCESS_DENIED: Product Selection account is not active');
 const permitted=table_('USERS').getDataRange().getValues().slice(1).find(r=>
   String(r[0]||'').trim().toLowerCase()===email&&String(r[2]||'').trim().toLowerCase()==='yes'
 );
 if(!permitted)throw Error('ACCESS_DENIED: email is not on the approved staff list');
 return {email,role:roles[0].role,name:String(roles[0].display_name||permitted[3]||email)};
}
