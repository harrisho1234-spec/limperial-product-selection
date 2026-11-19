/* Read-only Asfour code guide. Uses only the currently authorized catalog. */
'use strict';
(function(){
 const escapeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clean=v=>String(v||'').trim();
 const norm=v=>clean(v).replace(/\s+/g,'').toLowerCase();
 const split=code=>clean(code).split('/');
 const roleLabels=['Series / family identifier','Design / model reference','Finish code','Crystal / decoration code'];
 // These are examples already observed in the private Asfour data, not a manufacturer's complete dictionary.
 const observed={
  2:{'119':'Gold','110':'Gold Oxidized','121':'Chrome'},
  3:{'105':'Pendeloque (clear in observed examples)','100':'Without crystal','215':'Pendeloque / Gold (observed)','124':'Ball / Drop (observed)'}
 };
 const items=()=>window.PACK?.items||[];
 function catalog(){
  if(typeof PACK==='undefined'||!PACK)return [];
  const list=[...(PACK.items||[]).map(i=>({...i,guideKind:'Catalog',guideId:i.id})),
   ...(typeof allVariants==='function'?allVariants():[]).map(i=>({...i,guideKind:'Family version',guideId:i.id}))];
  const byCode=new Map();
  for(const item of list){
   const code=clean(item.code),key=norm(code);
   if(!key)continue;
   if(!byCode.has(key))byCode.set(key,[]);
   byCode.get(key).push(item);
  }
  return [...byCode].map(([key,records])=>({key,code:clean(records[0].code),records}));
 }
 function classification(code){
  const parts=split(code);
  return parts.length===4&&parts.every(v=>/^\d+$/.test(v))?parts:null;
 }
 function detail(code){
  const records=catalog().find(c=>norm(c.code)===norm(code))?.records||[];
  const parts=classification(code);
  const segments=parts?parts.map((value,i)=>({value,title:roleLabels[i],meaning:observed[i]?.[value]||'Meaning not yet verified'})):[];
  return {records,segments};
 }
 function button(code,extra=''){
  if(typeof ACTIVE_BRAND_ID==='undefined'||ACTIVE_BRAND_ID!=='asfour'||!clean(code))return '';
  return '<button type="button" class="btn quiet small li-code-info" data-action="asfourCodeInfo" data-code="'+escapeText(code)+'" '+extra+'>ⓘ Code Info</button>';
 }
 function show(code){
  if(typeof ACTIVE_BRAND_ID==='undefined'||ACTIVE_BRAND_ID!=='asfour')return;
  const data=detail(code);
  const rows=data.records;
  const entries=data.segments.map((s,i)=>'<div class="li-code-segment"><span class="li-code-numeric">'+escapeText(s.value)+'</span><span><b>'+escapeText(s.title)+'</b><small>'+escapeText(s.meaning)+'</small></span></div>').join('');
  const list=rows.slice(0,20).map(r=>'<div class="li-code-match"><b>'+escapeText(r.name||r.type||'Product reference')+'</b><span class="tiny">'+escapeText(r.guideKind)+(r.dimension?' · '+escapeText(r.dimension):'')+(r.targetSize?' · Requested: '+escapeText(r.targetSize):'')+'</span></div>').join('');
  const html='<div class="drawer-header"><div><div class="tiny">ASFOUR · CODE GUIDE</div><h2>'+escapeText(code)+'</h2></div><button class="close" data-action="close">×</button></div>'+
    '<div class="drawer-body"><p class="tiny">Interpretations are indicative and must be checked against the manufacturer before purchasing.</p>'+
    (entries?'<div class="li-code-breakdown">'+entries+'</div>':'<div class="alert">This code does not follow the four-number pattern. The original reference is preserved.</div>')+
    '<div class="subheading"><h3>Matches in your private catalog</h3></div>'+
    (list||'<p class="muted">No exact catalog match. A missing match does not prove an invalid supplier code.</p>')+
    (rows.length>20?'<p class="tiny">Showing the first 20 matching references.</p>':'')+
    '<div class="row-actions"><button class="btn secondary" data-action="goto" data-to="code-guide">Open full dictionary</button><button class="btn quiet" data-action="close">Close</button></div></div>';
  MODAL={type:'asfour-code',id:code};
  document.getElementById('drawerContent').innerHTML=html;
  showDrawer();
 }
 function render(){
  const app=document.getElementById('app');
  if(!app)return;
  const all=catalog(),filter=clean(window.LIAsfourGuideSearch).toLowerCase();
  const found=all.filter(x=>[x.code,...x.records.flatMap(r=>[r.name,r.type,r.dimension])].join(' ').toLowerCase().includes(filter));
  app.innerHTML='<div class="toolbar"><div class="search"><input id="liCodeGuideSearch" placeholder="Search code, product, size…" value="'+escapeText(window.LIAsfourGuideSearch||'')+'"></div><span class="tiny">'+found.length+' unique codes · '+all.length+' total</span></div>'+
   '<div class="alert">This guide derives codes and product descriptions from the loaded private Asfour catalog. The four code segments are a working interpretation, not an official complete manufacturer key. Unknown codes remain unverified.</div>'+
   '<div class="li-code-table-wrap"><table class="order-table"><thead><tr><th>Supplier code</th><th>Catalog description / references</th><th>Details</th></tr></thead><tbody>'+
   found.slice(0,150).map(c=>'<tr><td><b>'+escapeText(c.code)+'</b></td><td>'+escapeText(c.records.map(r=>r.name||r.type||'Reference').filter(Boolean).slice(0,2).join(' · '))+(c.records.length>2?' · …':'')+'<div class="tiny">'+c.records.length+' source reference(s)</div></td><td>'+button(c.code)+'</td></tr>').join('')+
   '</tbody></table></div>'+(found.length>150?'<p class="tiny">Showing 150 codes. Narrow your search to see the others.</p>':'')+
   (!found.length?'<p class="muted">No matching code in the currently loaded catalog.</p>':'');
 }
 document.addEventListener('input',e=>{
  if(e.target.id!=='liCodeGuideSearch')return;
  window.LIAsfourGuideSearch=e.target.value;
  const start=e.target.selectionStart;
  render();
  const input=document.getElementById('liCodeGuideSearch');
  if(input){input.focus();input.setSelectionRange(start,start)}
 });
 window.LIAsfourGuide={button,show,render,detail};
})();
