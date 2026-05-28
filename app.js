let data = [];
let calendar;

// ============================
// LOAD DATA
// ============================
fetch("data.csv")
  .then(r => r.text())
  .then(text => {

    const rows = text.trim().split("\n").map(r => r.split(","));
    const headers = rows[0].map(h => h.trim());

    data = rows.slice(1).map(r => {
      let obj = {};
      headers.forEach((h, i) => obj[h] = r[i]);
      return obj;
    });

    init();
  });

// ============================
// INIT
// ============================
function init() {
  renderKPIs();
  renderCalendar();
  renderTable();
  showView("overview");
}

// ============================
// KPI SYSTEM
// ============================
function renderKPIs() {

  const exams = data.filter(d => d.type === "Exam");
  const high = data.filter(d => parseFloat(d.weight || 0) >= 10);

  document.getElementById("kpiTotal").innerText = data.length;
  document.getElementById("kpiExams").innerText = exams.length;
  document.getElementById("kpiHigh").innerText = high.length;
}

// ============================
// CALENDAR (UCVM POLISHED)
// ============================
function renderCalendar() {

  const events = data.map(e => {

    const weight = parseFloat(e.weight || 0);

    // COLOR SYSTEM (UCVM STYLE)
    let color = "#2563eb";

    if (e.type === "Exam") color = "#ef4444";
    if (weight >= 10) color = "#dc2626";
    if (weight >= 20) color = "#991b1b";

    return {
      title: `${e.course} (${weight}%)`,
      start: `${e.date}T09:00`,
      end: `${e.date}T10:00`,
      backgroundColor: color,
      borderColor: color,
      textColor: "#fff"
    };
  });

  const calendarEl = document.getElementById("calendar");

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    height: "auto",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek"
    },
    events: events
  });

  calendar.render();
}

// ============================
// TABLE (CLEAN UI)
// ============================
function renderTable() {

  const table = document.getElementById("table");

  table.innerHTML = `
    <tr>
      <th>Course</th>
      <th>Date</th>
      <th>Type</th>
      <th>Weight</th>
    </tr>
  `;

  data.forEach(e => {

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${e.course}</td>
      <td>${e.date}</td>
      <td>${e.type}</td>
      <td>${e.weight}</td>
    `;

    table.appendChild(row);
  });
}

// ============================
// NAVIGATION SYSTEM
// ============================
function showView(viewId) {

  document.querySelectorAll(".view").forEach(v => {
    v.classList.remove("active");
    v.style.display = "none";
  });

  const el = document.getElementById(viewId);

  if (el) {
    el.classList.add("active");
    el.style.display = "block";
  }
}

// ============================
// OPTIONAL: AUTO REFRESH SAFE
// ============================
function refreshData() {
  renderKPIs();
  calendar.refetchEvents();
  renderTable();
}
