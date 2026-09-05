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

const FORECAST_DATA_ROOT =
  "https://raw.githubusercontent.com/pdasiitism/pdasiitism.github.io/forecast-data/";

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

const models = {
  ifs: {
    key: "ifs",
    label: "IFS 0.25 deg",
    dataUrl: `${FORECAST_DATA_ROOT}assets/data/forecast-ifs.json`,
    animationUrl: `${FORECAST_DATA_ROOT}assets/data/forecast-ifs-animation.json`,
    fallbackDataUrl: "assets/data/forecast-ifs.json",
    fallbackAnimationUrl: "assets/data/forecast-ifs-animation.json",
  },
  aifs: {
    key: "aifs",
    label: "AIFS 0.25 deg",
    dataUrl: `${FORECAST_DATA_ROOT}assets/data/forecast-aifs.json`,
    animationUrl: `${FORECAST_DATA_ROOT}assets/data/forecast-aifs-animation.json`,
    fallbackDataUrl: "assets/data/forecast-aifs.json",
    fallbackAnimationUrl: "assets/data/forecast-aifs-animation.json",
  },
};

const variables = {
  temperature: {
    label: "Temperature",
    gradient:
      "linear-gradient(90deg,#4c399c,#7e57c2,#3f51b5,#2196f3,#26a69a,#fdd835,#fb8c00,#e53935,#8e0000)",
  },
  rainfall: {
    label: "Rainfall",
    gradient:
      "linear-gradient(90deg,#f7fbff,#c7e9b4,#41b6c4,#2c7fb8,#fdae61,#d7191c,#6a1b9a)",
  },
};

const modelSelect = document.querySelector("#model-select");
const variableSelect = document.querySelector("#variable-select");
const forecastForm = document.querySelector("#forecast-form");
const statusEl = document.querySelector("#forecast-status");
const animationMap = document.querySelector("#forecast-animation-map");
const animationModelLabel = document.querySelector("#animation-model-label");
const animationTitle = document.querySelector("#animation-title");
const animationValidTime = document.querySelector("#animation-valid-time");
const animationLegend = document.querySelector("#animation-legend");
const frameSlider = document.querySelector("#frame-slider");
const frameStepLabel = document.querySelector("#frame-step-label");
const playToggle = document.querySelector("#play-toggle");
const prevFrameButton = document.querySelector("#prev-frame");
const nextFrameButton = document.querySelector("#next-frame");
const citySelect = document.querySelector("#city-select");
const cityDetailGrid = document.querySelector("#city-detail-grid");
const profileModal = document.querySelector("#profile-modal");
const profileOpenButtons = [...document.querySelectorAll("[data-open-profiles]")];
const profileCloseButtons = [...document.querySelectorAll("[data-close-profiles]")];

let indiaBoundary = null;
let activeForecast = null;
let activeAnimation = null;
let activeFrames = [];
let currentFrameIndex = 0;
let animationTimer = null;
let isPlaying = true;
let activeAssetRoot = "";

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

function formatTime(time) {
  if (!time) {
    return "";
  }

  return new Date(time).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    timeZoneName: "short",
  });
}

function formatRunTime(time) {
  if (!time) {
    return "";
  }

  const normalized = time.replace(/T(\d{2})(\d{2})Z$/, "T$1:$2:00Z");
  return formatTime(normalized);
}

function renderLegend(variableKey, variableData) {
  const variable = variables[variableKey];
  const ticks = (variableData.legend || []).map((tick) =>
    String(tick).replace(/\s*C$/, ""),
  );

  return `
    <div class="forecast-colorbar" aria-label="${variable.label} color scale">
      <strong>${variableData.unit || ""}</strong>
      <i style="background:${variable.gradient}"></i>
      <div>
        ${ticks.map((tick) => `<span>${tick}</span>`).join("")}
      </div>
    </div>
  `;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function fetchJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`);
  if (!response.ok) {
    throw new Error("Forecast data unavailable");
  }

  return response.json();
}

async function fetchBoundary() {
  if (indiaBoundary) {
    return indiaBoundary;
  }

  indiaBoundary = await fetchJson("assets/maps/india-state-boundary.geojson");
  return indiaBoundary;
}

async function fetchModelData(model) {
  try {
    const [forecast, animation] = await Promise.all([
      fetchJson(model.dataUrl),
      fetchJson(model.animationUrl),
    ]);
    activeAssetRoot = FORECAST_DATA_ROOT;
    return { forecast, animation };
  } catch (remoteError) {
    const [forecast, animation] = await Promise.all([
      fetchJson(model.fallbackDataUrl),
      fetchJson(model.fallbackAnimationUrl),
    ]);
    activeAssetRoot = "";
    return { forecast, animation };
  }
}

function frameImageUrl(path) {
  const base = activeAssetRoot || window.location.href;
  return new URL(path, base).href;
}

function renderFrame() {
  const model = models[modelSelect.value] || models.ifs;
  const variableKey = variableSelect.value;
  const variable = variables[variableKey];
  const variableData = activeAnimation.variables[variableKey];
  const frame = activeFrames[currentFrameIndex];
  const clipId = `india-animation-clip-${model.key}`;

  animationModelLabel.textContent = activeAnimation.model || model.label;
  animationTitle.textContent = `${variable.label} Animation`;
  animationValidTime.textContent = `Valid: ${formatTime(frame.valid_time)}`;
  frameStepLabel.textContent = `+${frame.step} h`;
  frameSlider.max = String(activeFrames.length - 1);
  frameSlider.value = String(currentFrameIndex);
  animationLegend.innerHTML = renderLegend(variableKey, variableData);

  animationMap.innerHTML = `
    <svg class="india-map animation-india-map" viewBox="0 0 1000 1030" role="img" aria-label="${variable.label} forecast animation for India">
      <defs>
        <clipPath id="${clipId}">
          ${boundaryPaths()}
        </clipPath>
      </defs>
      <image href="${frameImageUrl(frame.image)}?v=${activeAnimation.generated_at}" x="0" y="0" width="1000" height="1030" preserveAspectRatio="none" clip-path="url(#${clipId})"></image>
      <g class="india-map-shape">
        ${boundaryPaths()}
      </g>
    </svg>
  `;
}

function setFrame(index) {
  if (!activeFrames.length) {
    return;
  }

  currentFrameIndex = (index + activeFrames.length) % activeFrames.length;
  renderFrame();
}

function stopAnimation() {
  if (animationTimer) {
    window.clearInterval(animationTimer);
    animationTimer = null;
  }
}

function startAnimation() {
  stopAnimation();
  animationTimer = window.setInterval(() => {
    setFrame(currentFrameIndex + 1);
  }, 850);
}

function updatePlayback() {
  playToggle.textContent = isPlaying ? "Pause" : "Play";
  if (isPlaying) {
    startAnimation();
  } else {
    stopAnimation();
  }
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
      const time = formatTime(point[`t${suffix}`].time);
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
            <div><dt>MSL pressure</dt><dd>${formatNumber(point[`p${suffix}`].value)} hPa</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

async function loadForecast() {
  const model = models[modelSelect.value] || models.ifs;
  const variableKey = variableSelect.value;
  setStatus(`Loading ${model.label} ${variables[variableKey].label.toLowerCase()} animation...`);
  stopAnimation();

  try {
    await fetchBoundary();
    const modelData = await fetchModelData(model);
    activeForecast = modelData.forecast;
    activeAnimation = modelData.animation;
    activeFrames = activeAnimation.variables[variableKey].frames;
    currentFrameIndex = 0;

    if (!activeFrames.length) {
      throw new Error("No animation frames available");
    }

    renderFrame();
    renderCityDetails(activeForecast.city_points || []);
    setStatus(
      `${activeAnimation.model} ${variables[variableKey].label.toLowerCase()} animation loaded. Run: ${formatRunTime(activeAnimation.run_time_utc)}.`,
    );
    updatePlayback();
  } catch (error) {
    setStatus(error.message || "Forecast animation unavailable.", true);
  }
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

forecastForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadForecast();
});

modelSelect.addEventListener("change", loadForecast);
variableSelect.addEventListener("change", loadForecast);

frameSlider.addEventListener("input", () => {
  isPlaying = false;
  updatePlayback();
  setFrame(Number(frameSlider.value));
});

playToggle.addEventListener("click", () => {
  isPlaying = !isPlaying;
  updatePlayback();
});

prevFrameButton.addEventListener("click", () => {
  isPlaying = false;
  updatePlayback();
  setFrame(currentFrameIndex - 1);
});

nextFrameButton.addEventListener("click", () => {
  isPlaying = false;
  updatePlayback();
  setFrame(currentFrameIndex + 1);
});

citySelect.addEventListener("change", () => {
  renderCityDetails(activeForecast?.city_points || []);
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
