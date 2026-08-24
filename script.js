const publications = [
  {
    title:
      "Relative Robustness of ML Post-Processing Schemes in Forecasting Wintertime Precipitation Types",
    year: "2026",
    venue: "Weather and Forecasting",
    area: "Forecasting",
    summary:
      "CONUS-wide comparison of machine-learning post-processing approaches for winter precipitation type prediction.",
  },
  {
    title:
      "Selection of Optimum GCMs through Bayesian Networks for Improved ML Multi-Model Ensembles",
    year: "2025",
    venue: "Stochastic Environmental Research and Risk Assessment",
    area: "Climate Risk",
    summary:
      "Bayesian-network-driven model selection for precipitation and temperature ensemble development.",
  },
  {
    title:
      "A Bayesian Network Approach for Understanding Drivers of Rainfall and Streamflow",
    year: "2023",
    venue: "Stochastic Environmental Research and Risk Assessment",
    area: "Hydrology",
    summary:
      "Graphical modeling of large-scale and local hydro-meteorological variables behind basin-scale outcomes.",
  },
  {
    title:
      "Machine Learning-Based Rainfall Forecasting with Multiple Non-Linear Feature Selection Algorithms",
    year: "2022",
    venue: "Water Resources Management",
    area: "Forecasting",
    summary:
      "Feature selection and machine-learning workflow for rainfall forecasting in nonlinear hydro-climate systems.",
  },
  {
    title:
      "Bayesian Network Based Modeling of Regional Rainfall from Multiple Local Meteorological Drivers",
    year: "2020",
    venue: "Journal of Hydrology",
    area: "Hydrology",
    summary:
      "Probabilistic driver analysis for regional rainfall using meteorological predictors and Bayesian networks.",
  },
];

const skills = [
  { name: "Hydro-meteorology", value: 96 },
  { name: "AI/ML Forecasting", value: 92 },
  { name: "Bayesian Networks", value: 91 },
  { name: "Python + Scientific Data", value: 89 },
  { name: "Climate Risk Analysis", value: 87 },
  { name: "GIS + Earth Engine", value: 78 },
];

const publicationGrid = document.querySelector("#publication-grid");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const skillList = document.querySelector("#skill-list");
const skillTitle = document.querySelector("#skill-title");
const meterRing = document.querySelector("#meter-ring");
const meterValue = document.querySelector("#meter-value");

function renderPublications(filter = "All") {
  const selected =
    filter === "All"
      ? publications
      : publications.filter((publication) => publication.area === filter);

  publicationGrid.innerHTML = selected
    .map(
      (publication) => `
        <article class="publication-card">
          <div class="publication-meta">
            <span>${publication.year}</span>
            <span>${publication.area}</span>
          </div>
          <h3>${publication.title}</h3>
          <p>${publication.summary}</p>
          <footer>${publication.venue}</footer>
        </article>
      `,
    )
    .join("");
}

function selectSkill(skill) {
  skillTitle.textContent = skill.name;
  meterValue.textContent = skill.value;
  meterRing.style.setProperty("--meter-value", `${skill.value}%`);

  [...skillList.querySelectorAll("button")].forEach((button) => {
    button.classList.toggle("selected", button.dataset.skill === skill.name);
    button.setAttribute(
      "aria-pressed",
      button.dataset.skill === skill.name ? "true" : "false",
    );
  });
}

function renderSkills() {
  skillList.innerHTML = skills
    .map(
      (skill, index) => `
        <button
          aria-pressed="${index === 0 ? "true" : "false"}"
          class="${index === 0 ? "selected" : ""}"
          data-skill="${skill.name}"
          type="button"
        >
          <span>${skill.name}</span>
          <span class="mini-bar" aria-hidden="true">
            <span style="width: ${skill.value}%"></span>
          </span>
        </button>
      `,
    )
    .join("");

  [...skillList.querySelectorAll("button")].forEach((button) => {
    button.addEventListener("click", () => {
      const skill = skills.find((item) => item.name === button.dataset.skill);
      if (skill) {
        selectSkill(skill);
      }
    });
  });
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderPublications(button.dataset.filter);
  });
});

renderPublications();
renderSkills();
