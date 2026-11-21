# GeoLite Mobile

A lightweight, QGIS-style mapping app for Android (not QGIS itself). Plain HTML/JS in `www/`, wrapped as an APK with Capacitor.

## Features
- **Open data**: GeoJSON, zipped Shapefile (.zip), **File Geodatabase (.gdb)**, CSV (lat/lon or x/y columns), KML, GPX, GeoTIFF (WGS84, Web Mercator or UTM, single or multi-band)
- **Map**: layer order, visibility, zoom, attribute table, popups, OSM basemap, export layer as GeoJSON, save/open project
- **Symbology**: single symbol, categorized, graduated (equal interval / quantile), color ramps, labels, raster color ramps and opacity
- **Layout**: A4/A3/Letter page, **insert extra map frames (own extent), legend, scale bar, north arrow, text and images** (drag the green header, resize from the corner), editable title and notes, legend, north arrow, scale bar, export PNG or Print/PDF
- **Geoprocessing** (Turf.js): buffer, clip, intersection, difference, union, dissolve, centroids, convex hull, bounding box, simplify, Voronoi, grid, points-in-polygon, count points, geometry attributes, extract by attribute
- **Raster tools**: clip raster (by polygon), polygon to raster, raster to polygon, merge/mosaic rasters (first / mean / max / min on overlap), raster calculator. Also merge vector layers.
- **Export** (Layers → Export): vector → Shapefile (.zip), GeoJSON or GeoTIFF (polygons); raster → GeoTIFF.
- **Edit** (new tab): create feature classes (point / line / polygon with your own fields), add features by tapping on the map, select and reshape features (drag vertices, insert vertices, delete a vertex, move a whole feature), edit attributes, delete features, open an editable attribute table (edit cells, delete rows), add / rename / delete fields, populate fields (same value, auto-number, copy field, or expression with `$area`, `$length`, `$x`, `$y`), and undo (last 10 edits per layer).

## Build the APK without a PC (GitHub Actions)
1. Create a new GitHub repo and upload the contents of this folder (keep `.github/workflows/build-apk.yml`).
2. Open the repo's **Actions** tab, choose **Build APK**, tap **Run workflow**.
3. When it finishes, download the **GeoLite-debug-apk** artifact (a zip containing `app-debug.apk`), then install it. Allow "install unknown apps" if asked.

## Build locally
```bash
npm install
npm run vendor          # bundles JS libs into www/vendor for offline use
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```
Needs Node 20+, JDK 17 and the Android SDK.

## Try it in a browser or install as a PWA
Serve `www/` over HTTPS (or `npx serve www`) and open it on your phone, then "Add to Home screen". Opening `index.html` directly from a file also works for testing.

## Opening a File Geodatabase (.gdb)
A .gdb is a folder, so either **zip the .gdb folder** and open the .zip with "+ Open data" (works on phones), or use "+ GDB folder" on a desktop browser. Every feature class becomes a layer; tables without geometry are skipped.
Supported: points, multipoints, lines, polygons (curves are drawn as straight segments), WGS84/geographic, UTM and Web Mercator coordinate systems. Not supported: raster/mosaic datasets, annotation, other projections (reproject to WGS84 or UTM first). Reading is done by a small built-in parser (no GDAL), so very unusual geodatabases may fail with an error message.

## Limits
- Raster tools work on the on-screen grid (max 1600 px). Raster to polygon works on a coarser grid (default 300 cells on the long side); raise it for more detail.
- GeoTIFF export is Web Mercator (EPSG:3857) at on-screen resolution; shapefile export is WGS84.
- Basemap tiles need internet. The JS libraries work offline once vendored into the APK.
- Rasters are downsampled to at most 1600 px on the long side, and drawn below vector layers.
- Raster CRS support: WGS84, Web Mercator, UTM. Reproject others first.
- Geoprocessing runs in the browser, so very large datasets will be slow.
- Layout PNG export uses html2canvas and can differ slightly from the on-screen map. Print/PDF may not work inside the Android WebView; use PNG there.
- The APK is a debug build. To publish it you must sign a release build.

## Edit menu notes
- Edits live inside the app. Keep them with **Layers → Export** (Shapefile / GeoJSON) or **Layers → Save project** (the project file also stores empty feature classes and field types).
- Field types are Text, Integer and Decimal. Numeric fields reject non-numbers. Shapefile export truncates field names to 10 characters.
- On a phone the panel hides while you draw or select so the map is visible; the floating bar at the top of the map has Finish / Undo / Delete / Stop buttons.
