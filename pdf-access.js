/* Supplier PDF access: original files are never hosted in GitHub.
   Every document operation requires a Google sign-in and is authorized by Apps Script.
   The UI has no direct price-list download URLs for Managers/Staff. */
'use strict';
(function(){
 const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 let current=[],busy=false,error='',success='',loaded=false;
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
   '<div class="field"><label>Allow regular Staff to view too? (Managers are allowed automatically)</label><select name="allowStaff"><option value="false">No</option><option value="true"'+(d.allowStaff?' selected':'')+'>Yes</option></select></div></div>'+
   '<p class="alert"><b>To allow Manager access:</b> Choose <b>General Catalog</b>, review the entire PDF, tick the confirmation below, then click <b>Save access type</b>. Keep Staff = No if only Managers should see it.</p>'+'<label class="pdf-review-check"><input type="checkbox" name="verifiedPriceFree" value="yes"> <b>I checked every page and confirm this PDF contains no supplier prices, cost figures, or confidential information.</b></label>'+
   '<p class="pdf-form-error" role="alert" hidden></p><div class="row-actions"><button class="btn secondary small" type="submit">Save access type</button></div></form></details>';
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
   '<div class="field"><label>Allow regular Staff too? (Managers have automatic access)</label><select name="allowStaff"><option value="false">No</option><option value="true">Yes</option></select></div></div>'+
   '<p class="tiny">Only Super Admin can approve a price-free catalog. General Catalog automatically allows Manager access; choose Staff = Yes only when regular staff should also see it.</p>'+'<label class="pdf-review-check"><input type="checkbox" name="verifiedPriceFree" value="yes"> <b>I reviewed every page and confirmed this document is price-free.</b></label>'+
   '<p class="pdf-form-error" role="alert" hidden></p><div class="row-actions"><button class="btn small" type="submit">Add PDF to register</button></div></form></div>';
 }
 function render(){
  const host=document.getElementById('app');if(!host)return;
  if(!authenticated()){host.innerHTML=intro();return;}
  host.innerHTML=intro()+(error?'<p class="alert"><b>Permission not saved:</b> '+escapeHtml(error)+'</p>':'')+(success?'<p class="pdf-save-success" role="status">'+escapeHtml(success)+'</p>':'')+
   '<div class="row-actions"><button class="btn secondary small" data-pdf-refresh="true">Refresh PDFs</button><span class="tiny">'+(busy?'Checking private PDF access…':loaded?current.length+' PDFs visible to your role':'Loading PDFs…')+'</span></div>'+
   '<div class="row-list">'+current.map(docItem).join('')+(loaded&&!current.length?'<div class="empty"><h3>No approved PDF catalogs</h3><p>Ask Super Admin to classify a price-free catalog as General Catalog.</p></div>':'')+'</div>'+
   (admin()?newDocumentForm()+'<div class="candidate-row"><h3>Secure existing price lists and raw catalog packs</h3><p class="tiny">Existing Google Drive shares may grant access to confidential PDFs or raw Asfour/LUMAX catalog packs outside the app. After reviewing classifications, this removes non-Super Admin shares from restricted PDFs and original master catalog packs.</p><button class="btn danger small" type="button" data-pdf-secure="true">Revoke confidential Drive sharing</button></div>':'');
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
 async function secureShares(){
  if(!admin()||busy)return;
  if(!confirm('This will revoke direct Google Drive access to ALL Confidential Price List PDFs and original master catalog packs for non-Super Admin accounts, including existing Editors. Review classifications first. Continue?'))return;
  busy=true;
  try{
    const result=await api()('secureConfidentialDocs',{confirmRemoveExistingShares:true});
    alert('Reviewed '+result.documentsChecked+' confidential PDFs and '+result.catalogPacksChecked+' master catalog packs. Removed '+result.revokedCount+' non-Super Admin Drive shares.');
    await refresh();
  }catch(err){error='Unable to secure existing PDF shares: '+String(err.message||err);busy=false;render();}
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
  if(type==='General Catalog'&&!d.has('verifiedPriceFree')){
   const warning=form.querySelector('.pdf-form-error');
   if(warning){warning.hidden=false;warning.textContent='Before saving: review the complete PDF and tick the price-free confirmation. Your General Catalog selection has been kept.'}
   form.querySelector('[name="verifiedPriceFree"]')?.focus();
   return;
  }
  if(!confirm(type==='General Catalog'?
     'Confirm the entire PDF has no supplier prices or confidential figures. Managers will then be allowed to open it. Continue?':
     'Restrict this PDF to Super Admin only? Any app-granted document access will be revoked. Continue?'))return;
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
   success=title+' saved as '+type+'. '+(type==='General Catalog'?
     'Managers can now open this PDF.'+(allowStaff?' Regular Staff can view it too.':' Regular Staff remain restricted.'):
     'Only Super Admin can open it through this app.');
  }catch(err){
   error=String(err.message||err);
   success='';
  }finally{
   busy=false;
   render();
  }
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-pdf-refresh],[data-pdf-open],[data-pdf-secure]');if(!b||typeof VIEW==='undefined'||VIEW!=='documents')return;
  if(b.hasAttribute('data-pdf-refresh')){refresh();return;}if(b.hasAttribute('data-pdf-secure')){secureShares();return;}
  if(b.hasAttribute('data-pdf-open'))openDocument(b.dataset.brand,b.dataset.title);
 });
 document.addEventListener('submit',e=>{
  const form=e.target.closest('[data-doc-edit],[data-doc-create]');
  if(!form||typeof VIEW==='undefined'||VIEW!=='documents')return;
  e.preventDefault();saveDocument(form);
 });
 window.LIPdfAccess={enter,render,refresh};
})();