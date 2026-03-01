const REQUIRED_BASE = ["hole_id", "bearing_deg", "angle_deg", "depth_ft"];
const REQUIRED_BY_MODE = {
    planar: ["easting", "northing"],
    latlon: ["lat", "lon"],
};
const OPTIONAL_FIELDS = ["diameter_in", "pattern_type", "notes"];

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
    $("importSummary").textContent = `Detected ${state.imported.length} valid row(s), skipped ${state.skipped}. ${errors.slice(0, 4).join(" | ")}`;
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
    let pts;
    if (mode === "planar") pts = state.imported.map((d) => ({ ...d, x: d.easting, y: d.northing }));
    else {
        const lat0 = state.imported.reduce((a, b) => a + b.lat, 0) / state.imported.length;
        const lon0 = state.imported.reduce((a, b) => a + b.lon, 0) / state.imported.length;
        const mPerDegLat = 111132;
        const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
        pts = state.imported.map((d) => {
            const mx = (d.lon - lon0) * mPerDegLon;
            const my = (d.lat - lat0) * mPerDegLat;
            const factor = $("units").value === "ft" ? 3.28084 : 1;
            return { ...d, x: mx * factor, y: my * factor };
        });
    }
    return pts;
}

function renderDiagram() {
    const svg = $("diagramSvg");
    const data = projectedRows();
    svg.innerHTML = "";
    if (!data.length) return;

    const W = 1100, H = 850, margin = 70;
    const xs = data.map((d) => d.x), ys = data.map((d) => d.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    const scale = Math.min((W - margin * 2) / spanX, (H - margin * 2) / spanY);
    const toSvg = (x, y) => ({ x: margin + (x - minX) * scale, y: H - margin - (y - minY) * scale });

    const root = el("g", { transform: `translate(${state.transform.tx},${state.transform.ty}) scale(${state.transform.scale})` });
    if ($("showGrid").checked) {
        root.appendChild(drawGrid(W, H, 50));
    }

    const placedLabels = [];
    data.forEach((d) => {
        const p = toSvg(d.x, d.y);
        const bearingRad = (d.bearing_deg * Math.PI) / 180;
        const dx = Math.sin(bearingRad) * 24;
        const dy = -Math.cos(bearingRad) * 24;
        root.append(el("circle", { cx: p.x, cy: p.y, r: 3, fill: "#111827" }));
        root.append(el("line", { x1: p.x, y1: p.y, x2: p.x + dx, y2: p.y + dy, stroke: "#374151", "stroke-width": 1.1, "marker-end": "url(#arrowHead)" }));

        const txt = labelText(d);
        const bbox = placeLabel(p, txt, placedLabels);
        if (bbox.leader) root.append(el("line", { x1: p.x, y1: p.y, x2: bbox.x, y2: bbox.y + bbox.h * 0.7, stroke: "#9ca3af", "stroke-width": 0.6 }));
        root.append(el("text", { x: bbox.x, y: bbox.y + bbox.h * 0.75, "font-size": 10, fill: "#111827" }, txt));
        placedLabels.push(bbox);
    });

    svg.append(el("defs", {}, el("marker", { id: "arrowHead", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" }, el("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#374151" }))));
    svg.append(root, drawFixedHud(W, H, spanX, scale));
    renderTable();
}

function drawGrid(w, h, step) {
    const g = el("g", { stroke: "#eef2f7", "stroke-width": 1 });
    for (let x = 0; x <= w; x += step) g.append(el("line", { x1: x, y1: 0, x2: x, y2: h }));
    for (let y = 0; y <= h; y += step) g.append(el("line", { x1: 0, y1: y, x2: w, y2: y }));
    return g;
}

function labelText(d) {
    if (!$("showHoleId").checked && $("labelDensity").value === "minimal") return "";
    const depth = `${d.depth_ft.toFixed(1)} ft`;
    const angle = `${d.angle_deg.toFixed(1)}°`;
    const id = d.hole_id;
    const density = $("labelDensity").value;
    if (density === "minimal") return id;
    if (density === "standard") return `${id} ${depth}`;
    return `${id} ${angle} / ${depth}`;
}

function placeLabel(p, txt, occupied) {
    const w = Math.max(18, txt.length * 6.5), h = 12;
    const offsets = [[8, -16], [-w - 8, -16], [8, 8], [-w - 8, 8], [10, -4], [-w - 10, -4], [-w / 2, -18], [-w / 2, 10]];
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

function drawFixedHud(W, H, spanX, scalePxPerUnit) {
    const g = el("g", {});
    const meta = {
        shot: $("metaShot").value,
        face: $("metaFace").value,
        interior: $("metaInterior").value,
        diam: $("metaDiameter").value,
        bench: $("metaBench").value,
        date: $("metaDate").value,
    };

    g.append(el("line", { x1: W - 75, y1: 45, x2: W - 75, y2: 20, stroke: "#111827", "stroke-width": 1.5 }));
    g.append(el("polygon", { points: `${W - 75},14 ${W - 80},24 ${W - 70},24`, fill: "#111827" }));
    g.append(el("text", { x: W - 82, y: 58, "font-size": 11 }, "N"));

    const targetUnits = chooseNiceScale(spanX / 5);
    const px = targetUnits * scalePxPerUnit;
    g.append(el("line", { x1: 30, y1: H - 28, x2: 30 + px, y2: H - 28, stroke: "#111827", "stroke-width": 2 }));
    g.append(el("line", { x1: 30, y1: H - 34, x2: 30, y2: H - 22, stroke: "#111827", "stroke-width": 1 }));
    g.append(el("line", { x1: 30 + px, y1: H - 34, x2: 30 + px, y2: H - 22, stroke: "#111827", "stroke-width": 1 }));
    g.append(el("text", { x: 30, y: H - 38, "font-size": 10 }, `${targetUnits.toFixed(0)} ${$("units").value}`));

    const legendX = W - 300, legendY = H - 120;
    g.append(el("rect", { x: legendX, y: legendY, width: 270, height: 100, fill: "white", stroke: "#9ca3af" }));
    const rows = [
        `Shot: ${meta.shot || "-"}`,
        `Face: ${meta.face || "-"}`,
        `Interior: ${meta.interior || "-"}`,
        `Hole Ø: ${meta.diam || "-"}`,
        `Bench: ${meta.bench || "-"}    Date: ${meta.date || "-"}`,
    ];
    rows.forEach((t, i) => g.append(el("text", { x: legendX + 8, y: legendY + 18 + i * 16, "font-size": 11 }, t)));
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
    rows.sort((a, b) => (a[key] > b[key] ? 1 : -1) * state.sort.dir);
    const showCoords = $("showCoordTable").checked;
    const coordMode = effectiveMode();
    const cols = ["hole_id", "bearing_deg", "angle_deg", "depth_ft", ...(showCoords ? (coordMode === "planar" ? ["easting", "northing"] : ["lat", "lon"]) : [])];
    const head = `<thead><tr>${cols.map((c) => `<th data-k="${c}">${c}</th>`).join("")}</tr></thead>`;
    const body = rows.map((r) => `<tr>${cols.map((c) => `<td>${typeof r[c] === "number" ? r[c].toFixed(1) : r[c] ?? ""}</td>`).join("")}</tr>`).join("");
    t.innerHTML = head + `<tbody>${body}</tbody>`;
    t.querySelectorAll("th").forEach((th) => th.onclick = () => { state.sort = { key: th.dataset.k, dir: state.sort.key === th.dataset.k ? -state.sort.dir : 1 }; renderTable(); });
}

function exportTableCsv() {
    const table = $("holeTable");
    if (!table.tHead) return;
    const rows = [...table.rows].map((r) => [...r.cells].map((c) => `"${String(c.textContent).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadBlob(rows, "hole_table.csv", "text/csv");
}

async function exportPdf() {
    const { jsPDF } = window.jspdf;
    const orient = $("orientation").value === "landscape" ? "l" : "p";
    const doc = new jsPDF({ orientation: orient, unit: "pt", format: "letter" });
    const svg = $("diagramSvg").cloneNode(true);
    svg.setAttribute("width", orient === "l" ? "792" : "612");
    svg.setAttribute("height", orient === "l" ? "612" : "792");
    await doc.svg(svg, { x: 20, y: 20, width: orient === "l" ? 752 : 572, height: orient === "l" ? 572 : 752 });

    const tableRows = [...$("holeTable").querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent));
    const perPage = 36;
    for (let i = 0; i < tableRows.length; i += perPage) {
        doc.addPage("letter", "p");
        doc.setFontSize(10);
        let y = 34;
        tableRows.slice(i, i + perPage).forEach((row) => {
            doc.text(row.join("   "), 20, y);
            y += 15;
        });
    }
    doc.save("blast-hole-diagram.pdf");
}

function bindPanZoom() {
    const svg = $("diagramSvg");
    let dragging = false, sx = 0, sy = 0;
    svg.addEventListener("mousedown", (e) => { dragging = true; sx = e.clientX; sy = e.clientY; });
    window.addEventListener("mouseup", () => dragging = false);
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        state.transform.tx += e.clientX - sx;
        state.transform.ty += e.clientY - sy;
        sx = e.clientX; sy = e.clientY;
        renderDiagram();
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

    ["units", "labelDensity", "showGrid", "showHoleId", "orientation", "metaShot", "metaFace", "metaInterior", "metaDiameter", "metaBench", "metaDate", "metaNotes", "showCoordTable"].forEach((id) => {
        $(id).addEventListener("change", () => renderDiagram());
        $(id).addEventListener("input", () => renderDiagram());
    });

    $("fitScreenBtn").onclick = () => { state.transform = { scale: 1, tx: 0, ty: 0 }; renderDiagram(); };
    $("fitPageBtn").onclick = () => { state.transform = { scale: $("orientation").value === "landscape" ? 1 : 0.78, tx: 0, ty: 0 }; renderDiagram(); };
    $("exportPdfBtn").onclick = exportPdf;
    $("exportTableCsvBtn").onclick = exportTableCsv;

    $("savePresetBtn").onclick = () => {
        const name = $("presetName").value.trim(); if (!name) return;
        const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
        presets[name] = { mapping: state.mapping, coordMode: state.coordMode };
        localStorage.setItem("blastHoleMappingPresets", JSON.stringify(presets));
        loadPresets();
    };
    $("presetSelect").onchange = (e) => {
        const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
        const p = presets[e.target.value]; if (!p) return;
        state.mapping = p.mapping; state.coordMode = p.coordMode || "auto";
        $("coordMode").value = state.coordMode;
        renderMappingUI(); validateAndPreview();
    };
    $("deletePresetBtn").onclick = () => {
        const name = $("presetSelect").value; if (!name) return;
        const presets = JSON.parse(localStorage.getItem("blastHoleMappingPresets") || "{}");
        delete presets[name]; localStorage.setItem("blastHoleMappingPresets", JSON.stringify(presets)); loadPresets();
    };

    bindPanZoom();
}

setupEvents();
loadPresets();
$("orientation").value = "landscape";
$("units").value = "ft";
$("labelDensity").value = "standard";
