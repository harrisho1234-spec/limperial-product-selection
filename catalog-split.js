/* Split multi-design visual catalog pages without inventing supplier codes.
   Derived visual items are local views of the existing private catalog sprites.
   Original source pages remain in the catalog for legacy saved selections. */
'use strict';
(function(){
  const DEFAULTS={
    h2:"33-36,39-42,45-46,48,52-60,62-63,66,68-69,83-84,87,89-92,95-98,106,113-116,120-126,130,133,136-137,144-145,154-155,157-159,161,165-167,175-176,183-193,207,209-210,213-218,221-222,225,228-230,233-234,239-243,246-248,251-252,257,266-267,269,271,274,281-284,287,292",
    h3:"67,70-74,99-100,131-132,135,138-142,168,177-180,194,199,212,226-227,244-245,249-250,253-254,270,272-273,294",
    v2:"108,143,171,173,195,198,200,231,275",
    v3:"77,107,147,197",
    g4:"103-105,146,291"
  };
  function numbers(str){const result=new Set();for(const chunk of str.split(',')){const a=chunk.trim();if(!a)continue;const m=/^(\d+)-(\d+)$/.exec(a);if(m){for(let i=+m[1];i<=+m[2];i++)result.add(i)}else result.add(+a)}return result}
  const LOOKUP={};for(const [layout,pages] of Object.entries(DEFAULTS)){for(const page of numbers(pages))LOOKUP[page]=layout}
  const LAYOUTS={h2:{rows:2,cols:1},h3:{rows:3,cols:1},v2:{rows:1,cols:2},v3:{rows:1,cols:3},g4:{rows:2,cols:2}};
  function key(brand){return 'li-catalog-splits-v1-'+String(brand||'asfour')}
  function overrides(brand){try{return JSON.parse(localStorage.getItem(key(brand))||'{}')}catch(e){return {}}}
  function layoutFor(item,brand,manual=overrides(brand)){
    if(!item||item.code||!item.sprite||item.splitGenerated)return null;
    if(Object.prototype.hasOwnProperty.call(manual,item.id)){return LAYOUTS[manual[item.id]]?manual[item.id]:null}
    return brand==='asfour'&&item.source==='heritage'?LOOKUP[Number(item.page)]||null:null
  }
  function part(item,n,total,layout){
    const l=LAYOUTS[layout],col=n%l.cols,row=Math.floor(n/l.cols);
    return {...item,
      id:item.id+'--design-'+(n+1),
      name:(item.name||'Catalog page')+' · Design '+(n+1)+' of '+total,
      code:'',
      sprite:{...item.sprite,crop:{rows:l.rows,cols:l.cols,row,col}},
      pageSprite:item.sprite,
      splitGenerated:true,
      splitParentId:item.id,
      splitPart:n+1,splitTotal:total,
      splitLayout:layout,photoKind:'catalog-crop',
      verification:'Visual reference only — obtain exact supplier code, finish and dimensions',
      dimension:item.dimension||''
    }
  }
  function apply(pack,brand){
    if(!pack?.catalog||!Array.isArray(pack.catalog.items))return {pages:0,designs:0};
    const originals=pack.catalog.items.filter(item=>!item.splitGenerated);
    const manual=overrides(brand);const result=[];let pages=0,designs=0;
    for(const item of originals){
      const layout=layoutFor(item,brand,manual),l=LAYOUTS[layout];
      if(!l){result.push({...item,splitParent:false});continue}
      const total=l.rows*l.cols;pages++;designs+=total;
      result.push({...item,splitParent:true,splitLayout:layout});
      for(let n=0;n<total;n++)result.push(part(item,n,total,layout))
    }
    pack.catalog.items=result;
    return {pages,designs}
  }
  function setLayout(pack,brand,id,layout){
    if(layout!=='none'&&!LAYOUTS[layout])throw Error('Unsupported page layout');
    const original=pack?.catalog?.items?.find(item=>item.id===id&&!item.splitGenerated);
    if(!original||original.code)throw Error('Only image-only catalog pages can be split');
    const value=overrides(brand);value[id]=layout;
    localStorage.setItem(key(brand),JSON.stringify(value));
    return apply(pack,brand)
  }
  function image(s){
    // Free-form crop of one specific model on TL's scanned catalog page.
    // Convert to the same atlas crop geometry consumed by card previews and Excel.
    if(Array.isArray(s?.cropRect)&&s.cropRect.length===4){
      const [x,y,w,h]=s.cropRect.map(Number);
      if([x,y,w,h].every(Number.isFinite)&&w>=0.06&&h>=0.06&&x>=0&&y>=0&&x+w<=1.001&&y+h<=1.001)
        return {rows:1/h,cols:1/w,row:y/h,col:x/w};
      return null;
    }
    if(!s?.crop)return null;
    const {rows,cols,row,col}=s.crop;
    if(![rows,cols,row,col].every(Number.isInteger)||rows<1||cols<1||row<0||row>=rows||col<0||col>=cols||rows*cols>9)return null;
    return {rows,cols,row,col}
  }
  window.LICatalogSplit={apply,setLayout,image,layoutFor,LAYOUTS};
})();