let calendar;
let allEvents = [];

// ====================================
// LOAD CSV
// ====================================

fetch("data.csv")
  .then(res => res.text())
  .then(text => {

    const rows = text
      .trim()
      .split("\n")
      .map(r => r.split(","));

    // HEADERS
    const headers = rows[0].map(h =>
      h.trim().toLowerCase()
    );

    // DATA OBJECTS
    const data = rows.slice(1).map(row => {

      let obj = {};

      headers.forEach((h, i) => {
        obj[h] = (row[i] || "").trim();
      });

      return obj;
    });

    console.log(data);

    allEvents = convertToCalendarEvents(data);

    populateTypeFilter(data);

    initializeCalendar(allEvents);

  });


// ====================================
// CSV → CALENDAR EVENTS
// ====================================

function convertToCalendarEvents(data) {

  return data.map(item => {

    const type =
      (item.type || "").toLowerCase();

    let className = "assignment-event";

    if (type.includes("exam")) {
      className = "exam-event";
    }
    else if (type.includes("quiz")) {
      className = "quiz-event";
    }
    else if (type.includes("lab")) {
      className = "lab-event";
    }

    return {

      title: `
${item.course || ""}
- ${item.assessment_details || ""}
      `,

      start: combineDateTime(
        item.date,
        item.start_time
      ),

      end: combineDateTime(
        item.date,
        item.end_time
      ),

      extendedProps: item,

      classNames: [className]

    };

  });

}


// ====================================
// DATE + TIME
// ====================================

function combineDateTime(date, time) {

  if (!date) return null;

  if (!time) time = "08:00";

  return `${date}T${time}`;

}


// ====================================
// INITIALIZE CALENDAR
// ====================================

function initializeCalendar(events) {

  const calendarEl =
    document.getElementById("calendar");

  calendar = new FullCalendar.Calendar(
    calendarEl,
    {

      initialView: 'timeGridWeek',

      height: "auto",

      nowIndicator: true,

      slotMinTime: "07:00:00",

      slotMaxTime: "22:00:00",

      headerToolbar: {

        left: 'prev,next today',

        center: 'title',

        right:
          'dayGridMonth,timeGridWeek,timeGridDay'

      },

      events: events,

      eventClick: function(info) {

        const e = info.event.extendedProps;

        alert(`
Course:
${e.course || ""}

Assessment:
${e.assessment_details || ""}

Type:
${e.type || ""}

Weight:
${e.weight || ""}

Room:
${e.main_class_location || ""}

Format:
${e.format || ""}

Notes:
${e.notes || ""}
        `);

      }

    }
  );

  calendar.render();

}


// ====================================
// FILTERS
// ====================================

function populateTypeFilter(data) {

  const filter =
    document.getElementById("typeFilter");

  const values = [

    ...new Set(
      data.map(d => d.type).filter(Boolean)
    )

  ];

  values.forEach(v => {

    const opt =
      document.createElement("option");

    opt.value = v;

    opt.textContent = v;

    filter.appendChild(opt);

  });

  filter.addEventListener("change", applyFilters);

  document
    .getElementById("searchInput")
    .addEventListener("input", applyFilters);

}


// ====================================
// APPLY FILTERS
// ====================================

function applyFilters() {

  const type =
    document
      .getElementById("typeFilter")
      .value
      .toLowerCase();

  const search =
    document
      .getElementById("searchInput")
      .value
      .toLowerCase();

  const filtered = allEvents.filter(e => {

    const props = e.extendedProps;

    const matchType =

      !type ||

      (props.type || "")
        .toLowerCase()
        .includes(type);

    const matchSearch =

      JSON.stringify(props)
        .toLowerCase()
        .includes(search);

    return matchType && matchSearch;

  });

  calendar.removeAllEvents();

  calendar.addEventSource(filtered);

}