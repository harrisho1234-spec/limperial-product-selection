/* Private catalog loader for authorized staff. No supplier images in the GitHub repository.
 * Catalogs are loaded through the existing Google-ID-token-verified Apps Script bridge.
 * Local drafts and previously imported private packs are never overwritten automatically.
 */
'use strict';
(function(){
 const entries=new Map(),loading=new Map(),errors=new Map(),progress=new Map();
 const teamPhotoPacks=new Map(),teamPhotoLoading=new Map(),teamPhotoErrors=new Map();
 let teamPhotoGeneration=0;
 let lastRole='',lastEmail='';
 function signedIn(){return !!window.LITeamSync?.status()?.connected}
 function known(id){return entries.get(id)||null}
 function isCentralPack(pack){return !!(pack&&pack.metadata?.centralManaged===true)}
 function banner(id){
   const meta=known(id),task=progress.get(id),error=errors.get(id);
   if(!meta)return errors.get(id)?'<div class="alert">'+q(errors.get(id))+'</div>':'';
   if(!signedIn())return '<div class="alert">This supplier catalog is centrally managed. <button class="btn secondary small" data-action="goto" data-to="team">Sign in with Google</button> to view its products. Authorized staff do not need to import any files.</div>';
   if(error)return '<div class="alert">Catalog download was unsuccessful: '+q(error)+' <button class="btn secondary small" data-action="loadCentralCatalog" data-id="'+q(id)+'">Retry</button>. The local selections are preserved.</div>';
   if(task)return '<div class="alert">Loading '+q(brandNow().name)+' catalog securely from Google Drive: '+task.done+' / '+task.total+' photo sheets received. Please keep this app open.</div>';
   return '<div class="alert">Private supplier catalog managed by L\'Imperial. <button class="btn quiet small" data-action="loadCentralCatalog" data-id="'+q(id)+'">Check for catalog updates</button></div>';
 }
 function readyPack(brandId,pack){
   if(brandId!==ACTIVE_BRAND_ID||!signedIn())return;
   usePack(pack);if(typeof render==='function')render();
 }
 function preserveManual(loaded,original){
   if(!original||!original.catalog)return loaded;
   const from=original.catalog;
   const existing=new Set(loaded.catalog.items.map(item=>item.id));
   for(const item of from.items||[]){if(item.source==='manual'&&!existing.has(item.id)){loaded.catalog.items.push(item);existing.add(item.id)}}
   if(loaded.catalog.items.length>0&&from.sources?.manual)loaded.catalog.sources.manual=from.sources.manual;
   const families=new Set(loaded.catalog.family.map(x=>x.id));
   for(const family of from.family||[]){if(family?.customCreated&&!families.has(family.id)){loaded.catalog.family.push(family);families.add(family.id)}}
   // Only user-authored local variants are carried forward. Selection decisions live in S.
   const variantIds=new Set((loaded.catalog.variant||[]).map(v=>v.id));
   for(const v of from.variant||[]){if(v?.customCreated&&!variantIds.has(v.id)){loaded.catalog.variant.push(v);variantIds.add(v.id)}}
   return loaded;
 }
 async function fetchBrand(brandId,force){
   if(!signedIn())throw Error('Google sign-in required');const role=window.LITeamSync?.getRoles()?.role;if(role!=='Super Admin'&&!known(brandId)?.version?.endsWith('-price-safe-v1'))throw Error('Price-safe catalog protection is pending deployment. Ask Super Admin to deploy the updated Apps Script; original price sheets cannot be shown to this role.');
   const item=known(brandId);if(!item)throw Error('No published catalog for this supplier');
   const existing=DB?await tx(brandKey(brandId),null,'readonly'):null;
   if(!force && existing?.metadata?.centralVersion===item.version){readyPack(brandId,existing);return {cached:true,count:existing.catalog.items.length}}
   // Imported catalogs may have local custom products. They are merged after download.
   // If a local catalog was manually imported, leave it intact and use it until the admin
   // explicitly chooses to refresh from the central catalog.
   if(!force && role==='Super Admin' && existing?.catalog?.items?.length>0&&!isCentralPack(existing)){
     if(brandId===ACTIVE_BRAND_ID&&!PACK)readyPack(brandId,existing);
     return {existingLocal:true,count:existing.catalog.items.length};
   }
   const api=window.LITeamSync?.request;
   if(!api)throw Error('Team synchronization service unavailable');
   const m=await api('catalogManifest',{brandId});
   if(!m||m.brandId!==brandId||m.version!==item.version||!m.catalog||!Array.isArray(m.spriteKeys))throw Error('Catalog version mismatch; refresh team selections');
   if(m.catalog.items.length>6000||m.spriteKeys.length>500)throw Error('Catalog size limit exceeded');
   const sprites=Object.create(null),groups=[];
   // The private Apps Script bridge caps each sprite response at 1 MB. Two
   // high-resolution TL atlas sheets stay under this limit while retaining detail.
   for(let i=0;i<m.spriteKeys.length;i+=2)groups.push(m.spriteKeys.slice(i,i+2));
   progress.set(brandId,{done:0,total:m.spriteKeys.length});errors.delete(brandId);
   if(ACTIVE_BRAND_ID===brandId&&VIEW!=='team')render();
   let next=0;const workers=Array.from({length:Math.min(3,groups.length)},async()=>{
     while(next<groups.length){const batch=groups[next++];const response=await api('catalogSprites',{brandId,version:m.version,keys:batch});
       if(response.brandId!==brandId||response.version!==m.version)throw Error('Catalog changed during download');
       for(const key of batch){const sprite=response.sprites?.[key];if(typeof sprite!=='string'||!sprite.startsWith('data:image/webp;base64,'))throw Error('Missing private product image');sprites[key]=sprite}
       const p=progress.get(brandId);if(p)p.done+=batch.length;
       if(ACTIVE_BRAND_ID===brandId&&VIEW!=='team'){
         const statusElement=document.getElementById('centralCatalogProgress');
         if(statusElement)statusElement.textContent='Received '+progress.get(brandId)?.done+' / '+m.spriteKeys.length+' photo sheets';
       }
     }
   });
   await Promise.all(workers);
   const pack=preserveManual({catalog:m.catalog,sprites,metadata:{centralManaged:true,centralVersion:m.version,brandId}},existing);
   // Remove validated supplier price text BEFORE this pack reaches local cache.
   if(typeof sanitizeAsfourPack==='function')sanitizeAsfourPack(pack,brandId);
   if(DB)await tx(brandKey(brandId),pack);
   readyPack(brandId,pack);
   return {cached:false,count:pack.catalog.items.length};
 }
 function ensureBrand(brandId,force=false){
   if(!signedIn()||!known(brandId))return Promise.resolve(null);
   if(loading.has(brandId))return loading.get(brandId);
   errors.delete(brandId);
   const run=fetchBrand(brandId,force).catch(err=>{
      const reason=String(err?.message||err);
      const friendly=reason.includes('DriveApp.getFileById')&&reason.includes('Required permissions')
        ? 'Administrator action required: Google Drive access is not yet authorized for the shared catalog service. Ask the app owner to authorize Google Drive once in Apps Script. Staff do not need to import catalogs or change their settings.'
        : reason;
      errors.set(brandId,friendly);
      if(ACTIVE_BRAND_ID===brandId&&VIEW!=='team')render();
      throw err;
   }).finally(()=>{loading.delete(brandId);progress.delete(brandId)});
   loading.set(brandId,run);run.finally(()=>{if(ACTIVE_BRAND_ID===brandId&&VIEW!=='team'&&typeof render==='function')render()}).catch(()=>{});return run;
 }
 function clearActivePack(){
   PACK=null;ACTIVE_PACK=null;
   Object.values(SPRITES).forEach(url=>{if(typeof url==='string'&&url.startsWith('blob:'))URL.revokeObjectURL(url)});
   SPRITES={};
 }
 function activeCatalogOutdated(){
   const current=known(ACTIVE_BRAND_ID);
   if(!current)return false;
   if(!PACK)return true;
   // Local Super Admin imports remain usable until an explicit catalog refresh.
   if(!isCentralPack(ACTIVE_PACK))return false;
   return ACTIVE_PACK.metadata?.centralVersion!==current.version;
 }
 // Team selections can be filtered by another supplier while the active workspace
 // (PACK/SPRITES) still belongs to Asfour. Keep those approved images isolated.
 function clearTeamPhotos(){
   teamPhotoGeneration++;
   for(const lib of teamPhotoPacks.values())
     for(const url of Object.values(lib.urls||{}))
       if(typeof url==='string'&&url.startsWith('blob:'))URL.revokeObjectURL(url);
   teamPhotoPacks.clear();teamPhotoLoading.clear();teamPhotoErrors.clear();
 }
 function findTeamPhotoItem(items,record){
   if(!Array.isArray(items)||!record)return null;
   const withPhoto=x=>!!(x?.sprite&&(x.sprite.atlas||x.sprite.data));
   const ids=[record.itemId,record.item?.sourceItemId,record.entry?.sourceItemId].filter(Boolean).map(String);
   for(const id of ids){
     const match=items.find(x=>String(x.id)===id&&withPhoto(x));
     if(match)return match;
   }
   const code=String(record.code||record.item?.code||'').trim().toLowerCase();
   if(code){
     const same=items.filter(x=>withPhoto(x)&&String(x.code||'').trim().toLowerCase()===code);
     if(same.length===1)return same[0];
   }
   const ref=String(record.photoRef||record.item?.photoRef||'');
   if(ref){
     const same=items.filter(x=>x.sprite?.atlas&&ref===x.sprite.atlas+'#'+x.sprite.index);
     if(same.length===1)return same[0];
   }
   const name=String(record.name||record.item?.name||'').trim().toLowerCase();
   if(name){
     const same=items.filter(x=>withPhoto(x)&&String(x.name||'').trim().toLowerCase()===name);
     if(same.length===1)return same[0];
   }
   return null;
 }
 function teamPhotoFor(record){
   if(!signedIn()||!record||record.brandId===ACTIVE_BRAND_ID)return null;
   const lib=teamPhotoPacks.get(String(record.brandId));
   if(!lib||lib.version!==known(record.brandId)?.version)return null;
   const item=findTeamPhotoItem(lib.items,record),base=item?.sprite;
   if(!base)return null;
   const picked=window.LITLPicker?.parseRef(record.item?.sourceRef);
   const sprite=picked&&picked.parentId===item.id?{...base,cropRect:picked.crop}:base;
   if(sprite.data){
     if(/^data:image\/(webp|png|jpeg);base64,/.test(sprite.data))
       return {sprite,urls:lib.urls};
     return null;
   }
   return sprite.atlas&&lib.urls[sprite.atlas]?{sprite,urls:lib.urls}:null;
 }
 function teamPhotoStatus(brandId){
   if(brandId===ACTIVE_BRAND_ID)return PACK?'ready':'loading';
   if(teamPhotoLoading.has(brandId))return 'loading';
   if(teamPhotoErrors.has(brandId))return 'error';
   if(!known(brandId))return 'unpublished';
   return teamPhotoPacks.has(brandId)?'ready':'pending';
 }
 function ensureTeamPhotos(brandId,records,force=false){
   brandId=String(brandId||'');
   const meta=known(brandId),role=window.LITeamSync?.getRoles()?.role;
   if(!signedIn()||brandId===ACTIVE_BRAND_ID||!meta)return Promise.resolve(null);
   if(role!=='Super Admin'&&!String(meta.version).endsWith('-price-safe-v1'))
     return Promise.resolve(null);
   if(force)teamPhotoErrors.delete(brandId);
   if(teamPhotoErrors.has(brandId))return Promise.resolve(null);
   if(teamPhotoLoading.has(brandId))return teamPhotoLoading.get(brandId);
   const selected=(Array.isArray(records)?records:[]).filter(r=>r?.brandId===brandId&&!r.deleted).slice(0,200);
   if(!selected.length)return Promise.resolve(null);
   const existing=teamPhotoPacks.get(brandId);
   if(existing?.version===meta.version){
     const needed=selected.map(r=>findTeamPhotoItem(existing.items,r)?.sprite?.atlas).filter(Boolean)
       .filter(k=>existing.keys.has(k));
     if(needed.every(key=>existing.urls[key]))return Promise.resolve(existing);
   }
   const generation=teamPhotoGeneration;
   const valid=()=>signedIn()&&generation===teamPhotoGeneration&&known(brandId)?.version===meta.version;
   const run=(async()=>{
     let lib=teamPhotoPacks.get(brandId);
     if(!lib||lib.version!==meta.version){
       const manifest=await window.LITeamSync.request('catalogManifest',{brandId});
       if(!valid())return null;
       if(manifest.brandId!==brandId||manifest.version!==meta.version||
          !Array.isArray(manifest.catalog?.items)||!Array.isArray(manifest.spriteKeys)||
          manifest.catalog.items.length>6000||manifest.spriteKeys.length>500)
         throw Error('Invalid authorized catalog response');
       // Retain only photo lookup fields, not supplier price or cost data.
       const items=manifest.catalog.items.map(i=>({
         id:i.id,code:i.code,
         name:typeof cleanAsfourProductName==='function'?
           cleanAsfourProductName(i.name,i.source,brandId):i.name,
         page:i.page,sprite:i.sprite
       }));
       lib={version:meta.version,items,keys:new Set(manifest.spriteKeys),urls:Object.create(null)};
       const prior=teamPhotoPacks.get(brandId);
       if(prior)for(const url of Object.values(prior.urls))
         if(url.startsWith('blob:'))URL.revokeObjectURL(url);
       teamPhotoPacks.set(brandId,lib);
     }
     const wanted=[...new Set(selected.map(r=>findTeamPhotoItem(lib.items,r)?.sprite?.atlas)
       .filter(k=>k&&lib.keys.has(k)&&!lib.urls[k]))];
     const batches=[];
     for(let i=0;i<wanted.length;i+=2)batches.push(wanted.slice(i,i+2));
     // Fetch only photo sheets referenced by the filtered team selections.
     for(const batch of batches){
       if(!valid())return null;
       const response=await window.LITeamSync.request('catalogSprites',{brandId,version:meta.version,keys:batch});
       if(!valid())return null;
       if(response.brandId!==brandId||response.version!==meta.version)throw Error('Catalog changed while loading photos');
       for(const key of batch){
         const data=response.sprites?.[key];
         if(typeof data!=='string'||!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(data))
           throw Error('Authorized product photo is unavailable');
         const raw=atob(data.slice(data.indexOf(',')+1)),bytes=new Uint8Array(raw.length);
         for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
         lib.urls[key]=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));
       }
     }
     return lib;
   })();
   teamPhotoLoading.set(brandId,run);
   run.then(()=>{if(teamPhotoLoading.get(brandId)===run)teamPhotoLoading.delete(brandId);
     if(valid()&&VIEW==='team')window.LITeamSync?.render?.();
   }).catch(err=>{
     if(teamPhotoLoading.get(brandId)===run)teamPhotoLoading.delete(brandId);
     if(valid()){
       teamPhotoErrors.set(brandId,String(err?.message||err));
       if(VIEW==='team')window.LITeamSync?.render?.();
     }
   });
   return run;
 }
 function onConnected(){
   // Team records can arrive before authentication status switches to "connected".
   // Fetch catalog/photos only once the verified session is fully established.
   if(signedIn()&&activeCatalogOutdated())ensureBrand(ACTIVE_BRAND_ID).catch(()=>{});
 }
 function onSignedIn(data){
   const nextRole=String(data?.user?.role||''),nextEmail=String(data?.user?.email||'').toLowerCase();
   const identityChanged=!!lastRole&&(lastRole!==nextRole||lastEmail!==nextEmail);
   lastRole=nextRole;lastEmail=nextEmail;
   entries.clear();
   for(const row of data.catalogs||[]){
     if(!row?.brandId||!row.version)continue;
     if(nextRole!=='Super Admin'&&!String(row.version).endsWith('-price-safe-v1')){
       errors.set(row.brandId,'Price-free catalog controls are not active on the deployed Apps Script. This role cannot download the original price-list images.');
       continue;
     }
     entries.set(row.brandId,row);
   }
   // Never reuse a more-privileged catalog or photo cache after account/role changes.
   if(identityChanged){clearActivePack();clearTeamPhotos();}
   // refresh() may run before status becomes connected; authenticateCurrentToken
   // calls onConnected() after verification succeeds.
   onConnected();
 }
 function onSignedOut(){
   entries.clear();errors.clear();progress.clear();lastRole='';lastEmail='';
   clearActivePack();clearTeamPhotos();
   if(VIEW!=='team'&&typeof render==='function')render();
 }
 function isLocked(pack){return isCentralPack(pack)&&!signedIn()}
 window.LICentralCatalog={ensureBrand,onSignedIn,onSignedOut,onConnected,readyPack,banner,isLocked,known,errors,ensureTeamPhotos,teamPhotoFor,teamPhotoStatus};
})();
