/* Supplier PDF access: original files are never hosted in GitHub.
   Every document operation requires a Google sign-in and is authorized by Apps Script.
   The UI has no direct price-list download URLs for Managers/Staff. */
'use strict';
(function(){
 const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 let current=[],busy=false,error='',loaded=false;
 const role=()=>window.LITeamSync?.getRoles()?.role||'';
 const authenticated=()=>!!window.LITeamSync?.status()?.connected;
 const admin=()=>role()==='Super Admin';
 const api=()=>window.LITeamSync?.request;
 function intro(){
  if(!authenticated())return '<div class="candidate-row"><h2>Supplier PDF Catalogs</h2><p>Sign in with Google to view the supplier documents permitted for your role. Confidential price lists are not available to Managers or Staff.</p><button class="btn" data-action="goto" data-to="team">Sign in with Google</button></div>';
  return '<div class="candidate-row"><h2>Supplier PDF Catalogs</h2><p>Only price-free General Catalogs are available to Managers. Confidential Price Lists are restricted to Super Admin. Access is checked by the private Google Apps Script service and Google Drive.</p></div>';
 }
 const input=(name,value='',type='text')=>'<input name="'+name+'" type="'+type+'" value="'+escapeHtml(value)+'" required>';
 const documentForm=d=>{
  const general=d.accessType==='General Catalog',title=escapeHtml(d.title);
  return '<details class="pdf-admin-details"><summary>Edit access</summary><form class="pdf-doc-form" data-doc-edit="true">'+
   '<input type="hidden" name="brandId" value="'+escapeHtml(d.brandId)+'"><input type="hidden" name="title" value="'+title+'"><input type="hidden" name="fileId" value="'+escapeHtml(d.fileId)+'">'+
   '<div class="variant-fields"><div class="field"><label>PDF Access Type</label><select name="accessType"><option'+(general?'':' selected')+'>Confidential Price List</option><option'+(general?' selected':'')+'>General Catalog</option></select></div>'+
   '<div class="field"><label>Staff can view General Catalog</label><select name="allowStaff"><option value="false">No</option><option value="true"'+(d.allowStaff?' selected':'')+'>Yes</option></select></div></div>'+
   '<label class="tiny"><input type="checkbox" name="verifiedPriceFree" value="yes"> I have reviewed every page and confirmed there are no supplier prices, cost figures, or confidential information (required for General Catalog)</label>'+
   '<div class="row-actions"><button class="btn secondary small" type="submit">Save access type</button></div></form></details>';
 };
 function docItem(d){
  const confidential=d.accessType!=='General Catalog';
  return '<article class="candidate-row"><div class="variant-top"><div><div class="tiny">'+escapeHtml(d.brandId.toUpperCase())+'</div><h3>'+escapeHtml(d.title)+'</h3><p class="tiny">'+escapeHtml(d.accessType)+(confidential?' · Super Admin only':' · Price-free catalog')+'</p></div>'+
   '<button type="button" class="btn quiet small" data-pdf-open="true" data-brand="'+escapeHtml(d.brandId)+'" data-title="'+escapeHtml(d.title)+'">Open PDF</button></div>'+
   (admin()?documentForm(d):'')+'</article>';
 }
 function newDocumentForm(){
  const brands=(typeof BRANDS!=='undefined'?BRANDS:[]).map(b=>'<option value="'+escapeHtml(b.id)+'">'+escapeHtml(b.name)+'</option>').join('');
  return '<div class="candidate-row"><h3>Register supplier PDF</h3><p class="tiny">Documents default to Confidential Price List. Only choose General Catalog after checking the entire file is free of prices.</p>'+
   '<form class="pdf-doc-form" data-doc-create="true"><div class="variant-fields">'+
   '<div class="field"><label>Brand</label><select name="brandId">'+brands+'</select></div>'+
   '<div class="field"><label>Document title</label>'+input('title')+'</div>'+
   '<div class="field span2"><label>Private Google Drive PDF ID or file link</label>'+input('fileId')+'</div>'+
   '<div class="field"><label>PDF Access Type</label><select name="accessType"><option>Confidential Price List</option><option>General Catalog</option></select></div>'+
   '<div class="field"><label>Allow Staff to view General Catalog</label><select name="allowStaff"><option value="false">No</option><option value="true">Yes</option></select></div></div>'+
   '<label class="tiny"><input type="checkbox" name="verifiedPriceFree" value="yes"> I reviewed every page and confirmed this PDF is price-free (required for General Catalog)</label>'+
   '<div class="row-actions"><button class="btn small" type="submit">Add PDF to register</button></div></form></div>';
 }
 function render(){
  const host=document.getElementById('app');if(!host)return;
  if(!authenticated()){host.innerHTML=intro();return;}
  host.innerHTML=intro()+(error?'<p class="alert">'+escapeHtml(error)+'</p>':'')+
   '<div class="row-actions"><button class="btn secondary small" data-pdf-refresh="true">Refresh PDFs</button><span class="tiny">'+(busy?'Checking private PDF access…':loaded?current.length+' PDFs visible to your role':'Loading PDFs…')+'</span></div>'+
   '<div class="row-list">'+current.map(docItem).join('')+(loaded&&!current.length?'<div class="empty"><h3>No approved PDF catalogs</h3><p>Ask Super Admin to classify a price-free catalog as General Catalog.</p></div>':'')+'</div>'+
   (admin()?newDocumentForm():'');
 }
 async function refresh(){
  if(!authenticated()){current=[];loaded=false;render();return;}
  busy=true;error='';render();
  try{
   const docs=await api()('listDocs',{});
   if(!Array.isArray(docs))throw Error('Unexpected document list response');
   current=docs;loaded=true;
  }catch(err){
   error='Document permissions are not active on the deployed Apps Script yet: '+String(err.message||err)+'. Update the existing Web App deployment with the new Code.gs.';
   current=[];loaded=false;
  }finally{busy=false;render();}
 }
 function enter(){current=[];loaded=false;error='';render();refresh()}
 async function openDocument(brandId,title){
  // Open a blank tab directly from the click so Chrome permits the PDF window.
  const popup=window.open('about:blank','_blank');
  try{
   const result=await api()('openDoc',{brandId,title});
   if(!result?.url||!/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(result.url))throw Error('Invalid approved PDF link');
   if(popup)popup.location.href=result.url;
   else {error='Your browser blocked the PDF window. Enable pop-ups for this app and retry.';render();}
  }catch(err){if(popup)popup.close();error='Cannot open PDF: '+String(err.message||err);render();}
 }
 function parsedFileId(raw){
  const text=String(raw||'').trim(),match=text.match(/\/file\/d\/([-_A-Za-z0-9]{20,})/);
  return match?match[1]:text;
 }
 async function saveDocument(form){
  if(!admin()||busy)return;
  const d=new FormData(form),type=String(d.get('accessType')||'');
  if(type==='General Catalog'&&!d.has('verifiedPriceFree')){
   alert('Review the complete PDF for prices, then check the verification box before allowing Manager access.');return;
  }
  if(!confirm('Save this PDF classification? General Catalogs can be viewed by authorized Managers.'))return;
  busy=true;
  try{
   await api()('upsertDoc',{brandId:String(d.get('brandId')),title:String(d.get('title')),fileId:parsedFileId(d.get('fileId')),accessType:type,allowStaff:d.get('allowStaff')==='true',verifiedPriceFree:d.has('verifiedPriceFree')});
   await refresh();
  }catch(err){error='Could not update document access: '+String(err.message||err);busy=false;render()}
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-pdf-refresh],[data-pdf-open]');if(!b||typeof VIEW==='undefined'||VIEW!=='documents')return;
  if(b.hasAttribute('data-pdf-refresh')){refresh();return;}
  if(b.hasAttribute('data-pdf-open'))openDocument(b.dataset.brand,b.dataset.title);
 });
 document.addEventListener('submit',e=>{
  const form=e.target.closest('[data-doc-edit],[data-doc-create]');
  if(!form||typeof VIEW==='undefined'||VIEW!=='documents')return;
  e.preventDefault();saveDocument(form);
 });
 window.LIPdfAccess={enter,render,refresh};
})();