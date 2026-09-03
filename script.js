// SHP -> KML batch converter
// Everything below runs entirely in the browser: shapefiles are never
// uploaded anywhere, they're read, converted, and zipped locally.

const SHAPEFILE_EXTENSIONS = [".shp", ".shx", ".dbf", ".prj", ".cpg"];

// --- Element references ---
const $ = (id) => document.getElementById(id);

const drop = $("drop");
const folderInput = $("folder");
const fileInput = $("input");
const filesPanel = $("files");
const convertBtn = $("convert");
const clearBtn = $("clear");
const progress = $("progress");
const statusLabel = $("status");
const percentLabel = $("pct");
const progressBar = $("bar");
const result = $("result");

// Currently selected files (from folder picker, file picker, or drag-and-drop)
let selected = [];

// --- Wiring up the UI ---

$("folderBtn").onclick = (e) => {
  e.stopPropagation();
  folderInput.click();
};

$("zipBtn").onclick = (e) => {
  e.stopPropagation();
  fileInput.click();
};

folderInput.onchange = () => {
  selected = [...folderInput.files];
  renderFileList();
};

fileInput.onchange = () => {
  selected = [...fileInput.files];
  renderFileList();
};

// Clicking the empty drop area (not a button inside it) opens the folder picker
drop.onclick = (e) => {
  if (e.target === drop) folderInput.click();
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
  selected = [...e.dataTransfer.files];
  renderFileList();
});

clearBtn.onclick = () => {
  selected = [];
  folderInput.value = "";
  fileInput.value = "";
  renderFileList();
  result.className = "result hidden";
  progress.className = "progress hidden";
  setProgress(0, "");
};

convertBtn.onclick = runConversion;

// --- UI rendering ---

function renderFileList() {
  if (!selected.length) {
    filesPanel.className = "files hidden";
    convertBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }

  const shpFiles = selected.filter((f) => /\.shp$/i.test(f.name));
  const zipFiles = selected.filter((f) => /\.zip$/i.test(f.name));

  const header =
    `<div class="fh"><b>${selected.length} file(s) selected</b>` +
    `<span>${shpFiles.length} SHP${zipFiles.length ? " + " + zipFiles.length + " ZIP" : ""}</span></div>`;

  const rows = selected
    .map(
      (f) =>
        `<div class="fr"><span>${escapeHtml(f.webkitRelativePath || f.name)}</span>` +
        `<span class="size">${formatBytes(f.size)}</span></div>`
    )
    .join("");

  filesPanel.innerHTML = header + rows;
  filesPanel.className = "files";
  clearBtn.disabled = false;
  convertBtn.disabled = !(shpFiles.length || zipFiles.length);
}

function setProgress(percent, statusText) {
  progressBar.style.width = percent + "%";
  percentLabel.textContent = percent + "%";
  statusLabel.textContent = statusText;
}

// --- Grouping files into complete shapefile datasets ---

// A "dataset" is one shapefile's set of matching parts, e.g.
// parcels.shp + parcels.shx + parcels.dbf + parcels.prj
async function buildDatasets() {
  const groups = new Map();

  const addFileToGroup = (path, file) => {
    path = path.replaceAll("\\", "/");
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (!SHAPEFILE_EXTENSIONS.includes(ext)) return;

    const base = path.slice(0, path.lastIndexOf("."));
    if (!groups.has(base)) {
      groups.set(base, {
        name: path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf(".")),
        shp: null,
        shx: null,
        dbf: null,
        prj: null,
        cpg: null,
      });
    }
    groups.get(base)[ext.slice(1)] = file;
  };

  // Directly selected shapefile component files
  const looseFiles = selected.filter((f) => !/\.zip$/i.test(f.name));
  for (const file of looseFiles) {
    addFileToGroup(file.webkitRelativePath || file.name, file);
  }

  // Files bundled inside uploaded ZIP archives
  const zipFiles = selected.filter((f) => /\.zip$/i.test(f.name));
  for (const zipFile of zipFiles) {
    const archive = await JSZip.loadAsync(zipFile);
    for (const entry of Object.values(archive.files)) {
      if (entry.dir) continue;
      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (SHAPEFILE_EXTENSIONS.includes(ext)) {
        const blob = await entry.async("blob");
        const fileName = entry.name.split("/").pop();
        addFileToGroup(entry.name, new File([blob], fileName));
      }
    }
  }

  // Only keep datasets that have the minimum required parts
  return [...groups.values()].filter((g) => g.shp && g.shx && g.dbf);
}

// --- Conversion ---

async function runConversion() {
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  result.className = "result hidden";
  progress.className = "progress";
  setProgress(3, "Finding SHP datasets…");

  try {
    if (typeof shp !== "function" || typeof tokml !== "function" || typeof JSZip === "undefined") {
      throw new Error("A required library did not load. Refresh the page.");
    }

    const datasets = await buildDatasets();
    if (!datasets.length) {
      throw new Error("No complete SHP datasets found. Every SHP needs matching SHX and DBF files.");
    }

    const kmlFiles = await convertDatasetsToKml(datasets);
    if (!kmlFiles.length) {
      throw new Error("The SHPs were read, but no features were found.");
    }

    setProgress(92, "Creating ZIP…");
    const zipBlob = await buildZip(kmlFiles);

    showSuccess(kmlFiles.length, zipBlob);
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
async function convertDatasetsToKml(datasets) {
  const kmlFiles = [];

  for (let i = 0; i < datasets.length; i++) {
    const dataset = datasets[i];
    setProgress(
      8 + Math.round((i / datasets.length) * 78),
      `Converting ${dataset.name} (${i + 1} of ${datasets.length})…`
    );

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

    collections.forEach((featureCollection, index) => {
      if (!featureCollection?.features?.length) return;
      const suffix = collections.length > 1 ? `_${index + 1}` : "";
      kmlFiles.push({
        name: `${sanitizeFileName(dataset.name)}${suffix}.kml`,
        data: tokml(featureCollection),
      });
    });
  }

  return kmlFiles;
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

function showSuccess(kmlCount, zipBlob) {
  const downloadUrl = URL.createObjectURL(zipBlob);
  result.className = "result ok";
  result.innerHTML =
    `<b>✓ Conversion complete</b><div>${kmlCount} KML file(s) created.</div>` +
    `<a class="download" href="${downloadUrl}" download="kml_conversion_results.zip">Download KML ZIP</a>`;
  result.classList.remove("hidden");
}

function showError(message) {
  result.className = "result err";
  result.textContent = message;
  result.classList.remove("hidden");
}

// --- Small utilities ---

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  const i = bytes ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + units[i];
}

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "converted";
}

function escapeHtml(str) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(str).replace(/[&<>"']/g, (c) => escapes[c]);
}
