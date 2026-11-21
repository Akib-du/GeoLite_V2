/* GeoLite map customization: basemaps, layer symbols, map scale and control placement. */
(function(){
'use strict';
const $id=id=>document.getElementById(id);
let imagery=null, scaleControl=null, scaleCfg={units:'metric',width:120,divisions:4,position:'bottomleft'};
let baseChoice='osm';
function addStyles(){
 const s=document.createElement('style');s.textContent=`
 #map-tools{position:absolute;z-index:1200;top:8px;right:8px;display:flex;gap:6px;align-items:center;background:#fffE;padding:6px;border:1px solid #cbd5cf;border-radius:8px;box-shadow:0 1px 5px #0002;max-width:calc(100% - 16px);flex-wrap:wrap}
 #map-tools select,#map-tools button{font-size:12px;padding:5px 7px}
 .gl-marker{width:100%;height:100%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;line-height:1;white-space:nowrap}
 .gl-marker.circle{border-radius:50%}.gl-marker.square{border-radius:2px}.gl-marker.diamond{transform:rotate(45deg);border-radius:1px}.gl-marker.triangle{clip-path:polygon(50% 0,0 100%,100% 100%)}
 .gl-marker.star{clip-path:polygon(50% 0,61% 36%,98% 36%,68% 58%,79% 96%,50% 73%,21% 96%,32% 58%,2% 36%,39% 36%)}
 .gl-scale{background:#ffffffdf;padding:4px 6px;border:1px solid #666;border-radius:3px;color:#222;font-size:11px;min-width:80px;text-align:center}
 .gl-scale-bar{height:8px;display:flex;border:1px solid #222;margin-top:2px}
 .gl-scale-seg{flex:1;border-right:1px solid #222}.gl-scale-seg:nth-child(odd){background:#222}.gl-scale-seg:nth-child(even){background:#fff}.gl-scale-seg:last-child{border:0}
 .gl-style-preview{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px}
 `;document.head.appendChild(s);
}
function setBase(v){
 baseChoice=v;
 if(map&&osm&&map.hasLayer(osm))map.removeLayer(osm);
 if(map&&imagery&&map.hasLayer(imagery))map.removeLayer(imagery);
 if(v==='osm'&&osm)osm.addTo(map);
 if(v==='imagery'){if(!imagery)imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});imagery.addTo(map)}
 toast(v==='none'?'Basemap off':v==='imagery'?'Imagery basemap enabled':'OpenStreetMap basemap enabled');
}
function niceDistance(m){const p=Math.pow(10,Math.floor(Math.log10(Math.max(m,0.000001)))),n=m/p;return (n>=5?5:n>=2?2:1)*p}
function formatDistance(m,units){if(units==='imperial'){const ft=m*3.280839895;if(ft>=5280){const mi=ft/5280;return (mi>=10?mi.toFixed(0):mi.toFixed(1))+' mi'}return (ft>=100?Math.round(ft/10)*10:Math.round(ft))+' ft'}
 if(m>=1000)return (m>=10000?(m/1000).toFixed(0):(m/1000).toFixed(1))+' km';return Math.round(m)+' m'}
function installScale(){
 const old=document.querySelector('#map .leaflet-control-scale');if(old)old.remove();
 if(scaleControl){try{map.removeControl(scaleControl)}catch(e){}}
 scaleControl=L.control({position:scaleCfg.position});
 scaleControl.onAdd=function(m){
  const el=L.DomUtil.create('div','gl-scale');el.innerHTML='<div class="gl-scale-label"></div><div class="gl-scale-bar"></div>';
  L.DomEvent.disableClickPropagation(el);
  const update=()=>{
   const lat=m.getCenter().lat, meters=m.distance(m.containerPointToLatLng([0,m.getSize().y/2]),m.containerPointToLatLng([scaleCfg.width,m.getSize().y/2]));
   const nice=niceDistance(meters),px=Math.max(24,scaleCfg.width*nice/meters),parts=scaleCfg.divisions;
   el.querySelector('.gl-scale-label').textContent=formatDistance(nice,scaleCfg.units);
   el.querySelector('.gl-scale-bar').style.width=px+'px';
   el.querySelector('.gl-scale-bar').innerHTML=Array.from({length:parts},()=>'<span class="gl-scale-seg"></span>').join('');
  };
  m.on('zoom move resize',update);setTimeout(update,0);el._update=update;return el;
 };
 scaleControl.addTo(map);
}
function updateScale(){if(scaleControl)map.removeControl(scaleControl);installScale()}
function openMapProperties(){
 openModal('<h3>Map & display properties</h3>'+
 '<label>Basemap <select id="mc-base"><option value="osm">OpenStreetMap</option><option value="imagery">Imagery (Esri World Imagery)</option><option value="none">No basemap</option></select></label>'+
 '<fieldset><legend>Scale bar</legend><label>Units <select id="mc-units"><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>'+
 '<div class="row"><label style="flex:1">Width (px) <input id="mc-width" type="number" min="60" max="300" value="'+scaleCfg.width+'"></label><label style="flex:1">Divisions <input id="mc-div" type="number" min="2" max="10" value="'+scaleCfg.divisions+'"></label></div>'+
 '<label>Position <select id="mc-pos"><option value="bottomleft">Bottom left</option><option value="bottomright">Bottom right</option><option value="topleft">Top left</option><option value="topright">Top right</option></select></label></fieldset>'+
 '<fieldset><legend>Map controls</legend><label>Zoom control position <select id="mc-zoom"><option value="topleft">Top left</option><option value="topright">Top right</option><option value="bottomleft">Bottom left</option><option value="bottomright">Bottom right</option></select></label></fieldset>'+
 '<div class="row"><button class="pri" id="mc-apply">Apply</button><button onclick="closeModal()">Cancel</button></div>',false);
 $id('mc-base').value=baseChoice;$id('mc-units').value=scaleCfg.units;$id('mc-pos').value=scaleCfg.position;$id('mc-zoom').value=map.zoomControl.getPosition();
 $id('mc-apply').onclick=()=>{
  scaleCfg={units:$id('mc-units').value,width:Math.max(60,Math.min(300,+$id('mc-width').value||120)),divisions:Math.max(2,Math.min(10,+$id('mc-div').value||4)),position:$id('mc-pos').value};
  setBase($id('mc-base').value);map.zoomControl.setPosition($id('mc-zoom').value);updateScale();closeModal();
 };
}
function openLayerSymbol(id){
 const l=byId(id);if(!l||l.type!=='vector')return;
 const st=l.style,shape=st.markerShape||'circle',icon=st.markerIcon||'',size=st.markerSize||st.radius||7;
 openModal('<h3>Advanced symbol — '+esc(l.name)+'</h3>'+
 '<label>Point icon / marker shape <select id="gl-shape"><option value="circle">Circle</option><option value="square">Square</option><option value="diamond">Diamond</option><option value="triangle">Triangle</option><option value="star">Star</option><option value="text">Custom text / emoji</option></select></label>'+
 '<label>Custom icon text <input id="gl-icon" type="text" maxlength="4" placeholder="e.g. ★ or 🌳"></label>'+
 '<div class="row"><label style="flex:1">Marker size (px) <input id="gl-size" type="number" min="3" max="48" value="'+size+'"></label><label style="flex:1">Label size (px) <input id="gl-labelsize" type="number" min="8" max="28" value="'+(st.labelSize||11)+'"></label></div>'+
 '<div class="row"><label style="flex:1">Outline width <input id="gl-outline" type="number" min="0" max="12" step=".5" value="'+(st.strokeW||1)+'"></label><label style="flex:1">Opacity <input id="gl-opacity" type="number" min=".05" max="1" step=".05" value="'+(st.opacity||.9)+'"></label></div>'+
 '<p><small>Point icon settings apply to point features. Line and polygon fill/outline colors remain controlled by Style.</small></p>'+
 '<div class="row"><button class="pri" id="gl-apply">Apply</button><button onclick="closeModal()">Cancel</button></div>');
 $id('gl-shape').value=shape;$id('gl-icon').value=icon;
 $id('gl-apply').onclick=()=>{
  st.markerShape=$id('gl-shape').value;st.markerIcon=$id('gl-icon').value;
  st.markerSize=Math.max(3,Math.min(48,+$id('gl-size').value||7));st.radius=st.markerSize;
  st.labelSize=Math.max(8,Math.min(28,+$id('gl-labelsize').value||11));
  st.strokeW=Math.max(0,Math.min(12,+$id('gl-outline').value||0));st.opacity=Math.max(.05,Math.min(1,+$id('gl-opacity').value||.9));
  l.style=st;invalidate(l);closeModal();afterChange();
 };
}
function installMarkerRenderer(){
 const old=makeLeaflet;
 makeLeaflet=function(l,pop){
  if(l.type!=='vector')return old(l,pop);
  let n=0;
  return L.geoJSON(l.data,{pointToLayer:(f,ll)=>{
   const st=l.style,sz=st.markerSize||st.radius||6,shape=st.markerShape||'circle',custom=st.markerIcon||'';
   if(shape==='text'||custom){const html='<div class="gl-marker" style="font-size:'+sz+'px;color:'+st.fill+';text-shadow:0 0 2px white">'+esc(custom||'●')+'</div>';return L.marker(ll,{icon:L.divIcon({className:'',html,iconSize:[sz*2,sz*2],iconAnchor:[sz,sz]})})}
   const html='<div class="gl-marker '+shape+'" style="background:'+st.fill+';border:'+Math.max(0,st.strokeW||1)+'px solid '+st.stroke+';opacity:'+st.opacity+'"></div>';
   return L.marker(ll,{icon:L.divIcon({className:'',html,iconSize:[sz*2,sz*2],iconAnchor:[sz,sz]})});
  },style:f=>styleFor(l,f),onEachFeature:(f,lyr)=>{
   if(pop)lyr.bindPopup(()=>popupHTML(f),{maxHeight:240});
   const v=l.style.label&&f.properties?.[l.style.label];
   if(v!=null&&v!==false&&n++<500)lyr.bindTooltip(String(v),{permanent:true,direction:'center',className:'lbl'});
  }});
 };
}
function installToolbar(){
 if($id('map-tools'))return;
 const bar=document.createElement('div');bar.id='map-tools';
 bar.innerHTML='<label style="margin:0;font-size:11px">Basemap <select id="mc-quick-base"><option value="osm">OpenStreetMap</option><option value="imagery">Imagery</option><option value="none">None</option></select></label><button id="mc-properties" class="sm">Map properties ⚙</button>';
 $id('view-map').appendChild(bar);
 $id('mc-quick-base').value=baseChoice;$id('mc-quick-base').onchange=e=>setBase(e.target.value);
 $id('mc-properties').onclick=openMapProperties;
}
function addAdvancedButtons(){
 const el=$id('side-layers');if(!el||el.dataset.advanced==='1')return;el.dataset.advanced='1';
 el.addEventListener('click',e=>{if(e.target.dataset.a==='advanced'){const card=e.target.closest('.layer');if(card)openLayerSymbol(+card.dataset.id)}});
 const observer=new MutationObserver(()=>{
  el.querySelectorAll('.layer').forEach(card=>{
   const l=byId(card.dataset.id);if(!l||l.type!=='vector'||card.querySelector('[data-a="advanced"]'))return;
   const btn=document.createElement('button');btn.className='sm';btn.dataset.a='advanced';btn.textContent='Symbol ⚙';
   const ref=card.querySelector('[data-a="style"]');if(ref)ref.after(btn);
  });
 });observer.observe(el,{childList:true,subtree:true});
}
function boot(){
 addStyles();installMarkerRenderer();installToolbar();installScale();addAdvancedButtons();
 const quick=$id('mc-quick-base');if(quick)quick.value=baseChoice;
}
window.addEventListener('geolite-map-ready',()=>setTimeout(boot,0));
if(typeof map!=='undefined'&&map)setTimeout(boot,0);
})();
