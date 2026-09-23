// BrewOps frontend — vanilla JS, no dependencies, no build step.

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

// ---- dashboard ----

function renderDrinkBars(perDrink) {
  const container = document.getElementById("drink-bars");
  container.innerHTML = "";
  const max = Math.max(1, ...perDrink.map((d) => d.count));
  for (const drink of perDrink) {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span class="bar-label">${drink.label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(drink.count / max) * 100}%"></span></span>
      <span class="bar-count">${drink.count}</span>`;
    container.appendChild(row);
  }
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${MONTH_ABBR[Number(month) - 1]} ${Number(day)}`;
}

function svgText(x, y, content, extraAttrs) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", x);
  text.setAttribute("y", y);
  text.setAttribute("class", "timeline-label");
  for (const [key, value] of Object.entries(extraAttrs || {})) {
    text.setAttribute(key, value);
  }
  text.textContent = content;
  return text;
}

function renderTimeline(perDay) {
  const svg = document.getElementById("timeline");
  svg.innerHTML = "";
  if (perDay.length === 0) return;
  const width = 600;
  const height = 150;
  const axisHeight = 20; // reserved at the bottom for x-axis date labels
  const chartHeight = height - axisHeight;
  const max = Math.max(...perDay.map((d) => d.count));
  const barWidth = width / perDay.length;

  perDay.forEach((day, i) => {
    const barHeight = (day.count / max) * (chartHeight - 10);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", i * barWidth);
    rect.setAttribute("y", chartHeight - barHeight);
    rect.setAttribute("width", Math.max(0.5, barWidth - 0.6));
    rect.setAttribute("height", barHeight);
    rect.setAttribute("class", "timeline-bar");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${day.day}: ${day.count} brews`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });

  // peak-value label, top-left
  svg.appendChild(svgText(4, 12, `peak ${max}/day`, { class: "timeline-label timeline-peak" }));

  // x-axis date labels: at most 6 evenly-spaced ticks
  const tickCount = Math.min(6, perDay.length);
  for (let t = 0; t < tickCount; t++) {
    const i = tickCount === 1 ? 0 : Math.round((t * (perDay.length - 1)) / (tickCount - 1));
    const x = i * barWidth + barWidth / 2;
    const anchor = t === 0 ? "start" : t === tickCount - 1 ? "end" : "middle";
    svg.appendChild(
      svgText(x, height - 4, formatShortDate(perDay[i].day), { "text-anchor": anchor })
    );
  }
}

function renderMachineCards(healths) {
  const container = document.getElementById("machine-cards");
  container.innerHTML = "";
  for (const m of healths) {
    const card = document.createElement("div");
    card.className = "card";
    const specialty = m.specialty
      ? `<p class="specialty">Specialty: <strong>${m.specialty.label}</strong></p>`
      : "";
    const maintenance = m.last_maintenance
      ? `${m.last_maintenance.type} on ${m.last_maintenance.timestamp.slice(0, 10)}`
      : "none on record";
    const errors = m.recent_errors.length
      ? `<p class="errors">Recent errors: ${m.recent_errors
          .map((e) => `${e.error_code || "?"} (${e.timestamp.slice(0, 10)})`)
          .join(", ")}</p>`
      : "";
    card.innerHTML = `
      <h3>${m.name}</h3>
      <p class="badge">${m.has_telemetry ? "telemetry" : "manual log"}</p>
      ${specialty}
      <p>${m.brew_count} brews · last ${m.last_brew ? m.last_brew.slice(0, 16) : "never"}</p>
      <p>Last maintenance: ${maintenance}</p>
      ${errors}`;
    container.appendChild(card);
  }
}

function renderLeaderBanner(healths) {
  if (healths.length === 0) return;
  const leader = healths.reduce((best, m) => (m.brew_count > best.brew_count ? m : best));
  document.getElementById("leader-name").textContent = leader.name;
  const specialty = leader.specialty ? ` · specialty ${leader.specialty.label}` : "";
  document.getElementById("leader-detail").textContent =
    `${leader.brew_count.toLocaleString()} brews${specialty}`;
}

function dateRangeQuery() {
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function loadDashboard() {
  const query = dateRangeQuery();
  const stats = await fetchJSON(`/api/stats${query}`);
  document.getElementById("total-brews").textContent = stats.total_brews;
  const lastDay = stats.per_day[stats.per_day.length - 1];
  document.getElementById("brews-today").textContent = lastDay ? lastDay.count : 0;
  renderDrinkBars(stats.per_drink);
  renderTimeline(stats.per_day);

  const machines = await fetchJSON("/api/machines");
  document.getElementById("machine-count").textContent = machines.length;
  const healths = await Promise.all(
    machines.map((m) => fetchJSON(`/api/machines/${m.id}${query}`))
  );
  renderMachineCards(healths);
  renderLeaderBanner(healths);
}

// ---- forms ----

function localNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16); // datetime-local format
}

function localToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10); // date format
}

function fillSelect(select, items, valueKey, labelKey) {
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item[valueKey];
    option.textContent = item[labelKey];
    select.appendChild(option);
  }
}

async function setupForms() {
  const machines = await fetchJSON("/api/machines");
  const drinks = await fetchJSON("/api/drink-types");
  fillSelect(document.getElementById("brew-machine"), machines, "id", "name");
  fillSelect(document.getElementById("brew-drink"), drinks, "name", "label");
  fillSelect(document.getElementById("maintenance-machine"), machines, "id", "name");
  document.getElementById("brew-timestamp").value = localNow();
  document.getElementById("maintenance-timestamp").value = localNow();

  document.getElementById("brew-form").addEventListener("submit", (event) =>
    submitForm(event, "/api/brews", "brew-message", () => ({
      machine_id: Number(document.getElementById("brew-machine").value),
      drink_type: document.getElementById("brew-drink").value,
      timestamp: document.getElementById("brew-timestamp").value,
    }))
  );

  document.getElementById("maintenance-form").addEventListener("submit", (event) =>
    submitForm(event, "/api/maintenance", "maintenance-message", () => ({
      machine_id: Number(document.getElementById("maintenance-machine").value),
      type: document.getElementById("maintenance-type").value,
      timestamp: document.getElementById("maintenance-timestamp").value,
      note: document.getElementById("maintenance-note").value || null,
    }))
  );
}

async function submitForm(event, url, messageId, buildPayload) {
  event.preventDefault();
  const message = document.getElementById(messageId);
  message.textContent = "";
  message.className = "message";
  try {
    await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    message.textContent = "Logged.";
    message.classList.add("ok");
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
}

function setupFilter() {
  const from = document.getElementById("filter-from");
  const to = document.getElementById("filter-to");
  const clear = document.getElementById("filter-clear");
  from.addEventListener("change", () => loadDashboard());
  to.addEventListener("change", () => loadDashboard());
  clear.addEventListener("click", () => {
    from.value = "";
    to.value = "";
    loadDashboard();
  });
}

async function prefillFilterDefaults() {
  const stats = await fetchJSON("/api/stats");
  if (stats.per_day.length > 0) {
    document.getElementById("filter-from").value = stats.per_day[0].day;
  }
  document.getElementById("filter-to").value = localToday();
}

prefillFilterDefaults()
  .catch((error) => console.error("Filter prefill failed:", error))
  .finally(() => {
    loadDashboard().catch((error) => {
      document.getElementById("total-brews").textContent = "!";
      console.error("Dashboard failed to load:", error);
    });
  });
setupForms().catch((error) => console.error("Form setup failed:", error));
setupFilter();
