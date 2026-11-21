/* GeoLite layout elements: insert extra map frames, legend, scale bar, north arrow, text and images on the page.
   Items can be dragged by their green header and resized from the corner handle. Loaded after the main script. */
(function(){
'use strict';
const st=document.createElement('style');
st.textContent=`.lay-item{position:absolute;border:1px solid #777;background:#fff;z-index:20;box-sizing:border-box;overflow:hidden}
.lay-item.sel{outline:2px solid #1f6f4a}
.lay-hd{position:absolute;left:0;right:0;top:0;height:18px;background:rgba(31,111,74,.9);color:#fff;font-size:11px;line-height:18px;padding:0 6px;cursor:move;z-index:1000;display:flex;justify-content:space-between;touch-action:none;user-select:none}
.lay-hd .x{cursor:pointer;padding:0 4px}
.lay-rs{position:absolute;right:0;bottom:0;width:18px;height:18px;background:linear-gradient(135deg,transparent 50%,#1f6f4a 50%);cursor:nwse-resize;z-index:1000;touch-action:none}
.lay-body{position:absolute;inset:0;padding-top:18px}
.lay-body.nopad{padding-top:0}
#page.noui .lay-hd,#page.noui .lay-rs{display:none}#page.noui .lay-item{outline:none}#page.noui .lay-body{padding-top:0}
.lay-item[data-t=map] .lay-body{padding-top:0}
.lay-mapdiv{position:absolute;inset:0}
@media print{.lay-hd,.lay-rs{display:none!important}.lay-body{padding-top:0!important}.lay-item{outline:none!important}}`;
document.head.appendChild(st);

const XM=[];let sel=null,nid=1,cnt={map:0};
const items=()=>$$('.lay-item',$('#page'));
const ids=n=>cnt[n]=(cnt[n]||0)+1;

/* ---- toolbar ---- */
const tb=$('#view-layout .tb');
tb.insertAdjacentHTML('beforeend',`<select id="li-add"><option value="">+ Insert…</option><option value="map">Map frame</option><option value="legend">Legend</option><option value="scale">Scale bar</option><option value="north">North arrow</option><option value="text">Text</option><option value="image">Image…</option></select>
 <button class="sm" id="li-fit" title="Set the selected map frame to the Map tab extent">Fit frame to map</button>
 <button class="sm" id="li-del">Delete item</button><input type="file" id="li-file" accept="image/*" hidden>`);
$('#li-add').onchange=e=>{const t=e.target.value;e.target.value='';if(!t)return;if(t==='image')return $('#li-file').click();addItem(t)};
$('#li-file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const r=new FileReader();r.onload=()=>addItem('image',{src:r.result});r.readAsDataURL(f)};
$('#li-fit').onclick=()=>{const m=sel&&XM.find(x=>x.el===sel);if(!m)return toast('Select a map frame first');m.map.fitBounds(map.getBounds())};
$('#li-del').onclick=()=>{if(!sel)return toast('Select an item first');removeItem(sel)};
/* export hides the move/resize handles */
$('#view-layout .tb').addEventListener('click',e=>{if(e.target.id!=='lay-png')return;e.stopPropagation();e.preventDefault();const pg=$('#page');pg.classList.add('noui');Promise.resolve(exportPNG()).finally(()=>pg.classList.remove('noui'))},true);
$('#lay-base').addEventListener('change',e=>XM.forEach(m=>e.target.checked?m.osm.addTo(m.map):m.map.removeLayer(m.osm)));

/* ---- items ---- */
function select(el){sel=el;items().forEach(i=>i.classList.toggle('sel',i===el))}
function removeItem(el){const i=XM.findIndex(x=>x.el===el);if(i>=0){XM[i].map.remove();XM.splice(i,1)}if(sel===el)sel=null;el.remove();updScale()}
function addItem(t,o={}){
 if(typeof initLayoutMap==='function')initLayoutMap();
 const n=items().length,def={map:[420,300],legend:[200,160],scale:[190,46],north:[70,92],text:[240,80],image:[220,160]}[t],name={map:'Map '+ids('map'),legend:'Legend',scale:'Scale bar',north:'North arrow',text:'Text',image:'Image'}[t];
 const el=document.createElement('div');el.className='lay-item';el.dataset.t=t;
 el.style.cssText=`left:${60+n*24}px;top:${110+n*24}px;width:${def[0]}px;height:${def[1]}px`;
 el.innerHTML=`<div class="lay-hd"><span>${name}</span><span class="x" title="Delete">✕</span></div><div class="lay-body"></div><div class="lay-rs"></div>`;
 const body=$('.lay-body',el);
 if(t==='legend'){body.className='lay-body lay-legend';body.style.cssText='padding:22px 6px 4px;font-size:12px;overflow:auto';body.innerHTML=legendHTML()}
 else if(t==='north')body.innerHTML='<svg viewBox="0 0 46 60" style="width:100%;height:100%"><polygon points="23,2 36,52 23,42 10,52" fill="#222"/><polygon points="23,2 23,42 10,52" fill="#fff" stroke="#222"/><text x="23" y="60" font-size="10" text-anchor="middle">N</text></svg>';
 else if(t==='text'){body.contentEditable='true';body.style.cssText='padding:22px 6px 4px;outline:none;font-size:16px';body.textContent='Edit this text'}
 else if(t==='image')body.innerHTML=`<img src="${o.src}" style="width:100%;height:100%;object-fit:contain">`;
 else if(t==='scale'){body.className='lay-body lay-scale';body.style.cssText='padding:22px 8px 0;font-size:11px'}
 $('#page').appendChild(el);
 if(t==='map'){const div=document.createElement('div');div.className='lay-mapdiv';body.appendChild(div);
  const m=L.map(div,{zoomControl:false,attributionControl:false,zoomSnap:0.25});m.createPane('rasterPane').style.zIndex=250;
  const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,crossOrigin:true});if(!WEB_ONLY&&$('#lay-base').checked)osm.addTo(m);
  L.control.scale({imperial:false,position:'bottomleft'}).addTo(m);m.fitBounds(map.getBounds());m.on('zoomend moveend',updScale);
  XM.push({el,map:m,osm,key:'lyrX'+nid++});syncFrames();setTimeout(()=>{m.invalidateSize();m.fitBounds(map.getBounds())},60)}
 select(el);updScale();
 el.addEventListener('pointerdown',()=>select(el),true);
 $('.x',el).onclick=e=>{e.stopPropagation();removeItem(el)};
 drag($('.lay-hd',el),e=>{const l=el.offsetLeft,tp=el.offsetTop;return(dx,dy)=>{el.style.left=l+dx+'px';el.style.top=tp+dy+'px'}});
 drag($('.lay-rs',el),e=>{const w=el.offsetWidth,h=el.offsetHeight;return(dx,dy)=>{el.style.width=Math.max(60,w+dx)+'px';el.style.height=Math.max(40,h+dy)+'px';const m=XM.find(x=>x.el===el);if(m)m.map.invalidateSize();updScale()}});
 return el}
function drag(h,start){h.addEventListener('pointerdown',e=>{if(e.target.classList.contains('x'))return;e.preventDefault();h.setPointerCapture(e.pointerId);const x0=e.clientX,y0=e.clientY,mv=start(e),k=layK||1;
 const move=ev=>mv((ev.clientX-x0)/k,(ev.clientY-y0)/k),up=()=>{h.removeEventListener('pointermove',move);h.removeEventListener('pointerup',up)};h.addEventListener('pointermove',move);h.addEventListener('pointerup',up)})}

/* ---- keep frames, legends and scale bars in sync with the layer list ---- */
function syncFrames(){XM.forEach(m=>{m.map.eachLayer(x=>{if(x!==m.osm)m.map.removeLayer(x)});S.layers.forEach(l=>{l[m.key]=null});syncOn(m.map,m.key,false)})}
function updScale(){$$('.lay-scale').forEach(b=>{const ref=(XM.find(x=>x.el===sel)||XM[0]||{}).map||layMap;if(!ref){b.innerHTML='';return}
 const lat=ref.getCenter().lat,mpp=40075016.686*Math.cos(lat*Math.PI/180)/(256*Math.pow(2,ref.getZoom())),target=110*mpp,pw=Math.pow(10,Math.floor(Math.log10(target))),nice=([5,2,1].find(k=>k*pw<=target)||1)*pw,px=Math.max(10,nice/mpp);
 b.innerHTML=`<div style="width:${px}px;border:2px solid #222;border-top:none;height:8px"></div><div>${nice>=1000?nice/1000+' km':nice+' m'}</div>`})}
function updLegends(){$$('.lay-legend').forEach(b=>b.innerHTML=legendHTML())}
const _ac=afterChange;afterChange=function(){_ac();syncFrames();updLegends();updScale()};
})();
