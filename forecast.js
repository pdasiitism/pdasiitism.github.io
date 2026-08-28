const locations = [
  { name: "New Delhi", latitude: 28.6139, longitude: 77.209 },
  { name: "Mumbai", latitude: 19.076, longitude: 72.8777 },
  { name: "Kolkata", latitude: 22.5726, longitude: 88.3639 },
  { name: "Chennai", latitude: 13.0827, longitude: 80.2707 },
  { name: "Bengaluru", latitude: 12.9716, longitude: 77.5946 },
  { name: "Hyderabad", latitude: 17.385, longitude: 78.4867 },
  { name: "Guwahati", latitude: 26.1445, longitude: 91.7362 },
  { name: "Ahmedabad", latitude: 23.0225, longitude: 72.5714 },
  { name: "Bhubaneswar", latitude: 20.2961, longitude: 85.8245 },
  { name: "Dhanbad", latitude: 23.7957, longitude: 86.4304 },
];

const variables = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "cloud_cover",
  "pressure_msl",
];

const models = [
  {
    key: "gfs",
    name: "NOAA GFS",
    endpoint: "https://api.open-meteo.com/v1/gfs",
  },
  {
    key: "ifs",
    name: "ECMWF IFS",
    endpoint: "https://api.open-meteo.com/v1/ecmwf",
  },
];

const locationSelect = document.querySelector("#location-select");
const forecastForm = document.querySelector("#forecast-form");
const statusEl = document.querySelector("#forecast-status");
const summaryEl = document.querySelector("#forecast-summary");
const modelGrid = document.querySelector("#model-grid");
const profileModal = document.querySelector("#profile-modal");
const profileOpenButtons = [...document.querySelectorAll("[data-open-profiles]")];
const profileCloseButtons = [...document.querySelectorAll("[data-close-profiles]")];

function populateLocations() {
  locationSelect.innerHTML = locations
    .map(
      (location, index) =>
        `<option value="${index}">${location.name}</option>`,
    )
    .join("");
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(digits);
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

function extractSnapshot(data, hoursAhead) {
  const target = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const index = nearestIndex(data.hourly.time, target);
  const hour = data.hourly.time[index];

  return {
    hour,
    temperature: data.hourly.temperature_2m[index],
    precipitation: data.hourly.precipitation[index],
    wind: data.hourly.wind_speed_10m[index],
    gust: data.hourly.wind_gusts_10m[index],
    cloud: data.hourly.cloud_cover[index],
    pressure: data.hourly.pressure_msl[index],
  };
}

function buildUrl(model, location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    hourly: variables.join(","),
    timezone: "Asia/Kolkata",
    forecast_hours: "49",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    temperature_unit: "celsius",
  });

  return `${model.endpoint}?${params.toString()}`;
}

async function fetchModel(model, location) {
  const response = await fetch(buildUrl(model, location));

  if (!response.ok) {
    throw new Error(`${model.name} returned ${response.status}`);
  }

  const data = await response.json();
  return {
    ...model,
    generatedAt: new Date().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }),
    snapshots: [24, 48].map((hours) => ({
      hours,
      ...extractSnapshot(data, hours),
    })),
  };
}

function renderSummary(location, modelData) {
  summaryEl.innerHTML = `
    <article>
      <span>Location</span>
      <strong>${location.name}</strong>
      <small>${location.latitude.toFixed(4)} N, ${location.longitude.toFixed(4)} E</small>
    </article>
    <article>
      <span>Models</span>
      <strong>${modelData.map((model) => model.name).join(" + ")}</strong>
      <small>Open-Meteo browser API</small>
    </article>
    <article>
      <span>Range</span>
      <strong>24h and 48h</strong>
      <small>Timezone: Asia/Kolkata</small>
    </article>
  `;
}

function renderModel(model) {
  return `
    <article class="model-card">
      <div class="model-card-header">
        <span>${model.key.toUpperCase()}</span>
        <h2>${model.name}</h2>
        <p>Updated in this view: ${model.generatedAt}</p>
      </div>
      <div class="snapshot-grid">
        ${model.snapshots
          .map(
            (snapshot) => `
              <section class="snapshot-card">
                <div>
                  <span class="snapshot-label">${snapshot.hours} hours ahead</span>
                  <h3>${new Date(snapshot.hour).toLocaleString("en-IN", {
                    weekday: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  })}</h3>
                </div>
                <dl>
                  <div>
                    <dt>Temperature</dt>
                    <dd>${formatNumber(snapshot.temperature)} C</dd>
                  </div>
                  <div>
                    <dt>Rainfall</dt>
                    <dd>${formatNumber(snapshot.precipitation)} mm</dd>
                  </div>
                  <div>
                    <dt>Wind</dt>
                    <dd>${formatNumber(snapshot.wind)} km/h</dd>
                  </div>
                  <div>
                    <dt>Gust</dt>
                    <dd>${formatNumber(snapshot.gust)} km/h</dd>
                  </div>
                  <div>
                    <dt>Cloud</dt>
                    <dd>${formatNumber(snapshot.cloud, 0)}%</dd>
                  </div>
                  <div>
                    <dt>MSL pressure</dt>
                    <dd>${formatNumber(snapshot.pressure)} hPa</dd>
                  </div>
                </dl>
              </section>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderForecast(location, modelData) {
  renderSummary(location, modelData);
  modelGrid.innerHTML = modelData.map(renderModel).join("");
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
  const location = locations[Number(locationSelect.value) || 0];
  setStatus("Loading forecast...");
  modelGrid.innerHTML = "";

  try {
    const modelData = await Promise.all(
      models.map((model) => fetchModel(model, location)),
    );
    renderForecast(location, modelData);
    setStatus("Forecast loaded.");
  } catch (error) {
    setStatus(error.message || "Forecast unavailable.", true);
  }
}

forecastForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadForecast();
});

locationSelect.addEventListener("change", loadForecast);

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

populateLocations();
loadForecast();
