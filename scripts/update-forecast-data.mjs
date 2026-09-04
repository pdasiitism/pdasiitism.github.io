import { mkdir, readFile, writeFile } from "node:fs/promises";

const samplePoints = [
  { name: "Srinagar", latitude: 34.0837, longitude: 74.7973 },
  { name: "Leh", latitude: 34.1526, longitude: 77.5771 },
  { name: "Amritsar", latitude: 31.634, longitude: 74.8723 },
  { name: "New Delhi", latitude: 28.6139, longitude: 77.209 },
  { name: "Jaipur", latitude: 26.9124, longitude: 75.7873 },
  { name: "Lucknow", latitude: 26.8467, longitude: 80.9462 },
  { name: "Patna", latitude: 25.5941, longitude: 85.1376 },
  { name: "Guwahati", latitude: 26.1445, longitude: 91.7362 },
  { name: "Shillong", latitude: 25.5788, longitude: 91.8933 },
  { name: "Ahmedabad", latitude: 23.0225, longitude: 72.5714 },
  { name: "Bhopal", latitude: 23.2599, longitude: 77.4126 },
  { name: "Dhanbad", latitude: 23.7957, longitude: 86.4304 },
  { name: "Kolkata", latitude: 22.5726, longitude: 88.3639 },
  { name: "Bhubaneswar", latitude: 20.2961, longitude: 85.8245 },
  { name: "Mumbai", latitude: 19.076, longitude: 72.8777 },
  { name: "Nagpur", latitude: 21.1458, longitude: 79.0882 },
  { name: "Raipur", latitude: 21.2514, longitude: 81.6296 },
  { name: "Visakhapatnam", latitude: 17.6868, longitude: 83.2185 },
  { name: "Hyderabad", latitude: 17.385, longitude: 78.4867 },
  { name: "Panaji", latitude: 15.4909, longitude: 73.8278 },
  { name: "Bengaluru", latitude: 12.9716, longitude: 77.5946 },
  { name: "Chennai", latitude: 13.0827, longitude: 80.2707 },
  { name: "Kochi", latitude: 9.9312, longitude: 76.2673 },
  { name: "Thiruvananthapuram", latitude: 8.5241, longitude: 76.9366 },
  { name: "Port Blair", latitude: 11.6234, longitude: 92.7265 },
];

const cityLocations = [
  "New Delhi",
  "Mumbai",
  "Kolkata",
  "Chennai",
  "Bengaluru",
  "Hyderabad",
  "Guwahati",
  "Ahmedabad",
  "Bhubaneswar",
  "Dhanbad",
].map((name) => samplePoints.find((point) => point.name === name));

const models = [
  {
    key: "ifs",
    label: "IFS 0.25 deg",
    endpoint: "https://api.open-meteo.com/v1/forecast",
    model: "ecmwf_ifs025",
    gridStepDegrees: 0.25,
  },
  {
    key: "aifs",
    label: "AIFS 0.25 deg",
    endpoint: "https://api.open-meteo.com/v1/forecast",
    model: "ecmwf_aifs025_single",
    gridStepDegrees: 0.25,
  },
];

const mapVariables = ["temperature_2m", "precipitation"];
const cityVariables = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "pressure_msl",
];
const cityRequestBatchSize = 100;
const requestRetryDelayMs = 15000;
const requestMaxAttempts = 5;
const requestBatchDelayMs = 5000;
const mapTileLatitudeDegrees = 5;
const mapTileLongitudeDegrees = 10;
const outputDir = new URL("../assets/data/", import.meta.url);
const boundaryFile = new URL("../assets/maps/india-state-boundary.geojson", import.meta.url);

function pointInRing(longitude, latitude, ring) {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLon, currentLat] = ring[index];
    const [previousLon, previousLat] = ring[previous];
    const intersects =
      currentLat > latitude !== previousLat > latitude &&
      longitude <
        ((previousLon - currentLon) * (latitude - currentLat)) /
          (previousLat - currentLat) +
          currentLon;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInIndia(longitude, latitude, boundary) {
  return boundary.features.some((feature) =>
    feature.geometry.coordinates.some((ring) =>
      pointInRing(longitude, latitude, ring),
    ),
  );
}

function buildUrl(model, points, variables) {
  const params = new URLSearchParams({
    latitude: points.map((point) => point.latitude).join(","),
    longitude: points.map((point) => point.longitude).join(","),
    hourly: variables.join(","),
    models: model.model,
    timezone: "Asia/Kolkata",
    forecast_hours: "49",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });

  return `${model.endpoint}?${params.toString()}`;
}

function buildBoundingBoxUrl(model, boundingBox, variables) {
  const params = new URLSearchParams({
    bounding_box: boundingBox.join(","),
    hourly: variables.join(","),
    models: model.model,
    timezone: "Asia/Kolkata",
    forecast_hours: "49",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });

  return `${model.endpoint}?${params.toString()}`;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelayMs(response, attempt) {
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
  return Number.isFinite(retryAfter)
    ? retryAfter * 1000
    : requestRetryDelayMs * attempt;
}

function isRetryablePayload(payload) {
  return (
    payload?.error === true &&
    /limit|try again|temporarily|timeout|too many/i.test(payload.reason || "")
  );
}

function nearestIndex(times, targetDate) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  times.forEach((time, index) => {
    const distance = Math.abs(new Date(time).getTime() - targetDate.getTime());
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

function extractValue(data, variable, hoursAhead) {
  if (!data?.hourly?.time || !data.hourly[variable]) {
    return {
      time: null,
      value: null,
    };
  }

  const target = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const index = nearestIndex(data.hourly.time, target);
  return {
    time: data.hourly.time[index],
    value: data.hourly[variable][index],
  };
}

async function fetchBatch(model, points, variables) {
  const url = buildUrl(model, points, variables);
  let response;
  let payload;

  for (let attempt = 1; attempt <= requestMaxAttempts; attempt += 1) {
    response = await fetch(url);

    if (response.ok) {
      payload = await response.json();
      if (!isRetryablePayload(payload) || attempt === requestMaxAttempts) {
        break;
      }

      const delayMs = requestRetryDelayMs * attempt;
      console.log(
        `${model.label} batch request returned ${payload.reason}; retrying in ${Math.round(delayMs / 1000)}s`,
      );
      await wait(delayMs);
      continue;
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt === requestMaxAttempts) {
      break;
    }

    const delayMs = retryDelayMs(response, attempt);
    console.log(
      `${model.label} batch request returned HTTP ${response.status}; retrying in ${Math.round(delayMs / 1000)}s`,
    );
    await wait(delayMs);
  }

  if (!response.ok) {
    throw new Error(`${model.label} request failed with HTTP ${response.status}`);
  }

  if (payload.error) {
    throw new Error(`${model.label} request failed: ${payload.reason}`);
  }

  const locations = Array.isArray(payload) ? payload : [payload];

  return points.map((point, index) => {
    const data = locations[index];
    return {
      ...point,
      t24: extractValue(data, "temperature_2m", 24),
      t48: extractValue(data, "temperature_2m", 48),
      r24: extractValue(data, "precipitation", 24),
      r48: extractValue(data, "precipitation", 48),
      w24: extractValue(data, "wind_speed_10m", 24),
      w48: extractValue(data, "wind_speed_10m", 48),
      g24: extractValue(data, "wind_gusts_10m", 24),
      g48: extractValue(data, "wind_gusts_10m", 48),
      c24: extractValue(data, "cloud_cover", 24),
      c48: extractValue(data, "cloud_cover", 48),
      p24: extractValue(data, "pressure_msl", 24),
      p48: extractValue(data, "pressure_msl", 48),
    };
  });
}

async function fetchBoundingBox(model, boundingBox, variables) {
  const url = buildBoundingBoxUrl(model, boundingBox, variables);
  let response;
  let payload;

  for (let attempt = 1; attempt <= requestMaxAttempts; attempt += 1) {
    response = await fetch(url);

    if (response.ok) {
      payload = await response.json();
      if (!isRetryablePayload(payload) || attempt === requestMaxAttempts) {
        break;
      }

      const delayMs = requestRetryDelayMs * attempt;
      console.log(
        `${model.label} map tile returned ${payload.reason}; retrying in ${Math.round(delayMs / 1000)}s`,
      );
      await wait(delayMs);
      continue;
    }

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (!shouldRetry || attempt === requestMaxAttempts) {
      break;
    }

    const delayMs = retryDelayMs(response, attempt);
    console.log(
      `${model.label} map tile returned HTTP ${response.status}; retrying in ${Math.round(delayMs / 1000)}s`,
    );
    await wait(delayMs);
  }

  if (!response.ok) {
    throw new Error(`${model.label} map tile failed with HTTP ${response.status}`);
  }

  if (payload.error) {
    throw new Error(`${model.label} map tile failed: ${payload.reason}`);
  }

  const locations = Array.isArray(payload) ? payload : [payload];

  return locations.map((data) => ({
    name: `${Number(data.latitude).toFixed(2)}, ${Number(data.longitude).toFixed(2)}`,
    latitude: data.latitude,
    longitude: data.longitude,
    t24: extractValue(data, "temperature_2m", 24),
    t48: extractValue(data, "temperature_2m", 48),
    r24: extractValue(data, "precipitation", 24),
    r48: extractValue(data, "precipitation", 48),
  }));
}

async function fetchBatches(model, points, variables, batchSize) {
  const output = [];

  for (let index = 0; index < points.length; index += batchSize) {
    const batch = points.slice(index, index + batchSize);
    output.push(...(await fetchBatch(model, batch, variables)));
    if (index + batchSize < points.length) {
      await wait(requestBatchDelayMs);
    }
  }

  return output;
}

async function fetchMapPoints(model, boundary) {
  const [minLon, minLat, maxLon, maxLat] = boundary.bbox;
  const output = [];
  const seen = new Set();
  const startLatitude = Math.floor(minLat);
  const endLatitude = Math.ceil(maxLat);
  const startLongitude = Math.floor(minLon);
  const endLongitude = Math.ceil(maxLon);

  for (let latitude = startLatitude; latitude < endLatitude; latitude += mapTileLatitudeDegrees) {
    for (let longitude = startLongitude; longitude < endLongitude; longitude += mapTileLongitudeDegrees) {
      const boundingBox = [
        latitude,
        longitude,
        Math.min(latitude + mapTileLatitudeDegrees, endLatitude),
        Math.min(longitude + mapTileLongitudeDegrees, endLongitude),
      ];
      const points = await fetchBoundingBox(model, boundingBox, mapVariables);

      points.forEach((point) => {
        if (!pointInIndia(point.longitude, point.latitude, boundary)) {
          return;
        }

        const key = `${point.latitude},${point.longitude}`;
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        output.push(point);
      });

      await wait(requestBatchDelayMs);
    }
  }

  console.log(`${model.label} map grid has ${output.length} India land points`);
  return output;
}

async function updateModel(model) {
  const mapPoints = await fetchMapPoints(model, boundary);
  const cityPoints = await fetchBatches(model, cityLocations, cityVariables, cityRequestBatchSize);
  const payload = {
    generated_at: new Date().toISOString(),
    model: model.label,
    grid_step_degrees: model.gridStepDegrees,
    map_points: mapPoints,
    city_points: cityPoints,
  };

  await writeFile(
    new URL(`forecast-${model.key}.json`, outputDir),
    `${JSON.stringify(payload)}\n`,
  );
  console.log(`Wrote forecast-${model.key}.json with ${mapPoints.length} grid points`);
}

const boundary = JSON.parse(await readFile(boundaryFile, "utf8"));
await mkdir(outputDir, { recursive: true });

for (const model of models) {
  try {
    await updateModel(model);
  } catch (error) {
    console.log(`${model.label} update skipped: ${error.message}`);
  }
}
