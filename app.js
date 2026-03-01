
const REQUIRED_BASE = ["hole_id", "bearing_deg", "angle_deg", "depth_ft"];
const REQUIRED_BY_MODE = {
  planar: ["easting", "northing"],
  latlon: ["lat", "lon"],
};
const OPTIONAL_FIELDS = ["diameter_in", "pattern_type", "notes"];
const ANGLE_COLORS = {
  5: "#f97316",
  10: "#22c55e",
  15: "#eab308",
  20: "#0ea5e9",
  25: "#8b5cf6",
  30: "#ef4444",
};

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
  annotations: { paths: [], texts: [] },
  drawDraft: null,
  panState: null,
  renderedPoints: [],
  selectedHoleId: null,
};

const $ = (id) => document.getElementById(id);
const normalize = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const n = (v) => Number.parseFloat(v);

function loadPresets() {
  const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
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
      loadPresets();
    },
  });
}

function autoDetectMapping() {
  const mapping = {};
  const normHeaders = state.headers.map((h) => ({ h, n: normalize(h) }));
  const allFields = [...REQUIRED_BASE, ...REQUIRED_BY_MODE.planar, ...REQUIRED_BY_MODE.latlon, ...OPTIONAL_FIELDS];
  for (const field of allFields) {
    const aliases = [field, ...(ALIASES[field] || [])].map(normalize);
    const found = normHeaders.find((x) => aliases.includes(x.n));
    mapping[field] = found?.h || "";
  }
  return mapping;
}

function renderMappingUI() {
  const reqMode = effectiveMode();
  const required = [...REQUIRED_BASE, ...REQUIRED_BY_MODE[reqMode]];
  const grid = $("mappingGrid");
  grid.innerHTML = "";
  [...required, ...OPTIONAL_FIELDS].forEach((field) => {
    const label = document.createElement("div");
    label.className = required.includes(field) ? "required" : "";
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
  const required = [...REQUIRED_BASE, ...REQUIRED_BY_MODE[reqMode]];
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
      if (["bearing_deg", "angle_deg", "depth_ft", "easting", "northing", "lat", "lon"].includes(field) && !Number.isFinite(n(v))) {
        ok = false;
        errors.push(`Row ${idx + 2}: ${field} non-numeric`);
        invalidCells.add(`${idx}:${col}`);
      }
    }
    if (ok) validRows.push({ row, index: idx });
  });

  state.errors = errors;
  state.skipped = state.rawRows.length - validRows.length;
  state.imported = validRows.map(({ row }) => mapRow(row, reqMode)).filter(Boolean);
  $("importBtn").disabled = state.imported.length === 0;
  $("importSummary").textContent = `Detected ${state.imported.length} valid row(s), skipped ${state.skipped}. ${errors.slice(0, 3).join(" | ")}`;
  renderPreviewTable(invalidCells);
}

function mapRow(row, mode) {
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
  if (mode === "planar") {
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
  const h = `<thead><tr><th>#</th>${state.headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead>`;
  const b = rows.map((r, i) => `<tr><td>${i + 2}</td>${state.headers.map((k) => `<td class="${invalidCells.has(`${i}:${k}`) ? "invalid-cell" : ""}">${r[k] ?? ""}</td>`).join("")}</tr>`).join("");
  table.innerHTML = h + `<tbody>${b}</tbody>`;
}

function projectedRows() {
  if (!state.imported.length) return [];
  const mode = effectiveMode();
  if (mode === "planar") return state.imported.map((d) => ({ ...d, x: d.easting, y: d.northing }));

  const lat0 = state.imported.reduce((a, b) => a + b.lat, 0) / state.imported.length;
  const lon0 = state.imported.reduce((a, b) => a + b.lon, 0) / state.imported.length;
  const mPerDegLat = 111132;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return state.imported.map((d) => {
    const mx = (d.lon - lon0) * mPerDegLon;
    const my = (d.lat - lat0) * mPerDegLat;
    const factor = $("units").value === "ft" ? 3.28084 : 1;
    return { ...d, x: mx * factor, y: my * factor };
  });
}

function renderDiagram() {
  const svg = $("diagramSvg");
  const data = projectedRows();
  svg.innerHTML = "";
  renderTable();
  if (!data.length) {
    hideHolePopup();
    return;
  }

  const W = 1100;
  const H = 850;
  const margin = 70;
  const rotation = normalizeRotation($("diagramRotation").value);
  const rotatedData = rotateProjectedRows(data, rotation);
  const xs = rotatedData.map((d) => d.x);
  const ys = rotatedData.map((d) => d.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const scale = Math.min((W - margin * 2) / spanX, (H - margin * 2) / spanY);
  const toSvg = (x, y) => ({ x: W / 2 + (x - centerX) * scale, y: H / 2 - (y - centerY) * scale });

  const root = el("g", { transform: `translate(${state.transform.tx},${state.transform.ty}) scale(${state.transform.scale})` });
  const scene = el("g", { id: "sceneGroup" });

  if ($("showGrid").checked) scene.appendChild(drawGrid(W, H, 50));

  const placedLabels = [];
  scene.append(el("defs", {}, el("marker", { id: "arrowHead", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" }, el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#334155" }))));
  const textScale = Number($("textScale").value) || 1;
  const usedAngles = new Set();
  state.renderedPoints = [];
  rotatedData.forEach((d) => {
    const p = toSvg(d.x, d.y);
    const isVertical = Math.abs(d.angle_deg) < 0.01;
    const bearingRad = (d.bearing_deg * Math.PI) / 180;
    const dx = Math.sin(bearingRad) * 24;
    const dy = -Math.cos(bearingRad) * 24;
    scene.append(el("circle", { cx: p.x, cy: p.y, r: 2.2, fill: "#0f172a" }));
    state.renderedPoints.push({ hole_id: d.hole_id, x: p.x, y: p.y });

    if ($("showHoleId").checked) {
      scene.append(el("text", { x: p.x, y: p.y - 6, "font-size": 9 * textScale, fill: "#2563eb", "text-anchor": "middle", "font-weight": 700, transform: `rotate(${rotation} ${p.x} ${p.y - 6})` }, d.hole_id));
    }

    if (!isVertical) {
      const angle = normalizeAngleValue(d.angle_deg);
      const angleColor = ANGLE_COLORS[angle] || "#475569";
      usedAngles.add(angle);
      scene.append(el("line", { x1: p.x, y1: p.y, x2: p.x + dx, y2: p.y + dy, stroke: angleColor, "stroke-width": 1.6, "marker-end": "url(#arrowHead)" }));
      scene.append(el("text", { x: p.x + dx + 4, y: p.y + dy + 3, "font-size": 9 * textScale, fill: angleColor, "font-weight": 700, transform: `rotate(${rotation} ${p.x + dx + 4} ${p.y + dy + 3})` }, `${d.angle_deg.toFixed(1)}°`));
    }

    const parts = labelParts(d);
    if (!parts.length) return;
    const box = placeLabel(p, parts.map((part) => part.text).join(""), placedLabels);
    if (box.leader) scene.append(el("line", { x1: p.x, y1: p.y, x2: box.x, y2: box.y + box.h * 0.7, stroke: "#94a3b8", "stroke-width": 0.6 }));
    const label = el("text", { x: box.x, y: box.y + box.h * 0.75, "font-size": 10 * textScale, transform: `rotate(${rotation} ${box.x} ${box.y + box.h * 0.75})` });
    parts.forEach((part) => label.append(el("tspan", { fill: part.color }, part.text)));
    scene.append(label);
    placedLabels.push(box);
  });

  scene.append(drawNorthArrow(W));
  scene.append(drawAnnotations(rotation));
  root.append(scene);
  root.append(drawHud(W, H, spanX, scale, usedAngles));
  svg.append(root);
}

function rotateProjectedRows(data, rotation) {
  if (!rotation) return data;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = data.reduce((sum, d) => sum + d.x, 0) / data.length;
  const cy = data.reduce((sum, d) => sum + d.y, 0) / data.length;
  return data.map((d) => {
    const relX = d.x - cx;
    const relY = d.y - cy;
    return {
      ...d,
      x: relX * cos - relY * sin + cx,
      y: relX * sin + relY * cos + cy,
    };
  });
}

function drawNorthArrow(W) {
  const g = el("g", {});
  const x = W - 75;
  const y = 20;
  g.append(el("line", { x1: x, y1: y + 28, x2: x, y2: y, stroke: "#0f172a", "stroke-width": 1.5 }));
  g.append(el("polygon", { points: `${x},${y - 6} ${x - 6},${y + 5} ${x + 6},${y + 5}`, fill: "#0f172a" }));
  g.append(el("text", { x: x - 6, y: y + 40, "font-size": 12, fill: "#0f172a" }, "N"));
  return g;
}

function drawAnnotations(rotation = 0) {
  const g = el("g", { id: "annotationLayer" });
  const allPaths = [...state.annotations.paths, ...(state.drawDraft ? [state.drawDraft] : [])];
  allPaths.forEach((path) => {
    if (path.points.length < 2) return;
    const d = path.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    g.append(el("path", { d, fill: "none", stroke: path.color, "stroke-width": path.width, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.9 }));
  });
  state.annotations.texts.forEach((note) => {
    g.append(el("text", { x: note.x, y: note.y, fill: note.color, "font-size": 13, "font-weight": 600, transform: `rotate(${rotation} ${note.x} ${note.y})` }, note.text));
  });
  return g;
}

function drawGrid(w, h, step) {
  const g = el("g", { stroke: "#e2e8f0", "stroke-width": 1 });
  for (let x = 0; x <= w; x += step) g.append(el("line", { x1: x, y1: 0, x2: x, y2: h }));
  for (let y = 0; y <= h; y += step) g.append(el("line", { x1: 0, y1: y, x2: w, y2: y }));
  return g;
}

function labelParts(d) {
  if ($("labelDensity").value === "minimal") return [];
  const depth = `${d.depth_ft.toFixed(1)} ft`;
  const density = $("labelDensity").value;
  if (density === "standard") return [{ text: depth, color: "#0f172a" }];
  return [{ text: `angle ${d.angle_deg.toFixed(1)}° depth ${depth}`, color: "#0f172a" }];
}

function placeLabel(p, txt, occupied) {
  const w = Math.max(20, txt.length * 6.5);
  const h = 12;
  const offsets = [[8, -16], [-w - 8, -16], [8, 8], [-w - 8, 8], [12, -2], [-w - 12, -2], [-w / 2, -18], [-w / 2, 10]];
  for (const [ox, oy] of offsets) {
    const b = { x: p.x + ox, y: p.y + oy, w, h, leader: false };
    if (clear(b, occupied, p)) return b;
  }
  return { x: p.x + 14, y: p.y + 14, w, h, leader: true };
}

function clear(b, occupied, p) {
  const marker = { x: p.x - 4, y: p.y - 4, w: 8, h: 8 };
  if (intersects(b, marker)) return false;
  return !occupied.some((o) => intersects(b, o));
}

const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function drawHud(W, H, spanX, scalePxPerUnit, usedAngles) {
  const g = el("g", {});
  const meta = {
    shot: $("metaShot").value,
    face: $("metaFace").value,
    interior: $("metaInterior").value,
    diam: $("metaDiameter").value,
    bench: $("metaBench").value,
    date: $("metaDate").value,
  };

  const targetUnits = chooseNiceScale(spanX / 5);
  const px = targetUnits * scalePxPerUnit;
  g.append(el("line", { x1: 30, y1: H - 28, x2: 30 + px, y2: H - 28, stroke: "#0f172a", "stroke-width": 2 }));
  g.append(el("line", { x1: 30, y1: H - 34, x2: 30, y2: H - 22, stroke: "#0f172a", "stroke-width": 1 }));
  g.append(el("line", { x1: 30 + px, y1: H - 34, x2: 30 + px, y2: H - 22, stroke: "#0f172a", "stroke-width": 1 }));
  g.append(el("text", { x: 30, y: H - 38, "font-size": 10, fill: "#0f172a" }, `${targetUnits.toFixed(0)} ${$("units").value}`));

  const legendX = W - 320;
  const legendY = H - 132;
  g.append(el("rect", { x: legendX, y: legendY, width: 290, height: 108, fill: "white", stroke: "#94a3b8" }));
  [
    `Shot: ${meta.shot || "-"}`,
    `Face: ${meta.face || "-"}`,
    `Interior: ${meta.interior || "-"}`,
    `Hole Ø: ${meta.diam || "-"}`,
    `Bench: ${meta.bench || "-"}    Date: ${meta.date || "-"}`,
  ].forEach((t, i) => g.append(el("text", { x: legendX + 8, y: legendY + 18 + i * 16, "font-size": 11, fill: "#0f172a" }, t)));

  const used = [...usedAngles].filter((a) => ANGLE_COLORS[a]).sort((a, b) => a - b);
  if (used.length) {
    const keyY = 18;
    g.append(el("text", { x: 30, y: keyY, "font-size": 11, fill: "#0f172a", "font-weight": 700 }, "Angle key"));
    used.forEach((angle, idx) => {
      const x = 30 + idx * 64;
      g.append(el("line", { x1: x, y1: keyY + 8, x2: x + 24, y2: keyY + 8, stroke: ANGLE_COLORS[angle], "stroke-width": 3 }));
      g.append(el("text", { x: x + 28, y: keyY + 12, "font-size": 10, fill: "#0f172a" }, `${angle}°`));
    });
  }
  return g;
}

function normalizeAngleValue(angleDeg) {
  return Math.round(Number(angleDeg));
}

function normalizeRotation(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return ((parsed % 360) + 360) % 360;
}

function chooseNiceScale(v) {
  const mags = [1, 2, 5];
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  let best = p;
  mags.forEach((m) => {
    const c = m * p;
    if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  });
  return best;
}

function renderTable() {
  const t = $("holeTable");
  const rows = [...state.imported];
  rows.sort((a, b) => compareHoleIds(a.hole_id, b.hole_id));
  const showCoords = $("showCoordTable").checked;
  const coordMode = effectiveMode();
  const cols = ["hole_id", "depth_ft", "angle_deg", "bearing_deg", ...(showCoords ? (coordMode === "planar" ? ["easting", "northing"] : ["lat", "lon"]) : [])];
  const head = `<thead><tr>${cols.map((c) => `<th data-k="${c}">${c}</th>`).join("")}</tr></thead>`;
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${typeof r[c] === "number" ? r[c].toFixed(2) : r[c] ?? ""}</td>`).join("")}</tr>`).join("");
  t.innerHTML = head + `<tbody>${body}</tbody>`;
}

function compareHoleIds(a, b) {
  const aNum = Number.parseFloat(String(a).replace(/[^0-9.-]/g, ""));
  const bNum = Number.parseFloat(String(b).replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
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
  if (!jsPDF) return alert("PDF library failed to load. Refresh and try again.");

  const orient = $("orientation").value === "landscape" ? "l" : "p";
  const doc = new jsPDF({ orientation: orient, unit: "pt", format: "letter" });
  const pageWidth = orient === "l" ? 792 : 612;
  const pageHeight = orient === "l" ? 612 : 792;
  const margin = 20;

  const svg = $("diagramSvg").cloneNode(true);
  svg.setAttribute("width", String(pageWidth - margin * 2));
  svg.setAttribute("height", String(pageHeight - margin * 2));

  try {
    const pngDataUrl = await svgToPng(svg, pageWidth - margin * 2, pageHeight - margin * 2);
    doc.addImage(pngDataUrl, "PNG", margin, margin, pageWidth - margin * 2, pageHeight - margin * 2);
  } catch (err) {
    console.error(err);
    return alert("Could not export PDF image. Please try again.");
  }

  const tableRows = [...$("holeTable").querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent));
  const header = tableRows[0] || [];
  const bodyRows = tableRows.slice(1);

  let idx = 0;
  const rowsPerPage = 34;
  while (idx < bodyRows.length || idx === 0) {
    doc.addPage("letter", "p");
    drawPdfTablePage(doc, header, bodyRows.slice(idx, idx + rowsPerPage));
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

  doc.setLineWidth(0.5);
  doc.setDrawColor(130, 145, 165);
  doc.setFillColor(232, 240, 250);
  doc.rect(margin, headerY, tableWidth, rowHeight, "FD");
  doc.setFontSize(9);
  doc.setTextColor(24, 34, 48);

  for (let c = 0; c < colCount; c += 1) {
    const x = margin + c * colWidth;
    doc.line(x, headerY, x, headerY + rowHeight * (rows.length + 1));
    doc.text(String(header[c] || ""), x + 3, headerY + 11, { maxWidth: colWidth - 6 });
  }
  doc.line(margin + tableWidth, headerY, margin + tableWidth, headerY + rowHeight * (rows.length + 1));

  rows.forEach((row, rIdx) => {
    const y = headerY + rowHeight * (rIdx + 1);
    if (rIdx % 2 === 1) {
      doc.setFillColor(247, 250, 253);
      doc.rect(margin, y, tableWidth, rowHeight, "F");
    }
    doc.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
    for (let c = 0; c < colCount; c += 1) doc.text(String(row[c] || ""), margin + c * colWidth + 3, y + 11, { maxWidth: colWidth - 6 });
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

function getScenePoint(e) {
  const svg = $("diagramSvg");
  const scene = $("sceneGroup");
  if (!scene) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = scene.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm.inverse());
}

function bindDiagramInteractions() {
  const svg = $("diagramSvg");

  svg.addEventListener("mousedown", (e) => {
    const tool = $("annotationTool").value;
    if (tool === "draw") {
      e.preventDefault();
      const p = getScenePoint(e);
      if (!p) return;
      state.drawDraft = { points: [{ x: p.x, y: p.y }], color: $("annotationColor").value, width: Number($("annotationWidth").value) };
      return;
    }
    if (tool === "pan") {
      e.preventDefault();
      state.panState = { sx: e.clientX, sy: e.clientY };
      return;
    }
    if (tool === "text") {
      const p = getScenePoint(e);
      const text = $("annotationText").value.trim();
      if (!p || !text) return;
      state.annotations.texts.push({ x: p.x, y: p.y, text, color: $("annotationColor").value });
      renderDiagram();
    }
  });

  window.addEventListener("mouseup", () => {
    if (state.drawDraft?.points.length > 1) state.annotations.paths.push(state.drawDraft);
    state.drawDraft = null;
    state.panState = null;
    renderDiagram();
  });

  window.addEventListener("mousemove", (e) => {
    if (state.drawDraft) {
      e.preventDefault();
      const p = getScenePoint(e);
      if (!p) return;
      state.drawDraft.points.push({ x: p.x, y: p.y });
      renderDiagram();
      return;
    }
    if (state.panState && $("annotationTool").value === "pan") {
      state.transform.tx += e.clientX - state.panState.sx;
      state.transform.ty += e.clientY - state.panState.sy;
      state.panState.sx = e.clientX;
      state.panState.sy = e.clientY;
      renderDiagram();
    }
  });

  svg.addEventListener("wheel", (e) => {
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


function showHolePopup(holeId) {
  const hole = state.imported.find((d) => d.hole_id === holeId);
  if (!hole) return;
  state.selectedHoleId = holeId;
  $("holePopupTitle").textContent = `Hole ${holeId}`;
  $("holePopupPattern").value = hole.pattern_type || "";
  $("holePopupNotes").value = hole.notes || "";
  $("holePopup").hidden = false;
}

function hideHolePopup() {
  state.selectedHoleId = null;
  $("holePopup").hidden = true;
}

function setupEvents() {
  const dz = $("dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) readCsv(file);
  });

  $("csvFile").addEventListener("change", (e) => readCsv(e.target.files[0]));
  $("coordMode").addEventListener("change", (e) => { state.coordMode = e.target.value; renderMappingUI(); validateAndPreview(); });
  $("autoDetectBtn").onclick = () => { state.mapping = autoDetectMapping(); renderMappingUI(); validateAndPreview(); };
  $("resetMappingBtn").onclick = () => { state.mapping = {}; renderMappingUI(); validateAndPreview(); };
  $("importBtn").onclick = renderDiagram;

  ["units", "labelDensity", "textScale", "showGrid", "showHoleId", "orientation", "diagramRotation", "metaShot", "metaFace", "metaInterior", "metaDiameter", "metaBench", "metaDate", "metaNotes", "showCoordTable", "annotationColor", "annotationWidth"].forEach((id) => {
    $(id).addEventListener("change", renderDiagram);
    $(id).addEventListener("input", renderDiagram);
  });

  $("fitScreenBtn").onclick = () => { state.transform = { scale: 1, tx: 0, ty: 0 }; renderDiagram(); };
  $("fitPageBtn").onclick = () => { state.transform = { scale: $("orientation").value === "landscape" ? 1 : 0.78, tx: 0, ty: 0 }; renderDiagram(); };
  $("exportPdfBtn").onclick = exportPdf;
  $("exportTableCsvBtn").onclick = exportTableCsv;
  $("clearAnnotationsBtn").onclick = () => { state.annotations = { paths: [], texts: [] }; renderDiagram(); };

  $("savePresetBtn").onclick = () => {
    const name = $("presetName").value.trim();
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
    presets[name] = { mapping: state.mapping, coordMode: state.coordMode };
    localStorage.setItem("blastHoleMappingPresets", JSON.stringify(presets));
    loadPresets();
  };

  $("presetSelect").onchange = (e) => {
    const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
    const p = presets[e.target.value];
    if (!p) return;
    state.mapping = p.mapping;
    state.coordMode = p.coordMode || "auto";
    $("coordMode").value = state.coordMode;
    renderMappingUI();
    validateAndPreview();
  };

  $("deletePresetBtn").onclick = () => {
    const name = $("presetSelect").value;
    if (!name) return;
    const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
    delete presets[name];
    localStorage.setItem("blastHoleMappingPresets", JSON.stringify(presets));
    loadPresets();
  };

  $("openMetadataBtn").onclick = () => $("metadataDialog").showModal();
  $("openNotesBtn").onclick = () => $("notesDialog").showModal();
  $("openTableBtn").onclick = () => $("tableDialog").showModal();
  $("closeMetadataBtn").onclick = () => $("metadataDialog").close();
  $("closeNotesBtn").onclick = () => $("notesDialog").close();
  $("closeTableBtn").onclick = () => $("tableDialog").close();
  $("diagramRotation").addEventListener("change", (e) => {
    e.target.value = String(normalizeRotation(e.target.value));
    renderDiagram();
  });

  $("diagramSvg").addEventListener("click", (e) => {
    if ($("annotationTool").value !== "pan") return;
    const p = getScenePoint(e);
    if (!p || !state.renderedPoints.length) return;
    const nearest = state.renderedPoints
      .map((d) => ({ ...d, dist: Math.hypot(d.x - p.x, d.y - p.y) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (!nearest || nearest.dist > 12) return hideHolePopup();
    showHolePopup(nearest.hole_id);
  });

  $("holePopupSaveBtn").onclick = () => {
    const hole = state.imported.find((d) => d.hole_id === state.selectedHoleId);
    if (!hole) return;
    hole.pattern_type = $("holePopupPattern").value.trim();
    hole.notes = $("holePopupNotes").value.trim();
    renderDiagram();
  };
  $("holePopupCloseBtn").onclick = hideHolePopup;

  bindDiagramInteractions();
}

setupEvents();
loadPresets();
$("orientation").value = "landscape";
$("diagramRotation").value = "0";
$("units").value = "ft";
$("labelDensity").value = "standard";
