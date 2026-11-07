/* L'Imperial Asfour Selection Studio. Catalog data remains private in local IndexedDB. */
'use strict';
const $=id=>document.getElementById(id);
const CAT_STORE='limperial-private-catalog-v1',SEL_KEY='limperial-selections-v1';
const q=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

// Verified against the original 2025 supplier PDF: a comma-formatted amount at
// the END of an Asfour price-list description is a price, not a product model.
// Bare suffixes such as "917", "2023" and "100" are legitimate design identifiers
// in the supplier's English Description and must never be stripped.
const ASFOUR_APPENDED_PRICE_RE=/\s+\d{1,3},\d{3}\s*$/;
function cleanAsfourProductName(name,source,brandId){
 if(typeof name!=='string')return name;
 if(String(brandId||'')!=='asfour'||String(source||'')!=='price')return name;
 return name.replace(ASFOUR_APPENDED_PRICE_RE,'').trimEnd();
}
function sanitizeAsfourPack(pack,brandId){
 if(brandId!=='asfour'||!Array.isArray(pack?.catalog?.items))return 0;
 let changes=0;
 for(const item of pack.catalog.items){
  const cleaned=cleanAsfourProductName(item.name,item.source,brandId);
  if(cleaned!==item.name){item.name=cleaned;changes++}
 }
 // Keep the supplier name for provenance, but never give the private price-list
 // link as a source action inside Product Selection.
 if(pack.catalog.sources?.price?.url){delete pack.catalog.sources.price.url;changes++;}
 return changes;
}

let PACK=null,ACTIVE_PACK=null,DB=null,SPRITES={},VIEW='discover',SEARCH='',SRC='all',KIND='all',LIMIT=48,MODAL=null;
let ASFOUR_REFERENCE_FILTER='products';
let TL_CATALOG_VIEW='products';
let S=readState();
function readState(){const d={family:{},variants:{},catalog:{},shortlist:[],manual:[],compare:[],selectionRounds:[{id:'round-1',name:'1st Selection'}],activeRoundId:'round-1'};try{return Object.assign(d,JSON.parse(localStorage.getItem(stateKey(ACTIVE_BRAND_ID))||'{}'))}catch(e){return d}}
function save(){localStorage.setItem(stateKey(ACTIVE_BRAND_ID),JSON.stringify(S)); updateBadges();window.LITeamSync?.localSaved()}

function selectionRounds(){
 const own=Array.isArray(S.selectionRounds)?S.selectionRounds.filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string'):[];
 const shared=window.LITeamSync?.getSharedSelectionRounds?.(ACTIVE_BRAND_ID)||[];
 const list=[...shared];
 for(const item of own)if(!list.some(x=>x.id===item.id)){
  list.push({...item,name:shared.some(x=>x.name===item.name)?item.name+' (Personal)':item.name});
 }
 if(!list.some(x=>x.id==='round-1'))list.unshift({id:'round-1',name:'1st Selection'});
 return list;
}
function chosenRoundId(){
 const id=String(S.activeRoundId||'round-1');
 return id==='all'||selectionRounds().some(x=>x.id===id)?id:'round-1';
}
function entryRoundId(entry){
 const id=String(entry?.roundId||'round-1');
 return selectionRounds().some(x=>x.id===id)?id:'round-1';
}
function roundName(id){return selectionRounds().find(r=>r.id===id)?.name||'1st Selection'}
function ordinal(n){const k=n%100;return n+(k>=11&&k<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th')}
function roundOptions(selected){return selectionRounds().map(r=>'<option value="'+q(r.id)+'" '+(r.id===selected?'selected':'')+'>'+q(r.name)+'</option>').join('')}
function selectionRoundsBar(){
 const current=chosenRoundId(),selected=allVariants().filter(v=>['Select','Approved'].includes(variantEntry(v).decision));
 const total=candidates().length+selected.length;
 return '<div class="selection-rounds-bar"><label class="selection-rounds-label" for="selectionRoundsActive">Selection group</label>'+
  '<select id="selectionRoundsActive" aria-label="Current selection group"><option value="all" '+(current==='all'?'selected':'')+'>All selections ('+total+')</option>'+
  selectionRounds().map(r=>{const count=candidates().filter(i=>entryRoundId(candidateEntry(i))===r.id).length+
    selected.filter(v=>entryRoundId(variantEntry(v))===r.id).length;
    return '<option value="'+q(r.id)+'" '+(current===r.id?'selected':'')+'>'+q(r.name)+' ('+count+')</option>'}).join('')+
  '</select><button type="button" class="btn secondary small" data-action="newSelectionRound">＋ Personal group</button>'+
  (current!=='all'&&!selectionRounds().find(r=>r.id===current)?.shared?'<button type="button" class="btn quiet small" data-action="renameSelectionRound">Rename personal group</button>':'')+
  '<span class="tiny">New products go to '+q(roundName(current==='all'?'round-1':current))+'. Previous selections stay in their groups.</span></div>';
}
function createSelectionRound(){
 const rounds=selectionRounds();if(rounds.length>=30)return alert('A maximum of 30 selection groups is supported.');
 const input=prompt('Name the new selection group:',ordinal(rounds.length+1)+' Selection');
 if(input===null)return;
 const name=input.trim().slice(0,60);if(!name)return alert('Please enter a name.');
 let id;do{id='round-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}while(rounds.some(r=>r.id===id));
 S.selectionRounds=[...(Array.isArray(S.selectionRounds)?S.selectionRounds:[]).filter(r=>!window.LITeamSync?.getSharedSelectionRounds?.(ACTIVE_BRAND_ID)?.some(x=>x.id===r.id)),{id,name}];S.activeRoundId=id;save();render();toast('Created personal group '+name);
}
function renameSelectionRound(){
 const id=chosenRoundId();if(id==='all')return;
 const rounds=selectionRounds(),old=rounds.find(x=>x.id===id);if(!old)return;
 if(old.shared)return alert('Shared group names can only be changed by Admin in Team Selections.');
 const input=prompt('Rename selection group:',old.name);if(input===null)return;
 const name=input.trim().slice(0,60);if(!name)return alert('Please enter a name.');
 S.selectionRounds=(Array.isArray(S.selectionRounds)?S.selectionRounds:[]).map(r=>r.id===id?{...r,name}:r);save();render();toast('Renamed to '+name);
}

function toast(msg){let e=$('toast');e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),3000)}
function sprite(s,extra='',urlMap=SPRITES){if(s?.data&&/^data:image\/(webp|png|jpeg);base64,/.test(s.data))return `<div class="sprite" style="background-image:url('${s.data}');background-size:contain;background-position:center;background-repeat:no-repeat" ${extra}></div>`;if(!s||!urlMap[s.atlas])return `<div class="sprite" style="display:grid;place-items:center;color:#b7a37e;font-size:35px">✧</div>`;const x=(s.index%4)*100/3,y=Math.floor(s.index/4)*100/3;const crop=window.LICatalogSplit?.image(s);if(crop){const left=crop.col/crop.cols*100,top=crop.row/crop.rows*100;return `<div class="catalog-crop-window" style="--li-crop-aspect:${crop.rows/crop.cols}"><div class="sprite catalog-crop-source" style="width:${crop.cols*100}%;height:${crop.rows*100}%;transform:translate(-${left}%,-${top}%);background-image:url('${urlMap[s.atlas]}');background-position:${x}% ${y}%" ${extra}></div></div>`}return `<div class="sprite" style="background-image:url('${urlMap[s.atlas]}');background-position:${x}% ${y}%" ${extra}></div>`}
function photo(s,cl='preview',urlMap=SPRITES){return `<div class="${cl}">${sprite(s,'',urlMap)}</div>`}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(CAT_STORE,1);r.onupgradeneeded=()=>r.result.createObjectStore('store');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function tx(store,value,mode='readwrite'){return new Promise((res,rej)=>{const t=DB.transaction('store',mode);let r=mode==='readonly'?t.objectStore('store').get(store):t.objectStore('store').put(value,store);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function usePack(pack){if(!pack||!pack.catalog||!pack.sprites||!Array.isArray(pack.catalog.family))throw Error('Invalid catalog pack');const sanitized=sanitizeAsfourPack(pack,ACTIVE_BRAND_ID);if(sanitized&&DB)tx(brandKey(ACTIVE_BRAND_ID),pack).catch(err=>console.warn('Could not persist sanitized catalog cache',err));PACK=pack.catalog;ACTIVE_PACK=pack;window.LICatalogSplit?.apply(pack,ACTIVE_BRAND_ID);Object.values(SPRITES).forEach(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url)});SPRITES={};for(const [path,data] of Object.entries(pack.sprites)){const raw=atob(data.split(',')[1]),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);SPRITES[path]=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}))}updateBadges()}
async function importCatalog(file){let pack;try{pack=JSON.parse(await file.text());usePack(pack);await tx(brandKey(ACTIVE_BRAND_ID),pack);toast('Private catalog imported and saved on this device');VIEW=ACTIVE_BRAND_ID==='asfour'?'families':'discover';render()}catch(e){alert('Catalog import failed: '+e.message)}}
// Shared variants and local custom proposals may have the same stable ID after publication.
const allVariants=()=>{const central=PACK?.variant||[],known=new Set(central.map(v=>v.id));
 return [...central,...(S.manual||[]).filter(v=>!known.has(v.id))];};
function variantEntry(v){return Object.assign({decision:'Review',supplierStatus:'Not requested',qty:0,targetSize:v.targetSize||'',code:v.code||'',request:v.request||'',finish:v.finish||'',crystal:v.crystal||''},S.variants[v.id]||{})}
function isReady(v){const s=variantEntry(v);return s.decision==='Approved'&&s.supplierStatus==='Confirmed'&&Number(s.qty)>0&&!!s.code.trim()}
function isCatalogCopy(id){return !!S.catalogDuplicates?.[id]}
function selectionForItem(id){return isCatalogCopy(id)?S.catalogDuplicates[id]:S.catalog[id]}
// Individual TL product picks are selection records, never edits to the scanned
// master catalog. The position is normalized within the original printed page.
function validTLCrop(value){
 if(!Array.isArray(value)||value.length!==4)return null;
 const r=value.map(Number);
 return r.every(Number.isFinite)&&r[0]>=0&&r[1]>=0&&r[2]>=0.06&&r[3]>=0.06&&r[0]+r[2]<=1.001&&r[1]+r[3]<=1.001?r:null;
}
function tlCropSourceRef(parentId,rect){
 const crop=validTLCrop(rect);
 return crop?'tlcrop:'+encodeURIComponent(parentId)+':'+crop.map(n=>n.toFixed(4)).join(','):'';
}
function parseTLSourceRef(ref){
 const m=/^tlcrop:([^:]{1,160}):([0-9.,]+)$/.exec(String(ref||''));
 if(!m)return null;
 let parentId;
 try{parentId=decodeURIComponent(m[1])}catch(_){return null}
 const crop=validTLCrop(m[2].split(',').map(Number));
 return crop?{parentId,crop}:null;
}
window.LITLPicker={parseRef:parseTLSourceRef};
function catalogItemForSelection(id){
 const real=PACK?.items?.find(i=>i.id===id);
 if(real)return real;
 const entry=S.catalogDuplicates?.[id];
 if(!entry)return null;
 const source=PACK?.items?.find(i=>i.id===entry.sourceItemId);
 if(!source)return null;
 const crop=validTLCrop(entry.tlCrop);
 if(crop&&ACTIVE_BRAND_ID==='tl'){
  return {...source,id,sourceItemId:source.id,isSelectionCopy:true,
   code:String(entry.code||'').trim(),
   name:String(entry.tlName||'Tong Luo individual chandelier'),
   dimension:String(entry.tlOriginalSize||''),
   sprite:{...source.sprite,cropRect:crop},
   sourceRef:tlCropSourceRef(source.id,crop),
   verification:entry.code?'Individual model · verify printed supplier code':'Supplier code needs verification',
   photoKind:'catalog-crop'};
 }
 return {...source,id,sourceItemId:source.id,isSelectionCopy:true};
}
function candidateEntry(item){
 const entry=selectionForItem(item.id)||{};
 const value=Object.assign({decision:'Review',supplierStatus:'Not requested',qty:0,code:item.code||'',targetSize:'',request:'',crystal:'',finish:'',roundId:'round-1'},entry);
 if(String(value.targetSize||'').trim()===String(item.dimension||'').trim())value.targetSize='';
 return value;
}
function duplicateCatalogSelection(id){
 const item=catalogItemForSelection(id);
 if(!item||!selectionForItem(id)){toast('Select a catalog product before duplicating');return}
 if(!S.catalogDuplicates)S.catalogDuplicates={};
 let copyId;
 do{copyId='copy-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9)}
 while(S.catalogDuplicates[copyId]||S.catalog[copyId]||PACK.items.some(x=>x.id===copyId));
 const from=candidateEntry(item);
 S.catalogDuplicates[copyId]={...from,roundId:chosenRoundId()==='all'?'round-1':chosenRoundId(),sourceItemId:item.sourceItemId||item.id,decision:'Select',supplierStatus:'Not requested',targetSize:'',qty:Number(from.qty)>0?Number(from.qty):1};
 save();
 window.LITeamSync?.itemChanged('catalog',copyId);
 if(MODAL?.type==='item')closeDrawer();
 VIEW='selected';render();
 toast('Duplicate added — enter the custom requested size on the new copy');
}
function originalSizeFor(r){
 const item=r.item||{};
 return String(r.family==='CATALOG'?(item.dimension||item.originalSize||''):(item.originalSize||item.supplierSize||item.dimension||'')).trim();
}
function requestedSizeFor(r){
 const value=String(r.entry?.targetSize||'').trim(),original=originalSizeFor(r);
 return value&&value!==original?value:'';
}
function candidates(){
 const bySource=new Map();
 for(const [id,entry] of Object.entries(S.catalogDuplicates||{})){
  if(!entry?.sourceItemId)continue;
  const list=bySource.get(entry.sourceItemId)||[];list.push(id);bySource.set(entry.sourceItemId,list);
 }
 const result=[];
 for(const item of PACK?.items||[]){
  if(S.catalog[item.id]!==undefined)result.push(item);
  for(const id of bySource.get(item.id)||[])result.push({...item,id,sourceItemId:item.id,isSelectionCopy:true});
 }
 return result;
}
function orderRows(){const v=allVariants().filter(isReady).map(x=>({id:x.id,item:x,entry:variantEntry(x),family:x.familyId}));const c=candidates().filter(x=>{const t=candidateEntry(x);return t.decision==='Approved'&&t.supplierStatus==='Confirmed'&&Number(t.qty)>0&&!!t.code.trim()}).map(item=>({id:item.id,item,entry:candidateEntry(item),family:'CATALOG'}));return [...v,...c]}
function updateBadges(){const n=Object.keys(S.catalog||{}).length+Object.keys(S.catalogDuplicates||{}).length+Object.values(S.variants||{}).filter(x=>x.decision==='Select'||x.decision==='Approved').length;$('selectedCount').textContent=n;$('readyCount').textContent=orderRows().length}
function setView(v){if(!window.LITeamSync?.status()?.connected)return;if(v==='team-management'&&window.LITeamSync?.getRoles()?.role!=='Super Admin')return;VIEW=v;SEARCH='';SRC='all';KIND='all';LIMIT=48;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));render();window.scrollTo(0,0)}
function title(t,d){$('pageTitle').textContent=t;$('pageDesc').textContent=d}
function syncTeamManagementTab(){const allowed=window.LITeamSync?.status()?.connected&&window.LITeamSync?.getRoles()?.role==='Super Admin';const nav=$('teamManagementNav');if(nav)nav.hidden=!allowed;if(!allowed&&VIEW==='team-management')VIEW='brands';}
function render(){syncTeamManagementTab();if(!window.LITeamSync?.status()?.connected){$('app').innerHTML='';$('heroStats').innerHTML='';return;}syncBrandChrome();updateBadges();if(VIEW==='team-management'){title('Team Management','Authorized staff accounts, roles, and access permissions.');$('brandEyebrow').textContent='ADMINISTRATION · ACCESS CONTROL';$('heroStats').innerHTML='';window.LITeamSync?.renderTeamManagement();return}if(VIEW==='team'){title('Team selections & approvals','Secure shared purchasing selections across authorized staff.');$('heroStats').innerHTML='';window.LITeamSync?.render();return}if(VIEW==='documents'){title('Supplier PDF Catalogs','Price-free catalog access controlled by staff role.');$('heroStats').innerHTML='';window.LIPdfAccess?.enter();return}if(VIEW==='brands'){title('Brand Library','Choose a supplier or create a new brand.');$('heroStats').innerHTML='';renderBrands();return}if(VIEW==='brand-add'){title('Add New Brand','Create an independent catalog and selection workspace.');$('heroStats').innerHTML='';renderAddBrand();return}if(!window.LITeamSync?.status()?.connected){PACK=null;ACTIVE_PACK=null;title('Google Sign-In required','Private supplier product catalogs are accessible to authorized staff only.');$('heroStats').innerHTML='';VIEW='team';window.LITeamSync?.render();return}if(!PACK){title('Your private product catalog','Sign in to load '+brandNow().name+' products automatically.');$('heroStats').innerHTML='';$('app').innerHTML=(window.LICentralCatalog?.banner(ACTIVE_BRAND_ID)||'')+(ACTIVE_BRAND_ID==='asfour'?emptyCatalog():renderBrandEmpty());return}
 const stats=`<div><strong>${PACK.family.length}</strong><span>PREFERRED FAMILIES</span></div><div><strong>${PACK.items.filter(i=>i.code).length}</strong><span>SUPPLIER CODES</span></div>`;$('heroStats').innerHTML=stats;
 if(VIEW==='discover'){title('Discover '+brandNow().name,'Browse supplier products, codes and catalog references.');renderDiscover()}
 if(VIEW==='families'){title('Design families · '+brandNow().name,'Build coordinated lighting and furniture collections.');renderFamilies()}
 if(VIEW==='selected'){title('My selections · '+brandNow().name,'Review selected products for this supplier.');renderSelected()}
 if(VIEW==='order'){title('Prepare '+brandNow().name+' order','Confirmed, approved items with quantities appear in the final Excel.');renderOrder()}
 if(VIEW==='settings'){title('Catalogs & settings','Private catalog files, backups and storage information.');renderSettings()}}

function emptyCatalog(){if(window.LITeamSync?.status()?.connected)return `<div class="empty"><div class="empty-icon">◇</div><h2>Catalog temporarily unavailable</h2><p>You are already signed in. The supplier catalog is managed centrally and must be accessible through the secure Google Drive service. You do not need to download or import anything on this computer.</p><div class="row-actions" style="justify-content:center"><button class="btn" data-action="loadCentralCatalog" data-id="${q(ACTIVE_BRAND_ID)}">Retry catalog download</button></div></div>`;return `<div class="empty"><div class="empty-icon">◇</div><h2>Browse Asfour after Google sign-in</h2><p>Approved staff do not need to import any catalogs. Sign in to automatically load the private Asfour product photos. Manual import remains available for administrators and existing offline work.</p><div class="row-actions" style="justify-content:center"><button class="btn" data-action="goto" data-to="team">Sign in with Google</button></div>${window.LITeamSync?.getRoles()?.role==='Super Admin'?`<div class="row-actions" style="justify-content:center"><span class="tiny">Super Admin: open the supplier master pack from your private Google Drive.</span><label class="btn">Import catalog pack <input id="packFile" type="file" accept=".json,application/json" style="display:none"></label></div>`:''}<div class="intro-steps"><div><span class="pill gold">01</span><b>Download catalog pack</b><span class="tiny">Use Download in Google Drive</span></div><div><span class="pill gold">02</span><b>Import here</b><span class="tiny">Choose Asfour_Catalog_Private_Pack.json</span></div><div><span class="pill gold">03</span><b>Start selecting</b><span class="tiny">Browse, create versions and export orders</span></div></div></div>`}
function pricePhotoNotice(){const central=window.LICentralCatalog?.banner(ACTIVE_BRAND_ID)||'';if(ACTIVE_BRAND_ID!=='asfour')return central+brandImportToolbar();if(PACK.photoExtraction?.matchedCodes>=1000)return central+'<div class="alert">Individual supplier photos are loaded for '+PACK.photoExtraction.matchedCodes.toLocaleString()+' Asfour codes. Some finish variants share a supplier reference photo; verify details before approving.</div>';return central+'<div class="alert"><b>Individual Asfour product photos are available.</b> Your browser still has the earlier page-preview catalog. <span class="tiny">Ask Super Admin to use the private Google Drive master catalog backup.</span>, then <label class="btn secondary small" style="cursor:pointer">Import updated photos<input id="packFile" type="file" accept=".json,application/json" style="display:none"></label>. Your existing selections will be preserved.</div>';}
// Reviewed against the six supplied screenshots and the original private pack.
// Do NOT generalize this rule to other pages: a no-code page can show a real design.
const ASFOUR_CONFIRMED_INFORMATION_PAGES=new Set(['heritage-p7','heritage-p9','heritage-p11','heritage-p13','heritage-p15','heritage-p17']);
function isAsfourInformationPage(item){
 return ACTIVE_BRAND_ID==='asfour'&&item?.source==='heritage'&&
  !String(item.code||'').trim()&&!item.splitGenerated&&
  ASFOUR_CONFIRMED_INFORMATION_PAGES.has(String(item.id))&&
  String(item.name||'').startsWith('Chandeliers Collections (2020)');
}
function filteredCatalogItems(){return PACK.items.filter(x=>
 // Duplicate PDF photo crops are not separate products. Keep any already
 // selected legacy references visible so old selections remain editable.
 (!x.catalogDuplicateOf || !!S.catalog[x.id] || S.shortlist.includes(x.id))&&
 (ACTIVE_BRAND_ID==='tl'? (TL_CATALOG_VIEW==='pages'?(!!x.tlPageReference||(x.source==='tl-chandelier'&&!x.code)):(!!x.tlIndividualModel||(x.source==='tl-chandelier'&&!!x.code))):!x.splitParent)&&
 (ACTIVE_BRAND_ID!=='asfour'||ASFOUR_REFERENCE_FILTER==='all'||
   (ASFOUR_REFERENCE_FILTER==='information'?isAsfourInformationPage(x):!isAsfourInformationPage(x)))&&
 (SRC==='all'||x.source===SRC)&&
 (KIND==='all'||(KIND==='coded'?!!x.code:!x.code))&&
 (!SEARCH||`${x.code} ${x.name} ${x.dimension} ${x.modelSearch||''}`.toLowerCase().includes(SEARCH.toLowerCase())))}
function asfourPriceButton(){
 if(ACTIVE_BRAND_ID!=='asfour'||!['Admin','Super Admin'].includes(window.LITeamSync?.getRoles?.()?.role))return '';
 const showing=window.LISelectionCosts?.areListPricesVisible?.();
 return '<button class="btn secondary small" data-action="toggleAsfourListPrices">'+(showing?'Hide':'Show')+' Asfour list prices · Admin</button>';
}
function renderDiscover(){
 if(ACTIVE_BRAND_ID!=='asfour'&&!PACK.items.length){$('app').innerHTML=renderBrandEmpty();return}
 const sourceOptions=`<option value="all">All catalogs</option>${Object.entries(PACK.sources).map(([id,a])=>`<option value="${q(id)}" ${SRC===id?'selected':''}>${q(a.name)}</option>`).join('')}`;
 const informationCount=ACTIVE_BRAND_ID==='asfour'?PACK.items.filter(i=>!i.splitParent&&isAsfourInformationPage(i)).length:0;
 const extraFilter=ACTIVE_BRAND_ID==='asfour'?`<select id="asfourReferenceFilter" aria-label="Asfour reference type">
    <option value="products" ${ASFOUR_REFERENCE_FILTER==='products'?'selected':''}>Product &amp; design references</option>
    <option value="information" ${ASFOUR_REFERENCE_FILTER==='information'?'selected':''}>Catalog information (${informationCount})</option>
    <option value="all" ${ASFOUR_REFERENCE_FILTER==='all'?'selected':''}>All references</option>
  </select>`:'';
 const tlFilter=ACTIVE_BRAND_ID==='tl'? `<select id="tlCatalogView" aria-label="Tong Luo catalog view">
   <option value="products" ${TL_CATALOG_VIEW==='products'?'selected':''}>Individual products</option>
   <option value="pages" ${TL_CATALOG_VIEW==='pages'?'selected':''}>Original catalog pages</option>
 </select>`:'';
 const note=ACTIVE_BRAND_ID==='asfour'?
   `${informationCount} confirmed editorial pages separated; all original records and selections are preserved.`:
   ACTIVE_BRAND_ID==='tl'?(TL_CATALOG_VIEW==='products'
    ?'Individual models with automatic product photos. OCR codes and dimensions require supplier verification; photo matches marked for review.'
    :'Original PDF-page photos retained for checking model references; select individual products from the other view.'):
   'Scanned catalogs may contain visual references needing supplier verification';
 const items=filteredCatalogItems(),visible=items.slice(0,LIMIT);
 $('app').innerHTML=`${pricePhotoNotice()}${selectionRoundsBar()}<div class="toolbar"><div class="search">
   <input id="catalogSearch" placeholder="Search product code, style or size…" value="${q(SEARCH)}"></div>
   <select id="srcFilter">${sourceOptions}</select>
   <select id="kindFilter"><option value="all">All records</option><option value="coded" ${KIND==='coded'?'selected':''}>Exact product codes</option><option value="pages" ${KIND==='pages'?'selected':''}>Visual catalog pages</option></select>
   ${extraFilter}${tlFilter}${asfourPriceButton()}</div>
   <div class="subheading"><h2>${items.length.toLocaleString()} ${ACTIVE_BRAND_ID==='tl'?(TL_CATALOG_VIEW==='products'?'individual product models':'original catalog pages'):'catalog references'}</h2><span class="tiny">${q(note)}</span></div>
   <div class="cards">${visible.map(i=>catalogCard(i)).join('')}</div>
   ${items.length>LIMIT?`<div class="catalog-more" style="text-align:center;margin:22px"><button class="btn secondary" data-action="more">Load more (${Math.min(48,items.length-LIMIT)})</button></div>`:''}`;
}
function catalogCard(i){
 const added=!!S.catalog[i.id],sel=S.shortlist.includes(i.id),selected=added||sel;
 const tlPage=ACTIVE_BRAND_ID==='tl'&&(!!i.tlPageReference||(i.source==='tl-chandelier'&&!i.code));
 const editorial=isAsfourInformationPage(i);
 const label=tlPage?'Original page':i.tlIndividualModel?(i.photoNeedsVerification?'Verify photo':'Individual product'):editorial?'Catalog information':i.photoKind==='supplier-photo'?'Product photo':i.photoKind==='catalog-crop'?'Individual design':i.code?'Product · PDF preview':'Catalog page';
 const count=tlPage&&Array.isArray(i.modelCandidates)?i.modelCandidates.length:0;
 const description=tlPage?(count?count+' model labels on original page':'Source catalog page for product verification'):i.tlIndividualModel?'Supplier model from searchable PDF · verify code before ordering':editorial?'Editorial/reference page — not a coded product':(i.code?(i.name||'Chandelier'):'Visual reference only');
 return `<article class="card catalog-product-card${selected?' catalog-card-selected':''}"><div class="card-photo">${sprite(i.sprite)}<span class="float-tag">${q(label)}</span>${selected?'<span class="catalog-selected-tag" aria-label="In My selections">✓ Selected</span>':''}</div>
 <div class="card-info"><div class="card-name">${q(i.code||i.name)}</div>
 <div class="card-meta">${q(description)}</div>${window.LISelectionCosts?.listPriceMarkup?.(i.code)||''}
 ${tlPage&&i.modelCandidates?.length?`<div class="card-meta" title="OCR text — verify against photo">${q(i.modelCandidates.slice(0,3).map(m=>m.code).join(' · '))}${i.modelCandidates.length>3?' · …':''}</div>`:''}
 ${i.tlIndividualModel&&(i.photoNeedsVerification||i.modelNeedsVerification)?`<div class="card-meta" style="color:#9a6027">Verify ${i.photoNeedsVerification?'photo':'model code'}${i.photoNeedsVerification&&i.modelNeedsVerification?' and model code':''} against original page</div>`:''}
 ${String(i.dimension||'').trim()?`<div class="card-size" title="Original catalog size"><span class="card-size-label">Size</span> ${q(i.dimension)}</div>`:''}
 <div class="card-meta">${q(PACK.sources[i.source]?.name||'Supplier catalog')} · p.${i.page}</div>
 ${i.photoKind==='supplier-photo'&&i.imageSharedWithVariants?'<div class="card-meta">Reference photo; finish may vary</div>':''}</div>
 <div class="card-foot"><button class="btn quiet small" data-action="item" data-id="${q(i.id)}">${tlPage?'View original':'View details'}</button>
 ${tlPage?'':`<button type="button" class="btn small catalog-select-btn ${selected?'catalog-selected-btn':''}" data-action="shortlist" data-id="${q(i.id)}" aria-pressed="${selected?'true':'false'}" title="${selected?'Click to unselect this product':'Add this product to My selections'}" aria-label="${selected?'Unselect':'Select'} ${q(i.code||i.name)}">${selected?'× Unselect':'＋ Select'}</button>`}</div></article>`;
}
function renderFamilies(){const ql=SEARCH.toLowerCase();const list=PACK.family.filter(f=>!ql||[f.id,f.name,f.mainCode].join(' ').toLowerCase().includes(ql));$('app').innerHTML=`<div class="toolbar"><div class="search"><input id="familySearch" placeholder="Search preferred family…" value="${q(SEARCH)}"></div>${ACTIVE_BRAND_ID==='asfour'?'<button class="btn secondary" data-action="openDrive">Open original selection file</button>':''}${asfourPriceButton()}${['Super Admin','Admin'].includes(window.LITeamSync?.getRoles?.()?.role)?
   '<details class="li-export-choice"><summary class="btn secondary">⬇ Export Excel ▾</summary><div class="li-export-menu">'+
   '<button class="btn quiet small" data-action="exportFamilies" '+(!list.length?'disabled':'')+'>Without Cost</button>'+
   '<button class="btn quiet small" data-action="exportFamiliesWithCost" '+(!list.length?'disabled':'')+'>With Cost · Admin only</button></div></details>':
   '<button class="btn secondary" data-action="exportFamilies" '+(!list.length?'disabled':'')+'>⬇ Export Excel</button>'}<button class="btn" data-action="newFamily">＋ ${['Super Admin','Admin'].includes(window.LITeamSync?.getRoles?.()?.role)?'Create family':'Personal family draft'}</button></div><div class="subheading"><h2>${list.length} design families</h2><span class="tiny">${ACTIVE_BRAND_ID==='asfour'?'Imported from Product Performance.xlsx; custom proposals remain unconfirmed':'Custom family designs and supplier references'}</span></div><div class="f-grid">${list.map(f=>{let versions=allVariants().filter(v=>v.familyId===f.id),summary=familyVariantRows(versions),n=summary.visible.length,collapsed=summary.collapsed;return `<article class="f-card"><div class="mini-photo">${sprite(f.sprite)}</div><div class="f-copy"><div class="tiny">${q(f.id)} · ${n} design references${collapsed?` · ${collapsed} repeats collapsed`:``}</div><h3>${q(f.mainCode||f.name)}</h3>${window.LISelectionCosts?.listPriceMarkup?.(f.mainCode)||''}<p>Your preferred collection · supplier size confirmation pending</p><button class="btn secondary small" data-action="family" data-id="${q(f.id)}">Review family →</button></div></article>`}).join('')}</div>`}
function renderSelected(){
 const candidatesAll=candidates();
 const selectedVariants=allVariants().filter(v=>['Select','Approved'].includes(variantEntry(v).decision));
 const active=chosenRoundId(),rounds=selectionRounds().filter(r=>active==='all'||r.id===active);
 const cards=rounds.map(round=>{
  const items=candidatesAll.filter(i=>entryRoundId(candidateEntry(i))===round.id);
  const variants=selectedVariants.filter(v=>entryRoundId(variantEntry(v))===round.id);
  return '<section class="selection-round-section" aria-label="'+q(round.name)+'">'+
   '<div class="selection-round-heading"><h2>'+q(round.name)+'</h2><span class="tiny">'+items.length+' catalog products · '+variants.length+' family versions</span></div>'+
   (items.length?'<div class="row-list">'+items.map(i=>candidateCard(i)).join('')+'</div>':
     '<p class="muted">No catalog items in this group. Browse Discover to add products.</p>')+
   (variants.length?'<div class="subheading"><h3>Family versions</h3></div><div class="row-list">'+variants.map(v=>{
     const e=variantEntry(v);
     const original=PACK.family.find(f=>f.id===v.familyId);
     return '<div class="candidate-row selection-item"><div class="selection-card-head">'+
      photo(v.sprite||original?.sprite,'selection-thumb')+
      '<div class="selection-card-copy"><strong>'+q(v.familyId)+' · '+q(v.type)+'</strong>'+
      '<div class="tiny">'+q(e.code||'Custom code pending')+' · '+q(e.targetSize)+'</div>'+
      '<div class="row-actions selection-card-actions"><label class="selection-round-item-label">Group <select data-round-kind="variant" data-id="'+q(v.id)+'" aria-label="Move family version to selection group">'+roundOptions(round.id)+'</select></label>'+
      '<button class="btn quiet small" data-action="family" data-id="'+q(v.familyId)+'">Review family</button></div></div></div></div>';
    }).join('')+'</div>':'')+
   '</section>';
 }).join('');
 $('app').innerHTML='<div class="statuslist"><div class="statbox"><strong>'+candidatesAll.length+'</strong><small>Catalog candidates</small></div>'+
  '<div class="statbox"><strong>'+selectedVariants.length+'</strong><small>Family versions selected</small></div>'+
  '<div class="statbox"><strong>'+orderRows().length+'</strong><small>Approved and confirmed</small></div></div>'+
  selectionRoundsBar()+
  '<div class="toolbar"><button class="btn" data-action="exportDraft" '+(draftRows().length?'':'disabled')+'>⬇ Download selected designs (.xlsx)</button>'+
  '<span class="tiny">Groups organize your work; existing approval statuses and supplier confirmations remain unchanged.</span></div>'+
  (cards||'<div class="empty"><h2>No selections yet</h2><button class="btn secondary" data-action="goto" data-to="discover">Browse catalog</button></div>');
}
function candidateCard(i){let s=candidateEntry(i),checked=S.compare.includes(i.id);return `<article class="candidate-row selection-item"><div class="selection-card-head"><button type="button" class="selection-photo-button" data-action="item" data-id="${q(i.id)}" aria-label="View product image">${photo(i.sprite||i.pageSprite,'selection-thumb')}</button><div class="selection-card-copy"><div class="variant-top"><div><b>${q(s.code||i.name)}</b><div class="selection-description">${q(i.name||i.type||'Catalog product')}</div>${i.isSelectionCopy?`<div class="tiny selection-copy-marker">Duplicate selection · ${q(s.targetSize?'Custom requested size':'Enter custom size')}</div>`:''}<div class="tiny">${q(PACK.sources[i.source]?.name||'Supplier catalog')} · page ${q(i.page??'—')}</div>${i.imageSharedWithVariants?'<div class="tiny">Reference photo; finish may vary</div>':''}</div>${i.isSelectionCopy?'':`<label class="tiny"><input type="checkbox" data-action="compare" data-id="${q(i.id)}" ${checked?'checked':''}> Compare</label>`}</div></div></div><div class="variant-fields"><div class="field"><label>Selection group</label><select data-round-kind="catalog" data-id="${q(i.id)}" aria-label="Move item to selection group">${roundOptions(entryRoundId(s))}</select></div><div class="field"><label>Selection</label>${selectHTML('catalog',i.id,'decision',s.decision,['Review','Select','Skip','Approved'])}</div><div class="field"><label>Supplier confirmation</label>${selectHTML('catalog',i.id,'supplierStatus',s.supplierStatus,['Not requested','Quote requested','Confirmed','Not possible'])}</div><div class="field"><label>Supplier code</label><input data-edit="catalog" data-id="${q(i.id)}" data-key="code" value="${q(s.code)}" placeholder="Required for export"></div><div class="field"><label>Qty (later)</label><input type="number" min="0" data-edit="catalog" data-id="${q(i.id)}" data-key="qty" value="${q(s.qty)}"></div><div class="field"><label>Original size (catalog)</label><input value="${q(i.dimension||'Not specified in catalog')}" readonly aria-label="Original catalog size"></div><div class="field"><label>Requested size (custom)</label><input data-edit="catalog" data-id="${q(i.id)}" data-key="targetSize" value="${q(s.targetSize)}" placeholder="e.g. Ø80 × H90 cm"></div><div class="field span2"><label>Custom request (other changes)</label><input data-edit="catalog" data-id="${q(i.id)}" data-key="request" value="${q(s.request)}" placeholder="Finish, crystal, arms, tiers, drop length…"></div></div><div class="row-actions"><button class="btn quiet small" data-action="item" data-id="${q(i.id)}">View product</button><button class="btn secondary small" data-action="duplicateCandidate" data-id="${q(i.id)}">⧉ Duplicate</button><button class="btn danger small" data-action="removeCandidate" data-id="${q(i.id)}">Remove</button></div></article>`}
function renderOrder(){const rows=orderRows();const unconfirmed=allVariants().filter(v=>variantEntry(v).decision==='Select'||variantEntry(v).decision==='Approved').filter(v=>!isReady(v)).length + candidates().filter(i=>candidateEntry(i).decision!=='Skip'&&candidateEntry(i).decision!=='Review'&&!rows.some(r=>r.id===i.id)).length;
 $('app').innerHTML=`<div class="statuslist"><div class="statbox"><strong>${rows.length}</strong><small>Ready-to-export lines</small></div><div class="statbox"><strong>${unconfirmed}</strong><small>Need confirmation or quantity</small></div></div><div class="toolbar"><button class="btn secondary" data-action="exportDraft" ${draftRows().length?'':'disabled'}>⬇ Download draft selections (.xlsx)</button><button class="btn" data-action="exportExcel" ${rows.length?'':'disabled'}>⬇ Export final supplier order with photos (.xlsx)</button><button class="btn secondary" data-action="backup">Download selection backup</button></div><div class="alert">Export includes only items marked <b>Approved</b>, <b>Confirmed</b>, with Qty above zero and a verified supplier code. Photos are embedded as reference images; for coded entries the 2025 page preview may contain multiple products and should be checked before sending.</div>${rows.length?`<div style="overflow:auto"><table class="order-table"><thead><tr><th>No.</th><th>Photo reference</th><th>Supplier item / custom size</th><th>Qty</th><th>Crystal</th><th>Remarks</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${photo(r.item.sprite,'mini-photo thumb')}</td><td><b>${q(r.entry.code)}</b><div class="tiny">${q(r.entry.targetSize||'')}</div></td><td>${q(r.entry.qty)}</td><td>${q(r.entry.crystal)}</td><td>${q(r.entry.request||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h2>No items ready for supplier export</h2><p>First select a product or variant. Once the supplier confirms it, set the status to Approved and enter quantity.</p><button class="btn secondary" data-action="goto" data-to="families">Review design families</button></div>'}`}
function renderSettings(){const source=Object.entries(PACK.sources);$('app').innerHTML=`${ACTIVE_BRAND_ID==='asfour'?'':brandImportToolbar()}${ACTIVE_BRAND_ID!=='asfour'?`<div class="candidate-row"><h3>Brand catalog backup</h3><p class="tiny">Download your product codes, descriptions, custom families and manually uploaded photos. Original supplier PDFs and Excel files are <b>not</b> included—keep copies in Google Drive.</p><div class="row-actions"><button class="btn secondary small" data-action="exportBrandCatalog">Download brand catalog (.json)</button>${brandNow().driveUrl&&window.LITeamSync?.getRoles()?.role==='Super Admin'?`<a class="btn quiet small" target="_blank" rel="noopener" href="${q(brandNow().driveUrl)}">Open this brand's Google Drive folder</a>`:''}</div></div>`:''}<div class="subheading"><h2>${q(brandNow().name)} catalog sources</h2></div><div class="row-list">${source.map(([k,v])=>`<div class="candidate-row"><div class="variant-top"><div><b>${q(v.name)}</b><div class="tiny">${Number.isFinite(v.pages)?v.pages+' pages · Google Drive original':(v.kind||'Reference').toUpperCase()+' · '+(v.productRows||0)+' product rows indexed'}</div></div>${sourceLink(v)}</div></div>`).join('')}</div><div class="subheading"><h2>Private workspace controls</h2></div><div class="candidate-row"><p>Selections and supplier files are stored <b>in this browser on this computer</b>. They are <b>not automatically shared</b> with other computers or staff who install this app. Brand workspaces are separate. Download a backup to preserve or transfer selections; secure team-wide synchronization is not connected yet.</p><div class="row-actions"><button class="btn secondary" data-action="backup">Download selection backup</button><label class="btn quiet">Restore backup<input type="file" id="restoreFile" accept="application/json,.json" style="display:none"></label><span class="tiny">Private supplier photo pack available to Super Admin in Google Drive.</span><label class="btn quiet">Update product photos / replace pack<input type="file" id="packFile" accept="application/json,.json" style="display:none"></label></div></div><p class="footer-note">Built for L'Imperial · Supplier catalog files remain in your private Drive folder. This app does not create official procurement POs or edit your Sales & Order Management system.</p>`}
function selectHTML(area,id,key,val,opts){return `<select data-edit="${area}" data-id="${q(id)}" data-key="${key}">${opts.map(x=>`<option ${x===val?'selected':''}>${q(x)}</option>`).join('')}</select>`}

const FAMILY_SHOW_ALL_VARIANTS=new Set();
// Collapse only genuinely repeated Asfour references in the display.
// Original records, edits, selections, and export source data remain unchanged.
function familyVariantRows(variants){
 if(ACTIVE_BRAND_ID!=='asfour')return {visible:variants,collapsed:0};
 const seen=new Set(),visible=[];let collapsed=0;
 const norm=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
 for(const v of variants){
  const entry=variantEntry(v),code=norm(entry.code||v.code);
  const size=norm(entry.targetSize||v.targetSize||v.originalSize||v.supplierSize||v.dimension);
  const changed=!!Object.keys(S.variants?.[v.id]||{}).length;
  const canGroup=!!code&&!v.isCustomProposal&&!v.id.startsWith('CUSTOM-')&&!changed&&
      !['Select','Approved'].includes(entry.decision);
  const key=canGroup?[norm(v.familyId),code,size,norm(entry.finish),norm(entry.crystal)].join('|'):null;
  if(key&&seen.has(key)){collapsed++;continue}
  if(key)seen.add(key);
  visible.push(v);
 }
 return {visible,collapsed};
}
function familyDrawer(id){const f=PACK.family.find(x=>x.id===id);if(!f)return;MODAL={type:'family',id};const variants=allVariants().filter(x=>x.familyId===id);
const grouped=familyVariantRows(variants),showAll=FAMILY_SHOW_ALL_VARIANTS.has(id),display=showAll?variants:grouped.visible;
const toggle=grouped.collapsed||showAll?'<button class="btn secondary small" data-action="toggleFamilyRepeats" data-id="'+q(id)+'">'+(showAll?'Hide repeated references':'Show all '+variants.length+' versions')+'</button>':'';
$('drawerContent').innerHTML=`<div class="drawer-header"><div><div class="tiny">${q(f.id)} · PREFERRED FAMILY</div><h2>${q(f.mainCode||f.name)}</h2></div><button class="close" data-action="close">×</button></div><div class="drawer-body"><div class="product-hero">${photo(f.sprite)}<div><p><b>Base design:</b> ${q(f.mainCode||'Unspecified')}</p>${window.LISelectionCosts?.listPriceMarkup?.(f.mainCode)||''}<p class="muted">All customer-proposed sizes are separate from the supplier's standard specifications.</p><div class="alert">A matching-looking wall lamp is a suggested family match only. Confirm its actual detailing and finish with ${q(brandNow().name)}.</div></div></div><div class="subheading"><h2>${display.length} family versions</h2>${toggle}<button class="btn secondary small" data-action="custom" data-id="${q(f.id)}">＋ Add custom version</button>${['Super Admin','Admin'].includes(window.LITeamSync?.getRoles?.()?.role)?`<button class="btn small" data-action="publishFamily" data-id="${q(f.id)}">${f.shared?'Update team family':'Publish for team'}</button>`:''}</div>${!showAll&&grouped.collapsed?'<p class="tiny">'+grouped.collapsed+' matching supplier references are collapsed here, not deleted. Edited and selected items stay visible.</p>':''}${display.map(v=>variantForm(v)).join('')}<div class="row-actions"><button class="btn quiet" data-action="close">Close family</button><button class="btn secondary" data-action="goto" data-to="order">See order preparation</button></div></div>`;showDrawer()}

async function publishFamilyForTeam(familyId){
  const role=window.LITeamSync?.getRoles?.()?.role;
  if(!['Super Admin','Admin'].includes(role))throw Error('Admin access required');
  if(window.LITeamSync?.status?.()?.connected!==true)throw Error('Supabase staff sign-in required');
  const family=PACK?.family?.find(f=>f.id===familyId);
  if(!family)throw Error('Family no longer exists');
  // Only family metadata goes to the private backend. Never sync individual
  // decisions, approval statuses, costs, full source documents or photo bytes.
  const variants=allVariants().filter(v=>v.familyId===familyId).map(v=>{
    const e=variantEntry(v);
    return {
      id:v.id,familyId:v.familyId,type:v.type,code:e.code||v.code,
      originalSize:v.originalSize||v.supplierSize||v.dimension,
      targetSize:e.targetSize||v.targetSize,finish:e.finish||v.finish,crystal:e.crystal||v.crystal,
      request:e.request||v.request,referenceKind:v.referenceKind,
      customCreated:!!v.customCreated,isCustomProposal:!!v.isCustomProposal,sprite:v.sprite
    };
  });
  if(!confirm('Publish '+(family.mainCode||family.name)+' and '+variants.length+' design versions to all approved staff? This will not publish supplier costs or individual selection decisions.'))return;
  await window.LITeamSync.request('publishFamily',{brandId:ACTIVE_BRAND_ID,
    family:{id:family.id,name:family.name,mainCode:family.mainCode,
      style:family.style,customCreated:!!family.customCreated,sprite:family.sprite},
    variants});
  family.shared=true;
  // Super Admin may have an unpublished private master catalog on this device.
  // Publishing a family must never replace that master with a remote copy.
  if(role==='Super Admin'&&ACTIVE_PACK?.metadata?.centralManaged!==true){
    await persistActivePack();
    await window.LITeamSync.refresh();
  }else{
    await window.LITeamSync.refresh();
    await window.LICentralCatalog.ensureBrand(ACTIVE_BRAND_ID,true);
  }
  toast('Shared design family published for approved staff');
  if(PACK?.family?.some(f=>f.id===familyId))familyDrawer(familyId);
  else{closeDrawer();renderFamilies();}
}
function variantForm(v){const e=variantEntry(v),custom=v.isCustomProposal,previous=(PACK.history||[]).filter(x=>x.code===e.code);return `<div class="variant-row"><div class="variant-top"><div><b>${q(v.type)}</b><div class="tiny">${q(v.referenceKind||'Custom version')}${previous.length?' · Appears in previous orders (stock not confirmed)':''}</div></div><span class="pill ${custom?'warn':'gold'}">${custom?'Custom proposal':'Supplier reference'}</span></div><div style="display:flex;gap:14px;margin-top:10px"><div class="mini-photo" style="height:92px;width:92px">${sprite(v.sprite)}</div><div class="tiny" style="flex:1"><div>${q(v.sourceRef||'User-added variant')}</div><div>Supplier code: ${q(v.code||'Not assigned')}</div>${window.LISelectionCosts?.listPriceMarkup?.(e.code||v.code)||''}<div>${q(v.spec||'')}</div></div></div><div class="variant-fields"><div class="field"><label>Decision</label>${selectHTML('variant',v.id,'decision',e.decision,['Review','Select','Skip','Approved'])}</div><div class="field"><label>Supplier status</label>${selectHTML('variant',v.id,'supplierStatus',e.supplierStatus,['Not requested','Quote requested','Confirmed','Not possible'])}</div><div class="field"><label>Reference / confirmed code</label><input data-edit="variant" data-id="${q(v.id)}" data-key="code" value="${q(e.code)}" placeholder="Supplier code"></div><div class="field"><label>Original reference size</label><input value="${q(v.originalSize||v.supplierSize||v.dimension||'Not specified')}" readonly aria-label="Original reference size"></div><div class="field"><label>Requested size (custom)</label><input data-edit="variant" data-id="${q(v.id)}" data-key="targetSize" value="${q(e.targetSize)}" placeholder="L × W × H cm"></div><div class="field"><label>Finish</label><input data-edit="variant" data-id="${q(v.id)}" data-key="finish" value="${q(e.finish)}"></div><div class="field"><label>Crystal</label><input data-edit="variant" data-id="${q(v.id)}" data-key="crystal" value="${q(e.crystal)}"></div><div class="field"><label>Qty (after selection)</label><input type="number" min="0" data-edit="variant" data-id="${q(v.id)}" data-key="qty" value="${q(e.qty)}"></div><div class="field span2"><label>Custom design instructions / changes</label><textarea rows="2" data-edit="variant" data-id="${q(v.id)}" data-key="request">${q(e.request)}</textarea></div></div>${v.id.startsWith('CUSTOM-')?`<button class="btn danger small" data-action="removeCustom" data-id="${q(v.id)}">Delete custom version</button>`:''}</div>`}
function splitPageTools(i){
  if(!i||i.code||!i.sprite)return '';
  const parentId=i.splitParentId||i.id;
  const original=PACK.items.find(x=>x.id===parentId&&!x.splitGenerated);
  if(!original)return '';
  const current=original.splitParent?'Current: '+original.splitLayout:'Currently one catalog-page reference';
  const options=[['h2','2 stacked'],['h3','3 stacked'],['v2','2 side by side'],['v3','3 side by side'],['g4','4 in a grid'],['none','Keep original page']];
  return `<div class="candidate-row"><h3>Individual designs on this page</h3><p class="tiny">${q(current)}. Split or adjust the layout when the catalog page shows several products. Each resulting design can be selected independently.</p><div class="split-layout-tools">${options.map(([value,label])=>`<button type="button" class="btn ${original.splitLayout===value||(!original.splitParent&&value==='none')?'':'quiet'} small" data-action="splitPage" data-id="${q(parentId)}" data-layout="${value}">${label}</button>`).join('')}</div><p class="tiny">The exact supplier codes and dimensions are not verified from image-only pages. Your existing selections are never deleted automatically.</p></div>`;
}

function itemDrawer(id){const i=catalogItemForSelection(id);if(!i)return;MODAL={type:'item',id};const s=candidateEntry(i),src=PACK.sources[i.source],tlPage=ACTIVE_BRAND_ID==='tl'&&(!!i.tlPageReference||(i.source==='tl-chandelier'&&!i.code)),previous=(PACK.history||[]).filter(x=>x.code===i.code);$('drawerContent').innerHTML=`<div class="drawer-header"><div><div class="tiny">${q(src?.name||'Manual product')} ${i.page?'· PDF page '+q(i.page):''}</div><h2>${q(i.code||'Visual catalog reference')}</h2></div><button class="close" data-action="close">×</button></div><div class="drawer-body"><div class="product-hero">${photo(i.sprite)}<div><p><b>${q(i.name)}</b></p>${window.LISelectionCosts?.listPriceMarkup?.(i.code)||''}<p class="muted">${q(i.dimension||'Dimensions: supplier verification needed')}</p><p><span class="pill ${i.code?'green':'warn'}">${q(i.verification)}</span></p>${previous.length?'<p class="pill warn">Previously ordered — check stock before reordering</p>':''}<p>${sourceLink(src||{})}${i.page?' · Page '+q(i.page):''}</p>${ACTIVE_BRAND_ID==='asfour'?'':`<div class="row-actions"><label class="btn secondary small">${i.sprite?'Change product photo':'＋ Add product photo'}<input type="file" data-action="productPhoto" data-id="${q(i.id)}" accept="image/png,image/jpeg,image/webp" style="display:none"></label></div>`}</div></div><div class="alert">${i.photoKind==='user-photo'?'Image uploaded for this brand; verify the supplier code and requested finish.':i.photoKind==='supplier-photo'?'Photo cropped from the supplier-code row; crystal and finish variants may share the same reference picture.':i.photoKind==='catalog-crop'?'This is one visual design cropped from a multi-product catalog page. Confirm its exact supplier code, finish and size with the supplier.':'No individually verified product photo. Add one manually or check the original catalog.'}</div>${i.splitGenerated?'<h3>Original catalog page</h3>'+photo(i.pageSprite,'preview')+'<p class="tiny">The full page is retained here to verify the source and product references.</p>':''}${tlPage?'<p class="tiny">Original catalog page for visual reference. Open Individual products in Discover to select a specific model.</p>':splitPageTools(i)}
 ${tlPage?'':'<h3>Prepare this candidate</h3>'+candidateCard(i)}
 <div class="row-actions">${tlPage?'':`<button type="button" class="btn ${selectionForItem(i.id)||S.shortlist.includes(i.id)?'catalog-selected-btn':'secondary'}" data-action="shortlist" data-id="${q(i.id)}" aria-pressed="${selectionForItem(i.id)||S.shortlist.includes(i.id)?'true':'false'}" title="${selectionForItem(i.id)||S.shortlist.includes(i.id)?'Click to unselect':'Add to My selections'}">${selectionForItem(i.id)||S.shortlist.includes(i.id)?'× Unselect':'＋ Add to selections'}</button>`}<button class="btn quiet" data-action="close">Close</button></div></div>`;showDrawer()}
function customDrawer(id){const f=PACK.family.find(x=>x.id===id);MODAL={type:'custom',id};$('drawerContent').innerHTML=`<div class="drawer-header"><h2>New custom version · ${q(id)}</h2><button class="close" data-action="close">×</button></div><div class="drawer-body"><p class="muted">This creates a proposed version under ${q(f?.mainCode||id)}. It is <b>not</b> confirmed by ${q(brandNow().name)}.</p><form id="newCustomForm"><div class="variant-fields"><div class="field span2"><label>Version type</label><select name="type" required><option>XL chandelier</option><option>Large chandelier</option><option>Medium chandelier</option><option>Linear chandelier</option><option>Wall lamp</option><option>Floor lamp</option><option>Table lamp</option><option>Other</option></select></div><div class="field"><label>Requested size</label><input name="size" required placeholder="L150 × W40 × H80 cm"></div><div class="field"><label>Original reference code</label><input name="code" value="${q(f?.mainCode||'')}" placeholder="Reference, not final code"></div><div class="field span2"><label>Design modifications</label><textarea name="request" placeholder="Matching arms, number of tiers, gold finish, crystal type…" required></textarea></div></div><div class="row-actions"><button class="btn" type="submit">Create custom version</button></div></form></div>`;showDrawer()}
function compareDrawer(){const a=S.compare.slice(0,2).map(id=>PACK.items.find(x=>x.id===id)).filter(Boolean);if(a.length!==2){toast('Select two catalog candidates to compare');return}MODAL={type:'compare'};$('drawerContent').innerHTML=`<div class="drawer-header"><h2>Compare two designs</h2><button class="close" data-action="close">×</button></div><div class="drawer-body"><div class="compare-grid">${a.map(i=>`<div>${photo(i.sprite)}<p><b>${q(i.code||i.name)}</b></p><p class="tiny">${q(i.dimension||'Size not confirmed')} · ${q(PACK.sources[i.source]?.name||'Supplier catalog')}</p><p>${ACTIVE_BRAND_ID==='asfour'&&i.source==='price'?'<span class="tiny">Supplier reference · original price-list PDF not available in this app</span>':sourceLink(PACK.sources[i.source]||{})}</p></div>`).join('')}</div><div class="alert">Please compare design, room suitability, matching variants and visual similarity. Supplier availability is not implied.</div></div>`;showDrawer()}
function showDrawer(){$('overlay').classList.remove('hidden');document.body.style.overflow='hidden'}function closeDrawer(){$('overlay').classList.add('hidden');document.body.style.overflow='';MODAL=null}
function download(name,text,type='application/json'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000)}
function backup(){download('LImperial_'+brandNow().name.replace(/[^a-z0-9-]/gi,'_')+'_Selections_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({format:'limperial-selection-backup',version:2,brandId:ACTIVE_BRAND_ID,brandName:brandNow().name,when:new Date().toISOString(),state:S},null,2));toast('Selection backup downloaded for '+brandNow().name)}
async function restore(file){try{const b=JSON.parse(await file.text());if(b.format!=='limperial-selection-backup'||!b.state)throw Error('Invalid selection backup');if((b.brandId||'asfour')!==ACTIVE_BRAND_ID)throw Error('Backup is for another brand. Open that brand first.');if(!confirm('Replace the selections stored on this browser with the backup?'))return;S=b.state;save();render();toast('Selections restored')}catch(e){alert('Restore failed: '+e.message)}}
function draftRows(){const chosen=['Select','Approved'];return [...allVariants().filter(v=>chosen.includes(variantEntry(v).decision)).map(item=>({id:item.id,item,entry:variantEntry(item),family:item.familyId})),...candidates().filter(i=>chosen.includes(candidateEntry(i).decision)).map(item=>({id:item.id,item,entry:candidateEntry(item),family:'CATALOG'}))]}

function visibleFamilyExportData(){
  const matching=String(SEARCH||'').trim().toLowerCase();
  const families=(PACK?.family||[]).filter(f=>!matching||[f.id,f.name,f.mainCode].join(' ').toLowerCase().includes(matching));
  const ids=new Set(families.map(f=>f.id));
  const candidates=allVariants().filter(v=>ids.has(v.familyId));
  const versions=ACTIVE_BRAND_ID==='asfour'?families.flatMap(f=>{
    const sameFamily=candidates.filter(v=>v.familyId===f.id);
    return FAMILY_SHOW_ALL_VARIANTS.has(f.id)?sameFamily:familyVariantRows(sameFamily).visible;
  }):candidates;
  return {families,versions};
}
function safeExportFileBase(){
  return 'LImperial_'+String(brandNow().name||'Supplier').replace(/[^a-z0-9_-]/gi,'_')+'_Design_Families_'+new Date().toISOString().slice(0,10);
}
function safeCsvCell(value){
  let s=String(value??'');
  // Avoid imported supplier text becoming spreadsheet formulas.
  if(/^\s*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
function exportFamiliesCsv(families,versions,withCost=false,costData=[]){
  const byFamily=new Map();
  for(const v of versions){if(!byFamily.has(v.familyId))byFamily.set(v.familyId,[]);byFamily.get(v.familyId).push(v)}
  const headers=['Family ID','Family name / main code','Family type','Version type','Reference code','Original reference size','Requested size','Finish','Crystal','Decision','Supplier status','Qty','Custom request'];
  if(withCost)headers.push('Unit Cost','Total Cost');
  const rows=[headers],costById=new Map(versions.map((v,i)=>[v.id,costData[i]]));
  for(const f of families){
    const variants=byFamily.get(f.id)||[null];
    for(const v of variants){
      const e=v?variantEntry(v):null;
      const row=[f.id,f.mainCode||f.name,f.style||'Preferred design',v?.type||'',e?.code||v?.code||'',v?.originalSize||v?.supplierSize||v?.dimension||'',e?.targetSize||'',e?.finish||'',e?.crystal||'',e?.decision||'',e?.supplierStatus||'',e?.qty??'',e?.request||''];
      if(withCost){
        const cost=v?costById.get(v.id):null,unit=cost?Number(cost.unit_cost):null,qty=Number(e?.qty);
        row.push(cost&&Number.isFinite(unit)?unit:'',cost&&Number.isFinite(unit)&&Number.isFinite(qty)?Number((unit*qty).toFixed(4)):'');
      }
      rows.push(row);
    }
  }
  download(safeExportFileBase()+(withCost?'_With_Cost':'')+'.csv','\uFEFF'+rows.map(r=>r.map(safeCsvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
let exportingFamiliesExcel=false;
async function exportFamiliesExcel(withCost=false){
  if(!window.LITeamSync?.status()?.connected)return toast('Sign in to export Design families');
  if(exportingFamiliesExcel)return;
  const {families,versions}=visibleFamilyExportData();
  if(!families.length)return toast('No design families match the current search');
  if(withCost){
    if(!['Super Admin','Admin'].includes(window.LITeamSync?.getRoles?.()?.role))return toast('Admin access required.');
    if(!window.LISelectionCosts||!(await window.LISelectionCosts.requireAdmin()))return;
  }
  const btn=document.querySelector(withCost?'[data-action="exportFamiliesWithCost"]':'[data-action="exportFamilies"]');
  const label=btn?.textContent||'⬇ Export Excel';
  exportingFamiliesExcel=true;
  let costData=null;
  if(btn){btn.disabled=true;btn.textContent='Preparing Excel…'}
  try{
    // Staff exports never load or serialize confidential supplier-cost data.
    if(withCost)costData=await window.LISelectionCosts.lookup(versions.map(v=>({
      brandId:ACTIVE_BRAND_ID,kind:'variant',itemId:v.id,entry:variantEntry(v)
    })));
    if(!window.ExcelJS){
      exportFamiliesCsv(families,versions,withCost,costData||[]);
      toast('Excel library unavailable; downloaded CSV without photos');
      return;
    }
    const book=new window.ExcelJS.Workbook();
    book.creator="L'Imperial Product Selection Studio";
    const navy={argb:'FF13233A'},white={argb:'FFFFFFFF'},ink={argb:'FF213951'},line={argb:'FFE5E3DF'};
    const sheet=(name,headers,widths)=>{
      const ws=book.addWorksheet(name,{views:[{state:'frozen',ySplit:3}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1}});
      ws.columns=widths.map(width=>({width}));
      const max=String.fromCharCode(64+headers.length);
      ws.mergeCells('A1:'+max+'1');
      const h=ws.getCell('A1');
      h.value="L'IMPERIAL · "+brandNow().name.toUpperCase()+" · "+name.toUpperCase();
      h.font={bold:true,size:15,color:white};
      h.fill={type:'pattern',pattern:'solid',fgColor:navy};
      ws.getRow(1).height=34;
      ws.mergeCells('A2:'+max+'2');
      const info=ws.getCell('A2');
      info.value=withCost?'Confidential Admin cost export · Not a purchase order':'Reference only · Photos from the authorized catalog · Supplier prices excluded · Not a purchase order';
      info.font={italic:true,size:10,color:{argb:'FF65748A'}};
      ws.getRow(2).height=22;
      ws.getRow(3).values=headers;
      ws.getRow(3).font={bold:true,size:10,color:ink};
      ws.getRow(3).height=27;
      ws.autoFilter={from:{row:3,column:1},to:{row:3,column:headers.length}};
      return ws;
    };
    const fam=sheet('Design Families',
      ['No.','Family photo','Family ID','Main code / name','Family style','Variants','Selected / approved'],
      [7,24,17,31,27,13,22]);
    const ver=sheet('Family Versions',
      ['No.','Photo','Family ID','Main family code','Version type','Reference code','Original size','Requested size','Finish','Crystal','Decision','Supplier status','Qty','Custom instructions',
       ...(withCost?['Unit Cost','Total Cost']:[])],
      [7,24,16,27,25,27,25,24,19,18,17,20,9,46,...(withCost?[16,18]:[])]);
    const familyMap=new Map(families.map(f=>[f.id,f]));
    const versionCount=new Map(),chosenCount=new Map();
    for(const v of versions){
      versionCount.set(v.familyId,(versionCount.get(v.familyId)||0)+1);
      if(['Select','Approved'].includes(variantEntry(v).decision))
        chosenCount.set(v.familyId,(chosenCount.get(v.familyId)||0)+1);
    }
    const addPhoto=async(ws,rowIndex,sprite,column,width=104,height=104)=>{
      if(!sprite){ws.getCell(rowIndex,column).value='Photo unavailable';return}
      try{
        const png=await imageFromSprite(sprite);
        if(!png){ws.getCell(rowIndex,column).value='Photo unavailable';return}
        const id=book.addImage({base64:png,extension:'png'});
        ws.addImage(id,{tl:{col:column-1+0.08,row:rowIndex-1+0.05},ext:{width,height},editAs:'oneCell'});
      }catch(_){ws.getCell(rowIndex,column).value='Photo unavailable'}
    };
    const finishRow=(ws,rowIndex,columns)=>{
      const row=ws.getRow(rowIndex);
      row.height=84;
      row.alignment={vertical:'middle',wrapText:true};
      for(let column=1;column<=columns;column++){
        const cell=ws.getCell(rowIndex,column);
        cell.border={bottom:{style:'thin',color:line}};
      }
      if(rowIndex%2===0){
        for(let column=1;column<=columns;column++){
          ws.getCell(rowIndex,column).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF9F8F5'}};
        }
      }
    };
    for(let n=0;n<families.length;n++){
      const f=families[n],i=n+4;
      fam.getRow(i).values=[n+1,'',f.id,f.mainCode||f.name,f.style||'Preferred design',
        versionCount.get(f.id)||0,chosenCount.get(f.id)||0];
      finishRow(fam,i,7);
      await addPhoto(fam,i,f.sprite,2,105,105);
    }
    for(let n=0;n<versions.length;n++){
      const v=versions[n],i=n+4,e=variantEntry(v),f=familyMap.get(v.familyId);
      ver.getRow(i).values=[n+1,'',v.familyId,f?.mainCode||f?.name||'',
        v.type||'',e.code||v.code||'',
        v.originalSize||v.supplierSize||v.dimension||'',
        e.targetSize||'',e.finish||'',e.crystal||'',e.decision||'Review',
        e.supplierStatus||'Not requested',e.qty??0,e.request||''];
      if(withCost){
        const cost=costData[n],amount=cost?Number(cost.unit_cost):null,qty=Number(e.qty);
        ver.getCell(i,15).value=cost&&Number.isFinite(amount)?amount:null;
        ver.getCell(i,16).value=cost&&Number.isFinite(amount)&&Number.isFinite(qty)?Number((amount*qty).toFixed(4)):null;
        ver.getCell(i,15).numFmt='"$"#,##0.00';
        ver.getCell(i,16).numFmt='"$"#,##0.00';
      }
      finishRow(ver,i,withCost?16:14);
      await addPhoto(ver,i,v.sprite||f?.sprite,2,105,105);
    }
    const data=await book.xlsx.writeBuffer();
    const blob=new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=safeExportFileBase()+(withCost?'_With_Cost':'')+'.xlsx';
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
    toast('Exported '+families.length+' families and '+versions.length+' versions with photos');
  }catch(err){
    console.error('Design families export failed',err);
    if(withCost&&!costData)toast('Secure cost lookup failed; no cost export was generated.');
    else {exportFamiliesCsv(families,versions,withCost,costData||[]);toast('Excel export failed; downloaded CSV without photos')}
  }finally{
    exportingFamiliesExcel=false;
    if(btn){btn.disabled=false;btn.textContent=label}
  }
}
function exportDraftCsv(rows){
  // CSV cannot embed product photos, but uses the same six informational fields as the Excel export.
  const header=['No.','Code','Original size','Requested size','Qty','Crystal / finish','Custom request'];
  const body=rows.map((r,i)=>{
    const e=r.entry;
    return [i+1,e.code||'Custom reference pending',originalSizeFor(r),requestedSizeFor(r),e.qty??'',[e.crystal,e.finish].filter(Boolean).join(' / '),e.request||''];
  });
  const csv=[header,...body].map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
  download(brandNow().name.replace(/[^a-z0-9-]/gi,'_')+'_Draft_Selections.csv',csv,'text/csv;charset=utf-8');
}
async function exportDraft(){
  const rows=draftRows();
  if(!rows.length){toast('Select a product first to download a draft');return;}
  if(!window.ExcelJS){exportDraftCsv(rows);toast('Excel library unavailable; downloaded CSV draft instead');return;}
  try{
    const book=new ExcelJS.Workbook();
    book.creator="L'Imperial Product Selection Studio";
    const ws=book.addWorksheet('Draft Selections',{views:[{state:'frozen',ySplit:2}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1}});
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value="L'IMPERIAL · "+brandNow().name.toUpperCase()+" DRAFT SELECTION — NOT A PURCHASE ORDER";
    ws.getCell('A1').font={bold:true,size:14,color:{argb:'FFFFFFFF'}};
    ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF13233A'}};
    ws.getRow(1).height=36;
    ws.getRow(2).values=['No.','Product photo','Code','Original size','Requested size','Qty','Crystal / finish','Custom request'];
    ws.getRow(2).font={bold:true,color:{argb:'FF1E324D'}};
    ws.getRow(2).height=30;
    ws.columns=[{width:7},{width:24},{width:28},{width:24},{width:24},{width:10},{width:25},{width:48}];
    for(let n=0;n<rows.length;n++){
      const r=rows[n],i=n+3,e=r.entry,row=ws.getRow(i);
      row.values=[n+1,'',e.code||'Custom reference pending',originalSizeFor(r),requestedSizeFor(r),e.qty??'',[e.crystal,e.finish].filter(Boolean).join(' / '),e.request||''];
      row.height=108;
      row.alignment={vertical:'middle',wrapText:true};
      for(let c=1;c<=8;c++)ws.getCell(i,c).border={bottom:{style:'thin',color:{argb:'FFE5E3DF'}}};
      try{
        const pic=await imageFromSprite(r.item.sprite);
        if(pic){
          const picId=book.addImage({base64:pic,extension:'png'});
          ws.addImage(picId,{tl:{col:1.15,row:i-1+0.05},ext:{width:122,height:122},editAs:'oneCell'});
        }else ws.getCell(i,2).value='Photo unavailable';
      }catch(err){ws.getCell(i,2).value='Photo unavailable'}
    }
    const buf=await book.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;
    a.download=brandNow().name.replace(/[^a-z0-9-]/gi,'_')+'_Draft_Selections_'+new Date().toISOString().slice(0,10)+'.xlsx';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
    toast('Downloaded '+rows.length+' draft selections with product photos');
  }catch(err){
    console.error('Draft export error',err);
    exportDraftCsv(rows);
    toast('Excel export failed; downloaded CSV draft instead');
  }
}
function exportCsv(){const rows=orderRows(),header=['No.','Item Description','Qty','Crystal','Photo Reference','Supplier remarks'];const body=rows.map((r,i)=>[i+1,description(r),r.entry.qty,r.entry.crystal,refLabel(r),r.entry.request]);const csv=[header,...body].map(a=>a.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');download(brandNow().name.replace(/[^a-z0-9-]/gi,'_')+'_Supplier_Order.csv',csv,'text/csv');}
function description(r){const e=r.entry,it=r.item,original=originalSizeFor(r),requested=requestedSizeFor(r);return [e.code,original?'Original size: '+original:'',requested?'Requested size: '+requested:'',e.finish?'Finishing: '+e.finish:'',e.crystal?'Crystal: '+e.crystal:'',it.spec||'',it.isCustomProposal?'CUSTOM SIZE REQUEST - confirm before manufacture':''].filter(Boolean).join('\n')}
function refLabel(r){const it=r.item;return it.sourceRef||((it.source||'catalog')+' · page '+(it.page||'?'))}
const imgCache={};async function imageFromSprite(s,urlMap=SPRITES){if(s?.data){const image=new Image();image.src=s.data;return image.decode().then(()=>{const can=document.createElement('canvas');can.width=235;can.height=235;can.getContext('2d').drawImage(image,0,0,235,235);return can.toDataURL('image/png')})}if(!s||!urlMap[s.atlas])return null;const key=urlMap[s.atlas]+'#'+s.index+(s.crop?'#'+[s.crop.cols,s.crop.rows,s.crop.col,s.crop.row].join(':'):'')+(s.cropRect?'#TL:'+s.cropRect.join(':'):'');if(imgCache[key])return imgCache[key];const img=new Image();img.src=urlMap[s.atlas];await img.decode();const w=img.naturalWidth/4,h=img.naturalHeight/4,can=document.createElement('canvas');can.width=235;can.height=235;const ctx=can.getContext('2d');ctx.fillStyle='#f2f0ed';ctx.fillRect(0,0,235,235);const crop=window.LICatalogSplit?.image(s);const cols=crop?.cols||1,rows=crop?.rows||1,col=crop?.col||0,row=crop?.row||0;const sw=w/cols,sh=h/rows,ratio=Math.min(235/sw,235/sh),dw=sw*ratio,dh=sh*ratio;ctx.drawImage(img,(s.index%4+col/cols)*w,(Math.floor(s.index/4)+row/rows)*h,sw,sh,(235-dw)/2,(235-dh)/2,dw,dh);return imgCache[key]=can.toDataURL('image/png')}
async function exportExcel(){const rows=orderRows();if(!rows.length)return toast('Approve and confirm products first');if(!window.ExcelJS){if(confirm('Excel photo exporter is unavailable (check internet connection). Download a CSV without embedded pictures instead?'))exportCsv();return}const book=new ExcelJS.Workbook();book.creator="L'Imperial Product Selection Studio";const ws=book.addWorksheet((brandNow().name.replace(/[\\/:*?\[\]]/g,'').slice(0,18)||'Supplier')+' Order',{views:[{state:'frozen',ySplit:2}],pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1}});ws.mergeCells('A1:F1');ws.getCell('A1').value="L'IMPERIAL · "+brandNow().name.toUpperCase()+" SUPPLIER ORDER";ws.getCell('A1').font={bold:true,size:16,color:{argb:'FFFFFFFF'}};ws.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF13233A'}};ws.getRow(1).height=35;ws.getRow(2).values=['No.','Item Description','Qty','Crystal','Photo Reference','Supplier remarks'];ws.getRow(2).font={bold:true,color:{argb:'FF1E324D'}};ws.getRow(2).height=28;ws.columns=[{width:7},{width:42},{width:10},{width:16},{width:25},{width:34}];for(let n=0;n<rows.length;n++){const r=rows[n],ix=n+3;let obj=ws.getRow(ix);obj.values=[n+1,description(r),Number(r.entry.qty),r.entry.crystal,'',r.entry.request||''];obj.height=112;obj.alignment={vertical:'middle',wrapText:true};for(let c=1;c<=6;c++){ws.getCell(ix,c).border={bottom:{style:'thin',color:{argb:'FFE5E3DF'}}};}try{let pic=await imageFromSprite(r.item.sprite);if(pic){const picId=book.addImage({base64:pic,extension:'png'});ws.addImage(picId,{tl:{col:4.17,row:ix-1+0.08},ext:{width:132,height:132},editAs:'oneCell'});}}catch(e){ws.getCell(ix,5).value='Photo reference: '+refLabel(r)}ws.getCell(ix,6).value=[r.entry.request,r.item.isCustomProposal?'CUSTOMIZATION MUST BE CONFIRMED':'',r.item.code?'':'Verify code/photo against catalog',refLabel(r)].filter(Boolean).join('\n');}
const info=book.addWorksheet('Source & confirmation');info.columns=[{width:12},{width:28},{width:32},{width:24},{width:65}];info.addRow(['No.','Code','Status','Source','Catalog Drive URL']);for(let n=0;n<rows.length;n++){const r=rows[n],src=r.item.source?PACK.sources[r.item.source]:null;info.addRow([n+1,r.entry.code,'Approved / Confirmed',refLabel(r),src?.url||src?.name||'Manual supplier reference'])}const buf=await book.xlsx.writeBuffer(),blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=brandNow().name.replace(/[^a-z0-9-]/gi,'_')+'_Supplier_Order_'+new Date().toISOString().slice(0,10)+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast(`Exported ${rows.length} products with reference images`)}
// Basic event delegation: state changes always persisted before re-render.
document.addEventListener('click',async e=>{if(!window.LITeamSync?.status()?.connected)return;const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action,id=b.dataset.id;switch(a){case 'goto':closeDrawer();setView(b.dataset.to);break;case 'chooseBrand':closeDrawer();try{await switchBrand(id)}catch(err){alert('Unable to open brand: '+err.message)}break;case 'addBrand':setView('brand-add');break;case 'newManualItem':newManualItem();break;case 'loadCentralCatalog':window.LICentralCatalog?.ensureBrand(id,true).catch(err=>alert('Catalog could not be loaded: '+err.message));break;case 'newFamily':newFamilyDrawer();break;case 'toggleAsfourListPrices':try{if(ACTIVE_BRAND_ID!=='asfour')break;await window.LISelectionCosts?.toggleAsfourListPrices?.([...new Set([...(PACK?.items||[]).map(x=>x.code),...allVariants().map(v=>variantEntry(v).code)].filter(Boolean))],render)}catch(err){alert(err.message)}break;case 'publishFamily':try{await publishFamilyForTeam(id)}catch(err){alert('Could not publish shared family: '+err.message)}break;case 'exportBrandCatalog':exportBrandCatalog();break;case 'openSource':await openSourceFile(id);break;case 'more':{
  e.preventDefault();
  const items=filteredCatalogItems(),from=LIMIT,to=Math.min(from+48,items.length);
  if(to<=from){b.closest('.catalog-more')?.remove();break;}
  const grid=$('app').querySelector('.cards');
  if(!grid){LIMIT=to;renderDiscover();break;}
  // Browsers may anchor the viewport to the "Load more" button and follow it
  // to the new bottom as the grid grows. Keep the user's exact scroll position.
  const scroller=document.scrollingElement||document.documentElement;
  const savedY=window.scrollY??window.pageYOffset??scroller.scrollTop??0;
  const savedX=window.scrollX??window.pageXOffset??0;
  b.blur();
  grid.insertAdjacentHTML('beforeend',items.slice(from,to).map(i=>catalogCard(i)).join(''));
  LIMIT=to;
  const remaining=items.length-LIMIT;
  if(remaining>0)b.textContent=`Load more (${Math.min(48,remaining)})`;
  else b.closest('.catalog-more')?.remove();
  const keepViewport=()=>{
    // No smooth animation and no auto jump to any product or button.
    if(Math.abs((window.scrollY??scroller.scrollTop)-savedY)>1)window.scrollTo(savedX,savedY);
    if(scroller.scrollTop!==savedY)scroller.scrollTop=savedY;
  };
  keepViewport();
  requestAnimationFrame(keepViewport);
  break;
}case 'splitPage':{const layout=b.dataset.layout||'none';const prefix=id+'--design-';if(Object.keys(S.catalog).some(k=>k.startsWith(prefix))){alert('This page has individually selected products. Remove those selections before changing its layout, so their identities are not mixed up.');break;}try{window.LICatalogSplit.setLayout(ACTIVE_PACK,ACTIVE_BRAND_ID,id,layout);closeDrawer();render();toast('Catalog designs updated. Each design can now be selected separately.')}catch(err){alert('Unable to split catalog page: '+err.message)}break;}case 'item':itemDrawer(id);break;case 'family':familyDrawer(id);break;case 'toggleFamilyRepeats':{if(FAMILY_SHOW_ALL_VARIANTS.has(id))FAMILY_SHOW_ALL_VARIANTS.delete(id);else FAMILY_SHOW_ALL_VARIANTS.add(id);familyDrawer(id);break}case 'custom':customDrawer(id);break;case 'close':closeDrawer();break;case 'shortlist':{if(ACTIVE_BRAND_ID==='tl'&&PACK?.items?.some(x=>x.id===id&&(x.tlPageReference||(x.source==='tl-chandelier'&&!x.code)))){toast('Original pages are references. Select an individual model in Discover.');break}if(!selectionForItem(id)&&!S.shortlist.includes(id)){const item=catalogItemForSelection(id);if(!item){toast('Catalog product unavailable');break}S.catalog[id]={...candidateEntry(item),decision:'Select',qty:1,roundId:chosenRoundId()==='all'?'round-1':chosenRoundId()};if(!S.shortlist.includes(id))S.shortlist.push(id)}else{
 const entry=selectionForItem(id);
 const isReviewed=entry?.decision==='Approved'||entry?.supplierStatus==='Confirmed';
 const item=catalogItemForSelection(id);
 const product=String(item?.code||item?.name||'this product');
 const msg=isReviewed
  ?'This selection has an approval or supplier confirmation. Unselect '+product+'? This removes your own selection and requests removal of its Team Selection record. Other copies remain unchanged.'
  :'Unselect '+product+' from My selections? This also requests removal of your corresponding Team Selection record, if one exists.';
 if(!confirm(msg))break;
 if(entry)await window.LITeamSync?.itemRemoved('catalog',id);
 if(isCatalogCopy(id))delete S.catalogDuplicates[id];else delete S.catalog[id];
 S.shortlist=S.shortlist.filter(x=>x!==id);
 S.compare=S.compare.filter(x=>x!==id);
 save();
 toast('Unselected · removed from My selections');
 if(MODAL?.type==='item')itemDrawer(id);else render();
 break;
}save();window.LITeamSync?.itemChanged('catalog',id);toast('Added to selections locally');if(MODAL?.type==='item')itemDrawer(id);else render();break;}case 'newSelectionRound':createSelectionRound();break;case 'renameSelectionRound':renameSelectionRound();break;case 'duplicateCandidate':duplicateCatalogSelection(id);break;case 'removeCandidate':if(!confirm('Remove this selection? Other copies of the same product will remain.'))return;window.LITeamSync?.itemRemoved('catalog',id);if(isCatalogCopy(id))delete S.catalogDuplicates[id];else delete S.catalog[id];S.shortlist=S.shortlist.filter(x=>x!==id);S.compare=S.compare.filter(x=>x!==id);save();if(MODAL?.type==='item')closeDrawer();render();break;case 'removeCustom':if(!confirm('Delete this custom proposal?'))return;S.manual=S.manual.filter(v=>v.id!==id);delete S.variants[id];save();familyDrawer(MODAL.id);break;case 'backup':backup();break;case 'exportDraft':await exportDraft();break;case 'exportFamilies':await exportFamiliesExcel(false);break;case 'exportFamiliesWithCost':await exportFamiliesExcel(true);break;case 'exportExcel':try{await exportExcel()}catch(err){console.error('Supplier order export failed',err);alert('Excel export failed. Please use Download draft selections or try again.')}break;case 'openDrive':window.open('https://docs.google.com/spreadsheets/d/1ytiY9BOiSeNvE0sV94RzHoKUFzOCW6EQRSpJx1XgwCw/edit?gid=1628514328#gid=1628514328','_blank','noopener');break;}});
document.addEventListener('change',async e=>{if(!window.LITeamSync?.status()?.connected)return;const t=e.target;if(t.id==='packFile'&&t.files[0]){await importCatalog(t.files[0]);t.value='';return}if(t.id==='restoreFile'&&t.files[0]){await restore(t.files[0]);t.value='';return}if(t.id==='brandCatalogFiles'&&t.files.length){await uploadBrandFiles(t.files);t.value='';return}if(t.dataset.action==='productPhoto'&&t.files[0]){try{await updateManualProductPhoto(t.dataset.id,t.files[0])}catch(err){alert('Photo upload failed: '+err.message)}t.value='';return}if(t.id==='selectionRoundsActive'){S.activeRoundId=t.value==='all'?'all':selectionRounds().some(r=>r.id===t.value)?t.value:'round-1';save();render();return}
if(t.dataset.roundKind){
 const kind=t.dataset.roundKind,id=t.dataset.id;
 const roundId=selectionRounds().some(r=>r.id===t.value)?t.value:'round-1';
 if(kind==='catalog'){
  const collection=isCatalogCopy(id)?'catalogDuplicates':'catalog';
  const entry=S[collection]?.[id];if(!entry)return;
  entry.roundId=roundId;
 }else if(kind==='variant'){
  if(!S.variants[id])S.variants[id]={};
  S.variants[id].roundId=roundId;
 }else return;
 save();window.LITeamSync?.itemChanged(kind,id);renderSelected();toast('Moved to '+roundName(roundId));return;
}
if(t.id==='srcFilter'){SRC=t.value;LIMIT=48;renderDiscover();return}if(t.id==='kindFilter'){KIND=t.value;LIMIT=48;renderDiscover();return}if(t.id==='asfourReferenceFilter'){ASFOUR_REFERENCE_FILTER=['products','information','all'].includes(t.value)?t.value:'products';LIMIT=48;renderDiscover();return}if(t.id==='tlCatalogView'){TL_CATALOG_VIEW=t.value==='pages'?'pages':'products';KIND='all';LIMIT=48;renderDiscover();return}if(t.dataset.action==='compare'){const id=t.dataset.id;S.compare=t.checked?[...S.compare.filter(x=>x!==id),id].slice(-2):S.compare.filter(x=>x!==id);save();if(S.compare.length===2){compareDrawer()}return}if(t.dataset.edit){let collection=t.dataset.edit==='catalog'?(isCatalogCopy(t.dataset.id)?'catalogDuplicates':'catalog'):'variants';if(!S[collection][t.dataset.id])S[collection][t.dataset.id]={};if(((t.dataset.key==='decision'&&['Approved','Rejected'].includes(t.value))||(t.dataset.key==='supplierStatus'&&t.value==='Confirmed'))&&window.LITeamSync?.status()?.connected&&!['Super Admin','Admin','Manager'].includes(window.LITeamSync.getRoles().role)){alert('Only management can approve or confirm products for the shared team.');render();return}const entry=S[collection][t.dataset.id];
if(t.dataset.key==='decision'&&['Select','Approved'].includes(t.value)&&!entry.roundId)entry.roundId=chosenRoundId()==='all'?'round-1':chosenRoundId();
if(t.dataset.key==='decision'&&['Select','Approved'].includes(t.value)&&
  !['Select','Approved'].includes(entry.decision||'Review')&&
  !(Number(entry.qty)>0))entry.qty=1;
entry[t.dataset.key]=t.dataset.key==='qty'?Math.max(0,Number(t.value)||0):t.value;save();window.LITeamSync?.itemChanged(collection==='catalog'?'catalog':'variant',t.dataset.id);if(VIEW==='order')renderOrder();return}});
document.addEventListener('input',e=>{if(!window.LITeamSync?.status()?.connected)return;if(e.target.id==='catalogSearch'){SEARCH=e.target.value;LIMIT=48;const start=e.target.selectionStart;renderDiscover();$('catalogSearch').focus();$('catalogSearch').setSelectionRange(start,start)}if(e.target.id==='familySearch'){SEARCH=e.target.value;renderFamilies();$('familySearch').focus()}});
document.addEventListener('submit',async e=>{if(!window.LITeamSync?.status()?.connected)return;if(e.target.id==='addBrandForm'){e.preventDefault();try{await addNewBrand(e.target)}catch(err){alert('Unable to add brand: '+err.message)}return}if(e.target.id==='newBrandProductForm'){e.preventDefault();try{await addManualProduct(e.target)}catch(err){alert('Unable to add product: '+err.message)}return}if(e.target.id==='newFamilyForm'){e.preventDefault();try{await createFamily(e.target)}catch(err){alert('Unable to create family: '+err.message)}return}if(e.target.id==='newCustomForm'){e.preventDefault();let d=new FormData(e.target),fid=MODAL?.id;if(!fid)return;const family=PACK.family.find(f=>f.id===fid);let id='CUSTOM-'+Date.now().toString(36);let v={id,familyId:fid,type:String(d.get('type')),code:String(d.get('code')),targetSize:String(d.get('size')),request:String(d.get('request')),finish:'',crystal:'',spec:'',sourceRef:'User proposed size',referenceKind:'CUSTOM DESIGN — not a supplier standard',isCustomProposal:true,supplierStatus:'Not requested',decision:'Review',qty:0,sprite:family.sprite};S.manual.push(v);save();toast('Custom version added; supplier confirmation required');familyDrawer(fid)}});
window.LIAppAuthorized=()=>{if(VIEW==='team')VIEW='brands';render()};
$('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeDrawer()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()});$('backupTop').addEventListener('click',()=>{if(window.LITeamSync?.status()?.connected)backup()});document.querySelectorAll('#nav button').forEach(x=>x.addEventListener('click',()=>{if(window.LITeamSync?.status()?.connected)setView(x.dataset.view)}));
(async()=>{try{DB=await openDB();const data=await tx(brandKey(ACTIVE_BRAND_ID),null,'readonly');if(data&&window.LITeamSync?.status()?.connected&&!window.LICentralCatalog?.isLocked(data))usePack(data);if(!window.LITeamSync?.status()?.connected)VIEW='team'}catch(e){console.warn('IndexedDB storage unavailable',e);VIEW='team'}window.LITeamSync?.init();render();if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{})})();
