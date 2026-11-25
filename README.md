# Earth's Changing Climate

An interactive, plain-language briefing on climate change for a general audience:
the observed temperature record, past climates, human and natural drivers,
attribution of the warming, a fair look at alternative explanations (including
natural cycles, the Sun, and the 2022 Hunga Tonga eruption), oceans and sea level,
and future projections with uncertainty ranges.

## How the data stays current

The page (`site/`) tries to load each dataset **live** in the viewer's browser and
falls back to a saved **snapshot** (`site/data/snapshot.js`) when a source can't be
reached or blocks cross-site requests. Each dataset is labelled *live* or *snapshot*.

| Data | Live source |
| --- | --- |
| Global temperature composite, forcing, attribution, sea level, ocean heat | [ClimateIndicator/data](https://github.com/ClimateIndicator/data) (Indicators of Global Climate Change, updated yearly) |
| Solar irradiance, volcanic aerosol (incl. Hunga Tonga water vapour) | [ClimateIndicator/forcing-timeseries](https://github.com/ClimateIndicator/forcing-timeseries) |
| NASA GISTEMP, HadCRUT5 (annual and monthly) | [datasets/global-temp](https://github.com/datasets/global-temp) mirror |
| Mauna Loa CO₂ (monthly) | NOAA GML directly, then the [datasets/co2-ppm](https://github.com/datasets/co2-ppm) mirror |
| Berkeley Earth | Berkeley Earth's public S3 bucket |

Projections, paleoclimate ranges and extremes come from published assessments
(IPCC AR6, UNEP Emissions Gap 2025) and are written into the page with citations.

## Layout

- `site/` – the page (`index.html`, `style.css`, `charts.js` (a small SVG chart kit), `app.js`, `data/snapshot.js`)
- `scripts/update_data.py` – downloads every source and rebuilds the snapshot (standard library only)
- `scripts/build_artifact.py` – inlines `site/` into a single file at `dist/climate-briefing.html`
- `.github/workflows/refresh-data.yml` – weekly snapshot refresh
- `.github/workflows/pages.yml` – publishes `site/` to GitHub Pages

## Run locally

```sh
python3 scripts/update_data.py      # optional: refresh the snapshot
python3 -m http.server -d site 8000 # then open http://localhost:8000
```

## Publishing with GitHub Pages

In the repository settings, under **Pages**, set the source to **GitHub Actions**.
The Pages workflow then deploys on every change to `site/` and after each weekly
data refresh.
