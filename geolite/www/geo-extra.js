/* GeoLite extras: raster tools (clip, polygon->raster, raster->polygon, merge), File Geodatabase (.gdb) reader,
   export to Shapefile / GeoTIFF. Loaded after the main script; uses its globals (S, TOOLS, P, mercY, ...). */
(function(){
'use strict';
const TD=new TextDecoder('utf-8'),TE=new TextEncoder();
const clampLat=v=>Math.max(-85,Math.min(85,v));

/* ================= ZIP reader: fflate supports stored/deflate ZIPs and ZIP64 ================= */
function unzip(buf){
 const lib=window.fflate;
 if(!lib||typeof lib.unzipSync!=='function')throw new Error('ZIP support did not load. Reopen the app with internet once, then try again.');
 const entries=lib.unzipSync(new Uint8Array(buf)),m=new Map();
 for(const [raw,data] of Object.entries(entries)){
  const name=raw.replace(/\\/g,'/').replace(/^\.\//,'');
  if(!name.endsWith('/'))m.set(name,async()=>data);
 }
 return m;
}
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){let c=-1;for(let i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return(~c)>>>0}
function makeZip(files){const parts=[],cd=[];let off=0;
 for(const f of files){const nm=TE.encode(f.name),d=f.data,crc=crc32(d),h=new DataView(new ArrayBuffer(30));
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,d.length,true);h.setUint32(22,d.length,true);h.setUint16(26,nm.length,true);
  parts.push(new Uint8Array(h.buffer),nm,d);
  const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,d.length,true);c.setUint32(24,d.length,true);c.setUint16(28,nm.length,true);c.setUint32(42,off,true);
  cd.push(new Uint8Array(c.buffer),nm);off+=30+nm.length+d.length}
 const cl=cd.reduce((s,a)=>s+a.length,0),e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cl,true);e.setUint32(16,off,true);
 return new Blob([...parts,...cd,new Uint8Array(e.buffer)],{type:'application/zip'})}

/* ================= File Geodatabase (OpenFileGDB layout) reader ================= */
const vu=b=>{let r=0,s=0,x;do{x=b.u[b.p++];r+=(x&127)*2**s;s+=7}while(x&128);return r};
const vi=b=>{let x=b.u[b.p++];const neg=x&64;let r=x&63,s=6;while(x&128){x=b.u[b.p++];r+=(x&127)*2**s;s+=7}return neg?-r:r};
const u16s=(u,o,n)=>new TextDecoder('utf-16le').decode(u.subarray(o,o+2*n));
const SHP_P=[1,9,11,21,52],SHP_M=[8,18,20,28,53],SHP_L=[3,10,13,23,50],SHP_G=[5,15,19,25,51];
function decGeom(u,g){const b={u,p:0},gt=vu(b),t=gt&255;if(!t)return null;
 const xs=g.xs,X=v=>v/xs+g.x0,Y=v=>v/xs+g.y0;
 if(SHP_P.includes(t)){const x=vu(b),y=vu(b);if(!x||!y)return null;return{type:'Point',coordinates:[(x-1)/xs+g.x0,(y-1)/xs+g.y0]}}
 const cls=SHP_M.includes(t)?'m':SHP_L.includes(t)?'l':SHP_G.includes(t)?'g':null;if(!cls)return null;
 const np=vu(b);if(!np)return null;const nparts=cls==='m'?1:vu(b);
 if(t>=50&&(gt&0x20000000))vu(b);
 for(let i=0;i<4;i++)vu(b);
 const sizes=[];let used=0;for(let i=0;i<nparts-1;i++){const s=vu(b);sizes.push(s);used+=s}sizes.push(np-used);
 let ix=0,iy=0;const parts=sizes.map(n=>{const a=[];for(let i=0;i<n;i++){ix+=vi(b);iy+=vi(b);a.push([X(ix),Y(iy)])}return a});
 if(cls==='m')return{type:'MultiPoint',coordinates:parts[0]};
 if(cls==='l')return parts.length===1?{type:'LineString',coordinates:parts[0]}:{type:'MultiLineString',coordinates:parts};
 const polys=[];for(const r of parts){let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];
  if(a<=0||!polys.length)polys.push([r]);else polys[polys.length-1].push(r)}   // clockwise = outer ring, counter-clockwise = hole of previous outer
 return polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys}}
function wktInv(w){if(!w||/^\s*GEOG/i.test(w))return null;
 if(/Mercator_Auxiliary_Sphere|Web_Mercator|Pseudo-Mercator/i.test(w))return MERC.inv;
 const m=/UTM[ _]zone[ _](\d+)\s*([NS])?/i.exec(w);if(m){const z=+m[1],south=(m[2]||'N').toUpperCase()==='S';return(x,y)=>utmInv(x,y,z,south)}
 throw new Error('Unsupported coordinate system ('+((/PROJCS\["([^"]+)/.exec(w)||[])[1]||'unknown')+'). Reproject to WGS84 or UTM first.')}
function gdbTable(tbl,tblx){const T=new DataView(tbl.buffer,tbl.byteOffset,tbl.byteLength),X=new DataView(tblx.buffer,tblx.byteOffset,tblx.byteLength);
 const nb=X.getUint32(4,true),osz=X.getUint32(12,true);if(osz<4||osz>6)throw new Error('unreadable index file');
 const avail=Math.floor((tblx.length-16)/osz),nEnt=nb?Math.min(nb*1024,avail):avail;
 let p=T.getUint32(32,true);const geomType=tbl[p+8],nf=T.getUint16(p+12,true);p+=14;const fields=[];let gi=null;
 for(let i=0;i<nf;i++){const nl=tbl[p++],name=u16s(tbl,p,nl);p+=2*nl;const al=tbl[p++];p+=2*al;const type=tbl[p++];const f={name,type,nullable:false};
  if(type===4){p+=4;f.nullable=!!(tbl[p++]&1);const b={u:tbl,p};const dl=vu(b);p=b.p+dl}
  else if(type===7){p++;f.nullable=!!(tbl[p++]&1);const wl=T.getUint16(p,true);p+=2;const wkt=u16s(tbl,p,wl/2);p+=wl;const gf=tbl[p++],hasM=!!(gf&2),hasZ=!!(gf&4);
   const d=()=>{const v=T.getFloat64(p,true);p+=8;return v};const x0=d(),y0=d(),xs=d();if(hasM){d();d()}if(hasZ){d();d()}d();if(hasM)d();if(hasZ)d();
   p+=32+(hasZ?16:0)+(hasM?16:0);p++;const ng=T.getUint32(p,true);p+=4+8*ng;gi=f.geom={x0,y0,xs,wkt}}
  else if(type===6||type===8||type===10||type===11||type===12){f.nullable=type!==6&&!!(tbl[p+1]&1);p+=2}
  else if(type===9)throw new Error('raster fields are not supported');
  else{p++;f.nullable=!!(tbl[p++]&1);const dl=tbl[p++];p+=dl}
  fields.push(f)}
 const nn=fields.filter(f=>f.nullable).length,nbm=Math.ceil(nn/8),rows=[];
 for(let id=1;id<=nEnt;id++){let off=0,q=16+(id-1)*osz;for(let k=0;k<osz;k++)off+=X.getUint8(q+k)*2**(8*k);if(!off)continue;
  const b={u:tbl,p:off+4},bm=tbl.subarray(b.p,b.p+nbm);b.p+=nbm;let ni=0;const props={};let geom=null;
  for(const f of fields){if(f.type===6){props[f.name]=id;continue}
   if(f.nullable){const isNull=(bm[ni>>3]>>(ni&7))&1;ni++;if(isNull){if(f.type!==7)props[f.name]=null;continue}}
   switch(f.type){
    case 0:props[f.name]=T.getInt16(b.p,true);b.p+=2;break;
    case 1:props[f.name]=T.getInt32(b.p,true);b.p+=4;break;
    case 2:props[f.name]=+T.getFloat32(b.p,true).toPrecision(7);b.p+=4;break;
    case 3:props[f.name]=T.getFloat64(b.p,true);b.p+=8;break;
    case 4:{const l=vu(b);props[f.name]=TD.decode(tbl.subarray(b.p,b.p+l));b.p+=l;break}
    case 5:case 14:{const v=T.getFloat64(b.p,true);b.p+=8;props[f.name]=new Date(Math.round((v-25569)*864e5)).toISOString();break}
    case 15:b.p+=8;break;
    case 16:b.p+=10;break;
    case 13:props[f.name]=Number(T.getBigInt64(b.p,true));b.p+=8;break;
    case 7:{const l=vu(b);try{geom=decGeom(tbl.subarray(b.p,b.p+l),f.geom)}catch(e){geom=null}b.p+=l;break}
    case 8:case 12:{const l=vu(b);if(f.type===12)props[f.name]=TD.decode(tbl.subarray(b.p,b.p+l));b.p+=l;break}
    case 10:case 11:b.p+=16;break;
    default:throw new Error('unknown field type '+f.type)}}
  rows.push({id,props,geom})}
 return{fields,geomType,gi,rows}}
async function addGDB(files,label){ // files: Map(lowercase basename -> async()=>Uint8Array)
 const get=async n=>{const f=files.get(n);return f?f():null};
 const ct=await get('a00000001.gdbtable'),cx=await get('a00000001.gdbtablx');if(!ct||!cx)throw new Error('Not a File Geodatabase (catalog table missing)');
 const cat=gdbTable(ct,cx).rows.map(r=>({id:r.id,name:r.props.Name})).filter(r=>r.name&&!/^GDB_/i.test(r.name));
 let added=0,skipped=0;
 for(const c of cat){const base='a'+c.id.toString(16).padStart(8,'0');
  try{const t=await get(base+'.gdbtable'),x=await get(base+'.gdbtablx');if(!t||!x){skipped++;continue}
   const tb=gdbTable(t,x);if(!tb.gi){skipped++;continue}
   const inv=wktInv(tb.gi.wkt),feats=[];
   const conv=g=>{if(!inv)return g;const m=c=>Array.isArray(c[0])?c.map(m):inv(c[0],c[1]);return{type:g.type,coordinates:m(g.coordinates)}};
   for(const r of tb.rows){if(!r.geom)continue;feats.push({type:'Feature',properties:r.props,geometry:conv(r.geom)})}
   if(!feats.length){skipped++;continue}
   addVector(c.name,fc(feats),null,true,added===0);added++}
  catch(e){toast(`${label||'GDB'} → ${c.name}: ${e.message}`,7000);console.error(e)}}
 toast(`${label||'Geodatabase'}: ${added} layer(s) added${skipped?`, ${skipped} table(s) skipped (no geometry)`:''}`,5000)}
const isGdbName=n=>/\.gdbtable$|\.gdbtablx$/i.test(n);
async function openGdbZip(f){
 const ents=unzip(await f.arrayBuffer()),names=[...ents.keys()],gdbFiles=names.filter(isGdbName);
 if(!gdbFiles.length)return false;
 const groups=new Map();
 for(const n of gdbFiles){const i=n.lastIndexOf('/'),dir=i<0?'':n.slice(0,i),base=n.slice(i+1).toLowerCase(),m=groups.get(dir)||new Map();m.set(base,ents.get(n));groups.set(dir,m)}
 const valid=[...groups].filter(([,m])=>m.has('a00000001.gdbtable')&&m.has('a00000001.gdbtablx'));
 if(!valid.length)throw new Error('This ZIP contains GDB table fragments but not a complete File Geodatabase. ZIP the entire .gdb folder, including a00000001.gdbtable and a00000001.gdbtablx.');
 for(const [dir,m] of valid)await addGDB(m,(dir.split('/').pop()||f.name).replace(/\\.gdb$/i,''));
 return true;
}
async function openGdbLoose(files){const groups=new Map();for(const f of files){const rp=f.webkitRelativePath||'',i=rp.lastIndexOf('/'),dir=i<0?'':rp.slice(0,i),m=groups.get(dir)||new Map();m.set(f.name.toLowerCase(),async()=>new Uint8Array(await f.arrayBuffer()));groups.set(dir,m)}
 for(const [dir,m] of groups)try{await addGDB(m,(dir.split('/').pop()||'GDB').replace(/\.gdb$/i,''))}catch(e){toast('GDB: '+e.message,7000)}}

/* ================= Shapefile writer ================= */
const ringArea=r=>{let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return a/2};
const orient=(r,cw)=>{const a=ringArea(r);return(cw?a>0:a<0)?r.slice().reverse():r};
function splitGeoms(data){const o={point:[],line:[],poly:[]};
 const add=(g,f)=>{if(!g)return;switch(g.type){
  case'Point':o.point.push({pts:[g.coordinates],f});break;case'MultiPoint':o.point.push({pts:g.coordinates,f,multi:1});break;
  case'LineString':o.line.push({parts:[g.coordinates],f});break;case'MultiLineString':o.line.push({parts:g.coordinates,f});break;
  case'Polygon':o.poly.push({parts:g.coordinates.map((r,i)=>orient(r,i===0)),f});break;
  case'MultiPolygon':o.poly.push({parts:g.coordinates.flatMap(p=>p.map((r,i)=>orient(r,i===0))),f});break;
  case'GeometryCollection':g.geometries.forEach(x=>add(x,f))}};
 data.features.forEach(f=>add(f.geometry,f));return o}
function dbfFields(feats){const keys=[],seen=new Set();for(const f of feats)for(const k of Object.keys(f.properties||{}))if(!seen.has(k)){seen.add(k);keys.push(k)}
 const used=new Set();return keys.slice(0,250).map(k=>{let n=k.replace(/[^A-Za-z0-9_]/g,'_').slice(0,10)||'F',c=n,i=1;while(used.has(c.toUpperCase())){const s=String(i++);c=n.slice(0,10-s.length)+s}used.add(c.toUpperCase());
  let num=true,int=true,len=1;for(const f of feats){const v=f.properties&&f.properties[k];if(v===null||v===undefined||v==='')continue;if(typeof v==='number'&&isFinite(v)){if(!Number.isInteger(v))int=false}else{num=false}
   const s=typeof v==='object'?JSON.stringify(v):String(v);len=Math.max(len,TE.encode(s).length)}
  return num?{key:k,name:c,type:'N',len:19,dec:int?0:8}:{key:k,name:c,type:'C',len:Math.min(254,len),dec:0}})}
function buildDbf(feats,fl){const rl=1+fl.reduce((s,f)=>s+f.len,0),hl=33+32*fl.length,u=new Uint8Array(hl+rl*feats.length+1),dv=new DataView(u.buffer),d=new Date();
 u[0]=3;u[1]=d.getFullYear()-1900;u[2]=d.getMonth()+1;u[3]=d.getDate();dv.setUint32(4,feats.length,true);dv.setUint16(8,hl,true);dv.setUint16(10,rl,true);
 fl.forEach((f,i)=>{const o=32+32*i;u.set(TE.encode(f.name),o);u[o+11]=f.type.charCodeAt(0);u[o+16]=f.len;u[o+17]=f.dec});u[hl-1]=13;
 feats.forEach((ft,r)=>{let o=hl+r*rl;u[o++]=32;for(const f of fl){const v=ft.properties&&ft.properties[f.key];let s='';if(v!==null&&v!==undefined&&v!==''){s=f.type==='N'?(+v).toFixed(f.dec):(typeof v==='object'?JSON.stringify(v):String(v))}
   let b=TE.encode(s);if(b.length>f.len)b=b.subarray(0,f.len);if(f.type==='N'){u.fill(32,o,o+f.len);u.set(b,o+f.len-b.length)}else{u.fill(32,o,o+f.len);u.set(b,o)}o+=f.len}});
 u[u.length-1]=26;return u}
function buildShp(recs,kind){const type={point:1,multipoint:8,line:3,poly:5}[kind];let bx=[1/0,1/0,-1/0,-1/0];
 const pts=r=>kind==='point'||kind==='multipoint'?r.pts:r.parts.flat();for(const r of recs)for(const q of pts(r)){bx=[Math.min(bx[0],q[0]),Math.min(bx[1],q[1]),Math.max(bx[2],q[2]??q[0]),Math.max(bx[3],q[3]??q[1])]}
 const sizes=recs.map(r=>{const n=pts(r).length;return kind==='point'?20:kind==='multipoint'?40+16*n:44+4*r.parts.length+16*n});
 const total=100+sizes.reduce((s,c)=>s+8+c,0),shp=new Uint8Array(total),shx=new Uint8Array(100+8*recs.length),A=new DataView(shp.buffer),B=new DataView(shx.buffer);
 for(const [D,len] of [[A,total],[B,shx.length]]){D.setInt32(0,9994);D.setInt32(24,len/2);D.setInt32(28,1000,true);D.setInt32(32,type,true);bx.forEach((v,i)=>D.setFloat64(36+8*i,isFinite(v)?v:0,true))}
 let o=100;recs.forEach((r,i)=>{const c=sizes[i];B.setInt32(100+8*i,o/2);B.setInt32(104+8*i,c/2);A.setInt32(o,i+1);A.setInt32(o+4,c/2);let q=o+8;A.setInt32(q,type,true);q+=4;
  if(kind==='point'){A.setFloat64(q,r.pts[0][0],true);A.setFloat64(q+8,r.pts[0][1],true)}
  else{const P=pts(r);let b=[1/0,1/0,-1/0,-1/0];for(const t of P)b=[Math.min(b[0],t[0]),Math.min(b[1],t[1]),Math.max(b[2],t[0]),Math.max(b[3],t[1])];b.forEach((v,k)=>A.setFloat64(q+8*k,v,true));q+=32;
   if(kind==='multipoint'){A.setInt32(q,P.length,true);q+=4}else{A.setInt32(q,r.parts.length,true);A.setInt32(q+4,P.length,true);q+=8;let s=0;for(const pa of r.parts){A.setInt32(q,s,true);q+=4;s+=pa.length}}
   for(const t of P){A.setFloat64(q,t[0],true);A.setFloat64(q+8,t[1],true);q+=16}}
  o+=8+c});
 return{shp,shx}}
const PRJ='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
function toShapefileZip(l){const sp=splitGeoms(l.data),kinds=Object.keys(sp).filter(k=>sp[k].length);if(!kinds.length)throw new Error('Layer has no exportable geometry');
 const safe=l.name.replace(/[^\w\-]+/g,'_')||'layer',files=[];
 for(const k of kinds){const recs=sp[k],base=kinds.length>1?`${safe}_${k}`:safe,kind=k==='point'?(recs.some(r=>r.multi||r.pts.length!==1)?'multipoint':'point'):k;
  const feats=recs.map(r=>r.f),{shp,shx}=buildShp(recs,kind);
  files.push({name:base+'.shp',data:shp},{name:base+'.shx',data:shx},{name:base+'.dbf',data:buildDbf(feats,dbfFields(feats))},{name:base+'.prj',data:TE.encode(PRJ)},{name:base+'.cpg',data:TE.encode('UTF-8')})}
 return makeZip(files)}

/* ================= GeoTIFF writer (uncompressed, EPSG:3857) ================= */
function tiffBlob({bands,W,H,bounds,rgb,bmm}){const [[s,w],[n,e]]=bounds,x0=R_E*w*Math.PI/180,x1=R_E*e*Math.PI/180,y0=mercY(s),y1=mercY(n),N=W*H;
 const NODATA=-9999,planes=[];let spp,bps,fmt,photo,planar,extra=null;
 if(rgb){spp=4;bps=8;fmt=1;photo=2;planar=1;extra=2;const u=new Uint8Array(N*4);for(let p=0;p<N;p++){let ok=true;for(let b=0;b<3;b++){const v=bands[b][p];if(!isFinite(v)){ok=false;break}const [a,z]=bmm[b];u[p*4+b]=(z<=255&&a>=0)?v:(v-a)/((z-a)||1)*255}u[p*4+3]=ok?255:0}planes.push(u)}
 else{spp=bands.length;bps=32;fmt=3;photo=1;planar=2;for(const b of bands){const f=new Float32Array(N);for(let p=0;p<N;p++)f[p]=isFinite(b[p])?b[p]:NODATA;planes.push(new Uint8Array(f.buffer))}}
 const dbl=a=>{const f=new Float64Array(a);return new Uint8Array(f.buffer)},sh=a=>{const f=new Uint16Array(a);return new Uint8Array(f.buffer)},lg=a=>{const f=new Uint32Array(a);return new Uint8Array(f.buffer)};
 const E=[],ent=(tag,type,count,bytes)=>E.push({tag,type,count,bytes});
 const dataLen=planes.reduce((a,p)=>a+p.length,0);
 // sizes first (offsets patched after layout)
 const ndTxt=TE.encode(String(NODATA)+'\0');
 ent(256,4,1,lg([W]));ent(257,4,1,lg([H]));ent(258,3,spp,sh(Array(spp).fill(bps)));ent(259,3,1,sh([1]));ent(262,3,1,sh([photo]));
 ent(273,4,planes.length,null);ent(277,3,1,sh([spp]));ent(278,4,1,lg([H]));ent(279,4,planes.length,lg(planes.map(p=>p.length)));ent(284,3,1,sh([planar]));
 if(extra)ent(338,3,1,sh([extra]));ent(339,3,spp,sh(Array(spp).fill(fmt)));
 ent(33550,12,3,dbl([(x1-x0)/W,(y1-y0)/H,0]));ent(33922,12,6,dbl([0,0,0,x0,y1,0]));
 ent(34735,3,16,sh([1,1,0,3, 1024,0,1,1, 1025,0,1,1, 3072,0,1,3857]));
 if(!rgb)ent(42113,2,ndTxt.length,ndTxt);
 E.sort((a,b)=>a.tag-b.tag);
 const tsize=t=>({2:1,3:2,4:4,12:8}[t]),ifdLen=2+12*E.length+4;let ex=8+ifdLen,exLen=0;
 for(const t of E){const l=t.tag===273?4*t.count:t.bytes.length;if(l>4){t.off=ex+exLen;exLen+=l+(l&1)}}
 const dataStart=8+ifdLen+exLen,out=new Uint8Array(dataStart+dataLen),dv=new DataView(out.buffer);
 out[0]=0x49;out[1]=0x49;dv.setUint16(2,42,true);dv.setUint32(4,8,true);dv.setUint16(8,E.length,true);
 const offs=[];let dp=dataStart;for(const p of planes){offs.push(dp);out.set(p,dp);dp+=p.length}
 E.forEach((t,i)=>{const o=10+12*i;dv.setUint16(o,t.tag,true);dv.setUint16(o+2,t.type,true);dv.setUint32(o+4,t.count,true);
  const b=t.tag===273?lg(offs):t.bytes;if(b.length<=4)out.set(b,o+8);else{dv.setUint32(o+8,t.off,true);out.set(b,t.off)}});
 return new Blob([out],{type:'image/tiff'})}
function layerRasterData(l){const r=l.raster,N=r.outW*r.outH,bands=r.bands.map((b,i)=>{const o=new Float32Array(N);for(let p=0;p<N;p++){const ix=r.lut[p];if(ix<0){o[p]=NaN;continue}const v=b[ix];o[p]=(v===r.nodata||!isFinite(v))?NaN:v}return o});
 return{bands:r.rgb?bands.slice(0,3):bands,W:r.outW,H:r.outH,bounds:r.bounds,rgb:r.rgb,bmm:r.bmm}}

/* ================= raster helpers ================= */
const gridOf=r=>{const [[s,w],[n,e]]=r.bounds;return{W:r.outW,H:r.outH,w,e,s,n,y0:mercY(s),y1:mercY(n)}};
const gx=(g,lon)=>(lon-g.w)/(g.e-g.w)*g.W,gy=(g,lat)=>(g.y1-mercY(clampLat(lat)))/(g.y1-g.y0)*g.H;
function polyGeoms(d){const o=[];for(const f of d.features){const t=f.geometry&&f.geometry.type;if(t==='Polygon')o.push({c:f.geometry.coordinates,f});else if(t==='MultiPolygon')f.geometry.coordinates.forEach(c=>o.push({c,f}))}return o}
function fillPolys(g,polys,cb){for(let k=0;k<polys.length;k++){const rows=new Map();
 for(const ring of polys[k].c){let px=0,py=0;for(let i=0;i<ring.length;i++){const x=gx(g,ring[i][0]),y=gy(g,ring[i][1]);
  if(i&&py!==y){const j0=Math.max(0,Math.ceil(Math.min(py,y)-.5)),j1=Math.min(g.H-1,Math.ceil(Math.max(py,y)-.5)-1);for(let j=j0;j<=j1;j++){let a=rows.get(j);if(!a)rows.set(j,a=[]);a.push(px+(j+.5-py)*(x-px)/(y-py))}}px=x;py=y}}
 for(const [j,a] of rows){a.sort((p,q)=>p-q);for(let m=0;m+1<a.length;m+=2){const i0=Math.max(0,Math.ceil(a[m]-.5)),i1=Math.min(g.W-1,Math.ceil(a[m+1]-.5)-1);if(i1>=i0)cb(j,i0,i1,k)}}}}
function gridBand(l,b){const r=l.raster,N=r.outW*r.outH,o=new Float32Array(N),src=r.bands[b];for(let p=0;p<N;p++){const ix=r.lut[p];if(ix<0){o[p]=NaN;continue}const v=src[ix];o[p]=(v===r.nodata||!isFinite(v))?NaN:v}return o}

function clipRaster(l,pl,crop,name){const r=l.raster,g=gridOf(r),polys=polyGeoms(pl.data);if(!polys.length)throw new Error('Clip layer has no polygons');
 const mask=new Uint8Array(g.W*g.H);fillPolys(g,polys,(j,a,b)=>mask.fill(1,j*g.W+a,j*g.W+b+1));
 let i0=0,j0=0,i1=g.W,j1=g.H;
 if(crop){let a=1/0,b=1/0,c=-1/0,d=-1/0;for(const p of polys)for(const ring of p.c)for(const q of ring){const x=gx(g,q[0]),y=gy(g,q[1]);a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y)}
  i0=Math.max(0,Math.floor(a));j0=Math.max(0,Math.floor(b));i1=Math.min(g.W,Math.ceil(c));j1=Math.min(g.H,Math.ceil(d))}
 if(i1<=i0||j1<=j0)throw new Error('The clip polygons do not overlap this raster');
 const W=i1-i0,H=j1-j0,lon=i=>g.w+i/g.W*(g.e-g.w),lat=j=>invMercLat(g.y1-j/g.H*(g.y1-g.y0)),bounds=[[lat(j1),lon(i0)],[lat(j0),lon(i1)]];
 const nb=r.rgb?Math.min(3,r.bands.length):r.bands.length,out=[];let any=false;
 for(let b=0;b<nb;b++){const src=gridBand(l,b),o=new Float32Array(W*H).fill(NaN);for(let j=0;j<H;j++)for(let i=0;i<W;i++){const p=(j0+j)*g.W+i0+i;if(mask[p]){o[j*W+i]=src[p];if(!isNaN(src[p]))any=true}}out.push(o)}
 if(!any)throw new Error('No raster cells fall inside the clip polygons');
 return addComputedRaster(name,out,W,H,bounds,true,{rgb:r.rgb})}

function rasterizePoly(l,field,cells){const polys=polyGeoms(l.data);if(!polys.length)throw new Error('Layer has no polygons');
 let w=1/0,s=1/0,e=-1/0,n=-1/0;for(const p of polys)for(const ring of p.c)for(const q of ring){w=Math.min(w,q[0]);e=Math.max(e,q[0]);s=Math.min(s,clampLat(q[1]));n=Math.max(n,clampLat(q[1]))}
 if(!(e>w&&n>s))throw new Error('Layer extent is empty');cells=Math.max(2,Math.min(2000,cells|0||500));
 const y0=mercY(s),y1=mercY(n),sx=R_E*(e-w)*Math.PI/180,sy=y1-y0,W=sx>=sy?cells:Math.max(1,Math.round(cells*sx/sy)),H=sx>=sy?Math.max(1,Math.round(cells*sy/sx)):cells;
 const g={W,H,w,e,s,n,y0,y1},num=field&&isNumField(l,field),cat=new Map(),vals=polys.map(p=>{if(!field)return 1;const v=p.f.properties&&p.f.properties[field];if(num){const x=parseFloat(v);return isFinite(x)?x:NaN}const k=String(v);if(!cat.has(k))cat.set(k,cat.size+1);return cat.get(k)});
 const out=new Float32Array(W*H).fill(NaN);fillPolys(g,polys,(j,a,b,k)=>out.fill(vals[k],j*W+a,j*W+b+1));
 return{bands:[out],W,H,bounds:[[s,w],[n,e]],rgb:false,cat:field&&!num?[...cat.keys()]:null}}

function polygonize(l,bi,mode,nc,maxc){const r=l.raster;if(!(bi>=1&&bi<=r.bands.length))throw new Error(`"${l.name}" has ${r.bands.length} band(s)`);
 const g=gridOf(r),step=Math.max(1,Math.ceil(Math.max(g.W,g.H)/Math.max(10,maxc|0||300))),w=Math.ceil(g.W/step),h=Math.ceil(g.H/step),band=r.bands[bi-1],v=new Float32Array(w*h);let mn=1/0,mx=-1/0;
 for(let j=0;j<h;j++)for(let i=0;i<w;i++){const sj=Math.min(g.H-1,j*step+(step>>1)),si=Math.min(g.W-1,i*step+(step>>1)),ix=r.lut[sj*g.W+si];let x=NaN;if(ix>=0){const t=band[ix];if(t!==r.nodata&&isFinite(t))x=t}v[j*w+i]=x;if(x<mn)mn=x;if(x>mx)mx=x}
 if(!isFinite(mn))throw new Error('Raster has no valid cells');
 const cls=new Int32Array(w*h).fill(-1),info=[];
 if(mode==='unique'){const m=new Map();for(let i=0;i<v.length;i++){if(isNaN(v[i]))continue;let c=m.get(v[i]);if(c===undefined){if(m.size>=5000)throw new Error('More than 5000 unique values. Use equal-interval classes.');c=m.size;m.set(v[i],c);info.push({value:v[i]})}cls[i]=c}}
 else{const n=Math.max(2,Math.min(50,nc|0||5)),rg=(mx-mn)||1;for(let i=0;i<v.length;i++)if(!isNaN(v[i]))cls[i]=Math.min(n-1,Math.floor((v[i]-mn)/rg*n));for(let c=0;c<n;c++)info.push({class:c+1,min:+(mn+rg*c/n).toPrecision(6),max:+(mn+rg*(c+1)/n).toPrecision(6)})}
 const lab=new Int32Array(w*h).fill(-1),regC=[],st=[];let nl=0;
 for(let s0=0;s0<w*h;s0++){if(cls[s0]<0||lab[s0]>=0)continue;const c=cls[s0];lab[s0]=nl;st.push(s0);
  while(st.length){const q=st.pop(),x=q%w,y=(q-x)/w;
   if(x>0&&lab[q-1]<0&&cls[q-1]===c){lab[q-1]=nl;st.push(q-1)}if(x<w-1&&lab[q+1]<0&&cls[q+1]===c){lab[q+1]=nl;st.push(q+1)}
   if(y>0&&lab[q-w]<0&&cls[q-w]===c){lab[q-w]=nl;st.push(q-w)}if(y<h-1&&lab[q+w]<0&&cls[q+w]===c){lab[q+w]=nl;st.push(q+w)}}
  regC.push(c);nl++;if(nl>100000)throw new Error('Too many polygons (>100000). Use fewer classes or a lower resolution.')}
 const V=w+1,E=Array.from({length:nl},()=>[]);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const L=lab[y*w+x];if(L<0)continue;const e=E[L],a=y*V+x;
  if(y===0||lab[(y-1)*w+x]!==L)e.push(a,a+1);
  if(x===w-1||lab[y*w+x+1]!==L)e.push(a+1,a+1+V);
  if(y===h-1||lab[(y+1)*w+x]!==L)e.push(a+1+V,a+V);
  if(x===0||lab[y*w+x-1]!==L)e.push(a+V,a)}
 const lon=x=>g.w+Math.min(g.W,x*step)/g.W*(g.e-g.w),lat=y=>invMercLat(g.y1-Math.min(g.H,y*step)/g.H*(g.y1-g.y0)),xy=id=>[id%V,Math.floor(id/V)];
 const inRing=(pt,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)c=!c}return c};
 const area=r=>{let a=0;for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2};
 const feats=[];
 for(let L=0;L<nl;L++){const e=E[L],n=e.length/2,from=new Map();for(let k=0;k<n;k++){let t=from.get(e[2*k]);if(!t)from.set(e[2*k],t=[]);t.push(k)}
  const used=new Uint8Array(n),outers=[],holes=[];
  for(let k0=0;k0<n;k0++){if(used[k0])continue;const ids=[];let k=k0;
   for(;;){used[k]=1;ids.push(e[2*k]);const b=e[2*k+1];if(b===e[2*k0])break;
    const cand=(from.get(b)||[]).filter(c=>!used[c]);if(!cand.length)break;
    if(cand.length===1)k=cand[0];else{const [ax,ay]=xy(e[2*k]),[bx,by]=xy(b);let best=-1e9;for(const c of cand){const [cx,cy]=xy(e[2*c+1]),cr=(bx-ax)*(cy-by)-(by-ay)*(cx-bx);if(cr>best){best=cr;k=c}}}}
   let pts=ids.map(xy);pts=pts.filter((p,i)=>{const a=pts[(i+pts.length-1)%pts.length],b=pts[(i+1)%pts.length];return(p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0])!==0});
   if(pts.length<3)continue;const ar=area(pts);(ar>0?outers:holes).push({pts,ar:Math.abs(ar)})}
  const polys=outers.map(o=>({o,h:[]}));
  for(const hole of holes){const a=hole.pts[0],b=hole.pts[1],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),pt=[(a[0]+b[0])/2+.25*dy/len,(a[1]+b[1])/2-.25*dx/len];
   let best=null;for(const p of polys)if(inRing(pt,p.o.pts)&&(!best||p.o.ar<best.o.ar))best=p;if(best)best.h.push(hole)}
  const conv=pts=>{const c=pts.map(p=>[lon(p[0]),lat(p[1])]);c.push(c[0]);return c};
  const props=info[regC[L]];
  for(const p of polys)feats.push({type:'Feature',properties:{...props},geometry:{type:'Polygon',coordinates:[conv(p.o.pts),...p.h.map(x=>conv(x.pts))]}})}
 return fc(feats)}

function mergeRasters(ls,ov,name){if(!ls||ls.length<2)throw new Error('Select at least two rasters');
 let w=1/0,s=1/0,e=-1/0,n=-1/0,cell=1/0;for(const l of ls){const [[a,b],[c,d]]=l.raster.bounds;s=Math.min(s,a);w=Math.min(w,b);n=Math.max(n,c);e=Math.max(e,d);cell=Math.min(cell,(d-b)/l.raster.outW)}
 const y0=mercY(s),y1=mercY(n);let W=Math.min(1600,Math.max(1,Math.ceil((e-w)/cell)));let H=Math.max(1,Math.round(W*(y1-y0)/(R_E*(e-w)*Math.PI/180)));if(H>1600){W=Math.max(1,Math.round(W*1600/H));H=1600}
 const nb=Math.min(...ls.map(l=>l.raster.bands.length)),rgb=ls.every(l=>l.raster.rgb)&&nb>=3,N=W*H,bounds=[[s,w],[n,e]],mode={'First listed wins':'first','Mean':'mean','Maximum':'max','Minimum':'min'}[ov]||'first';
 const out=Array.from({length:nb},()=>new Float32Array(N).fill(NaN)),cnt=out.map(()=>mode==='mean'?new Uint8Array(N):null);
 for(const l of ls){const r=l.raster,lut=resampleLut({outW:W,outH:H,bounds},r);
  for(let b=0;b<nb;b++){const src=r.bands[b],o=out[b],c=cnt[b];for(let p=0;p<N;p++){const ix=lut[p];if(ix<0)continue;const v=src[ix];if(v===r.nodata||!isFinite(v))continue;const cur=o[p];
   if(isNaN(cur)){o[p]=v;if(c)c[p]=1}else if(mode==='mean'){o[p]=(cur*c[p]+v)/(c[p]+1);c[p]++}else if(mode==='max'){if(v>cur)o[p]=v}else if(mode==='min'){if(v<cur)o[p]=v}}}}
 return addComputedRaster(name,rgb?out.slice(0,3):out,W,H,bounds,true,{rgb});}

/* ================= export dialog ================= */
function openExport(l){
 if(l.type==='raster'){openModal(`<h3>Export — ${esc(l.name)}</h3><p><small>GeoTIFF is written in Web Mercator (EPSG:3857) at the on-screen resolution (max 1600 px). To get polygons, run <b>Raster to polygon</b> first, then export the result as Shapefile.</small></p>
  <div class="row"><button class="pri" id="x-tif">GeoTIFF (.tif)</button><button onclick="closeModal()">Cancel</button></div>`);
  $('#x-tif').onclick=()=>{try{saveFile(l.name+'.tif',tiffBlob(layerRasterData(l)),'image/tiff');closeModal()}catch(e){toast(e.message,6000)}};return}
 const polyOK=l.kind==='polygon'||l.kind==='mixed',fl=fieldsOf(l);
 openModal(`<h3>Export — ${esc(l.name)}</h3>
  <label>Format <select id="x-fmt"><option value="shp">Shapefile (.zip)</option><option value="geojson">GeoJSON</option>${polyOK?'<option value="tif">Raster (GeoTIFF)</option>':''}</select></label>
  <div id="x-ras" style="display:none"><label>Burn value field <select id="x-field"><option value="">(constant 1)</option>${fl.map(f=>`<option>${esc(f)}</option>`).join('')}</select></label>
   <label>Cells on long side <input type="number" id="x-cells" value="1000" min="10" max="2000"></label></div>
  <div class="row"><button class="pri" id="x-go">Export</button><button onclick="closeModal()">Cancel</button></div>`);
 const sync=()=>$('#x-ras').style.display=$('#x-fmt').value==='tif'?'block':'none';$('#x-fmt').onchange=sync;
 $('#x-go').onclick=()=>{try{const f=$('#x-fmt').value;
  if(f==='geojson')saveFile(l.name+'.geojson',JSON.stringify(l.data),'application/geo+json');
  else if(f==='shp')saveFile(l.name+'_shp.zip',toShapefileZip(l),'application/zip');
  else{const d=rasterizePoly(l,$('#x-field').value,+$('#x-cells').value);saveFile(l.name+'.tif',tiffBlob(d),'image/tiff')}
  closeModal()}catch(e){toast('Export failed: '+e.message,7000);console.error(e)}}}

/* ================= wire into the app ================= */
const API={unzip,makeZip,crc32,gdbTable,decGeom,toShapefileZip,tiffBlob,clipRaster,rasterizePoly,polygonize,mergeRasters,fillPolys,gridOf,polyGeoms};
if(typeof module!=='undefined')module.exports=API;
if(typeof TOOLS==='undefined')return;
window.GX=API;window.openExport=openExport;
P.rlayer=(k,label)=>({k,t:'rlayer',label});P.multi=(k,label,kind)=>({k,t:'multi',label,kind});
const noTurf={noTurf:true};
TOOLS.push(
 {name:'Clip raster',...noTurf,params:[P.rlayer('input','Raster layer'),P.layer('overlay','Clip polygons','polygon'),P.chk('crop','Crop to polygon extent',true)],
  run:(p,n)=>({raster:clipRaster(p.input,p.overlay,p.crop,n)})},
 {name:'Polygon to raster',...noTurf,params:[P.layer('input','Polygon layer','polygon'),P.text('field','Value field (blank = 1)',''),P.num('cells','Cells on long side',500)],
  run:(p,n)=>{const f=p.field.trim(),d=rasterizePoly(p.input,f,+p.cells),r=addComputedRaster(n,d.bands,d.W,d.H,d.bounds);if(d.cat)toast('Text field coded as: '+d.cat.map((k,i)=>`${i+1}=${k}`).join(', ').slice(0,300),9000);return{raster:r}}},
 {name:'Raster to polygon',...noTurf,params:[P.rlayer('input','Raster layer'),P.num('band','Band',1),P.sel('mode','Group cells by',['Unique values','Equal-interval classes']),P.num('n','Classes (equal interval)',5),P.num('cells','Max cells on long side',300)],
  run:p=>polygonize(p.input,+p.band,p.mode==='Unique values'?'unique':'eq',+p.n,+p.cells)},
 {name:'Merge rasters (mosaic)',...noTurf,params:[P.multi('inputs','Rasters to merge (in priority order)'),P.sel('ov','Where rasters overlap',['First listed wins','Mean','Maximum','Minimum'])],
  run:(p,n)=>({raster:mergeRasters(p.inputs,p.ov,n)})},
 {name:'Merge vector layers',...noTurf,params:[P.multi('inputs','Layers to merge','vector')],
  run:p=>{if(!p.inputs||p.inputs.length<2)throw new Error('Select at least two layers');return fc(p.inputs.flatMap(l=>l.data.features.map(f=>({type:'Feature',properties:{...f.properties,source_layer:l.name},geometry:f.geometry}))))}}
);
const _openFile=openFile,_openFiles=openFiles;
openFile=async function(f){if(/\.zip$/i.test(f.name)&&await openGdbZip(f))return;return _openFile(f)};
openFiles=async function(files){const g=files.filter(f=>isGdbName(f.name)),rest=files.filter(f=>!isGdbName(f.name)&&!/\.gdb\//i.test(f.webkitRelativePath||''));
 if(g.length)await openGdbLoose(g);return _openFiles(rest)};
const d=$('#gdbdir');if(d){$('#btn-gdb').onclick=()=>d.click();d.onchange=e=>{openFiles([...e.target.files]);e.target.value='';showTab('map')}}
})();
