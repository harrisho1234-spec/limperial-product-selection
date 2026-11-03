/* Only approved price-free supplier catalogs are accessible here.
   Original confidential PDFs stay private in Google Drive, never hosted on GitHub.
   Every document open is still authorized by the private Apps Script service. */
'use strict';
(function(){
 const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 let current=[],busy=false,error='',success='',loaded=false;
 const role=()=>window.LITeamSync?.getRoles()?.role||'';
 const authenticated=()=>!!window.LITeamSync?.status()?.connected;
 const admin=()=>role()==='Super Admin';
 const api=()=>window.LITeamSync?.request;
 function intro(){
   if(!authenticated())return '<div class="candidate-row"><h2>Supplier Catalogs</h2><p>Sign in to view approved price-free supplier catalogs.</p></div>';
   return '<div class="candidate-row"><h2>Approved Supplier Catalogs</h2><p>Only reviewed General Catalogs free of supplier pricing are available through Product Selection. Original supplier price lists are kept outside the app.</p></div>';
 }
 const input=(name,value='',type='text')=>'<input name="'+name+'" type="'+type+'" value="'+escapeHtml(value)+'" required>';
 const documentForm=d=>{
   if(d.accessType!=='General Catalog')return '';
   return '<details class="pdf-admin-details"><summary>Edit catalog access</summary><form class="pdf-doc-form" data-doc-edit="true">'+
    '<input type="hidden" name="brandId" value="'+escapeHtml(d.brandId)+'">'+
    '<input type="hidden" name="title" value="'+escapeHtml(d.title)+'">'+
    '<input type="hidden" name="fileId" value="'+escapeHtml(d.fileId)+'">'+
    '<input type="hidden" name="accessType" value="General Catalog">'+
    '<label class="field">Allow Staff to view? (Managers are allowed)<select name="allowStaff">'+
    '<option value="false">No</option><option value="true"'+(d.allowStaff?' selected':'')+'>Yes</option></select></label>'+
    '<label class="pdf-review-check"><input type="checkbox" name="verifiedPriceFree" value="yes" required> '+
    '<b>I reviewed the entire PDF and confirm that it has no supplier prices, costs, or confidential information.</b></label>'+
    '<p class="pdf-form-error" role="alert" hidden></p><div class="row-actions"><button class="btn secondary small" type="submit">Save catalog access</button></div></form></details>';
 };
 function docItem(d){
   if(!d||d.accessType!=='General Catalog')return '';
   return '<article class="candidate-row"><div class="variant-top"><div><div class="tiny">'+escapeHtml(d.brandId.toUpperCase())+
     '</div><h3>'+escapeHtml(d.title)+'</h3><p class="tiny">Approved General Catalog · Price-free</p></div>'+
     '<button type="button" class="btn quiet small" data-pdf-open="true" data-brand="'+escapeHtml(d.brandId)+
     '" data-title="'+escapeHtml(d.title)+'">Open catalog</button></div>'+
     (admin()?documentForm(d):'')+'</article>';
 }
 function newDocumentForm(){
   const brands=(typeof BRANDS!=='undefined'?BRANDS:[]).map(b=>'<option value="'+escapeHtml(b.id)+'">'+escapeHtml(b.name)+'</option>').join('');
   return '<div class="candidate-row"><h3>Register price-free supplier catalog</h3>'+
    '<p class="tiny">Only upload a PDF after checking every page. Confidential price lists are not supported in this app.</p>'+
    '<form class="pdf-doc-form" data-doc-create="true"><div class="variant-fields">'+
    '<div class="field"><label>Brand</label><select name="brandId">'+brands+'</select></div>'+
    '<div class="field"><label>Catalog title</label>'+input('title')+'</div>'+
    '<div class="field span2"><label>Private Google Drive PDF ID or link</label>'+input('fileId')+'</div>'+
    '<input type="hidden" name="accessType" value="General Catalog">'+
    '<div class="field"><label>Allow Staff? (Managers can view)</label><select name="allowStaff">'+
    '<option value="false">No</option><option value="true">Yes</option></select></div></div>'+
    '<label class="pdf-review-check"><input type="checkbox" name="verifiedPriceFree" value="yes" required> '+
    '<b>I checked every page and confirm this PDF contains no supplier pricing, costs, or confidential material.</b></label>'+
    '<p class="pdf-form-error" role="alert" hidden></p>'+
    '<div class="row-actions"><button class="btn small" type="submit">Register approved catalog</button></div></form></div>';
 }
 function render(){
   const host=document.getElementById('app');if(!host)return;
   if(!authenticated()){host.innerHTML=intro();return}
   host.innerHTML=intro()+
    (error?'<p class="alert"><b>Catalog access error:</b> '+escapeHtml(error)+'</p>':'')+
    (success?'<p class="pdf-save-success" role="status">'+escapeHtml(success)+'</p>':'')+
    '<div class="row-actions"><button class="btn secondary small" data-pdf-refresh="true">Refresh catalogs</button>'+
    '<span class="tiny">'+(busy?'Checking authorized catalogs…':loaded?current.length+' approved catalogs':'Loading catalogs…')+'</span></div>'+
    '<div class="row-list">'+current.map(docItem).join('')+
    (loaded&&!current.length?'<div class="empty"><h3>No approved PDF catalogs</h3><p>Ask Super Admin to register a verified price-free General Catalog.</p></div>':'')+'</div>'+
    (admin()?newDocumentForm():'');
 }
 async function refresh(){
  if(!authenticated()){current=[];loaded=false;render();return;}
  busy=true;error='';render();
  try{
   const docs=await api()('listDocs',{});
   if(!Array.isArray(docs))throw Error('Unexpected document list response');
   current=docs.filter(d=>d&&d.accessType==='General Catalog'&&d.active!==false);loaded=true;
  }catch(err){
   error='Document permissions are not active on the deployed Apps Script yet: '+String(err.message||err)+'. Update the existing Web App deployment with the new Code.gs.';
   current=[];loaded=false;
  }finally{busy=false;render();}
 }
 function enter(){current=[];loaded=false;error='';render();refresh()}
 async function openDocument(brandId,title){
  if(!current.some(d=>d.brandId===brandId&&d.title===title&&d.accessType==='General Catalog'))return;
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
  const brandId=String(d.get('brandId')||'').trim().toLowerCase();
  const title=String(d.get('title')||'').trim();
  const fileId=parsedFileId(d.get('fileId'));
  const allowStaff=d.get('allowStaff')==='true';
  if(type!=='General Catalog'){error='Only verified General Catalogs may be registered in this app.';render();return;}
  if(!d.has('verifiedPriceFree')){
   const warning=form.querySelector('.pdf-form-error');
   if(warning){warning.hidden=false;warning.textContent='Before saving: review the complete PDF and tick the price-free confirmation. Your General Catalog selection has been kept.'}
   form.querySelector('[name="verifiedPriceFree"]')?.focus();
   return;
  }
  if(!confirm('Confirm this complete PDF contains no supplier prices or confidential material and is approved as a General Catalog?'))return;
  busy=true;error='';success='';
  const submit=form.querySelector('button[type="submit"]');
  if(submit){submit.disabled=true;submit.textContent='Saving permissions…'}
  try{
   const saved=await api()('upsertDoc',{brandId,title,fileId,accessType:type,allowStaff,verifiedPriceFree:d.has('verifiedPriceFree')});
   if(!saved||saved.accessType!==type||saved.brandId!==brandId||saved.title!==title)
     throw Error('Server did not confirm the requested access type');
   await refresh();
   const updated=current.find(x=>x.brandId===brandId&&x.title===title);
   if(!updated||updated.accessType!==type||updated.allowStaff!==(type==='General Catalog'&&allowStaff))
     throw Error('The server returned the previous access type. Check the deployed Apps Script version, then refresh.');
   error='';
   success=title+' saved as a price-free General Catalog. Managers can open it.'+(allowStaff?' Staff can view it too.':' Staff remain restricted.');
  }catch(err){
   error=String(err.message||err);
   success='';
  }finally{
   busy=false;
   render();
  }
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