#!/usr/bin/env python3
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from eccodes import (
    codes_get,
    codes_get_array,
    codes_grib_new_from_file,
    codes_release,
)
from ecmwf.opendata import Client


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "assets" / "data"
BOUNDARY_FILE = ROOT / "assets" / "maps" / "india-state-boundary.geojson"

CITY_LOCATIONS = [
    {"name": "New Delhi", "latitude": 28.6139, "longitude": 77.209},
    {"name": "Mumbai", "latitude": 19.076, "longitude": 72.8777},
    {"name": "Kolkata", "latitude": 22.5726, "longitude": 88.3639},
    {"name": "Chennai", "latitude": 13.0827, "longitude": 80.2707},
    {"name": "Bengaluru", "latitude": 12.9716, "longitude": 77.5946},
    {"name": "Hyderabad", "latitude": 17.385, "longitude": 78.4867},
    {"name": "Guwahati", "latitude": 26.1445, "longitude": 91.7362},
    {"name": "Ahmedabad", "latitude": 23.0225, "longitude": 72.5714},
    {"name": "Bhubaneswar", "latitude": 20.2961, "longitude": 85.8245},
    {"name": "Dhanbad", "latitude": 23.7957, "longitude": 86.4304},
]

MODELS = [
    {
        "key": "ifs",
        "label": "IFS 0.25 deg",
        "client_model": "ifs",
    },
    {
        "key": "aifs",
        "label": "AIFS 0.25 deg",
        "client_model": "aifs-single",
    },
]
DATA_SOURCES = ["google", "aws", "ecmwf"]

PARAMS = {
    "2t": "temperature_2m",
    "tp": "precipitation",
    "10u": "wind_u_10m",
    "10v": "wind_v_10m",
    "msl": "pressure_msl",
}


def point_in_ring(longitude, latitude, ring):
    inside = False
    previous = len(ring) - 1

    for index, (current_lon, current_lat) in enumerate(ring):
        previous_lon, previous_lat = ring[previous]
        intersects = (
            (current_lat > latitude) != (previous_lat > latitude)
            and longitude
            < ((previous_lon - current_lon) * (latitude - current_lat))
            / (previous_lat - current_lat)
            + current_lon
        )

        if intersects:
            inside = not inside

        previous = index

    return inside


def point_in_india(longitude, latitude, boundary):
    return any(
        point_in_ring(longitude, latitude, ring)
        for feature in boundary["features"]
        for ring in feature["geometry"]["coordinates"]
    )


def read_grib_messages(path, boundary):
    fields = {}
    run_date = None
    min_lon, min_lat, max_lon, max_lat = boundary["bbox"]
    india_mask_cache = {}

    with path.open("rb") as handle:
        while True:
            gid = codes_grib_new_from_file(handle)
            if gid is None:
                break

            try:
                short_name = codes_get(gid, "shortName")
                units = codes_get(gid, "units")
                step = int(codes_get(gid, "endStep"))
                data_date = str(codes_get(gid, "dataDate"))
                data_time = int(codes_get(gid, "dataTime"))
                run_date = run_date or f"{data_date[:4]}-{data_date[4:6]}-{data_date[6:]}T{data_time:04d}Z"

                values = codes_get_array(gid, "values")
                latitudes = codes_get_array(gid, "latitudes")
                longitudes = codes_get_array(gid, "longitudes")
            finally:
                codes_release(gid)

            variable = PARAMS.get(short_name)
            if variable is None or step not in (24, 48):
                continue

            bbox_mask = (
                (latitudes >= min_lat)
                & (latitudes <= max_lat)
                & (longitudes >= min_lon)
                & (longitudes <= max_lon)
            )
            candidate_indices = np.flatnonzero(bbox_mask)

            for index in candidate_indices:
                latitude = round(float(latitudes[index]), 2)
                longitude = round(float(longitudes[index]), 2)
                cache_key = (latitude, longitude)

                if cache_key not in india_mask_cache:
                    india_mask_cache[cache_key] = point_in_india(longitude, latitude, boundary)

                if not india_mask_cache[cache_key]:
                    continue

                value = float(values[index])
                if not math.isfinite(value):
                    continue

                if variable == "temperature_2m" and value > 150:
                    value -= 273.15
                elif variable == "precipitation" and units == "m":
                    value *= 1000
                elif variable == "pressure_msl" and value > 2000:
                    value /= 100

                fields.setdefault(cache_key, {"latitude": latitude, "longitude": longitude})[
                    f"{variable}_{step}"
                ] = value

    return fields, run_date


def value_object(value, valid_time):
    return {"time": valid_time, "value": None if value is None else round(value, 2)}


def lead_valid_time(run_date, step):
    if not run_date:
      return None

    parsed = datetime.strptime(run_date, "%Y-%m-%dT%H%MZ").replace(tzinfo=timezone.utc)
    valid = parsed.timestamp() + step * 3600
    return datetime.fromtimestamp(valid, timezone.utc).isoformat().replace("+00:00", "Z")


def make_site_point(record, valid_times, name=None):
    wind_speed = {}
    for step in (24, 48):
        u = record.get(f"wind_u_10m_{step}")
        v = record.get(f"wind_v_10m_{step}")
        if u is not None and v is not None:
            wind_speed[step] = math.sqrt(u * u + v * v) * 3.6

    return {
        "name": name or f"{record['latitude']:.2f}, {record['longitude']:.2f}",
        "latitude": record["latitude"],
        "longitude": record["longitude"],
        "t24": value_object(record.get("temperature_2m_24"), valid_times[24]),
        "t48": value_object(record.get("temperature_2m_48"), valid_times[48]),
        "r24": value_object(record.get("precipitation_24"), valid_times[24]),
        "r48": value_object(record.get("precipitation_48"), valid_times[48]),
        "w24": value_object(wind_speed.get(24), valid_times[24]),
        "w48": value_object(wind_speed.get(48), valid_times[48]),
        "g24": value_object(None, valid_times[24]),
        "g48": value_object(None, valid_times[48]),
        "c24": value_object(None, valid_times[24]),
        "c48": value_object(None, valid_times[48]),
        "p24": value_object(record.get("pressure_msl_24"), valid_times[24]),
        "p48": value_object(record.get("pressure_msl_48"), valid_times[48]),
    }


def nearest_record(fields, city):
    return min(
        fields.values(),
        key=lambda record: (record["latitude"] - city["latitude"]) ** 2
        + (record["longitude"] - city["longitude"]) ** 2,
    )


def retrieve_model(model, target):
    last_error = None

    for source in DATA_SOURCES:
        try:
            client = Client(
                source=source,
                model=model["client_model"],
                resol="0p25",
                preserve_request_order=True,
                infer_stream_keyword=True,
                maximum_retries=3,
                retry_after=20,
            )

            client.retrieve(
                type="fc",
                step=[24, 48],
                param=list(PARAMS),
                target=str(target),
            )
            print(f"Downloaded {model['label']} from ECMWF Open Data mirror: {source}")
            return source
        except Exception as error:
            last_error = error
            print(f"{model['label']} source {source} failed: {error}")

    raise RuntimeError(f"{model['label']} download failed from all ECMWF Open Data mirrors") from last_error


def update_model(model, boundary):
    with tempfile.TemporaryDirectory() as temp_dir:
        grib_file = Path(temp_dir) / f"{model['key']}.grib2"
        source = retrieve_model(model, grib_file)
        fields, run_date = read_grib_messages(grib_file, boundary)

    if not fields:
        raise RuntimeError(f"{model['label']} did not produce India forecast points")

    valid_times = {step: lead_valid_time(run_date, step) for step in (24, 48)}
    map_points = [
        make_site_point(record, valid_times)
        for record in sorted(fields.values(), key=lambda item: (item["latitude"], item["longitude"]))
    ]
    city_points = [
        make_site_point(nearest_record(fields, city), valid_times, city["name"])
        for city in CITY_LOCATIONS
    ]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "model": model["label"],
        "source": f"ECMWF Open Data ({source})",
        "run_time_utc": run_date,
        "grid_step_degrees": 0.25,
        "map_points": map_points,
        "city_points": city_points,
    }

    output_file = OUTPUT_DIR / f"forecast-{model['key']}.json"
    output_file.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {output_file.relative_to(ROOT)} with {len(map_points)} India grid points")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    boundary = json.loads(BOUNDARY_FILE.read_text(encoding="utf-8"))

    for model in MODELS:
        update_model(model, boundary)


if __name__ == "__main__":
    main()
