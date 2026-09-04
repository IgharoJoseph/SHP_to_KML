// SHP -> KML batch converter
// Everything below runs entirely in the browser: shapefiles are never
// uploaded anywhere, they're read, converted, and zipped locally.
//
// Flow: user provides ZIP file(s) -> we inspect each ZIP and group its
// contents into shapefile datasets -> each dataset is validated (all parts
// present, at least one feature) -> the user sees that report before
// anything is converted -> only datasets marked "ready" get converted.

const SHAPEFILE_EXTENSIONS = [".shp", ".shx", ".dbf", ".prj", ".cpg"];
const REQUIRED_EXTENSIONS = ["shp", "shx", "dbf"];

// --- Element references ---
const $ = (id) => document.getElementById(id);

const drop = $("drop");
const fileInput = $("input");
const filesPanel = $("files");
const convertBtn = $("convert");
const clearBtn = $("clear");
const progress = $("progress");
const statusLabel = $("status");
const percentLabel = $("pct");
const progressBar = $("bar");
const result = $("result");

// Datasets built from the currently selected ZIP(s), after validation.
// Each entry: { name, shp, shx, dbf, prj, cpg, status: "ready"|"missing"|"empty", detail }
let datasets = [];

// --- Wiring up the UI ---

$("zipBtn").onclick = (e) => {
  e.stopPropagation();
  fileInput.click();
};

fileInput.onchange = () => handleSelection([...fileInput.files]);

drop.onclick = (e) => {
  if (e.target === drop) fileInput.click();
};

["dragenter", "dragover"].forEach((eventName) =>
  drop.addEventListener(eventName, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  })
);

["dragleave", "drop"].forEach((eventName) =>
  drop.addEventListener(eventName, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  })
);

drop.addEventListener("drop", (e) => {
  handleSelection([...e.dataTransfer.files]);
});

clearBtn.onclick = resetAll;
convertBtn.onclick = runConversion;

function resetAll() {
  datasets = [];
  fileInput.value = "";
  filesPanel.className = "files hidden";
  filesPanel.innerHTML = "";
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  result.className = "result hidden";
  progress.className = "progress hidden";
  setProgress(0, "");
}

// --- Handling a new selection: reject non-ZIPs, then validate ---

async function handleSelection(incomingFiles) {
  if (!incomingFiles.length) return;

  const nonZips = incomingFiles.filter((f) => !/\.zip$/i.test(f.name));
  if (nonZips.length) {
    resetAll();
    showError(
      "Only ZIP files are accepted. " +
        `Please zip up your shapefile(s) first (rejected: ${nonZips.map((f) => f.name).join(", ")}).`
    );
    return;
  }

  clearBtn.disabled = false;
  convertBtn.disabled = true;
  result.className = "result hidden";
  filesPanel.className = "files";
  filesPanel.innerHTML = '<div class="fh"><b>Checking ZIP contents…</b></div>';

  try {
    datasets = await buildDatasetsFromZips(incomingFiles);
    renderDatasetReport();
  } catch (error) {
    console.error(error);
    resetAll();
    showError("Couldn't read that ZIP file: " + (error.message || String(error)));
  }
}

// --- Reading ZIP(s) and grouping their contents into datasets ---

async function buildDatasetsFromZips(zipFiles) {
  const groups = new Map();

  const addEntry = (path, ext, blob) => {
    const base = path.slice(0, path.lastIndexOf("."));
    if (!groups.has(base)) {
      groups.set(base, {
        name: base.replaceAll("/", "_"),
        shp: null,
        shx: null,
        dbf: null,
        prj: null,
        cpg: null,
      });
    }
    groups.get(base)[ext] = blob;
  };

  for (const zipFile of zipFiles) {
    const archive = await JSZip.loadAsync(zipFile);
    // Prefix with the source zip's name so identically-named datasets in
    // different ZIP uploads never collide with each other either.
    const zipPrefix = zipFile.name.replace(/\.zip$/i, "");
    for (const entry of Object.values(archive.files)) {
      if (entry.dir) continue;
      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (!SHAPEFILE_EXTENSIONS.includes(ext)) continue;
      const blob = await entry.async("blob");
      const fullPath = zipFiles.length > 1
        ? `${zipPrefix}/${entry.name.replaceAll("\\", "/")}`
        : entry.name.replaceAll("\\", "/");
      addEntry(fullPath, ext.slice(1), blob);
    }
  }

  // Classify each group as ready / missing parts / empty (0 features)
  const results = [];
  for (const group of groups.values()) {
    const missing = REQUIRED_EXTENSIONS.filter((ext) => !group[ext]);
    if (missing.length) {
      results.push({
        ...group,
        status: "missing",
        detail: `Missing ${missing.map((e) => "." + e).join(", ")}`,
      });
      continue;
    }

    const recordCount = await readDbfRecordCount(group.dbf);
    if (recordCount === 0) {
      results.push({ ...group, status: "empty", detail: "0 features (empty shapefile)" });
      continue;
    }

    results.push({ ...group, status: "ready", detail: `${recordCount} feature(s)` });
  }

  return results;
}

// Reads the record count straight from a DBF file's header (bytes 4-7,
// little-endian uint32), per the DBF file format spec. This lets us flag
// empty shapefiles before attempting a full conversion.
async function readDbfRecordCount(dbfBlob) {
  const buffer = await dbfBlob.arrayBuffer();
  const view = new DataView(buffer);
  return view.getUint32(4, true);
}

// --- Pre-conversion report ---

function renderDatasetReport() {
  if (!datasets.length) {
    filesPanel.innerHTML = '<div class="fh"><b>No shapefiles found in that ZIP.</b></div>';
    convertBtn.disabled = true;
    return;
  }

  const readyCount = datasets.filter((d) => d.status === "ready").length;

  const header =
    `<div class="fh"><b>${datasets.length} dataset(s) found</b>` +
    `<span>${readyCount} ready to convert</span></div>`;

  const rows = datasets
    .map((d) => {
      const badge =
        d.status === "ready" ? "✓" : d.status === "empty" ? "⚠" : "✗";
      return (
        `<div class="fr"><span>${badge} ${escapeHtml(d.name)}</span>` +
        `<span class="size">${escapeHtml(d.detail)}</span></div>`
      );
    })
    .join("");

  filesPanel.innerHTML = header + rows;
  convertBtn.disabled = readyCount === 0;
}

function setProgress(percent, statusText) {
  progressBar.style.width = percent + "%";
  percentLabel.textContent = percent + "%";
  statusLabel.textContent = statusText;
}

// --- Conversion ---

async function runConversion() {
  const ready = datasets.filter((d) => d.status === "ready");

  convertBtn.disabled = true;
  clearBtn.disabled = true;
  result.className = "result hidden";
  progress.className = "progress";
  setProgress(3, "Starting conversion…");

  try {
    if (typeof shp !== "function" || typeof tokml !== "function" || typeof JSZip === "undefined") {
      throw new Error("A required library did not load. Refresh the page.");
    }
    if (!ready.length) {
      throw new Error("No ready datasets to convert.");
    }

    const { kmlFiles, failures } = await convertDatasetsToKml(ready);
    if (!kmlFiles.length) {
      throw new Error(
        "None of the SHP datasets could be converted." + (failures.length ? " " + failures[0].message : "")
      );
    }

    setProgress(92, "Creating ZIP…");
    const zipBlob = await buildZip(kmlFiles);

    showSuccess(kmlFiles.length, zipBlob, failures);
    setProgress(100, "Complete");
  } catch (error) {
    console.error(error);
    showError(error.message || String(error));
    setProgress(0, "Conversion failed");
  } finally {
    convertBtn.disabled = false;
    clearBtn.disabled = false;
  }
}

// Converts each dataset with shpjs, then each resulting GeoJSON
// FeatureCollection to a KML string with tokml.
// A failure on one dataset is caught and recorded rather than aborting
// the whole batch, so one bad SHP doesn't block the rest from converting.
async function convertDatasetsToKml(readyDatasets) {
  const kmlFiles = [];
  const failures = [];

  for (let i = 0; i < readyDatasets.length; i++) {
    const dataset = readyDatasets[i];
    setProgress(
      8 + Math.round((i / readyDatasets.length) * 78),
      `Converting ${dataset.name} (${i + 1} of ${readyDatasets.length})…`
    );

    try {
      const geoData = await shp({
        shp: await dataset.shp.arrayBuffer(),
        shx: await dataset.shx.arrayBuffer(),
        dbf: await dataset.dbf.arrayBuffer(),
        prj: dataset.prj ? await dataset.prj.arrayBuffer() : undefined,
        cpg: dataset.cpg ? await dataset.cpg.arrayBuffer() : undefined,
      });

      // shpjs returns either a single FeatureCollection or an array of them
      // (e.g. when a shapefile mixes multiple geometry types)
      const collections = Array.isArray(geoData) ? geoData : [geoData];
      let addedAny = false;

      collections.forEach((featureCollection, index) => {
        if (!featureCollection?.features?.length) return;
        const suffix = collections.length > 1 ? `_${index + 1}` : "";
        kmlFiles.push({
          name: `${sanitizeFileName(dataset.name)}${suffix}.kml`,
          data: tokml(featureCollection),
        });
        addedAny = true;
      });

      if (!addedAny) {
        failures.push({
          name: dataset.name,
          message: `Dataset "${dataset.name}" had no features to convert.`,
        });
      }
    } catch (error) {
      console.error(`Failed to convert dataset "${dataset.name}":`, error);
      failures.push({
        name: dataset.name,
        message:
          `Dataset "${dataset.name}" could not be converted. The SHP data could not be read. ` +
          "Check that the SHP, SHX and DBF files belong to the same dataset and are not corrupt.",
      });
    }
  }

  return { kmlFiles, failures };
}

async function buildZip(kmlFiles) {
  const zip = new JSZip();
  kmlFiles.forEach((file) => zip.file(file.name, file.data));

  return zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (metadata) => setProgress(92 + Math.round(metadata.percent * 0.08), "Creating ZIP…")
  );
}

// --- Result banner ---

function showSuccess(kmlCount, zipBlob, failures = []) {
  const downloadUrl = URL.createObjectURL(zipBlob);
  const hasFailures = failures.length > 0;

  result.className = hasFailures ? "result err" : "result ok";
  let html =
    `<b>${hasFailures ? "⚠ Conversion finished with some errors" : "✓ Conversion complete"}</b>` +
    `<div>${kmlCount} KML file(s) created.</div>`;

  if (hasFailures) {
    html +=
      `<div style="margin-top:8px">${failures.length} dataset(s) failed:</div>` +
      "<ul>" +
      failures.map((f) => `<li>${escapeHtml(f.message)}</li>`).join("") +
      "</ul>";
  }

  html += `<a class="download" href="${downloadUrl}" download="kml_conversion_results.zip">Download KML ZIP</a>`;
  result.innerHTML = html;
  result.classList.remove("hidden");
}

function showError(message) {
  result.className = "result err";
  result.textContent = message;
  result.classList.remove("hidden");
}

// --- Small utilities ---

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "converted";
}

function escapeHtml(str) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(str).replace(/[&<>"']/g, (c) => escapes[c]);
}
