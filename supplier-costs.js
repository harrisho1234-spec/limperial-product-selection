/* Product Selection staging: confidential unit costs stay ONLY in Supabase.
 * Supabase RLS checks per-app membership: Staff and Manager cannot retrieve costs.
 * No supplier prices are bundled in catalog JSON, local storage, or price-free exports.
 */
'use strict';
window.LISelectionCosts=(()=>{
 const key=(brand,kind,id,spec)=>JSON.stringify([String(brand||''),String(kind||''),String(id||''),String(spec||'')]);
 const normalize=v=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
 function specKey(entry={}){
  const parts=[entry.targetSize,entry.finish,entry.crystal,entry.request].map(normalize);
  return parts.some(Boolean)?JSON.stringify(parts):'';
 }
 function itemKey(item){
  const record=item.record||item;
  const entry=record.entry||{};
  const brand=record.brandId||item.brandId||item.brand||'';
  const kind=record.kind||item.kind||'variant';
  const id=record.itemId||item.itemId||record.id||'';
  return {brand_id:String(brand),item_kind:String(kind),item_id:String(id),spec_key:specKey(entry)};
 }
 function authorized(){
  return window.LISelectionIdentity?.canSeeCosts()===true;
 }
 function ensureAuthorized(){
  if(!authorized())throw Error('Only Product Selection Admin and Super Admin may access supplier costs.');
 }
 async function fetchRows(items){
  ensureAuthorized();
  const wanted=(items||[]).map(itemKey).filter(x=>x.brand_id&&x.item_id);
  if(!wanted.length)return new Map();
  const client=window.LISelectionIdentity.client();
  const ids=[...new Set(wanted.map(x=>x.item_id))];
  const result=new Map();
  // Small batches keep the authorized Data API request within its URL limits.
  for(let i=0;i<ids.length;i+=40){
    const {data,error}=await client.from('product_selection_supplier_costs')
      .select('brand_id,item_kind,item_id,spec_key,unit_cost,currency')
      .in('item_id',ids.slice(i,i+40));
    if(error)throw Error('Unable to load protected supplier costs: '+error.message);
    for(const row of data||[])result.set(key(row.brand_id,row.item_kind,row.item_id,row.spec_key),row);
  }
  const matched=new Map();
  for(const wantedRow of wanted){
    const exact=result.get(key(wantedRow.brand_id,wantedRow.item_kind,wantedRow.item_id,wantedRow.spec_key));
    const standard=result.get(key(wantedRow.brand_id,wantedRow.item_kind,wantedRow.item_id,''));
    if(exact||standard)matched.set(key(wantedRow.brand_id,wantedRow.item_kind,wantedRow.item_id,wantedRow.spec_key),exact||standard);
  }
  return matched;
 }
 function costFor(item,lookup){
  const id=itemKey(item);
  return lookup?.get(key(id.brand_id,id.item_kind,id.item_id,id.spec_key))||null;
 }
 function unitTotal(item,cost){
  if(!cost)return {unit:null,total:null,currency:null};
  const unit=Number(cost.unit_cost),qty=Number(item.qty??item.record?.qty??item.entry?.qty??0);
  if(!Number.isFinite(unit)||unit<0)return {unit:null,total:null,currency:null};
  return {unit,total:Number.isFinite(qty)&&qty>=0?Math.round(unit*qty*10000)/10000:null,currency:cost.currency||'USD'};
 }
 async function save(item,amount,currency='USD'){
  ensureAuthorized();
  if(String(amount??'').trim()==='')throw Error('Unit cost cannot be blank.');
  const price=Number(amount);
  if(!Number.isFinite(price)||price<0)throw Error('Enter a valid non-negative supplier cost.');
  const c=String(currency||'USD').toUpperCase();
  if(!/^[A-Z]{3}$/.test(c))throw Error('Use a three-letter currency code.');
  const identity=window.LISelectionIdentity.status();
  const meta=itemKey(item);
  if(!meta.brand_id||!meta.item_id||!['catalog','variant'].includes(meta.item_kind))throw Error('Missing product identity');
  const user=(await window.LISelectionIdentity.client().auth.getUser()).data.user;
  if(!user?.id)throw Error('Sign in again to save supplier costs.');
  const {error}=await window.LISelectionIdentity.client().from('product_selection_supplier_costs').upsert({
    ...meta, supplier_code:String(item.code||item.record?.code||'').slice(0,120),
    unit_cost:price,currency:c,updated_by:user.id,updated_at:new Date().toISOString()
  },{onConflict:'brand_id,item_kind,item_id,spec_key'});
  if(error)throw Error('Supplier cost was not saved: '+error.message);
  return true;
 }
 return {authorized,fetchRows,costFor,unitTotal,save,itemKey,specKey};
})();
