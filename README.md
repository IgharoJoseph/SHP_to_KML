# [SHP → KML Batch Converter](https://shptokml.vercel.app/)

A single-page, client-side tool that converts ESRI Shapefiles to KML — in
bulk. Select a whole folder of shapefiles, individual SHP files, or drop in a
ZIP and get back one KML per shapefile, packaged into a single ZIP.

**[Try SHP → KML Batch Converter](https://shptokml.vercel.app/)**

**Everything runs in the browser.** No files are uploaded to a server; the
conversion happens locally using [shpjs](https://github.com/calvinmetcalf/shapefile-js)
and [tokml](https://github.com/mapbox/tokml).

## Features

- Select an entire folder of shapefiles
- Select individual SHP files
- Upload a `.zip` containing shapefile datasets
- Automatically groups matching `.shp` / `.shx` / `.dbf` / `.prj` / `.cpg` files
- Converts each shapefile to its own `.kml`
- Bundles all output KMLs into one downloadable ZIP
- Drag-and-drop or file-picker input
- Runs entirely client-side with no file uploads

## Files

- `index.html` — page markup
- `style.css` — styling
- `script.js` — app logic: reads ZIP(s), groups shapefile parts, validates each dataset, then converts

## How validation works

Only `.zip` files are accepted — anything else is rejected immediately with
an explanation. Each ZIP is inspected before conversion starts:

- Shapefile parts inside it are grouped by matching base name
- A dataset is **ready** if it has `.shp`, `.shx`, and `.dbf`, and the `.dbf`
  header reports at least one record
- A dataset is flagged **missing parts** or **empty (0 features)** instead,
  and shown as such in the list — it's excluded from conversion, and
  everything else still proceeds

## Usage

You can use the live application here:

**[SHP → KML Batch Converter](https://shptokml.vercel.app/)**

To run it locally, just open `index.html` in a browser — there's no build step.
For example, using a static file server:

```bash
npx serve .
