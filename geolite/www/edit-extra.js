/* GeoLite Edit menu: create feature classes, add / move / reshape / delete features, edit attribute tables,
   add / rename / delete fields, populate fields (field calculator), undo. Loaded after the main script. */
(function(){
'use strict';
const E=window.EDIT={tool:null,layerId:null,sel:null,vsel:null,draw:null,table:null,tsel:new Set()};
const PAGE=50;
let grp=null,hl=null;

/* ---------- styles ---------- */
const css=document.createElement('style');
css.textContent=`#edit-bar{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:1100;background:#fff;border:1px solid #1f6f4a;border-radius:10px;box-shadow:0 2px 10px #0004;padding:6px 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;max-width:94vw;font-size:12px}
#edit-bar .msg{color:#1c2421;font-weight:600}
.ev-v,.ev-m,.ev-c{background:transparent;border:0}
.ev-v i,.ev-m i,.ev-c i{display:block;box-sizing:border-box}
.ev-v i{width:16px;height:16px;margin:3px;border-radius:50%;background:#fff;border:3px solid #e11d48}
.ev-v.sel i{background:#e11d48}
.ev-m i{width:10px;height:10px;margin:6px;background:#fff;border:2px solid #2563eb;border-radius:2px;opacity:.85}
.ev-c i{width:26px;height:26px;margin:0;border-radius:50%;background:#2563eb;color:#fff;text-align:center;line-height:26px;font-style:normal;font-size:15px;border:2px solid #fff;box-shadow:0 1px 4px #0006}
table.et{border-collapse:collapse;font-size:12px}
table.et th,table.et td{border:1px solid #d4dad7;padding:1px 2px;white-space:nowrap}
table.et th{background:#eef2f0;position:sticky;top:0;z-index:1;padding:3px 6px}
table.et th small{display:block;font-weight:400;color:#68746e}
table.et input[type=text]{width:100px;border:0;padding:3px 4px;background:transparent;outline:none}
table.et input[type=text]:focus{background:#fff8d6}
table.et td.n{text-align:center;background:#f6f8f7}
.es-sec{border:1px solid #dbe1de;border-radius:8px;margin:8px 0;padding:6px 8px}
.es-sec legend{font-size:12px;color:#55615b}
.es-sec .row{margin:4px 0}
.fc-row{display:flex;gap:4px;margin:3px 0}.fc-row input{flex:1;min-width:0}`;
document.head.appendChild(css);

/* ---------- helpers ---------- */
const vecs=()=>S.layers.filter(l=>l.type==='vector');
const tgt=()=>{const l=byId(E.layerId);return l&&l.type==='vector'?l:null};
const TYPES=[['text','Text'],['integer','Integer'],['decimal','Decimal']];
const typeOpts=sel=>TYPES.map(([v,t])=>`<option value="${v}" ${v===sel?'selected':''}>${t}</option>`).join('');

function inferType(l,k){let n=0,c=0,allInt=true;for(const f of l.data.features.slice(0,300)){const v=f.properties?.[k];if(v===null||v===undefined||v==='')continue;c++;if(typeof v==='number'||(typeof v==='string'&&v.trim()!==''&&isFinite(+v))){n++;if(!Number.isInteger(+v))allInt=false}}
 return c>0&&n===c?(allInt?'integer':'decimal'):'text'}
function ensureFields(l){if(!l.fields)l.fields=[];const have=new Set(l.fields.map(f=>f.name));
 const seen=new Set();for(const f of l.data.features)for(const k of Object.keys(f.properties||{}))seen.add(k);
 for(const k of seen)if(!have.has(k))l.fields.push({name:k,type:inferType(l,k)});return l.fields}
function coerce(v,type){if(v===''||v===null||v===undefined)return null;
 if(type==='integer'){const n=parseInt(v,10);return isFinite(n)?n:null}
 if(type==='decimal'){const n=parseFloat(v);return isFinite(n)?n:null}
 return String(v)}
const blankProps=l=>{const p={};ensureFields(l).forEach(f=>p[f.name]=null);return p};
function validName(l,name,except){name=(name||'').trim();if(!name)throw new Error('Enter a field name');if(name.length>63)throw new Error('Field name is too long');
 if(ensureFields(l).some(f=>f.name.toLowerCase()===name.toLowerCase()&&f.name!==except))throw new Error('A field called "'+name+'" already exists');return name}

/* ---------- undo ---------- */
const UNDO=new Map();
function snap(l){const a=UNDO.get(l.id)||[];const s=JSON.stringify({d:l.data,f:l.fields||null});if(s.length>12e6){toast('Layer is very large: undo is not available for this change',4000);return}a.push(s);if(a.length>10)a.shift();UNDO.set(l.id,a)}
function undo(){const l=tgt();if(!l)return;const a=UNDO.get(l.id);if(!a||!a.length)return toast('Nothing to undo');const o=JSON.parse(a.pop());l.data=o.d;l.fields=o.f;E.sel=null;E.vsel=null;E.tsel.clear();clearHandles();commit(l);toast('Undone');if(E.table&&E.table.id===l.id&&$('#modal').classList.contains('on'))openEditTable(l,E.table.page)}
function commit(l){invalidate(l);afterChange()}

/* ---------- editing state (popups off while a map tool is active) ---------- */
function setEditing(on){if(!!window.EDITING===on)return;window.EDITING=on;S.layers.forEach(l=>{if(l.lyr&&map.hasLayer(l.lyr))map.removeLayer(l.lyr);l.lyr=null});afterChange()}
function stop(){const had=E.tool;E.tool=null;E.draw=null;E.sel=null;E.vsel=null;clearGroup();if(map&&map.doubleClickZoom)map.doubleClickZoom.enable();if(had||window.EDITING)setEditing(false);updateBar();if(had)E.render()}
E.stop=stop;
function clearGroup(){if(grp)grp.clearLayers();hl=null}
function clearHandles(){clearGroup()}

/* ---------- floating tool bar ---------- */
function updateBar(){const b=$('#edit-bar');if(!b)return;const sideOver=$('#side').classList.contains('on')&&innerWidth<=760;
 if(!E.tool||sideOver){b.style.display='none';return}
 let h='';
 if(E.tool==='add'){const d=E.draw;
  if(d.type==='Point')h=`<span class="msg">Tap the map to place a point</span>`;
  else h=`<span class="msg">${d.type==='Polygon'?'Polygon':'Line'}: ${d.pts.length} vertex(es)</span><button class="sm" data-eb="vundo">Undo</button><button class="sm pri" data-eb="finish">Finish</button>`}
 else if(E.tool==='select'){
  if(!E.sel)h=`<span class="msg">Tap a feature to select it</span>`;
  else h=`<span class="msg">Drag ● to reshape, ◼ to add a vertex, ✥ to move</span><button class="sm" data-eb="attr">Attributes</button><button class="sm" data-eb="delf">Delete feature</button><button class="sm" data-eb="delv">Delete vertex</button><button class="sm" data-eb="desel">Deselect</button>`}
 h+=`<button class="sm" data-eb="stop">Stop</button>`;b.innerHTML=h;b.style.display='flex'}
E.updateBar=updateBar;

function barClick(e){const a=e.target.dataset.eb;if(!a)return;const l=tgt();
 if(a==='stop')return stop();
 if(a==='vundo'&&E.draw){E.draw.pts.pop();drawPreview();updateBar()}
 else if(a==='finish')finishDraw();
 else if(a==='attr'&&l&&E.sel)featureForm(l,E.sel,false);
 else if(a==='delf'&&l&&E.sel){if(confirm('Delete the selected feature?')){snap(l);l.data.features=l.data.features.filter(f=>f!==E.sel);E.tsel.delete(E.sel);E.sel=null;E.vsel=null;clearGroup();commit(l);updateBar();toast('Feature deleted')}}
 else if(a==='delv')deleteVertex();
 else if(a==='desel')deselect()}

/* ---------- geometry helpers ---------- */
function parts(g){const t=g.type,c=g.coordinates;
 if(t==='Point')return[{k:'pt',pts:[c]}];
 if(t==='MultiPoint')return[{k:'mp',pts:c}];
 if(t==='LineString')return[{k:'ln',pts:c}];
 if(t==='MultiLineString')return c.map(p=>({k:'ln',pts:p}));
 if(t==='Polygon')return c.map(p=>({k:'rg',pts:p}));
 if(t==='MultiPolygon')return c.flatMap(poly=>poly.map(p=>({k:'rg',pts:p})));
 return[]}
const nv=p=>p.k==='rg'?p.pts.length-1:p.pts.length;
const ll=pos=>[pos[1],pos[0]];

function segDist(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,L=dx*dx+dy*dy;let t=L?((p.x-a.x)*dx+(p.y-a.y)*dy)/L:0;t=Math.max(0,Math.min(1,t));const x=a.x+t*dx,y=a.y+t*dy;return Math.hypot(p.x-x,p.y-y)}
function inRing(pt,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
function featDist(g,p,latlng){const pt=[latlng.lng,latlng.lat],px=pos=>map.latLngToLayerPoint(ll(pos));let d=1e9;
 const ps=parts(g);
 if(g.type==='Point'||g.type==='MultiPoint'){for(const pa of ps)for(const q of pa.pts)d=Math.min(d,p.distanceTo(px(q)));return d}
 for(const pa of ps){const P=pa.pts.map(px);for(let i=0;i<P.length-1;i++)d=Math.min(d,segDist(p,P[i],P[i+1]))}
 if(/Polygon/.test(g.type)){const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;for(const poly of polys){if(inRing(pt,poly[0])&&!poly.slice(1).some(h=>inRing(pt,h)))d=Math.min(d,10)}}
 return d}
function hit(l,latlng){const p=map.latLngToLayerPoint(latlng),tol=14;let best=null,bd=1e9;
 for(const f of l.data.features){if(!f.geometry)continue;const d=featDist(f.geometry,p,latlng);if(d<=bd){bd=d;best=f}}return bd<=tol?best:null}

/* ---------- tool: add feature ---------- */
function startAdd(){const l=tgt();if(!l)return toast('Choose a layer to edit first');
 const m={point:'Point',line:'LineString',polygon:'Polygon'}[l.kind];
 if(m)return beginAdd(l,m);
 openModal(`<h3>Add feature to “${esc(l.name)}”</h3><p>This layer has mixed geometry. Which type do you want to draw?</p><div class="row"><button data-g="Point">Point</button><button data-g="LineString">Line</button><button data-g="Polygon">Polygon</button><button onclick="closeModal()">Cancel</button></div>`);
 $$('#modalBody [data-g]').forEach(b=>b.onclick=()=>{closeModal();beginAdd(l,b.dataset.g)})}
function beginAdd(l,type){if(!l.visible){l.visible=true;afterChange()}stop();E.tool='add';E.draw={type,pts:[]};map.doubleClickZoom.disable();setEditing(true);
 if(innerWidth<=760)showTab('map');updateBar();E.render()}
function drawPreview(){clearGroup();const d=E.draw;if(!d)return;const lls=d.pts.map(ll);
 if(lls.length>1){(d.type==='Polygon'&&lls.length>2?L.polygon:L.polyline)(lls,{pane:'editPane',color:'#e11d48',weight:3,dashArray:'6 4',fillOpacity:.15,interactive:false}).addTo(grp)}
 lls.forEach(p=>L.circleMarker(p,{pane:'editPane',radius:5,color:'#e11d48',fillColor:'#fff',fillOpacity:1,weight:2,interactive:false}).addTo(grp))}
function addClick(l,latlng){const d=E.draw,pos=[+latlng.lng.toFixed(8),+latlng.lat.toFixed(8)];
 if(d.type==='Point'){newFeature(l,{type:'Point',coordinates:pos});return}
 d.pts.push(pos);drawPreview();updateBar()}
function finishDraw(){const l=tgt(),d=E.draw;if(!l||!d)return;
 if(d.type==='LineString'){if(d.pts.length<2)return toast('A line needs at least 2 vertices');const g={type:'LineString',coordinates:d.pts.map(p=>p.slice())};d.pts=[];clearGroup();updateBar();newFeature(l,g)}
 else if(d.type==='Polygon'){if(d.pts.length<3)return toast('A polygon needs at least 3 vertices');const r=d.pts.map(p=>p.slice());r.push(r[0].slice());
  let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];if(a>0)r.reverse(); // clockwise outer ring (shapefile convention)
  d.pts=[];clearGroup();updateBar();newFeature(l,{type:'Polygon',coordinates:[r]})}}
function newFeature(l,geometry){const f={type:'Feature',properties:blankProps(l),geometry};
 if(!ensureFields(l).length){snap(l);l.data.features.push(f);commit(l);toast('Feature added (layer has no fields yet)');return}
 featureForm(l,f,true)}

/* ---------- attribute form for a single feature ---------- */
function inputFor(fl,v,id){const val=v===null||v===undefined?'':v;
 return `<input type="text" id="${id}" value="${esc(val)}" ${fl.type!=='text'?'inputmode="decimal"':''} style="width:100%;padding:6px">`}
function featureForm(l,f,isNew){const fs=ensureFields(l);
 openModal(`<h3>${isNew?'New feature':'Attributes'} — ${esc(l.name)}</h3>${fs.length?fs.map((fl,i)=>`<label>${esc(fl.name)} <small>(${fl.type})</small>${inputFor(fl,f.properties?.[fl.name],'fv'+i)}</label>`).join(''):'<p><small>This layer has no fields. Use “Add field” first.</small></p>'}
  <div class="row"><button class="pri" id="fv-save">${isNew?'Add feature':'Save'}</button><button id="fv-cancel">${isNew?'Discard':'Cancel'}</button></div>`);
 $('#fv-save').onclick=()=>{snap(l);f.properties=f.properties||{};fs.forEach((fl,i)=>{f.properties[fl.name]=coerce($('#fv'+i).value,fl.type)});if(isNew)l.data.features.push(f);closeModal();commit(l);if(isNew)toast('Feature added');else if(E.sel===f)showHandles()};
 $('#fv-cancel').onclick=()=>closeModal()}

/* ---------- tool: select / modify ---------- */
function startSelect(){const l=tgt();if(!l)return toast('Choose a layer to edit first');if(!l.data.features.length)return toast('This layer has no features yet. Use “Add feature”.');
 if(!l.visible){l.visible=true;afterChange()}stop();E.tool='select';map.doubleClickZoom.disable();setEditing(true);if(innerWidth<=760)showTab('map');updateBar();E.render()}
function deselect(){E.sel=null;E.vsel=null;clearGroup();updateBar()}
function select(f){E.sel=f;E.vsel=null;showHandles();updateBar()}
function mkIcon(c){return L.divIcon({className:c,iconSize:[22,22],iconAnchor:[11,11],html:'<i></i>'})}
function showHandles(){clearGroup();const f=E.sel,l=tgt();if(!f||!l||!f.geometry)return;
 hl=L.geoJSON(f,{pane:'editPane',interactive:false,style:{color:'#ffea00',weight:5,opacity:.9,fillOpacity:0},pointToLayer:(x,p)=>L.circleMarker(p,{pane:'editPane',radius:11,color:'#ffea00',weight:4,fillOpacity:0,interactive:false})}).addTo(grp);
 const ps=parts(f.geometry);let total=0;ps.forEach(p=>total+=nv(p));
 if(total>2000){toast('Too many vertices to show handles. Use Simplify (Tools) first.',5000);return}
 const refresh=()=>{hl.clearLayers();hl.addData(f)};
 ps.forEach((pa,pi)=>{const n=nv(pa);
  for(let i=0;i<n;i++){const pos=pa.pts[i];const sel=E.vsel&&E.vsel.pi===pi&&E.vsel.i===i;
   const m=L.marker(ll(pos),{pane:'editPane',draggable:true,icon:mkIcon('ev-v'+(sel?' sel':'')),keyboard:false}).addTo(grp);
   m.on('dragstart',()=>snap(l));
   m.on('drag',ev=>{const p=ev.target.getLatLng();pos[0]=p.lng;pos[1]=p.lat;if(pa.k==='rg'&&i===0){const z=pa.pts[pa.pts.length-1];z[0]=p.lng;z[1]=p.lat}refresh()});
   m.on('dragend',ev=>{const p=ev.target.getLatLng();pos[0]=+p.lng.toFixed(8);pos[1]=+p.lat.toFixed(8);if(pa.k==='rg'&&i===0){const z=pa.pts[pa.pts.length-1];z[0]=pos[0];z[1]=pos[1]}setTimeout(()=>{commit(l);showHandles()},0)});
   m.on('click',()=>{E.vsel={pi,i};showHandles();updateBar()})}
  if(pa.k==='ln'||pa.k==='rg'){const segs=pa.k==='rg'?n:n-1;
   for(let i=0;i<segs;i++){const a=pa.pts[i],b=pa.pts[(i+1)%n===0&&pa.k==='rg'?0:i+1];
    const m=L.marker([(a[1]+b[1])/2,(a[0]+b[0])/2],{pane:'editPane',draggable:true,icon:mkIcon('ev-m'),keyboard:false}).addTo(grp);
    m.on('dragstart',()=>snap(l));
    m.on('dragend',ev=>{const p=ev.target.getLatLng();pa.pts.splice(i+1,0,[+p.lng.toFixed(8),+p.lat.toFixed(8)]);setTimeout(()=>{commit(l);showHandles()},0)})}}});
 if(f.geometry.type!=='Point'){const b=L.geoJSON(f).getBounds();if(b.isValid()){const c=b.getCenter(),orig=JSON.stringify(f.geometry.coordinates);let st=null;
  const m=L.marker(c,{pane:'editPane',draggable:true,icon:L.divIcon({className:'ev-c',iconSize:[30,30],iconAnchor:[15,15],html:'<i>✥</i>'}),keyboard:false}).addTo(grp);
  m.on('dragstart',()=>{snap(l);st=c;});
  m.on('drag',ev=>{const p=ev.target.getLatLng(),dx=p.lng-st.lng,dy=p.lat-st.lat;const o=JSON.parse(orig);const sh=a=>typeof a[0]==='number'?(a[0]+=dx,a[1]+=dy):a.forEach(sh);sh(o);f.geometry.coordinates=o;refresh()});
  m.on('dragend',()=>{const sh=a=>typeof a[0]==='number'?(a[0]=+a[0].toFixed(8),a[1]=+a[1].toFixed(8)):a.forEach(sh);sh(f.geometry.coordinates);setTimeout(()=>{commit(l);showHandles()},0)})}}}
function deleteVertex(){const l=tgt(),f=E.sel;if(!l||!f)return;if(!E.vsel)return toast('Tap a ● vertex first, then “Delete vertex”');
 const pa=parts(f.geometry)[E.vsel.pi];if(!pa)return;const n=nv(pa),min=pa.k==='rg'?3:pa.k==='ln'?2:pa.k==='mp'?1:99;
 if(n<=min)return toast(pa.k==='pt'?'A point has no vertex to remove — delete the feature instead':'Cannot go below '+min+' vertices');
 snap(l);pa.pts.splice(E.vsel.i,1);if(pa.k==='rg')pa.pts[pa.pts.length-1]=pa.pts[0].slice();E.vsel=null;commit(l);showHandles();updateBar()}

function onMapClick(e){if(!E.tool)return;const l=tgt();if(!l){stop();return}
 if(E.tool==='add')return addClick(l,e.latlng);
 if(E.tool==='select'){const f=hit(l,e.latlng);if(f)select(f);else deselect()}}

/* ---------- feature class ---------- */
function uniqueName(n){n=(n||'').trim()||'new_layer';let k=n,i=2;while(S.layers.some(l=>l.name===k))k=n+'_'+i++;return k}
function newFeatureClassDialog(){
 openModal(`<h3>New feature class</h3>
  <label>Name <input type="text" id="fc-name" value="new_layer"></label>
  <label>Geometry type <select id="fc-geom"><option value="point">Point</option><option value="line">Line</option><option value="polygon">Polygon</option></select></label>
  <fieldset class="es-sec"><legend>Fields</legend><div id="fc-rows"></div><button class="sm" id="fc-add">+ Add field</button></fieldset>
  <div class="row"><button class="pri" id="fc-ok">Create</button><button onclick="closeModal()">Cancel</button></div>`);
 const rows=$('#fc-rows');
 const addRow=(n='',t='text')=>{const d=document.createElement('div');d.className='fc-row';d.innerHTML=`<input type="text" placeholder="field name" value="${esc(n)}"><select>${typeOpts(t)}</select><button class="sm" title="Remove">✕</button>`;d.querySelector('button').onclick=()=>d.remove();rows.appendChild(d)};
 addRow('name','text');addRow('notes','text');
 $('#fc-add').onclick=()=>addRow();
 $('#fc-ok').onclick=()=>{try{const name=uniqueName($('#fc-name').value),kind=$('#fc-geom').value,fields=[],seen=new Set();
  $$('.fc-row',rows).forEach(r=>{const n=r.querySelector('input').value.trim();if(!n)return;if(seen.has(n.toLowerCase()))throw new Error('Duplicate field name: '+n);seen.add(n.toLowerCase());fields.push({name:n,type:r.querySelector('select').value})});
  const l={id:S.id++,name,type:'vector',kind,data:{type:'FeatureCollection',features:[]},visible:true,style:defaultStyle(kind,S.id),lyr:null,lyrL:null,fields};
  S.layers.unshift(l);E.layerId=l.id;closeModal();afterChange();toast(`Feature class “${name}” created. Use “Add feature” to draw into it.`,5000);E.render()}catch(e){toast(e.message,5000)}}}
function renameLayerDialog(){const l=tgt();if(!l)return toast('Choose a layer first');
 openModal(`<h3>Rename layer</h3><label>Name <input type="text" id="rl-n" value="${esc(l.name)}"></label><div class="row"><button class="pri" id="rl-ok">Rename</button><button onclick="closeModal()">Cancel</button></div>`);
 $('#rl-ok').onclick=()=>{const n=$('#rl-n').value.trim();if(!n)return toast('Enter a name');l.name=n;closeModal();afterChange()}}

/* ---------- fields: add / rename / delete ---------- */
function after(cb){return()=>{if(cb)cb();else E.render()}}
function addFieldDialog(l,cb){l=l||tgt();if(!l)return toast('Choose a layer first');
 openModal(`<h3>Add field — ${esc(l.name)}</h3><label>Field name <input type="text" id="af-n"></label>
  <label>Type <select id="af-t">${typeOpts('text')}</select></label>
  <label>Default value (optional) <input type="text" id="af-d"></label>
  <p><small>Shapefile export keeps only the first 10 characters of a field name.</small></p>
  <div class="row"><button class="pri" id="af-ok">Add field</button><button id="af-x">Cancel</button></div>`);
 $('#af-x').onclick=()=>{closeModal();if(cb)cb()};
 $('#af-ok').onclick=()=>{try{const name=validName(l,$('#af-n').value),type=$('#af-t').value,dv=coerce($('#af-d').value,type);
  snap(l);l.fields.push({name,type});l.data.features.forEach(f=>{f.properties=f.properties||{};f.properties[name]=dv});closeModal();commit(l);toast('Field “'+name+'” added');after(cb)()}catch(e){toast(e.message,5000)}}}
function renameFieldDialog(l,cb){l=l||tgt();if(!l)return toast('Choose a layer first');const fs=ensureFields(l);if(!fs.length)return toast('This layer has no fields');
 openModal(`<h3>Rename field — ${esc(l.name)}</h3><label>Field <select id="rf-f">${fs.map(f=>`<option>${esc(f.name)}</option>`).join('')}</select></label><label>New name <input type="text" id="rf-n"></label>
  <div class="row"><button class="pri" id="rf-ok">Rename</button><button id="rf-x">Cancel</button></div>`);
 $('#rf-x').onclick=()=>{closeModal();if(cb)cb()};
 $('#rf-ok').onclick=()=>{try{const old=$('#rf-f').value,name=validName(l,$('#rf-n').value,old);if(name===old){closeModal();return after(cb)()}
  snap(l);l.fields.find(f=>f.name===old).name=name;
  l.data.features.forEach(f=>{const p=f.properties||{},o={};for(const k of Object.keys(p))o[k===old?name:k]=p[k];f.properties=o});
  const st=l.style;if(st.field===old)st.field=name;if(st.label===old)st.label=name;
  closeModal();commit(l);toast('Field renamed');after(cb)()}catch(e){toast(e.message,5000)}}}
function deleteFieldDialog(l,cb){l=l||tgt();if(!l)return toast('Choose a layer first');const fs=ensureFields(l);if(!fs.length)return toast('This layer has no fields');
 openModal(`<h3>Delete field — ${esc(l.name)}</h3><label>Field <select id="df-f">${fs.map(f=>`<option>${esc(f.name)}</option>`).join('')}</select></label><p><small>The values in this field are removed from every feature (you can undo).</small></p>
  <div class="row"><button class="pri" id="df-ok">Delete field</button><button id="df-x">Cancel</button></div>`);
 $('#df-x').onclick=()=>{closeModal();if(cb)cb()};
 $('#df-ok').onclick=()=>{const k=$('#df-f').value;snap(l);l.fields=l.fields.filter(f=>f.name!==k);l.data.features.forEach(f=>{if(f.properties)delete f.properties[k]});
  const st=l.style;if(st.field===k){st.field='';if(st.mode!=='single'){st.mode='single';st.classes=[]}}if(st.label===k)st.label='';
  closeModal();commit(l);toast('Field “'+k+'” deleted');after(cb)()}}

/* ---------- populate field (field calculator) ---------- */
function splitExpr(src){const out=[];let i=0,code='';
 const flush=()=>{if(code){out.push({c:code});code=''}};
 while(i<src.length){const ch=src[i];
  if(ch==='"'){const j=src.indexOf('"',i+1);if(j<0)throw new Error('Unclosed " in expression');flush();out.push({f:src.slice(i+1,j)});i=j+1;continue}
  if(ch==="'"){let j=i+1;while(j<src.length&&src[j]!=="'"){if(src[j]==='\\')j++;j++}if(j>=src.length)throw new Error("Unclosed ' in expression");flush();out.push({s:src.slice(i,j+1)});i=j+1;continue}
  code+=ch;i++}flush();return out}
function compileExpr(src){const seg=splitExpr(src);let js='';
 for(const s of seg){if(s.f!==undefined)js+='F['+JSON.stringify(s.f)+']';else if(s.s)js+=s.s;
  else js+=s.c.replace(/\band\b/gi,'&&').replace(/\bor\b/gi,'||').replace(/\bnot\b/gi,'!').replace(/\^/g,'**').replace(/<>/g,'!=').replace(/(^|[^<>!=])=(?!=)/g,'$1==')}
 const H={upper:v=>String(v??'').toUpperCase(),lower:v=>String(v??'').toLowerCase(),trim:v=>String(v??'').trim(),len:v=>String(v??'').length,
  concat:(...a)=>a.map(v=>v??'').join(''),num:v=>parseFloat(v),str:v=>String(v??''),round:(v,d=0)=>{const m=Math.pow(10,d);return Math.round(v*m)/m},
  abs:Math.abs,sqrt:Math.sqrt,min:Math.min,max:Math.max,pow:Math.pow,floor:Math.floor,ceil:Math.ceil,
  substr:(v,a,n)=>String(v??'').substr(a-1,n),replace:(v,a,b)=>String(v??'').split(a).join(b),IF:(c,a,b)=>c?a:b,'if':(c,a,b)=>c?a:b};
 const names=Object.keys(H).filter(k=>/^[A-Za-z_]+$/.test(k)&&k!=='if');
 let fn;try{fn=new Function('F','$id','$area','$length','$x','$y',...names,'return ('+js+')')}catch(e){throw new Error('Invalid expression: '+e.message)}
 return{run:(F,id,g)=>fn(F,id,g.area,g.length,g.x,g.y,...names.map(k=>H[k])),usesGeom:/\$(area|length|x|y)\b/.test(src)}}
function geomVars(f){const o={area:null,length:null,x:null,y:null};try{if(!f.geometry)return o;const t=f.geometry.type;
 if(/Polygon/.test(t)){o.area=turf.area(f);o.length=turf.flatten(f).features.reduce((s,g)=>s+turf.length(turf.polygonToLine(g),{units:'meters'}),0)}
 else if(/Line/.test(t))o.length=turf.length(f,{units:'meters'});
 const c=turf.centroid(f).geometry.coordinates;o.x=c[0];o.y=c[1]}catch(e){}return o}

function populateDialog(l,cb){l=l||tgt();if(!l)return toast('Choose a layer first');const fs=ensureFields(l);
 const selN=(E.table&&E.table.id===l.id)?E.tsel.size:0;
 openModal(`<h3>Populate field — ${esc(l.name)}</h3>
  <label>Field <select id="pf-f">${fs.map(f=>`<option>${esc(f.name)}</option>`).join('')}<option value="__new">(create new field…)</option></select></label>
  <div id="pf-new" style="display:none" class="row"><input type="text" id="pf-nn" placeholder="new field name" style="flex:2"><select id="pf-nt" style="flex:1">${typeOpts('text')}</select></div>
  <label>Method <select id="pf-m"><option value="const">Same value for all</option><option value="auto">Auto-number</option><option value="copy">Copy from another field</option><option value="expr">Expression (calculator)</option></select></label>
  <div id="pf-opt"></div>
  <label>Apply to <select id="pf-s"><option value="all">All ${l.data.features.length} features</option>${selN?`<option value="sel" selected>Selected table rows (${selN})</option>`:''}</select></label>
  <div class="row"><button class="pri" id="pf-ok">Populate</button><button id="pf-x">Cancel</button></div>`);
 const opt=()=>{const m=$('#pf-m').value,o=$('#pf-opt');
  if(m==='const')o.innerHTML='<label>Value <input type="text" id="pf-v" placeholder="leave empty to clear"></label>';
  else if(m==='auto')o.innerHTML='<div class="row"><label style="flex:1">Start <input type="number" id="pf-a" value="1" step="any"></label><label style="flex:1">Step <input type="number" id="pf-b" value="1" step="any"></label></div>';
  else if(m==='copy')o.innerHTML=`<label>Copy from <select id="pf-c">${fs.map(f=>`<option>${esc(f.name)}</option>`).join('')}</select></label>`;
  else o.innerHTML=`<label>Expression <textarea id="pf-e" rows="3" spellcheck="false" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px;padding:5px" placeholder='"pop" * 2'></textarea></label>
   <div class="row">${fs.map(f=>`<button class="sm" data-ins='"${esc(f.name)}"'>${esc(f.name)}</button>`).join('')}${['$area','$length','$x','$y','$id'].map(v=>`<button class="sm" data-ins="${v}">${v}</button>`).join('')}</div>
   <small>Fields in "double quotes", text in 'single quotes'. Functions: upper lower trim len concat substr replace round num str abs sqrt min max pow floor ceil IF(cond,a,b). Operators + - * / ^ &gt; &lt; = and or. <b>$area</b> m², <b>$length</b> m, <b>$x/$y</b> centroid lon/lat, <b>$id</b> row number. Examples: <code>"pop"/"area"</code> · <code>upper("name")</code> · <code>IF("score"&gt;50,'high','low')</code></small>`;
  $$('#pf-opt [data-ins]').forEach(b=>b.onclick=()=>{const t=$('#pf-e'),s=t.selectionStart??t.value.length,e=t.selectionEnd??s;t.value=t.value.slice(0,s)+b.dataset.ins+t.value.slice(e);t.focus();t.selectionStart=t.selectionEnd=s+b.dataset.ins.length})};
 const fsync=()=>{$('#pf-new').style.display=$('#pf-f').value==='__new'?'flex':'none'};
 $('#pf-f').onchange=fsync;$('#pf-m').onchange=opt;opt();fsync();
 $('#pf-x').onclick=()=>{closeModal();if(cb)cb()};
 $('#pf-ok').onclick=()=>{try{
  let fname=$('#pf-f').value,ftype,isNew=false;
  if(fname==='__new'){fname=validName(l,$('#pf-nn').value);ftype=$('#pf-nt').value;isNew=true}else ftype=l.fields.find(f=>f.name===fname).type;
  const m=$('#pf-m').value;let targets=l.data.features;if($('#pf-s').value==='sel')targets=targets.filter(f=>E.tsel.has(f));
  if(!targets.length)throw new Error('No features to update');
  let getter;
  if(m==='const'){const v=coerce($('#pf-v').value,ftype);getter=()=>v}
  else if(m==='auto'){const a=parseFloat($('#pf-a').value),b=parseFloat($('#pf-b').value);if(!isFinite(a)||!isFinite(b))throw new Error('Enter start and step numbers');let k=0;getter=()=>a+(k++)*b}
  else if(m==='copy'){const c=$('#pf-c').value;getter=f=>f.properties?.[c]}
  else{const src=$('#pf-e').value.trim();if(!src)throw new Error('Enter an expression');const ce=compileExpr(src);if(ce.usesGeom)need('turf','Turf.js');
   const idx=new Map(l.data.features.map((f,i)=>[f,i+1]));let bad=0;
   getter=f=>{try{const r=ce.run(f.properties||{},idx.get(f),ce.usesGeom?geomVars(f):{});return typeof r==='number'&&!isFinite(r)?null:r}catch(e){bad++;return null}};
   getter.bad=()=>bad;
   // dry run on first target so syntax/name errors show before anything changes
   try{ce.run(targets[0].properties||{},1,ce.usesGeom?geomVars(targets[0]):{})}catch(e){if(e instanceof SyntaxError||e instanceof ReferenceError)throw new Error('Expression error: '+e.message)}}
  snap(l);if(isNew){l.fields.push({name:fname,type:ftype});l.data.features.forEach(f=>{f.properties=f.properties||{};f.properties[fname]=null})}
  for(const f of targets){f.properties=f.properties||{};f.properties[fname]=coerce(getter(f),ftype)}
  closeModal();commit(l);const bad=getter.bad?getter.bad():0;toast(`Updated ${targets.length} feature(s)${bad?` — ${bad} could not be calculated (left empty)`:''}`,bad?6000:3500);after(cb)()}catch(e){toast(e.message,6000)}}}

/* ---------- editable attribute table ---------- */
function openEditTable(l,page){l=l||tgt();if(!l)return toast('Choose a layer first');const fs=ensureFields(l);
 if(!E.table||E.table.id!==l.id){E.tsel.clear()}
 const F=l.data.features,pages=Math.max(1,Math.ceil(F.length/PAGE));page=Math.max(0,Math.min(pages-1,page||0));E.table={id:l.id,page};
 const rows=F.slice(page*PAGE,page*PAGE+PAGE);
 const reopen=()=>openEditTable(l,E.table.page);
 openModal(`<h3>${esc(l.name)} — ${F.length} feature(s)</h3>
  <div class="row"><button class="sm" id="t-addf">+ Field</button><button class="sm" id="t-renf">Rename field</button><button class="sm" id="t-delf">Delete field</button><button class="sm pri" id="t-pop">Populate field</button>
   <button class="sm" id="t-undo">↶ Undo</button></div>
  <div class="row"><button class="sm" id="t-all">Select all</button><button class="sm" id="t-none">Clear selection</button><button class="sm" id="t-del" style="color:#b42318;border-color:#b42318">Delete selected (${E.tsel.size})</button></div>
  <div style="overflow:auto;max-height:52vh"><table class="et"><tr><th></th><th>#</th><th></th>${fs.map(f=>`<th>${esc(f.name)}<small>${f.type}</small></th>`).join('')}</tr>
  ${rows.map((f,i)=>{const gi=page*PAGE+i;return`<tr data-i="${gi}"><td class="n"><input type="checkbox" class="rs" ${E.tsel.has(f)?'checked':''}></td><td class="n"><button class="sm zm" title="Zoom to feature">${gi+1}</button></td><td class="n"><button class="sm rd" title="Delete this feature" style="color:#b42318;border-color:#b42318">✕</button></td>${fs.map((fl,k)=>`<td><input type="text" data-f="${k}" value="${esc(f.properties?.[fl.name]??'')}" ${fl.type!=='text'?'inputmode="decimal"':''}></td>`).join('')}</tr>`}).join('')}</table></div>
  <div class="row" style="margin-top:8px"><button class="sm" id="t-prev" ${page===0?'disabled':''}>◀</button><span>Page ${page+1} / ${pages}</span><button class="sm" id="t-next" ${page>=pages-1?'disabled':''}>▶</button><span style="flex:1"></span><button class="pri" onclick="closeModal()">Close</button></div>
  <small>Tap a cell to edit; changes are saved when you leave the cell. Numeric fields only accept numbers.</small>`,true);
 const B=$('#modalBody');
 B.onchange=e=>{const t=e.target,tr=t.closest('tr');if(!tr)return;const f=F[+tr.dataset.i];
  if(t.classList.contains('rs')){t.checked?E.tsel.add(f):E.tsel.delete(f);$('#t-del').textContent='Delete selected ('+E.tsel.size+')';return}
  if(t.dataset.f!==undefined){const fl=fs[+t.dataset.f];snap(l);const v=coerce(t.value,fl.type);f.properties=f.properties||{};f.properties[fl.name]=v;t.value=v===null?'':v;invalidate(l);syncOn(map,'lyr',!window.EDITING);syncOn(layMap,'lyrL',false);renderLegend()}};
 B.onclick=e=>{const t=e.target,tr=t.closest('tr');if(!tr)return;const f=F[+tr.dataset.i];
  if(t.classList.contains('zm')){closeModal();try{const b=L.geoJSON(f).getBounds();if(b.isValid()){if(f.geometry.type==='Point')map.setView(b.getCenter(),Math.max(map.getZoom(),17));else map.fitBounds(b.pad(.3),{maxZoom:19})}}catch(x){}showTab('map')}
  else if(t.classList.contains('rd')){if(confirm('Delete feature #'+(+tr.dataset.i+1)+'?')){snap(l);l.data.features=l.data.features.filter(x=>x!==f);E.tsel.delete(f);commit(l);reopen()}}};
 $('#t-addf').onclick=()=>addFieldDialog(l,reopen);$('#t-renf').onclick=()=>renameFieldDialog(l,reopen);$('#t-delf').onclick=()=>deleteFieldDialog(l,reopen);$('#t-pop').onclick=()=>populateDialog(l,reopen);
 $('#t-undo').onclick=undo;
 $('#t-all').onclick=()=>{F.forEach(f=>E.tsel.add(f));reopen()};$('#t-none').onclick=()=>{E.tsel.clear();reopen()};
 $('#t-del').onclick=()=>{if(!E.tsel.size)return toast('Tick the rows you want to delete first');if(!confirm('Delete '+E.tsel.size+' selected feature(s)?'))return;snap(l);const n=E.tsel.size;l.data.features=l.data.features.filter(f=>!E.tsel.has(f));E.tsel.clear();if(E.sel&&!l.data.features.includes(E.sel)){E.sel=null;clearGroup()}commit(l);toast(n+' feature(s) deleted');openEditTable(l,E.table.page)};
 $('#t-prev').onclick=()=>openEditTable(l,page-1);$('#t-next').onclick=()=>openEditTable(l,page+1)}

/* ---------- delete features helper ---------- */
function deleteFeaturesDialog(){const l=tgt();if(!l)return toast('Choose a layer first');
 openModal(`<h3>Delete features — ${esc(l.name)}</h3><p>How do you want to choose the features to delete?</p>
  <div class="row"><button id="dd-map">Pick on the map</button><button id="dd-tab">Tick rows in the table</button></div>
  <div class="row"><button id="dd-all" style="color:#b42318;border-color:#b42318">Delete ALL ${l.data.features.length} features</button><button onclick="closeModal()">Cancel</button></div>`);
 $('#dd-map').onclick=()=>{closeModal();startSelect()};$('#dd-tab').onclick=()=>openEditTable(l,0);
 $('#dd-all').onclick=()=>{if(!l.data.features.length)return toast('Layer is already empty');if(!confirm('Delete every feature in “'+l.name+'”? (You can undo.)'))return;snap(l);l.data.features=[];E.tsel.clear();E.sel=null;closeModal();clearGroup();commit(l);toast('All features deleted')}}

/* ---------- Edit menu panel ---------- */
E.render=function(){const el=$('#side-edit');if(!el)return;const L0=vecs();
 if(!tgt())E.layerId=L0.length?L0[0].id:null;const l=tgt();
 const info=l?`${l.data.features.length} feature(s) · ${l.kind} · ${ensureFields(l).length} field(s)`:'No vector layer yet — create a feature class or open data.';
 const dis=l?'':'disabled';
 el.innerHTML=`<h3>Edit</h3>
  <label>Layer to edit <select id="e-layer">${L0.map(x=>`<option value="${x.id}" ${l&&x.id===l.id?'selected':''}>${esc(x.name)}</option>`).join('')||'<option value="">(none)</option>'}</select></label>
  <small>${info}</small>
  ${E.tool?`<div class="es-sec" style="background:#eaf6ef"><b>${E.tool==='add'?'Adding features…':'Select / modify tool is active'}</b><div class="row"><button class="sm" id="e-stop">Stop editing</button></div></div>`:''}
  <fieldset class="es-sec"><legend>Feature class</legend><div class="row"><button id="e-newfc" class="pri">+ New feature class</button><button id="e-renl" ${dis}>Rename layer</button></div></fieldset>
  <fieldset class="es-sec"><legend>Features</legend><div class="row"><button id="e-add" ${dis}>➕ Add feature</button><button id="e-sel" ${dis}>✋ Select / modify / move</button><button id="e-delfeat" ${dis}>🗑 Delete features</button></div>
   <small>Select a feature on the map to drag its vertices (●), insert vertices (◼), move it (✥), edit its attributes or delete it.</small></fieldset>
  <fieldset class="es-sec"><legend>Attribute table</legend><div class="row"><button id="e-tab" class="pri" ${dis}>📋 Open editable table</button></div>
   <div class="row"><button id="e-addf" ${dis}>+ Add field</button><button id="e-renf" ${dis}>Rename field</button><button id="e-delf" ${dis}>Delete field</button></div>
   <div class="row"><button id="e-pop" ${dis}>Populate field…</button></div></fieldset>
  <div class="row"><button id="e-undo" ${dis}>↶ Undo last edit</button></div>
  <p><small>Edits change the layer inside the app. Use <b>Layers → Export</b> (Shapefile / GeoJSON) or <b>Save project</b> to keep them.</small></p>`;
 const on=(id,fn)=>{const b=$('#'+id,el);if(b)b.onclick=fn};
 $('#e-layer',el).onchange=e=>{const wasTool=E.tool;if(wasTool)stop();E.layerId=+e.target.value||null;E.tsel.clear();E.render()};
 on('e-stop',stop);on('e-newfc',newFeatureClassDialog);on('e-renl',renameLayerDialog);
 on('e-add',startAdd);on('e-sel',startSelect);on('e-delfeat',deleteFeaturesDialog);
 on('e-tab',()=>openEditTable(tgt(),0));on('e-addf',()=>addFieldDialog(tgt()));on('e-renf',()=>renameFieldDialog(tgt()));on('e-delf',()=>deleteFieldDialog(tgt()));on('e-pop',()=>populateDialog(tgt()));
 on('e-undo',undo)};
E.refresh=function(){const el=$('#side-edit');if(!el||el.style.display==='none')return;if(E.tool&&!tgt()){stop();return}E.render()};

/* ---------- init (map is created asynchronously by the main script) ---------- */
function init(){
 map.createPane('editPane').style.zIndex=610;
 grp=L.layerGroup().addTo(map);
 map.on('click',onMapClick);
 $('#edit-bar').addEventListener('click',barClick);
 addEventListener('keydown',e=>{if(e.key==='Escape'&&E.tool)stop()});
 E.render()}
(function wait(){if(typeof map!=='undefined'&&map&&document.getElementById('side-edit')&&document.getElementById('edit-bar'))init();else setTimeout(wait,100)})();
})();
