/* ArcGIS-style Identify and Select tools for GeoLite.
   Vector features are queried from the visible map layers; selection is non-destructive. */
(function(){
'use strict';
let mode=null, selected=[], panel, rail, lastHit=null;
const css=`
#gis-tool-rail{position:absolute;right:10px;top:12px;z-index:1200;display:flex;flex-direction:column;gap:5px;padding:5px;background:#fff;border:1px solid #cbd5cf;border-radius:9px;box-shadow:0 2px 8px #0003}
#gis-tool-rail button{width:42px;height:42px;padding:3px;font-size:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border:1px solid #cbd5cf;color:#34443b;background:#fff}
#gis-tool-rail button .ico{font-size:18px;line-height:19px}
#gis-tool-rail button.active{background:#1f6f4a;color:#fff;border-color:#1f6f4a}
#gis-identify-panel{position:absolute;right:62px;top:12px;bottom:12px;width:min(310px,calc(100% - 78px));z-index:1150;background:#fff;border:1px solid #cbd5cf;border-radius:9px;box-shadow:0 2px 12px #0003;display:none;flex-direction:column;overflow:hidden}
#gis-identify-panel.open{display:flex}
#gis-identify-panel .ghead{display:flex;align-items:center;gap:6px;padding:9px;border-bottom:1px solid #e0e5e2;font-weight:650}
#gis-identify-panel .ghead span{flex:1}
#gis-identify-panel .gbody{overflow:auto;padding:9px;font-size:12px}
#gis-identify-panel .gfeature{border:1px solid #e0e5e2;border-radius:7px;padding:7px;margin-bottom:8px}
#gis-identify-panel .gfeature h4{margin:0 0 5px;font-size:12px}
#gis-identify-panel table{width:100%;border-collapse:collapse;table-layout:fixed}
#gis-identify-panel td,#gis-identify-panel th{padding:4px;border-bottom:1px solid #edf0ee;text-align:left;vertical-align:top;overflow-wrap:anywhere}
#gis-identify-panel th{width:42%;color:#536159;font-weight:600}
#gis-identify-panel .gmuted{color:#68746e}
@media(max-width:600px){#gis-tool-rail{right:7px;top:8px}#gis-identify-panel{right:57px;top:8px;bottom:8px;width:min(285px,calc(100% - 70px))}}
`;
function escHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function setup(){
 if(!window.L||!map||document.getElementById('gis-tool-rail'))return;
 const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
 const host=document.getElementById('view-map');
 rail=document.createElement('div');rail.id='gis-tool-rail';
 rail.innerHTML='<button type="button" data-mode="identify" title="Identify features"><span class="ico">ⓘ</span>Identify</button><button type="button" data-mode="select" title="Select features"><span class="ico">▧</span>Select</button>';
 panel=document.createElement('aside');panel.id='gis-identify-panel';
 panel.innerHTML='<div class="ghead"><span id="gis-panel-title">Identify</span><button type="button" id="gis-clear" class="sm">Clear</button><button type="button" id="gis-close" class="sm">×</button></div><div class="gbody" id="gis-panel-body"><p class="gmuted">Choose Identify or Select, then tap a feature on the map.</p></div>';
 host.append(rail,panel);
 rail.addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(!b)return;setMode(mode===b.dataset.mode?null:b.dataset.mode)});
 panel.querySelector('#gis-close').onclick=()=>setMode(null);
 panel.querySelector('#gis-clear').onclick=clearSelection;
 map.on('click',onMapClick);
}
function setMode(next){
 mode=next;
 if(rail)rail.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 if(panel){panel.classList.toggle('open',!!mode);panel.querySelector('#gis-panel-title').textContent=mode==='select'?'Select features':'Identify';}
 if(map&&map.getContainer())map.getContainer().style.cursor=mode?'crosshair':'';
 if(mode==='identify')renderIdentify(null);
 if(mode==='select')renderSelection();
}
function featureHit(latlng){
 const p=map.latLngToLayerPoint(latlng), hits=[];
 // S.layers is newest-first, matching the visual draw order.
 for(const l of S.layers){
  if(!l.visible||l.type!=='vector'||!l.lyr||!map.hasLayer(l.lyr))continue;
  l.lyr.eachLayer(child=>{
   let hit=false;
   try{
    if(child.getBounds&&child.getBounds().isValid()&&!child.getBounds().contains(latlng))return;
    if(child._containsPoint)hit=!!child._containsPoint(p);
    else if(child.getLatLng){const q=map.latLngToLayerPoint(child.getLatLng());hit=q.distanceTo(p)<=Math.max(10,(child.options&&child.options.radius||6)+5)}
    else if(child.getBounds)hit=child.getBounds().contains(latlng);
   }catch(_){}
   if(hit)hits.push({layer:l,child,feature:child.feature});
  });
  if(hits.length)break;
 }
 return hits;
}
function onMapClick(e){
 if(!mode)return;
 const hits=featureHit(e.latlng);
 if(mode==='identify'){renderIdentify(hits[0]||null);if(!hits.length)toast('No visible vector feature at this location');return}
 if(!hits.length){toast('No feature found to select');return}
 const h=hits[0],key=h.layer.id+':'+h.layer.data.features.indexOf(h.feature);
 const idx=selected.findIndex(x=>x.key===key);
 if(e.originalEvent&&e.originalEvent.shiftKey){if(idx>=0)selected.splice(idx,1);else selected.push({...h,key})}
 else if(idx>=0)selected.splice(idx,1);else selected=[{...h,key}];
 paintSelection();renderSelection();
}
function renderIdentify(hit){
 if(!panel)return;
 const body=panel.querySelector('#gis-panel-body');
 if(!hit){body.innerHTML='<p class="gmuted">Tap a visible vector feature to inspect its attributes.</p>';return}
 const props=hit.feature&&hit.feature.properties||{},rows=Object.entries(props);
 body.innerHTML='<div class="gfeature"><h4>'+escHTML(hit.layer.name)+'</h4><table>'+ (rows.length?rows.map(([k,v])=>'<tr><th>'+escHTML(k)+'</th><td>'+escHTML(typeof v==='object'?JSON.stringify(v):v)+'</td></tr>').join(''):'<tr><td class="gmuted">No attributes</td></tr>')+'</table></div>';
}
function renderSelection(){
 if(!panel)return;
 const body=panel.querySelector('#gis-panel-body');
 if(!selected.length){body.innerHTML='<p class="gmuted">Tap a feature to select it. Hold Shift while tapping to add or remove multiple features.</p>';return}
 body.innerHTML='<p><b>'+selected.length+'</b> feature(s) selected. Hold Shift and tap to add/remove.</p>'+selected.map((h,i)=>{
  const p=h.feature&&h.feature.properties||{},entries=Object.entries(p).slice(0,8);
  return '<div class="gfeature"><h4>'+escHTML(h.layer.name)+' — Feature '+(i+1)+'</h4><table>'+entries.map(([k,v])=>'<tr><th>'+escHTML(k)+'</th><td>'+escHTML(typeof v==='object'?JSON.stringify(v):v)+'</td></tr>').join('')+'</table></div>';
 }).join('');
}
function paintSelection(){
 // Restore each feature's layer style, then apply a temporary highlight.
 for(const l of S.layers){if(l.type!=='vector'||!l.lyr)continue;l.lyr.eachLayer(child=>{if(child.setStyle){try{child.setStyle(styleFor(l,child.feature))}catch(_){}}});}
 for(const h of selected){if(h.child&&h.child.setStyle){try{h.child.setStyle({color:'#ff8c00',weight:4,opacity:1,fillColor:'#ffd54f',fillOpacity:.65})}catch(_){}}}
}
function clearSelection(){selected=[];paintSelection();renderSelection()}
window.GeoLiteIdentifySelect={setMode,clearSelection,getSelected:()=>selected.map(h=>({layer:h.layer.name,properties:{...(h.feature&&h.feature.properties||{})}}))};
window.addEventListener('geolite-map-ready',setup);
if(map)setup();
})();