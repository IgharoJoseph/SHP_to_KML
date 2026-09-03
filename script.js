const EXT = [".shp", ".shx", ".dbf", ".prj", ".cpg"];

const $ = id => document.getElementById(id);

const drop = $("drop");
const folderInput = $("folder");
const shpInput = $("shpFiles");
const zipInput = $("zip");
const filesPanel = $("files");
const convertBtn = $("convert");
const clearBtn = $("clear");
const progress = $("progress");
const status = $("status");
const pct = $("pct");
const bar = $("bar");
const result = $("result");

let selected = [];
let selectionType = null;

// Input buttons
$("folderBtn").onclick = e => {
  e.stopPropagation();
  folderInput.click();
};

$("shpBtn").onclick = e => {
  e.stopPropagation();
  shpInput.click();
};

$("zipBtn").onclick = e => {
  e.stopPropagation();
  zipInput.click();
};

// File selection
folderInput.onchange = () => {
  selected = [...folderInput.files];
  selectionType = "folder";
  renderFiles();
};

shpInput.onchange = () => {
  selected = [...shpInput.files];
  selectionType = "shp";
  renderFiles();
};

zipInput.onchange = () => {
  selected = [...zipInput.files];
  selectionType = "zip";
  renderFiles();
};

// Drop area
drop.onclick = e => {
  if (e.target === drop) folderInput.click();
};

["dragenter", "dragover"].forEach(type => {
  drop.addEventListener(type, e => {
    e.preventDefault();
    drop.classList.add("over");
  });
});

["dragleave", "drop"].forEach(type => {
  drop.addEventListener(type, e => {
    e.preventDefault();
    drop.classList.remove("over");
  });
});

drop.addEventListener("drop", e => {
  selected = [...e.dataTransfer.files];
  selectionType = detectType(selected);
  renderFiles();
});

// Clear
clearBtn.onclick = () => {
  selected = [];
  selectionType = null;

  folderInput.value = "";
  shpInput.value = "";
  zipInput.value = "";

  renderFiles();
  result.className = "result hidden";
  progress.className = "progress hidden";
  setProgress(0, "");
};

convertBtn.onclick = convert;

// UI
function renderFiles() {
  if (!selected.length) {
    filesPanel.className = "files hidden";
    convertBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }

  const shps = selected.filter(f => /\.shp$/i.test(f.name));
  const zips = selected.filter(f => /\.zip$/i.test(f.name));

  const source =
    selectionType === "folder" ? "Folder" :
    selectionType === "zip" ? "ZIP" :
    selectionType === "shp" ? "SHP files" :
    "Dropped files";

  filesPanel.innerHTML = `
    <div class="fh">
      <b>${selected.length} file(s) selected</b>
      <span>${source}</span>
    </div>
    ${selected.map(f => `
      <div class="fr">
        <span>${escapeHtml(f.webkitRelativePath || f.name)}</span>
        <span class="size">${formatBytes(f.size)}</span>
      </div>
    `).join("")}
  `;

  filesPanel.className = "files";
  clearBtn.disabled = false;
  convertBtn.disabled = !(shps.length || zips.length);
}

function detectType(files) {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) return "zip";
  if (files.some(f => f.webkitRelativePath)) return "folder";
  return "shp";
}

function setProgress(value, text) {
  bar.style.width = `${value}%`;
  pct.textContent = `${value}%`;
  status.textContent = text;
}

// Dataset grouping
async function getDatasets() {
  const groups = new Map();

  function add(path, file) {
    path = path.replaceAll("\\", "/");

    const i = path.lastIndexOf(".");
    if (i < 0) return;

    const ext = path.slice(i).toLowerCase();
    if (!EXT.includes(ext)) return;

    const base = path.slice(0, i);

    if (!groups.has(base)) {
      groups.set(base, {
        name: path.slice(path.lastIndexOf("/") + 1, i),
        shp: null,
        shx: null,
        dbf: null,
        prj: null,
        cpg: null
      });
    }

    groups.get(base)[ext.slice(1)] = file;
  }

  for (const file of selected.filter(f => !/\.zip$/i.test(f.name))) {
    add(file.webkitRelativePath || file.name, file);
  }

  for (const zipFile of selected.filter(f => /\.zip$/i.test(f.name))) {
    const zip = await JSZip.loadAsync(zipFile);

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;

      const i = entry.name.lastIndexOf(".");
      if (i < 0) continue;

      const ext = entry.name.slice(i).toLowerCase();
      if (!EXT.includes(ext)) continue;

      const blob = await entry.async("blob");
      add(entry.name, new File([blob], entry.name.split("/").pop()));
    }
  }

  return [...groups.values()].filter(g => g.shp && g.shx && g.dbf);
}

// Conversion
async function convert() {
  convertBtn.disabled = true;
  clearBtn.disabled = true;
  result.className = "result hidden";
  progress.className = "progress";

  try {
    if (typeof shp !== "function" || typeof tokml !== "function" || !window.JSZip) {
      throw new Error("A required library did not load. Refresh the page.");
    }

    setProgress(3, "Finding SHP datasets…");

    const datasets = await getDatasets();

    if (!datasets.length) {
      throw new Error(
        "No complete SHP datasets found. Every SHP needs matching SHX and DBF files. Use a complete folder or ZIP for automatic pairing."
      );
    }

    const kmlFiles = [];

    for (let i = 0; i < datasets.length; i++) {
      const d = datasets[i];

      setProgress(
        8 + Math.round(i / datasets.length * 78),
        `Converting ${d.name} (${i + 1} of ${datasets.length})…`
      );

      const data = await shp({
        shp: await d.shp.arrayBuffer(),
        shx: await d.shx.arrayBuffer(),
        dbf: await d.dbf.arrayBuffer(),
        prj: d.prj ? await d.prj.arrayBuffer() : undefined,
        cpg: d.cpg ? await d.cpg.arrayBuffer() : undefined
      });

      const collections = Array.isArray(data) ? data : [data];

      collections.forEach((fc, index) => {
        if (!fc?.features?.length) return;

        const suffix = collections.length > 1 ? `_${index + 1}` : "";

        kmlFiles.push({
          name: `${safeName(d.name)}${suffix}.kml`,
          data: tokml(fc)
        });
      });
    }

    if (!kmlFiles.length) {
      throw new Error("The SHPs were read, but no features were found.");
    }

    setProgress(92, "Creating ZIP…");

    const zip = new JSZip();

    kmlFiles.forEach(file => zip.file(file.name, file.data));

    const blob = await zip.generateAsync(
      {
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      },
      metadata => setProgress(
        92 + Math.round(metadata.percent * 0.08),
        "Creating ZIP…"
      )
    );

    const filename = outputName(datasets);

    const url = URL.createObjectURL(blob);

    result.className = "result ok";
    result.innerHTML = `
      <b>✓ Conversion complete</b>
      <div>${kmlFiles.length} KML file(s) created.</div>
      <a class="download" href="${url}" download="${escapeHtml(filename)}">
        Download KML ZIP
      </a>
    `;

    setProgress(100, "Complete");

  } catch (error) {
    console.error(error);

    result.className = "result err";
    result.textContent = error.message || String(error);

    setProgress(0, "Conversion failed");
  }

  convertBtn.disabled = false;
  clearBtn.disabled = false;
}

// Output filename
function outputName(datasets) {
  let name;

  if (selectionType === "folder") {
    const path = selected[0]?.webkitRelativePath || "";
    name = path.split("/")[0] || datasets[0].name;
  } else if (selectionType === "zip") {
    name = selected[0].name.replace(/\.zip$/i, "");
  } else if (selectionType === "shp") {
    name = datasets.length === 1 ? datasets[0].name : "SHP_Batch";
  } else {
    const zip = selected.find(f => /\.zip$/i.test(f.name));

    if (zip) {
      name = zip.name.replace(/\.zip$/i, "");
    } else {
      name = datasets.length === 1 ? datasets[0].name : "SHP_Batch";
    }
  }

  const d = new Date();

  const timestamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

  return `${safeName(name)}_KML_${timestamp}.zip`;
}

// Utilities
function safeName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim() || "converted";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  const i = bytes ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}