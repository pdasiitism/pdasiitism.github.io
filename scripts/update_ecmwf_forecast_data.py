#!/usr/bin/env python3
import binascii
import json
import math
import shutil
import struct
import tempfile
import zlib
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
FRAME_DIR = ROOT / "assets" / "forecast"
BOUNDARY_FILE = ROOT / "assets" / "maps" / "india-state-boundary.geojson"

FORECAST_STEPS = list(range(0, 121, 6))
RAIN_STEPS = [step for step in FORECAST_STEPS if step > 0]
CITY_STEPS = (24, 48)
FRAME_WIDTH = 720
FRAME_HEIGHT = 820

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
    {"key": "ifs", "label": "IFS 0.25 deg", "client_model": "ifs"},
    {"key": "aifs", "label": "AIFS 0.25 deg", "client_model": "aifs-single"},
]
DATA_SOURCES = ["google", "aws", "ecmwf"]

PARAMS = {
    "2t": "temperature_2m",
    "tp": "precipitation",
    "10u": "wind_u_10m",
    "10v": "wind_v_10m",
    "msl": "pressure_msl",
}

ANIMATION_VARIABLES = {
    "temperature": {
        "field": "temperature_2m",
        "steps": FORECAST_STEPS,
        "unit": "°C",
        "legend": ["-10", "0", "16", "32", "44"],
        "stops": [
            (-12, (76, 57, 156)),
            (0, (126, 87, 194)),
            (8, (63, 81, 181)),
            (16, (33, 150, 243)),
            (24, (38, 166, 154)),
            (32, (253, 216, 53)),
            (38, (251, 140, 0)),
            (44, (229, 57, 53)),
            (48, (142, 0, 0)),
        ],
    },
    "rainfall": {
        "field": "precipitation",
        "steps": RAIN_STEPS,
        "unit": "mm / 6 h",
        "legend": ["0", "5", "15", "30", "60+"],
        "stops": [
            (0, (247, 251, 255)),
            (1, (199, 233, 180)),
            (5, (65, 182, 196)),
            (15, (44, 127, 184)),
            (30, (253, 174, 97)),
            (60, (215, 25, 28)),
            (120, (106, 27, 154)),
        ],
    },
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


def convert_value(variable, units, value):
    value = float(value)
    if not math.isfinite(value):
        return None

    if variable == "temperature_2m" and value > 150:
        value -= 273.15
    elif variable == "precipitation" and units == "m":
        value *= 1000
    elif variable == "pressure_msl" and value > 2000:
        value /= 100

    return value


def field_to_grid(latitudes, longitudes, values, variable, units, boundary):
    min_lon, min_lat, max_lon, max_lat = boundary["bbox"]
    bbox_mask = (
        (latitudes >= min_lat)
        & (latitudes <= max_lat)
        & (longitudes >= min_lon)
        & (longitudes <= max_lon)
    )
    indices = np.flatnonzero(bbox_mask)
    rounded_lats = np.round(latitudes[indices].astype(float), 2)
    rounded_lons = np.round(longitudes[indices].astype(float), 2)
    unique_lats = np.array(sorted(set(rounded_lats.tolist())), dtype=float)
    unique_lons = np.array(sorted(set(rounded_lons.tolist())), dtype=float)
    lat_index = {lat: index for index, lat in enumerate(unique_lats)}
    lon_index = {lon: index for index, lon in enumerate(unique_lons)}
    grid = np.full((len(unique_lats), len(unique_lons)), np.nan, dtype=float)

    for source_index, latitude, longitude in zip(indices, rounded_lats, rounded_lons):
        value = convert_value(variable, units, values[source_index])
        if value is None:
            continue
        grid[lat_index[float(latitude)], lon_index[float(longitude)]] = value

    return {"latitudes": unique_lats, "longitudes": unique_lons, "values": grid}


def read_grib_messages(path, boundary):
    india_fields = {}
    gridded_fields = {}
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
            if variable is None or step not in FORECAST_STEPS:
                continue

            gridded_fields[(variable, step)] = field_to_grid(
                latitudes,
                longitudes,
                values,
                variable,
                units,
                boundary,
            )

            if step not in CITY_STEPS:
                continue

            bbox_mask = (
                (latitudes >= min_lat)
                & (latitudes <= max_lat)
                & (longitudes >= min_lon)
                & (longitudes <= max_lon)
            )

            for index in np.flatnonzero(bbox_mask):
                latitude = round(float(latitudes[index]), 2)
                longitude = round(float(longitudes[index]), 2)
                cache_key = (latitude, longitude)

                if cache_key not in india_mask_cache:
                    india_mask_cache[cache_key] = point_in_india(longitude, latitude, boundary)

                if not india_mask_cache[cache_key]:
                    continue

                value = convert_value(variable, units, values[index])
                if value is None:
                    continue

                india_fields.setdefault(cache_key, {"latitude": latitude, "longitude": longitude})[
                    f"{variable}_{step}"
                ] = value

    return india_fields, gridded_fields, run_date


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
    for step in CITY_STEPS:
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
            client.retrieve(type="fc", step=FORECAST_STEPS, param=list(PARAMS), target=str(target))
            print(f"Downloaded {model['label']} from ECMWF Open Data mirror: {source}")
            return source
        except Exception as error:
            last_error = error
            print(f"{model['label']} source {source} failed: {error}")

    raise RuntimeError(f"{model['label']} download failed from all ECMWF Open Data mirrors") from last_error


def interpolate_grid(field, boundary):
    min_lon, min_lat, max_lon, max_lat = boundary["bbox"]
    lats = field["latitudes"]
    lons = field["longitudes"]
    values = field["values"]
    target_lons = np.linspace(min_lon, max_lon, FRAME_WIDTH)
    target_lats = np.linspace(max_lat, min_lat, FRAME_HEIGHT)
    lon_mesh, lat_mesh = np.meshgrid(target_lons, target_lats)
    lon_indices = np.clip(np.searchsorted(lons, lon_mesh, side="right") - 1, 0, len(lons) - 2)
    lat_indices = np.clip(np.searchsorted(lats, lat_mesh, side="right") - 1, 0, len(lats) - 2)
    lon0 = lons[lon_indices]
    lon1 = lons[lon_indices + 1]
    lat0 = lats[lat_indices]
    lat1 = lats[lat_indices + 1]
    lon_weight = np.divide(lon_mesh - lon0, lon1 - lon0, out=np.zeros_like(lon_mesh), where=lon1 != lon0)
    lat_weight = np.divide(lat_mesh - lat0, lat1 - lat0, out=np.zeros_like(lat_mesh), where=lat1 != lat0)
    v00 = values[lat_indices, lon_indices]
    v01 = values[lat_indices, lon_indices + 1]
    v10 = values[lat_indices + 1, lon_indices]
    v11 = values[lat_indices + 1, lon_indices + 1]

    return (
        v00 * (1 - lat_weight) * (1 - lon_weight)
        + v10 * lat_weight * (1 - lon_weight)
        + v01 * (1 - lat_weight) * lon_weight
        + v11 * lat_weight * lon_weight
    )


def colors_for_values(values, stops):
    stop_values = np.array([stop[0] for stop in stops], dtype=float)
    channels = []
    for channel in range(3):
        stop_colors = np.array([stop[1][channel] for stop in stops], dtype=float)
        channels.append(np.interp(values, stop_values, stop_colors))

    return np.stack(channels, axis=-1).clip(0, 255).astype(np.uint8)


def png_chunk(chunk_type, data):
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", binascii.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def write_png_rgb(path, rgb):
    height, width, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[row].tobytes() for row in range(height))
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(raw, level=9))
        + png_chunk(b"IEND", b"")
    )
    path.write_bytes(payload)


def rainfall_interval(gridded_fields, step):
    current = gridded_fields.get(("precipitation", step))
    previous = gridded_fields.get(("precipitation", step - 6))
    if current is None:
        return None
    if previous is None:
        return current

    return {
        "latitudes": current["latitudes"],
        "longitudes": current["longitudes"],
        "values": np.maximum(current["values"] - previous["values"], 0),
    }


def make_frame(model, variable_key, step, gridded_fields, boundary, valid_time):
    config = ANIMATION_VARIABLES[variable_key]
    field = (
        rainfall_interval(gridded_fields, step)
        if variable_key == "rainfall"
        else gridded_fields.get((config["field"], step))
    )
    if field is None:
        return None

    interpolated = interpolate_grid(field, boundary)
    if variable_key == "rainfall":
        interpolated = np.maximum(interpolated, 0)

    rgb = colors_for_values(interpolated, config["stops"])
    image_path = FRAME_DIR / f"{model['key']}-{variable_key}-f{step:03d}.png"
    write_png_rgb(image_path, rgb)
    finite_values = interpolated[np.isfinite(interpolated)]

    return {
        "step": step,
        "valid_time": valid_time,
        "image": str(image_path.relative_to(ROOT)),
        "range": {
            "min": round(float(np.min(finite_values)), 2),
            "max": round(float(np.max(finite_values)), 2),
        },
    }


def write_animation_manifest(model, source, run_date, gridded_fields, boundary):
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "model": model["label"],
        "source": f"ECMWF Open Data ({source})",
        "run_time_utc": run_date,
        "grid_step_degrees": 0.25,
        "display_interpolation": "bilinear",
        "rainfall_frame": "6-hour accumulation ending at the valid time",
        "variables": {},
    }

    for variable_key, config in ANIMATION_VARIABLES.items():
        frames = []
        for step in config["steps"]:
            frame = make_frame(
                model,
                variable_key,
                step,
                gridded_fields,
                boundary,
                lead_valid_time(run_date, step),
            )
            if frame is not None:
                frames.append(frame)

        manifest["variables"][variable_key] = {
            "unit": config["unit"],
            "legend": config["legend"],
            "frames": frames,
        }

    manifest_file = OUTPUT_DIR / f"forecast-{model['key']}-animation.json"
    manifest_file.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {manifest_file.relative_to(ROOT)}")


def update_model(model, boundary):
    with tempfile.TemporaryDirectory() as temp_dir:
        grib_file = Path(temp_dir) / f"{model['key']}.grib2"
        source = retrieve_model(model, grib_file)
        fields, gridded_fields, run_date = read_grib_messages(grib_file, boundary)

    if not fields:
        raise RuntimeError(f"{model['label']} did not produce India forecast points")

    valid_times = {step: lead_valid_time(run_date, step) for step in CITY_STEPS}
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
    write_animation_manifest(model, source, run_date, gridded_fields, boundary)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if FRAME_DIR.exists():
        shutil.rmtree(FRAME_DIR)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    boundary = json.loads(BOUNDARY_FILE.read_text(encoding="utf-8"))

    for model in MODELS:
        update_model(model, boundary)


if __name__ == "__main__":
    main()
