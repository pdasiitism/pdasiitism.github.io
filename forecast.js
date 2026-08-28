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

const cityVariables = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "pressure_msl",
];

const models = {
  gfs: {
    key: "gfs",
    label: "GFS",
    name: "NOAA GFS",
    endpoint: "https://api.open-meteo.com/v1/gfs",
  },
  ifs: {
    key: "ifs",
    label: "IFS",
    name: "ECMWF IFS",
    endpoint: "https://api.open-meteo.com/v1/ecmwf",
  },
};

const modelSelect = document.querySelector("#model-select");
const citySelect = document.querySelector("#city-select");
const forecastForm = document.querySelector("#forecast-form");
const statusEl = document.querySelector("#forecast-status");
const mapGrid = document.querySelector("#forecast-map-grid");
const cityDetailGrid = document.querySelector("#city-detail-grid");
const profileModal = document.querySelector("#profile-modal");
const profileOpenButtons = [...document.querySelectorAll("[data-open-profiles]")];
const profileCloseButtons = [...document.querySelectorAll("[data-close-profiles]")];
let indiaBoundary = null;
let currentMapPoints = [];

function populateCities() {
  citySelect.innerHTML = cityLocations
    .map((city, index) => `<option value="${index}">${city.name}</option>`)
    .join("");
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function projectPoint(coordinate) {
  const [longitude, latitude] = coordinate;
  const [minLon, minLat, maxLon, maxLat] = indiaBoundary.bbox;
  const x = ((longitude - minLon) / (maxLon - minLon)) * 1000;
  const y = ((maxLat - latitude) / (maxLat - minLat)) * 1030;

  return [clamp(x, 0, 1000), clamp(y, 0, 1030)];
}

function ringPath(ring) {
  return ring
    .map((coordinate, index) => {
      const [x, y] = projectPoint(coordinate);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ")
    .concat(" Z");
}

function boundaryPaths() {
  return indiaBoundary.features
    .map((feature) =>
      feature.geometry.coordinates
        .map((ring) => `<path d="${ringPath(ring)}"></path>`)
        .join(""),
    )
    .join("");
}

function markerPosition(point) {
  const [x, y] = projectPoint([point.longitude, point.latitude]);
  return { x, y };
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

function temperatureColor(value) {
  if (value < 0) return "#7e57c2";
  if (value < 8) return "#3f51b5";
  if (value < 16) return "#2196f3";
  if (value < 24) return "#26a69a";
  if (value < 32) return "#fdd835";
  if (value < 38) return "#fb8c00";
  if (value < 44) return "#e53935";
  return "#8e0000";
}

function rainfallColor(value) {
  if (value <= 0) return "#f7fbff";
  if (value < 1) return "#c7e9b4";
  if (value < 5) return "#41b6c4";
  if (value < 15) return "#2c7fb8";
  if (value < 30) return "#fdae61";
  if (value < 60) return "#d7191c";
  return "#6a1b9a";
}

function markerSize(type, value) {
  if (type === "temperature") {
    return 15;
  }

  return clamp(10 + Math.sqrt(Math.max(value, 0)) * 5, 10, 30);
}

function inverseDistanceValue(points, keyName, x, y) {
  let weighted = 0;
  let weights = 0;

  points.forEach((point) => {
    const position = markerPosition(point);
    const distance = Math.hypot(position.x - x, position.y - y);
    const value = Number(point[keyName].value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (distance < 0.1) {
      weighted = value;
      weights = 1;
      return;
    }
    const weight = 1 / distance ** 2;
    weighted += value * weight;
    weights += weight;
  });

  return weights ? weighted / weights : 0;
}

function gridCells(type, keyName, points) {
  const cellSize = 24;
  const cells = [];

  for (let y = 0; y < 1030; y += cellSize) {
    for (let x = 0; x < 1000; x += cellSize) {
      const value = inverseDistanceValue(
        points,
        keyName,
        x + cellSize / 2,
        y + cellSize / 2,
      );
      const color =
        type === "temperature" ? temperatureColor(value) : rainfallColor(value);
      const opacity = type === "temperature" ? 0.82 : value <= 0 ? 0.42 : 0.82;
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellSize + 1}" height="${cellSize + 1}" fill="${color}" opacity="${opacity}"></rect>`,
      );
    }
  }

  return cells.join("");
}

function buildUrl(model, points, variables) {
  const params = new URLSearchParams({
    latitude: points.map((point) => point.latitude).join(","),
    longitude: points.map((point) => point.longitude).join(","),
    hourly: variables.join(","),
    timezone: "Asia/Kolkata",
    forecast_hours: "49",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });

  return `${model.endpoint}?${params.toString()}`;
}

function extractValue(data, variable, hoursAhead) {
  const target = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const index = nearestIndex(data.hourly.time, target);
  return {
    time: data.hourly.time[index],
    value: data.hourly[variable][index],
  };
}

async function fetchPointForecasts(model, points, variables) {
  const response = await fetch(buildUrl(model, points, variables));

  if (!response.ok) {
    throw new Error(`${model.label} forecast unavailable`);
  }

  const payload = await response.json();
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

async function fetchBoundary() {
  if (indiaBoundary) {
    return indiaBoundary;
  }

  const response = await fetch("assets/maps/india-state-boundary.geojson?v=1");
  if (!response.ok) {
    throw new Error("India map boundary unavailable");
  }

  indiaBoundary = await response.json();
  return indiaBoundary;
}

function valueRange(points, key) {
  const values = points
    .map((point) => point[key].value)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function formatLeadTime(points, key) {
  const time = points.find((point) => point[key].time)?.[key].time;
  if (!time) {
    return "";
  }

  return new Date(time).toLocaleString("en-IN", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function renderLegend(type) {
  if (type === "temperature") {
    return `
      <div class="forecast-legend">
        <span><i style="background:#3f51b5"></i>Cold</span>
        <span><i style="background:#26a69a"></i>Mild</span>
        <span><i style="background:#fdd835"></i>Warm</span>
        <span><i style="background:#e53935"></i>Hot</span>
      </div>
    `;
  }

  return `
    <div class="forecast-legend">
      <span><i style="background:#f7fbff"></i>Dry</span>
      <span><i style="background:#41b6c4"></i>Light</span>
      <span><i style="background:#2c7fb8"></i>Moderate</span>
      <span><i style="background:#d7191c"></i>Heavy</span>
    </div>
  `;
}

function renderMapCard({ title, type, keyName, unit, model, points }) {
  const range = valueRange(points, keyName);
  const clipId = `india-clip-${type}-${keyName}`;

  return `
    <article class="india-map-card">
      <header>
        <div>
          <span>${model.label}</span>
          <h2>${title}</h2>
        </div>
        <p>${formatLeadTime(points, keyName)}</p>
      </header>
      <svg class="india-map" viewBox="0 0 1000 1030" role="img" aria-label="${title} forecast map for India">
        <defs>
          <clipPath id="${clipId}">
            ${boundaryPaths()}
          </clipPath>
        </defs>
        <g class="forecast-field" clip-path="url(#${clipId})">
          ${gridCells(type, keyName, points)}
        </g>
        <g class="india-map-shape">
          ${boundaryPaths()}
        </g>
        <g class="map-labels" aria-hidden="true">
          <text x="455" y="150">North</text>
          <text x="135" y="485">West</text>
          <text x="740" y="465">East</text>
          <text x="485" y="885">South</text>
        </g>
        <g clip-path="url(#${clipId})">
        ${points
          .map((point) => {
            const value = Number(point[keyName].value);
            const color =
              type === "temperature"
                ? temperatureColor(value)
                : rainfallColor(value);
            const size = markerSize(type, value);
            const { x, y } = markerPosition(point);

            return `
              <g class="map-marker ${type}" tabindex="0" aria-label="${point.name}: ${formatNumber(value)} ${unit}">
                <title>${point.name}: ${formatNumber(value)} ${unit}</title>
                <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(size / 2).toFixed(2)}" fill="${color}"></circle>
                ${
                  type === "temperature"
                    ? `<text x="${x.toFixed(2)}" y="${(y + 4).toFixed(2)}">${formatNumber(value, 0)}</text>`
                    : ""
                }
              </g>
            `;
          })
          .join("")}
        </g>
      </svg>
      <footer>
        <span>${formatNumber(range.min)} to ${formatNumber(range.max)} ${unit}</span>
        ${renderLegend(type)}
      </footer>
    </article>
  `;
}

function renderMaps(model, points) {
  mapGrid.innerHTML = [
    { title: "Temperature - 24h", type: "temperature", keyName: "t24", unit: "C" },
    { title: "Rainfall - 24h", type: "rainfall", keyName: "r24", unit: "mm" },
    { title: "Temperature - 48h", type: "temperature", keyName: "t48", unit: "C" },
    { title: "Rainfall - 48h", type: "rainfall", keyName: "r48", unit: "mm" },
  ]
    .map((config) => renderMapCard({ ...config, model, points }))
    .join("");
}

function renderCityDetails(points) {
  const selectedCity = cityLocations[Number(citySelect.value) || 0];
  const point = points.find((item) => item.name === selectedCity.name);
  if (!point) {
    cityDetailGrid.innerHTML = "";
    return;
  }

  cityDetailGrid.innerHTML = [24, 48]
    .map((lead) => {
      const suffix = lead === 24 ? "24" : "48";
      const time = formatLeadTime([point], `t${suffix}`);
      return `
        <article class="city-detail-card">
          <header>
            <span>${lead} hours ahead</span>
            <h3>${point.name}</h3>
            <p>${time}</p>
          </header>
          <dl>
            <div><dt>Temperature</dt><dd>${formatNumber(point[`t${suffix}`].value)} C</dd></div>
            <div><dt>Rainfall</dt><dd>${formatNumber(point[`r${suffix}`].value)} mm</dd></div>
            <div><dt>Wind speed</dt><dd>${formatNumber(point[`w${suffix}`].value)} km/h</dd></div>
            <div><dt>Wind gust</dt><dd>${formatNumber(point[`g${suffix}`].value)} km/h</dd></div>
            <div><dt>Cloud cover</dt><dd>${formatNumber(point[`c${suffix}`].value, 0)}%</dd></div>
            <div><dt>MSL pressure</dt><dd>${formatNumber(point[`p${suffix}`].value)} hPa</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function openProfiles() {
  profileModal.classList.add("active");
  profileModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeProfiles() {
  profileModal.classList.remove("active");
  profileModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

async function loadForecast() {
  const model = models[modelSelect.value] || models.gfs;
  setStatus(`Loading ${model.label} maps...`);
  mapGrid.innerHTML = "";
  cityDetailGrid.innerHTML = "";

  try {
    const [, points] = await Promise.all([
      fetchBoundary(),
      fetchPointForecasts(model, samplePoints, cityVariables),
    ]);
    currentMapPoints = points;
    renderMaps(model, points);
    renderCityDetails(points);
    setStatus(`${model.label} maps loaded.`);
  } catch (error) {
    setStatus(error.message || "Forecast maps unavailable.", true);
  }
}

forecastForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadForecast();
});

modelSelect.addEventListener("change", loadForecast);

citySelect.addEventListener("change", () => {
  renderCityDetails(currentMapPoints);
});

profileOpenButtons.forEach((button) => {
  button.addEventListener("click", openProfiles);
});

profileCloseButtons.forEach((button) => {
  button.addEventListener("click", closeProfiles);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeProfiles();
  }
});

populateCities();
loadForecast();
