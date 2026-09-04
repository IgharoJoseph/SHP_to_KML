# SHP → KML Batch Converter

A single-page, client-side tool that converts ESRI Shapefiles to KML — in
bulk. Select a whole folder of shapefiles (or drop in a ZIP) and get back one
KML per shapefile, packaged into a single ZIP.

**Everything runs in the browser.** No files are uploaded to a server; the
conversion happens locally using [shpjs](https://github.com/calvinmetcalf/shapefile-js)
and [tokml](https://github.com/mapbox/tokml).

## Features

- Select an entire folder of shapefiles, or upload a `.zip`
- Automatically groups matching `.shp` / `.shx` / `.dbf` / `.prj` / `.cpg` files
- Converts each shapefile to its own `.kml`
- Bundles all output KMLs into one downloadable ZIP
- Drag-and-drop or file-picker input

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

Just open `index.html` in a browser — there's no build step. To try it
locally:

```bash
# any static file server works, e.g.:
npx serve .
```

Then visit the printed local URL, select a shapefile folder or ZIP, and click
**Convert all SHPs to KML**.

## Deploying to Vercel

This is a static site (no build command needed). Push this repo to GitHub,
import it in Vercel, and deploy — `vercel.json` is already configured with
`cleanUrls`.

## Notes

- A shapefile needs at least matching `.shp`, `.shx`, and `.dbf` files to be
  converted; `.prj` (coordinate system) and `.cpg` (encoding) are used when
  present.
- Output KML uses WGS84 (EPSG:4326) coordinates, per the KML spec.
- Very large batches (many/large shapefiles) run entirely in the browser tab,
  so extremely large inputs may be slow or memory-limited depending on the
  device.

## License

MIT — see [LICENSE](LICENSE).
