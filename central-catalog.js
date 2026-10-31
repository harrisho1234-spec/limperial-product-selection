/* Private catalog loader for authorized staff. No supplier images in the GitHub repository.
 * Catalogs are loaded through the existing Google-ID-token-verified Apps Script bridge.
 * Local drafts and previously imported private packs are never overwritten automatically.
 */
'use strict';
(function(){
 const entries=new Map(),loading=new Map(),errors=new Map(),progress=new Map();
 function signedIn(){return !!window.LITeamSync?.status()?.connected}
 function known(id){return entries.get(id)||null}
 function isCentralPack(pack){return !!(pack&&pack.metadata?.centralManaged===true)}
 function banner(id){
   const meta=known(id),task=progress.get(id),error=errors.get(id);
   if(!meta)return '';
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
   if(!signedIn())throw Error('Google sign-in required');
   const item=known(brandId);if(!item)throw Error('No published catalog for this supplier');
   const existing=DB?await tx(brandKey(brandId),null,'readonly'):null;
   if(!force && existing?.metadata?.centralVersion===item.version){readyPack(brandId,existing);return {cached:true,count:existing.catalog.items.length}}
   // Imported catalogs may have local custom products. They are merged after download.
   // If a local catalog was manually imported, leave it intact and use it until the admin
   // explicitly chooses to refresh from the central catalog.
   if(!force && existing?.catalog?.items?.length>0&&!isCentralPack(existing)){
     if(brandId===ACTIVE_BRAND_ID&&!PACK)readyPack(brandId,existing);
     return {existingLocal:true,count:existing.catalog.items.length};
   }
   const api=window.LITeamSync?.request;
   if(!api)throw Error('Team synchronization service unavailable');
   const m=await api('catalogManifest',{brandId});
   if(!m||m.brandId!==brandId||m.version!==item.version||!m.catalog||!Array.isArray(m.spriteKeys))throw Error('Catalog version mismatch; refresh team selections');
   if(m.catalog.items.length>6000||m.spriteKeys.length>500)throw Error('Catalog size limit exceeded');
   const sprites=Object.create(null),groups=[];
   for(let i=0;i<m.spriteKeys.length;i+=4)groups.push(m.spriteKeys.slice(i,i+4));
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
   if(DB)await tx(brandKey(brandId),pack);
   readyPack(brandId,pack);
   return {cached:false,count:pack.catalog.items.length};
 }
 function ensureBrand(brandId,force=false){
   if(!signedIn()||!known(brandId))return Promise.resolve(null);
   if(loading.has(brandId))return loading.get(brandId);
   errors.delete(brandId);
   const run=fetchBrand(brandId,force).catch(err=>{
      errors.set(brandId,String(err.message||err));
      if(ACTIVE_BRAND_ID===brandId&&VIEW!=='team')render();
      throw err;
   }).finally(()=>{loading.delete(brandId);progress.delete(brandId)});
   loading.set(brandId,run);return run;
 }
 function onSignedIn(data){
   entries.clear();for(const row of data.catalogs||[]){if(row?.brandId&&row.version)entries.set(row.brandId,row)}
   if(known(ACTIVE_BRAND_ID))ensureBrand(ACTIVE_BRAND_ID).catch(()=>{});
 }
 function onSignedOut(){entries.clear();errors.clear();progress.clear();
   if(isCentralPack(ACTIVE_PACK)){PACK=null;ACTIVE_PACK=null;Object.values(SPRITES).forEach(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url)});SPRITES={};if(VIEW!=='team')render()}
 }
 function isLocked(pack){return isCentralPack(pack)&&!signedIn()}
 window.LICentralCatalog={ensureBrand,onSignedIn,onSignedOut,readyPack,banner,isLocked,known,errors};
})();
