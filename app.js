const REQUIRED_BASE = ["hole_id", "bearing_deg", "angle_deg", "depth_ft"];
const REQUIRED_BY_MODE = {
  planar: ["easting", "northing"],
  latlon: ["lat", "lon"],
};
const OPTIONAL_FIELDS = ["diameter_in", "pattern_type", "notes"];
const ALL_FIELDS = [...REQUIRED_BASE, ...REQUIRED_BY_MODE.planar, ...REQUIRED_BY_MODE.latlon, ...OPTIONAL_FIELDS];
const NUMERIC_FIELDS = new Set(["bearing_deg", "angle_deg", "depth_ft", "easting", "northing", "lat", "lon"]);
const ANGLE_COLORS = {
  5: "#f97316",
  10: "#22c55e",
  15: "#eab308",
  20: "#ef4444",
  25: "#ec4899",
  30: "#3b82f6",
};
const PRESET_STORAGE_KEY = "blastHoleMappingPresets";
const LABEL_FONT_MIN = 8;
const LABEL_FONT_MAX = 18;
const HOLE_RADIUS_MIN = 4;
const HOLE_RADIUS_MAX = 16;
const RERENDER_CONTROL_IDS = [
  "units",
  "showGrid",
  "showHoleId",
  "orientation",
  "diagramRotation",
  "printRotation",
  "metaShot",
  "metaFace",
  "metaInterior",
  "metaDiameter",
  "metaBench",
  "metaDate",
  "metaNotes",
  "showCoordTable",
  "diagramScale",
];

const ALIASES = {
  hole_id: ["hole", "holeid", "id", "hole_number", "hole_no", "number"],
  easting: ["e", "east", "x", "e_coord", "easting_ft"],
  northing: ["n", "north", "y", "n_coord", "northing_ft"],
  lat: ["latitude"],
  lon: ["long", "longitude"],
  bearing_deg: ["bearing", "azimuth", "azi", "direction"],
  angle_deg: ["angle", "dip", "inclination"],
  depth_ft: ["depth", "hole_depth", "total_depth", "depth_feet"],
  diameter_in: ["diameter", "diameter_in", "hole_diameter"],
  pattern_type: ["pattern", "patterntype", "face_interior"],
  notes: ["comment", "remark"],
};

const state = {
  headers: [],
  rawRows: [],
  mapping: {},
  coordMode: "auto",
  imported: [],
  skipped: 0,
  errors: [],
  transform: { scale: 1, tx: 0, ty: 0 },
  sort: { key: "hole_id", dir: 1 },
  depthFontSize: 10,
  holeRadius: 7,
  annotations: [],
  activePath: "",
  activeColor: "#38bdf8",
  activeWidth: 2,
};

const $ = (id) => document.getElementById(id);
const normalize = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const n = (v) => Number.parseFloat(v);
const getPresets = () => JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || "{}");
const setPresets = (presets) => localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));

function requiredFields(mode) {
  return [...REQUIRED_BASE, ...(REQUIRED_BY_MODE[mode] || [])];
}

function loadPresets() {
  const presets = getPresets();
  const sel = $("presetSelect");
  sel.innerHTML = `<option value="">Load preset...</option>`;
  Object.keys(presets).sort().forEach((k) => sel.add(new Option(k, k)));
}

function readCsv(file) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: ({ data, meta, errors }) => {
      if (errors.length) $("importSummary").textContent = `CSV parse warnings: ${errors.length}`;
      state.headers = meta.fields || [];
      state.rawRows = data.slice(0, 50000);
      state.coordMode = $("coordMode").value;
      state.mapping = autoDetectMapping();
      renderMappingUI();
      validateAndPreview();
      renderDiagram();
      loadPresets();
    },
  });
}

function autoDetectMapping() {
  const mapping = {};
  const normHeaders = state.headers.map((h) => ({ h, n: normalize(h) }));
  for (const field of ALL_FIELDS) {
    const aliases = new Set([field, ...(ALIASES[field] || [])].map(normalize));
    const found = normHeaders.find((x) => aliases.has(x.n));
    mapping[field] = found?.h || "";
  }
  return mapping;
}

function renderMappingUI() {
  const reqMode = effectiveMode();
  const required = requiredFields(reqMode);
  const requiredSet = new Set(required);
  const grid = $("mappingGrid");
  grid.innerHTML = "";
  [...required, ...OPTIONAL_FIELDS].forEach((field) => {
    const label = document.createElement("div");
    label.className = requiredSet.has(field) ? "required" : "";
    label.textContent = field;
    const sel = document.createElement("select");
    sel.dataset.field = field;
    sel.innerHTML = `<option value="">-- Unmapped --</option>` + state.headers.map((h) => `<option ${state.mapping[field] === h ? "selected" : ""}>${h}</option>`).join("");
    sel.addEventListener("change", (e) => {
      state.mapping[field] = e.target.value;
      validateAndPreview();
    });
    grid.append(label, sel);
  });
}

function effectiveMode() {
  if (state.coordMode !== "auto") return state.coordMode;
  const hasPlanar = state.mapping.easting && state.mapping.northing;
  const hasLatLon = state.mapping.lat && state.mapping.lon;
  return hasPlanar || !hasLatLon ? "planar" : "latlon";
}

function validateAndPreview() {
  const reqMode = effectiveMode();
  const required = requiredFields(reqMode);
  const errors = [];
  const validRows = [];
  const invalidCells = new Set();

  state.rawRows.forEach((row, idx) => {
    let ok = true;
    for (const field of required) {
      const col = state.mapping[field];
      const v = row[col];
      if (!col) {
        ok = false;
        continue;
      }
      if (NUMERIC_FIELDS.has(field) && !Number.isFinite(n(v))) {
        ok = false;
        errors.push(`Row ${idx + 2}: ${field} non-numeric`);
        invalidCells.add(`${idx}:${col}`);
      }
    }
    if (ok) validRows.push(row);
  });

  state.errors = errors;
  state.skipped = state.rawRows.length - validRows.length;
  state.imported = validRows.map((row) => mapRow(row, reqMode)).filter(Boolean);
  $("importBtn").disabled = state.imported.length === 0;
  $("importSummary").textContent = `Detected ${state.imported.length} valid row(s), skipped ${state.skipped}. ${errors.slice(0, 4).join(" | ")}`;
  renderPreviewTable(invalidCells);
}

function mapRow(row, mode) {
  const safeMode = REQUIRED_BY_MODE[mode] ? mode : "planar";
  const out = {
    hole_id: String(row[state.mapping.hole_id] ?? "").trim(),
    bearing_deg: ((n(row[state.mapping.bearing_deg]) % 360) + 360) % 360,
    angle_deg: n(row[state.mapping.angle_deg]),
    depth_ft: n(row[state.mapping.depth_ft]),
    diameter_in: n(row[state.mapping.diameter_in]),
    pattern_type: row[state.mapping.pattern_type] || "",
    notes: row[state.mapping.notes] || "",
  };
  if (!out.hole_id) return null;
  if (safeMode === "planar") {
    out.easting = n(row[state.mapping.easting]);
    out.northing = n(row[state.mapping.northing]);
  } else {
    out.lat = n(row[state.mapping.lat]);
    out.lon = n(row[state.mapping.lon]);
  }
  return out;
}

function renderPreviewTable(invalidCells) {
  const table = $("previewTable");
  const rows = state.rawRows.slice(0, 50);
  if (!rows.length) return (table.innerHTML = "");
  const h = `<thead><tr><th>#</th>${state.headers.map((x) => `<th>${escapeHtml(x)}</th>`).join("")}</tr></thead>`;
  const b = rows.map((r, i) => `<tr><td>${i + 2}</td>${state.headers.map((k) => `<td class="${invalidCells.has(`${i}:${k}`) ? "invalid-cell" : ""}">${escapeHtml(r[k] ?? "")}</td>`).join("")}</tr>`).join("");
  table.innerHTML = h + `<tbody>${b}</tbody>`;
}

function resolveDiagramScale(autoScale) {
  const mode = $("diagramScale")?.value || "auto";
  if (mode === "auto") return autoScale;
  const factor = Number.parseFloat(mode);
  if (!Number.isFinite(factor) || factor <= 0) return autoScale;
  return autoScale * factor;
}

function getDiagramCanvasSize() {
  const orient = $("orientation")?.value === "portrait" ? "portrait" : "landscape";
  const pageWidth = orient === "portrait" ? 612 : 792;
  const pageHeight = orient === "portrait" ? 792 : 612;
  const margin = 20;
  return {
    width: pageWidth - margin * 2,
    height: pageHeight - margin * 2,
  };
}

function projectedRows() {
  if (!state.imported.length) return [];
  const mode = effectiveMode();
  let pts;
  if (mode === "planar") {
    pts = state.imported.map((d) => ({ ...d, x: d.easting, y: d.northing }));
  } else {
    let latSum = 0;
    let lonSum = 0;
    state.imported.forEach((d) => {
      latSum += d.lat;
      lonSum += d.lon;
    });
    const lat0 = latSum / state.imported.length;
    const lon0 = lonSum / state.imported.length;
    const mPerDegLat = 111132;
    const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const factor = $("units").value === "ft" ? 3.28084 : 1;
    pts = state.imported.map((d) => {
      const mx = (d.lon - lon0) * mPerDegLon;
      const my = (d.lat - lat0) * mPerDegLat;
      return { ...d, x: mx * factor, y: my * factor };
    });
  }
  return pts;
}

function renderDiagram() {
  const svg = $("diagramSvg");
  const data = projectedRows();
  svg.innerHTML = "";

  const { width: W, height: H } = getDiagramCanvasSize();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const margin = 48;
  const xs = data.map((d) => d.x), ys = data.map((d) => d.y);
  const minX = data.length ? Math.min(...xs) : 0;
  const maxX = data.length ? Math.max(...xs) : 100;
  const minY = data.length ? Math.min(...ys) : 0;
  const maxY = data.length ? Math.max(...ys) : 100;
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const autoScale = Math.min((W - margin * 2) / spanX, (H - margin * 2) / spanY);
  const scale = resolveDiagramScale(autoScale);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const toSvg = (x, y) => ({
    x: W / 2 + (x - centerX) * scale,
    y: H / 2 - (y - centerY) * scale,
  });

  const root = el("g", { transform: `translate(${state.transform.tx},${state.transform.ty}) scale(${state.transform.scale})` });
  const rotationControl = $("diagramRotation") || $("printRotation");
  const rotation = Number.parseInt(rotationControl?.value || "0", 10) || 0;
  const rotationTransform = rotation ? `rotate(${rotation} ${W / 2} ${H / 2})` : "";
  const geo = el("g", { transform: rotationTransform });
  const labels = el("g", { transform: rotationTransform });
  const keepTextUpright = (attrs) => {
    if (!rotation) return attrs;
    return { ...attrs, transform: `rotate(${-rotation} ${attrs.x} ${attrs.y})` };
  };
  if ($("showGrid").checked) {
    geo.appendChild(drawGrid(W, H, 50));
  }

  const depthFont = state.depthFontSize;
  const holeRadius = state.holeRadius;
  const holeIdFont = Math.max(7, Math.min(18, holeRadius * 1.12));
  data.forEach((d) => {
    const p = toSvg(d.x, d.y);
    const isVertical = Math.abs(d.angle_deg) < 0.01;
    const angleColor = getAngleColor(d.angle_deg);
    const bearingRad = (d.bearing_deg * Math.PI) / 180;
    const angleLen = Math.max(24, holeRadius * 3.2);
    const angleStroke = Math.max(1.1, holeRadius * 0.2);
    const dx = Math.sin(bearingRad) * angleLen;
    const dy = -Math.cos(bearingRad) * angleLen;
    geo.append(el("circle", { cx: p.x, cy: p.y, r: holeRadius, fill: "#ffffff", stroke: "#111827", "stroke-width": 1.2 }));
    if ($("showHoleId").checked) {
      geo.append(el("text", keepTextUpright({
        x: p.x,
        y: p.y,
        "font-size": holeIdFont,
        "font-weight": "700",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: "#1d4ed8",
      }), d.hole_id));
    }
    if (!isVertical) {
      geo.append(el("line", { x1: p.x, y1: p.y, x2: p.x + dx, y2: p.y + dy, stroke: angleColor, "stroke-width": angleStroke, "marker-end": "url(#arrowHead)" }));
    }

    const labelInfo = labelParts(d);
    if (labelInfo.lines.length) {
      const bottomGap = Math.max(2, Math.round(holeRadius * 0.35));
      const label = el("text", keepTextUpright({
        x: p.x,
        y: p.y + holeRadius + bottomGap,
        "font-size": depthFont,
        "text-anchor": "middle",
        "dominant-baseline": "hanging",
      }));
      labelInfo.lines.forEach((line, idx) => {
        label.append(el("tspan", {
          x: p.x,
          dy: idx === 0 ? 0 : depthFont + 4,
          fill: line.color,
          "font-weight": line.bold ? "700" : "400",
          "text-anchor": "middle",
        }, line.text));
      });
      labels.append(label);
    }
  });

  if (!data.length) {
    labels.append(el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", "font-size": 18, fill: "#6b7280" }, "No renderable rows to display"));
  }

  svg.append(el("defs", {}, el("marker", { id: "arrowHead", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" }, el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#374151" }))));
  root.append(geo);
  root.append(labels);
  root.append(drawAnnotations());
  svg.append(root);
  svg.append(drawFixedHud(W, H, spanX, scale, rotation));
  renderTable();
}

function drawGrid(w, h, step) {
  const g = el("g", { stroke: "#eef2f7", "stroke-width": 1 });
  for (let x = 0; x <= w; x += step) g.append(el("line", { x1: x, y1: 0, x2: x, y2: h }));
  for (let y = 0; y <= h; y += step) g.append(el("line", { x1: 0, y1: y, x2: w, y2: y }));
  return g;
}

function labelParts(d) {
  const depth = `${Math.round(d.depth_ft)} ft`;
  return {
    lines: [
      { text: depth, color: "#111827", bold: false },
    ],
  };
}

function normalizeAngleValue(angleDeg) {
  return Math.round(Number(angleDeg));
}

function getAngleColor(angleDeg) {
  return ANGLE_COLORS[normalizeAngleValue(angleDeg)] || "#374151";
}

function drawAnnotations() {
  const g = el("g", { id: "annotationLayer" });
  state.annotations.forEach((ann) => {
    if (ann.type === "path") {
      g.append(el("path", {
        d: ann.d,
        fill: "none",
        stroke: ann.color,
        "stroke-width": ann.width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }));
    } else if (ann.type === "text") {
      g.append(el("text", { x: ann.x, y: ann.y, fill: ann.color, "font-size": 12, "font-weight": "600" }, ann.text));
    }
  });
  if (state.activePath) {
    g.append(el("path", {
      d: state.activePath,
      fill: "none",
      stroke: state.activeColor || "#38bdf8",
      "stroke-width": state.activeWidth || 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }));
  }
  return g;
}

function drawFixedHud(W, H, spanX, scalePxPerUnit, rotationDeg = 0) {
  const g = el("g", {});
  const meta = {
    shot: $("metaShot").value,
    face: $("metaFace").value,
    interior: $("metaInterior").value,
    diam: $("metaDiameter").value,
    bench: $("metaBench").value,
    date: $("metaDate").value,
  };

  const northArrow = el("g", { transform: rotationDeg ? `rotate(${rotationDeg} ${W - 75} ${35})` : "" });
  northArrow.append(el("line", { x1: W - 75, y1: 45, x2: W - 75, y2: 20, stroke: "#111827", "stroke-width": 1.5 }));
  northArrow.append(el("polygon", { points: `${W - 75},14 ${W - 80},24 ${W - 70},24`, fill: "#111827" }));
  northArrow.append(el("text", { x: W - 82, y: 58, "font-size": 11 }, "N"));
  g.append(northArrow);

  const targetUnits = chooseNiceScale(spanX / 5);
  const px = targetUnits * scalePxPerUnit;
  const diagramScaleMode = $("diagramScale")?.value || "auto";
  const scaleLabel = diagramScaleMode === "auto"
    ? "Auto"
    : `${Math.round(Number.parseFloat(diagramScaleMode) * 100)}%`;
  g.append(el("line", { x1: 30, y1: H - 28, x2: 30 + px, y2: H - 28, stroke: "#111827", "stroke-width": 2 }));
  g.append(el("line", { x1: 30, y1: H - 34, x2: 30, y2: H - 22, stroke: "#111827", "stroke-width": 1 }));
  g.append(el("line", { x1: 30 + px, y1: H - 34, x2: 30 + px, y2: H - 22, stroke: "#111827", "stroke-width": 1 }));
  g.append(el("text", { x: 30, y: H - 38, "font-size": 10 }, `${targetUnits.toFixed(0)} ${$("units").value}`));

  const legendX = W - 300, legendY = H - 120;
  g.append(el("rect", { x: legendX, y: legendY, width: 270, height: 116, fill: "white", stroke: "#9ca3af" }));
  const rows = [
    `Shot: ${meta.shot || "-"}`,
    `Face: ${meta.face || "-"}`,
    `Interior: ${meta.interior || "-"}`,
    `Scale: ${scaleLabel}`,
    `Hole Ø: ${meta.diam || "-"}`,
    `Bench: ${meta.bench || "-"}    Date: ${meta.date || "-"}`,
  ];
  rows.forEach((t, i) => {
    const x = legendX + 8;
    const y = legendY + 18 + i * 16;
    g.append(el("text", { x, y, "font-size": 11 }, t));
  });

  const colorScaleX = 30;
  const colorScaleY = 30;
  const colorScaleRows = Object.keys(ANGLE_COLORS)
    .map((k) => Number.parseInt(k, 10))
    .sort((a, b) => a - b);
  const colorScaleHeight = 28 + colorScaleRows.length * 16;
  g.append(el("rect", {
    x: colorScaleX,
    y: colorScaleY,
    width: 270,
    height: colorScaleHeight,
    fill: "white",
    stroke: "#9ca3af",
  }));
  g.append(el("text", { x: colorScaleX + 8, y: colorScaleY + 16, "font-size": 11, "font-weight": "700" }, "Angle color scale"));
  colorScaleRows.forEach((angle, idx) => {
    const y = colorScaleY + 30 + idx * 16;
    const color = ANGLE_COLORS[angle];
    g.append(el("line", { x1: colorScaleX + 10, y1: y - 4, x2: colorScaleX + 34, y2: y - 4, stroke: color, "stroke-width": 3 }));
    g.append(el("text", { x: colorScaleX + 40, y: y, "font-size": 10, fill: "#111827" }, `${angle}°`));
  });
  return g;
}
function chooseNiceScale(v) {
  const mags = [1, 2, 5];
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  let best = p;
  mags.forEach((m) => { const c = m * p; if (Math.abs(c - v) < Math.abs(best - v)) best = c; });
  return best;
}

function renderTable() {
  const t = $("holeTable");
  const rows = [...state.imported];
  const key = state.sort.key;
  rows.sort((a, b) => compareValues(a[key], b[key]) * state.sort.dir);
  const showCoords = $("showCoordTable").checked;
  const coordMode = effectiveMode();
  const cols = ["hole_id", "bearing_deg", "angle_deg", "depth_ft", ...(showCoords ? (coordMode === "planar" ? ["easting", "northing"] : ["lat", "lon"]) : [])];
  const head = `<thead><tr>${cols.map((c) => `<th data-k="${c}">${c}</th>`).join("")}</tr></thead>`;
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${typeof r[c] === "number" ? r[c].toFixed(1) : r[c] ?? ""}</td>`).join("")}</tr>`).join("");
  t.innerHTML = head + `<tbody>${body}</tbody>`;
  t.querySelectorAll("th").forEach((th) => th.onclick = () => { state.sort = { key: th.dataset.k, dir: state.sort.key === th.dataset.k ? -state.sort.dir : 1 }; renderTable(); });
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function exportTableCsv() {
  const table = $("holeTable");
  if (!table.tHead) return;
  const rows = [...table.rows].map((r) => [...r.cells].map((c) => `"${String(c.textContent).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(rows, "hole_table.csv", "text/csv");
}

async function exportPdf() {
  if (!state.imported.length) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("PDF library failed to load. Refresh and try again.");
    return;
  }

  const orient = $("orientation").value === "landscape" ? "l" : "p";
  const doc = new jsPDF({ orientation: orient, unit: "pt", format: "letter" });
  const pageWidth = orient === "l" ? 792 : 612;
  const pageHeight = orient === "l" ? 612 : 792;
  const margin = 20;
  const svg = $("diagramSvg").cloneNode(true);
  svg.setAttribute("width", String(pageWidth - margin * 2));
  svg.setAttribute("height", String(pageHeight - margin * 2));
  svg.querySelectorAll('[data-print-outline="true"]').forEach((node) => node.remove());

  try {
    const pngDataUrl = await svgToPng(svg, pageWidth - margin * 2, pageHeight - margin * 2);
    doc.addImage(pngDataUrl, "PNG", margin, margin, pageWidth - margin * 2, pageHeight - margin * 2);
  } catch (err) {
    console.error(err);
    alert("Could not export PDF image. Please try again.");
    return;
  }

  const tableRows = [...$("holeTable").querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent));
  const header = tableRows[0] || [];
  const bodyRows = tableRows.slice(1);
  const rowsPerPage = 34;
  let idx = 0;

  while (idx < bodyRows.length || idx === 0) {
    doc.addPage("letter", "p");
    const pageRows = bodyRows.slice(idx, idx + rowsPerPage);
    drawPdfTablePage(doc, header, pageRows);
    idx += rowsPerPage;
    if (!bodyRows.length) break;
  }

  doc.save("blast-hole-diagram.pdf");
}


function drawPdfTablePage(doc, header, rows) {
  const pageWidth = 612;
  const margin = 24;
  const tableWidth = pageWidth - margin * 2;
  const rowHeight = 16;
  const headerY = 34;
  const colCount = Math.max(1, header.length || (rows[0] || []).length || 1);
  const colWidth = tableWidth / colCount;

  doc.setLineWidth(0.35);
  doc.setDrawColor(170, 180, 190);
  doc.setFillColor(245, 248, 252);

  doc.rect(margin, headerY, tableWidth, rowHeight, "FD");
  doc.setFontSize(9);
  doc.setTextColor(31, 41, 55);

  for (let c = 0; c < colCount; c += 1) {
    const x = margin + c * colWidth;
    doc.line(x, headerY, x, headerY + rowHeight * (rows.length + 1));
    const text = String(header[c] || "");
    doc.text(text, x + 3, headerY + 11, { maxWidth: colWidth - 6 });
  }
  doc.line(margin + tableWidth, headerY, margin + tableWidth, headerY + rowHeight * (rows.length + 1));

  rows.forEach((row, rIdx) => {
    const y = headerY + rowHeight * (rIdx + 1);
    doc.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
    for (let c = 0; c < colCount; c += 1) {
      const cell = String(row[c] || "");
      doc.text(cell, margin + c * colWidth + 3, y + 11, { maxWidth: colWidth - 6 });
    }
  });

  doc.line(margin, headerY, margin + tableWidth, headerY);
}

function svgToPng(svg, width, height) {
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function bindPanZoom() {
  const svg = $("diagramSvg");
  let dragging = false, sx = 0, sy = 0;
  let drawing = false;
  let currentPath = "";
  const diagramPoint = (evt) => {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  };

  svg.addEventListener("mousedown", (e) => {
    const tool = $("annotationTool")?.value || "pan";
    if (tool === "draw") {
      const p = diagramPoint(e);
      if (!p) return;
      drawing = true;
      currentPath = `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      state.activePath = currentPath;
      state.activeColor = $("annotationColor").value;
      state.activeWidth = Number($("annotationWidth").value) || 2;
      renderDiagram();
      e.preventDefault();
      return;
    }
    if (tool === "text") {
      const p = diagramPoint(e);
      const text = $("annotationText")?.value?.trim();
      if (p && text) {
        state.annotations.push({ type: "text", x: p.x, y: p.y, color: $("annotationColor").value, text });
        renderDiagram();
      }
      return;
    }
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
  });

  window.addEventListener("mouseup", () => {
    if (drawing && currentPath) {
      state.annotations.push({ type: "path", d: currentPath, color: $("annotationColor").value, width: Number($("annotationWidth").value) || 2 });
      currentPath = "";
      state.activePath = "";
      renderDiagram();
    }
    drawing = false;
    dragging = false;
  });
  window.addEventListener("mousemove", (e) => {
    if (drawing) {
      const p = diagramPoint(e);
      if (!p) return;
      currentPath += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
      state.activePath = currentPath;
      renderDiagram();
      return;
    }
    if (!dragging) return;
    state.transform.tx += e.clientX - sx;
    state.transform.ty += e.clientY - sy;
    sx = e.clientX; sy = e.clientY;
    renderDiagram();
  });
  svg.addEventListener("wheel", (e) => {
    if (($("annotationTool")?.value || "pan") !== "pan") return;
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.08 : 0.92;
    state.transform.scale = Math.min(8, Math.max(0.2, state.transform.scale * f));
    renderDiagram();
  }, { passive: false });
}

function el(name, attrs = {}, text) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
}

function downloadBlob(contents, filename, type) {
  const blob = new Blob([contents], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setupEvents() {
  const dz = $("dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("dragover");
    const file = e.dataTransfer.files[0]; if (file) readCsv(file);
  });
  $("csvFile").addEventListener("change", (e) => readCsv(e.target.files[0]));
  $("coordMode").addEventListener("change", (e) => { state.coordMode = e.target.value; renderMappingUI(); validateAndPreview(); });
  $("autoDetectBtn").onclick = () => { state.mapping = autoDetectMapping(); renderMappingUI(); validateAndPreview(); };
  $("resetMappingBtn").onclick = () => { state.mapping = {}; renderMappingUI(); validateAndPreview(); };
  $("importBtn").onclick = renderDiagram;

  RERENDER_CONTROL_IDS.forEach((id) => bindRerenderEvents($(id)));

  $("fitPageBtn").onclick = () => { $("diagramScale").value = "auto"; state.transform = { scale: 1, tx: 0, ty: 0 }; renderDiagram(); };
  $("exportPdfBtn").onclick = exportPdf;
  $("savePresetBtn").onclick = () => {
    const name = $("presetName").value.trim(); if (!name) return;
    const presets = getPresets();
    presets[name] = { mapping: state.mapping, coordMode: state.coordMode };
    setPresets(presets);
    loadPresets();
  };
  $("presetSelect").onchange = (e) => {
    const presets = getPresets();
    const p = presets[e.target.value]; if (!p) return;
    state.mapping = p.mapping; state.coordMode = p.coordMode || "auto";
    $("coordMode").value = state.coordMode;
    renderMappingUI(); validateAndPreview();
  };
  $("deletePresetBtn").onclick = () => {
    const name = $("presetSelect").value; if (!name) return;
    const presets = getPresets();
    delete presets[name];
    setPresets(presets);
    loadPresets();
  };

  bindDialog("openMetadataBtn", "metadataDialog", "closeMetadataBtn");
  bindDialog("openNotesBtn", "notesDialog", "closeNotesBtn");
  bindDialog("openTableBtn", "tableDialog", "closeTableBtn");

  bindRerenderEvents($("holeSize"));
  bindRerenderEvents($("depthTextSize"));
  $("holeSize").addEventListener("input", syncSizingStateFromControls);
  $("depthTextSize").addEventListener("input", syncSizingStateFromControls);
  $("holeSize").addEventListener("change", syncSizingStateFromControls);
  $("depthTextSize").addEventListener("change", syncSizingStateFromControls);
  $("clearAnnotationsBtn").onclick = () => {
    state.annotations = [];
    state.activePath = "";
    renderDiagram();
  };

  bindPanZoom();
}

function syncSizingStateFromControls() {
  state.holeRadius = Math.max(HOLE_RADIUS_MIN, Math.min(HOLE_RADIUS_MAX, Number($("holeSize")?.value || 7)));
  state.depthFontSize = Math.max(LABEL_FONT_MIN, Math.min(LABEL_FONT_MAX, Number($("depthTextSize")?.value || 10)));
  const holeLabel = $("holeSizeValue");
  const depthLabel = $("depthTextSizeValue");
  if (holeLabel) holeLabel.textContent = `Hole ${state.holeRadius}px`;
  if (depthLabel) depthLabel.textContent = `Depth ${state.depthFontSize}px`;
}

function bindDialog(openBtnId, dialogId, closeBtnId) {
  const openBtn = $(openBtnId);
  const closeBtn = $(closeBtnId);
  const dialog = $(dialogId);
  if (!openBtn || !dialog) return;

  openBtn.addEventListener("click", () => {
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "open");
  });

  if (!closeBtn) return;
  closeBtn.addEventListener("click", () => {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  });
}

function bindRerenderEvents(element) {
  if (!element) return;
  element.addEventListener("change", () => renderDiagram());
  element.addEventListener("input", () => renderDiagram());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

setupEvents();
loadPresets();
$("orientation").value = "landscape";
if ($("diagramRotation")) $("diagramRotation").value = "0";
if ($("printRotation")) $("printRotation").value = "0";
$("units").value = "ft";
if ($("diagramScale")) $("diagramScale").value = "auto";
syncSizingStateFromControls();
