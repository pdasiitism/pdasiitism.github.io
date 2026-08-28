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

const mapBounds = {
  minLat: 6,
  maxLat: 36,
  minLon: 68,
  maxLon: 94,
};

const variables = ["temperature_2m", "precipitation"];

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
const forecastForm = document.querySelector("#forecast-form");
const statusEl = document.querySelector("#forecast-status");
const mapGrid = document.querySelector("#forecast-map-grid");
const profileModal = document.querySelector("#profile-modal");
const profileOpenButtons = [...document.querySelectorAll("[data-open-profiles]")];
const profileCloseButtons = [...document.querySelectorAll("[data-close-profiles]")];
let indiaBoundary = null;

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointStyle(point) {
  const x =
    ((point.longitude - mapBounds.minLon) /
      (mapBounds.maxLon - mapBounds.minLon)) *
    100;
  const y =
    ((mapBounds.maxLat - point.latitude) /
      (mapBounds.maxLat - mapBounds.minLat)) *
    100;

  return `left:${clamp(x, 0, 100)}%;top:${clamp(y, 0, 100)}%;`;
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
  if (value < 10) return "#355caa";
  if (value < 18) return "#2f8ac4";
  if (value < 26) return "#19a974";
  if (value < 34) return "#e0a526";
  if (value < 40) return "#d66b2f";
  return "#b83232";
}

function rainfallColor(value) {
  if (value <= 0) return "#d9e1dd";
  if (value < 1) return "#b7e4d6";
  if (value < 5) return "#65c3b4";
  if (value < 15) return "#1f8fbe";
  if (value < 30) return "#3763ad";
  return "#5c2f99";
}

function markerSize(type, value) {
  if (type === "temperature") {
    return 18;
  }

  return clamp(12 + Math.sqrt(Math.max(value, 0)) * 5, 12, 34);
}

function buildUrl(model) {
  const params = new URLSearchParams({
    latitude: samplePoints.map((point) => point.latitude).join(","),
    longitude: samplePoints.map((point) => point.longitude).join(","),
    hourly: variables.join(","),
    timezone: "Asia/Kolkata",
    forecast_hours: "49",
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

async function fetchForecast(model) {
  const response = await fetch(buildUrl(model));

  if (!response.ok) {
    throw new Error(`${model.label} forecast unavailable`);
  }

  const payload = await response.json();
  const locations = Array.isArray(payload) ? payload : [payload];

  return samplePoints.map((point, index) => {
    const data = locations[index];
    return {
      ...point,
      t24: extractValue(data, "temperature_2m", 24),
      t48: extractValue(data, "temperature_2m", 48),
      r24: extractValue(data, "precipitation", 24),
      r48: extractValue(data, "precipitation", 48),
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
        <span><i style="background:#355caa"></i>Cool</span>
        <span><i style="background:#19a974"></i>Mild</span>
        <span><i style="background:#e0a526"></i>Warm</span>
        <span><i style="background:#b83232"></i>Hot</span>
      </div>
    `;
  }

  return `
    <div class="forecast-legend">
      <span><i style="background:#d9e1dd"></i>Dry</span>
      <span><i style="background:#65c3b4"></i>Light</span>
      <span><i style="background:#1f8fbe"></i>Moderate</span>
      <span><i style="background:#5c2f99"></i>Heavy</span>
    </div>
  `;
}

function renderMapCard({ title, type, keyName, unit, model, points }) {
  const range = valueRange(points, keyName);

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
          <clipPath id="india-clip-${type}-${keyName}">
            ${boundaryPaths()}
          </clipPath>
        </defs>
        <g class="india-map-shape">
          ${boundaryPaths()}
        </g>
        <g class="map-labels" aria-hidden="true">
          <text x="455" y="150">North</text>
          <text x="135" y="485">West</text>
          <text x="740" y="465">East</text>
          <text x="485" y="885">South</text>
        </g>
        <g clip-path="url(#india-clip-${type}-${keyName})">
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
    {
      title: "Temperature - 24h",
      type: "temperature",
      keyName: "t24",
      unit: "C",
    },
    {
      title: "Rainfall - 24h",
      type: "rainfall",
      keyName: "r24",
      unit: "mm",
    },
    {
      title: "Temperature - 48h",
      type: "temperature",
      keyName: "t48",
      unit: "C",
    },
    {
      title: "Rainfall - 48h",
      type: "rainfall",
      keyName: "r48",
      unit: "mm",
    },
  ]
    .map((config) => renderMapCard({ ...config, model, points }))
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

  try {
    const [, points] = await Promise.all([fetchBoundary(), fetchForecast(model)]);
    renderMaps(model, points);
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

loadForecast();
