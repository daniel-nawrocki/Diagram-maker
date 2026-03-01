# Blast Hole Diagrammer

A static, client-side **Blast Hole Diagrammer** designed for GitHub Pages.

It imports arbitrary CSV drill-hole data, lets users map columns, validates rows, and renders a clean, true-scale SVG plan with anti-clutter labels, north arrow, scale bar, metadata legend, sortable table, and multi-page PDF export.

## Defaults

- Page size: **Letter**
- Diagram orientation: **Landscape** (default)
- PDF:
  - Page 1 (diagram): Letter Landscape by default
  - Page 2+ (table): Letter Portrait
- Units: **feet** by default
- Angle definition: **degrees from vertical down**
  - `0° = vertical down`
  - `10° = 10° off vertical`
- Label Density default: **Standard**

## Features

- Drag/drop CSV or file picker.
- CSV preview (first 50 rows).
- Column auto-detection with aliases + manual mapping overrides.
- Coordinate Mode selector:
  - Auto
  - Planar (`easting`/`northing`)
  - Lat/Lon (`lat`/`lon`) projected locally north-up.
- Validation with row-level messages and highlighted invalid preview cells.
- Import with invalid rows skipped.
- Local mapping presets (save/load/delete via `localStorage`).
- True-scale SVG rendering with fixed aspect ratio.
- Hole marker + bearing arrow + label density options (vertical 0° holes omit bearing arrows):
  - Minimal: ID only
  - Standard: ID + depth
  - Full: ID + depth (angle is shown at arrow tip)
- Smart label placement (NE/NW/SE/SW/E/W/N/S) with leader-line fallback.
- Fixed north arrow, auto scale bar, optional grid, clean shot metadata legend.
- Pan/zoom, Fit to Screen, Fit to Page (orientation-aware), and north-rotation of diagram geometry only (0/90/180/270) while legend/north arrow/scale remain fixed.
- Sortable hole table and CSV table export.
- PDF export: page 1 diagram, subsequent portrait pages for table with light boxed grid styling for cleaner print readability.

## Required CSV Fields

### Required always

- `hole_id`
- `bearing_deg`
- `angle_deg`
- `depth_ft`

### Required by coordinate mode

- Planar mode: `easting`, `northing`
- Lat/Lon mode: `lat`, `lon`

### Optional fields

- `diameter_in`
- `pattern_type` (`face` / `interior` or any text)
- `notes`

## Header alias auto-detection

Examples used by auto-mapper:

- `hole_id`: `hole`, `holeid`, `id`, `hole_number`, `hole_no`, `number`
- `easting`: `e`, `east`, `x`, `e_coord`, `easting_ft`
- `northing`: `n`, `north`, `y`, `n_coord`, `northing_ft`
- `lat`: `latitude`
- `lon`: `long`, `longitude`
- `bearing_deg`: `bearing`, `azimuth`, `azi`, `direction`
- `angle_deg`: `angle`, `dip`, `inclination`
- `depth_ft`: `depth`, `hole_depth`, `total_depth`, `depth_feet`

## Included sample files

- `samples/planar_sample.csv`
- `samples/latlon_sample.csv`
- `samples/weird_header_sample.csv` (for mapper proof)

## Run locally

No build step is required.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy to GitHub Pages

Because this app is static HTML/CSS/JS, deploy by serving repository root via Pages:

1. Push repository to GitHub.
2. In **Settings → Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main` (or your publishing branch)
   - Folder: `/ (root)`
3. Save and wait for publish.

## Notes on PDF export

The app uses browser-side `jsPDF` and rasterized SVG capture for reliable, legible static exports in a pure client-side environment.
