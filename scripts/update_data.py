#!/usr/bin/env python3
"""Build site/data/snapshot.js: the cached copy of every dataset the page uses.

The page tries the live sources in the browser first and falls back to this
snapshot when a source is unreachable or blocks cross-origin requests. Run this
script (or let the scheduled GitHub Action run it) to refresh the snapshot.

Only the Python standard library is used.
"""
import csv, io, json, datetime, urllib.request, sys, pathlib

RAW = "https://raw.githubusercontent.com"
CI = f"{RAW}/ClimateIndicator/data/main/data/base"
FTS = f"{RAW}/ClimateIndicator/forcing-timeseries/main/output"
SRC = {
    "igcc_gmst": f"{CI}/global_mean_temperatures/annual_averages.csv",
    "global_temp_annual": f"{RAW}/datasets/global-temp/main/data/annual.csv",
    "global_temp_monthly": f"{RAW}/datasets/global-temp/main/data/monthly.csv",
    "berkeley": "https://berkeley-earth-temperature.s3.us-west-1.amazonaws.com/Global/Land_and_Ocean_summary.txt",
    "co2_monthly": f"{RAW}/datasets/co2-ppm/main/data/co2-mm-mlo.csv",
    "ghg_conc": f"{CI}/greenhouse_gas_concentrations/ghg_concentrations.csv",
    "erf": f"{CI}/effective_radiative_forcing/ERF_best_aggregates.csv",
    "erf_p05": f"{CI}/effective_radiative_forcing/ERF_p05_aggregates.csv",
    "erf_p95": f"{CI}/effective_radiative_forcing/ERF_p95_aggregates.csv",
    "attr_walsh": f"{CI}/anthropogenic_warming/Walsh_GMST_timeseries.csv",
    "attr_gillett": f"{CI}/anthropogenic_warming/Gillett_GMST_timeseries.csv",
    "attr_ribes": f"{CI}/anthropogenic_warming/Ribes_GMST_timeseries.csv",
    "attr_headline": f"{CI}/anthropogenic_warming/Assessment-Update-2025_GMST_headlines.csv",
    "species": f"{CI}/anthropogenic_warming_by_species/temperature_relative_to_1750.csv",
    "sea_level": f"{CI}/sea_level_rise/IGCC_GMSL_ensemble.csv",
    "energy": f"{CI}/earth_energy_imbalance/earth_energy_imbalance.csv",
    "emissions": f"{CI}/greenhouse_gas_emissions/greehouse_gas_emissions_co2eq.csv",
    "solar": f"{FTS}/solar_tsi_erf.csv",
    "volcanic": f"{FTS}/volcanic_sAOD_ERF_annual.csv",
}

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "climate-presentation-data-refresh"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8-sig")

def rows(text):
    return list(csv.DictReader(io.StringIO(text)))

def num(x):
    try:
        v = float(x)
        return None if v != v else v
    except (TypeError, ValueError):
        return None

def r(v, n=3):
    return None if v is None else round(v, n)

def main(out):
    t = {k: get(u) for k, u in SRC.items()}
    snap = {"built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"), "sources": SRC}

    # Temperatures (annual)
    snap["igcc_gmst"] = [[int(num(x["time"])), r(num(x["GMST"]))] for x in rows(t["igcc_gmst"]) if num(x["GMST"]) is not None]
    gt = rows(t["global_temp_annual"])
    snap["gistemp"] = [[int(x["Year"]), r(num(x["Mean"]))] for x in gt if x["Source"] == "GISTEMP"]
    snap["hadcrut"] = [[int(x["Year"]), r(num(x["Mean"]))] for x in gt if x["Source"] == "GCAG"]
    snap["gistemp"].sort(); snap["hadcrut"].sort()
    gm = rows(t["global_temp_monthly"])
    snap["hadcrut_monthly"] = sorted([[x["Year"], r(num(x["Mean"]))] for x in gm if x["Source"] == "GCAG" and x["Year"] >= "1991"])
    snap["gistemp_monthly"] = sorted([[x["Year"], r(num(x["Mean"]))] for x in gm if x["Source"] == "GISTEMP" and x["Year"] >= "1991"])
    be = []
    for line in t["berkeley"].splitlines():
        p = line.split()
        if p and not line.startswith("%") and p[0].isdigit() and num(p[1]) is not None:
            be.append([int(p[0]), r(num(p[1])), r(num(p[2]))])
    snap["berkeley"] = be

    # CO2 at Mauna Loa (monthly)
    snap["co2_monthly"] = [[x["Date"], r(num(x["Average"]) if num(x["Average"]) and num(x["Average"]) > 0 else num(x["Interpolated"]), 2)] for x in rows(t["co2_monthly"])]
    snap["ghg_conc"] = [[int(num(x["time"])), r(num(x["CO2"]), 1), r(num(x["CH4"]), 0), r(num(x["N2O"]), 1)] for x in rows(t["ghg_conc"]) if num(x["time"])]

    # Forcing
    cols = ["CO2", "CH4", "N2O", "halogen", "O3", "aerosol", "land_use", "contrails", "BC_on_snow", "H2O_stratospheric", "solar", "volcanic", "anthro", "natural", "total"]
    def erf(text):
        return {c: [r(num(x[c])) for x in rows(text)] for c in cols} | {"year": [int(num(x["time"])) for x in rows(text)]}
    snap["erf"] = erf(t["erf"])
    lo, hi = erf(t["erf_p05"]), erf(t["erf_p95"])
    snap["erf_range"] = {c: [lo[c][-1], hi[c][-1]] for c in cols}

    # Attribution
    def attr(text):
        out = {"year": []}
        keys = ["anthropogenic", "ghg", "other_human_forcing", "natural"]
        for k in keys:
            out[k] = []
        for x in rows(text):
            out["year"].append(int(num(x["time"])))
            for k in keys:
                out[k].append([r(num(x[f"{k}_p05"])), r(num(x[f"{k}_p50"])), r(num(x[f"{k}_p95"]))])
        return out
    snap["attr"] = {"walsh": attr(t["attr_walsh"]), "gillett": attr(t["attr_gillett"]), "ribes": attr(t["attr_ribes"])}
    snap["attr_headline"] = rows(t["attr_headline"])
    snap["species"] = [{"name": x["Compound emitted"], "p05": num(x["Total_p5"]), "p50": num(x["Total_p50"]), "p95": num(x["Total_p95"])} for x in rows(t["species"])]

    # Oceans
    snap["sea_level"] = [[int(num(x["time"])), r(num(x["mean"]), 1), r(num(x["std"]), 1)] for x in rows(t["sea_level"]) if num(x["time"])]
    snap["ocean_heat"] = [[int(num(x["time"])), r(num(x["ocean_full-depth"]), 1), r(num(x["ocean_full-depth_error"]), 1)] for x in rows(t["energy"]) if num(x["time"]) and num(x["ocean_full-depth"]) is not None]
    snap["emissions"] = [[int(num(x["year"])), r(num(x["CO2-FFI"]), 2), r(num(x["CO2-LULUCF"]), 2), r(num(x["CH4"]), 2), r(num(x["N2O"]), 2), r(num(x["F-gases"]), 2)] for x in rows(t["emissions"]) if num(x["year"])]

    # Natural drivers
    snap["tsi"] = [[int(num(x["Year"])), r(num(x["igcc"]), 3)] for x in rows(t["solar"]) if num(x["Year"]) and num(x["Year"]) >= 1850 and num(x["igcc"])]
    snap["volcanic"] = [[int(num(x["year"])), r(num(x["stratospheric_AOD"]), 4), r(num(x["ERF_sulfate"])), r(num(x["ERF_H2O"]))] for x in rows(t["volcanic"]) if num(x["year"]) and num(x["year"]) >= 1850]

    js = "// Generated by scripts/update_data.py. Do not edit by hand.\nwindow.CLIMATE_SNAPSHOT = " + json.dumps(snap, separators=(",", ":")) + ";\n"
    pathlib.Path(out).write_text(js)
    print(f"wrote {out} ({len(js)//1024} KB), built {snap['built']}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(pathlib.Path(__file__).resolve().parent.parent / "site/data/snapshot.js"))
