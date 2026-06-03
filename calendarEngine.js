// calendarEngine.js — Calendar Rendering & Event Layout Engine

const CalendarEngine = (() => {

  // ── Color palette per course ──────────────────────────────────────────────
  const PALETTE = [
    '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
    '#06B6D4','#EC4899','#84CC16','#F97316','#6366F1',
    '#14B8A6','#F43F5E','#A855F7','#0EA5E9','#22C55E',
  ];
  const _courseColors = {};
  let   _colorIndex   = 0;

  function getCourseColor(courseId) {
    if (!_courseColors[courseId]) {
      _courseColors[courseId] = PALETTE[_colorIndex % PALETTE.length];
      _colorIndex++;
    }
    return _courseColors[courseId];
  }

  function getCourseColorMap(data) {
    const ids = [...new Set(data.map(a => a.course))].sort();
    ids.forEach(id => getCourseColor(id));
    return { ..._courseColors };
  }

  // ── Month View ────────────────────────────────────────────────────────────
  function buildMonthGrid(year, month) {
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7; // Mon=0
    const cells    = [];

    for (let i = 0; i < startDow; i++) {
      const d = new Date(year, month, 1 - (startDow - i));
      cells.push({ date: d, current: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      cells.push({ date: new Date(year, month, d), current: true });
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      cells.push({ date: new Date(last.getTime() + 86400000), current: false });
    }
    return cells;
  }

  function getEventsForDate(data, date) {
    const key = date.toISOString().slice(0,10);
    return data.filter(a => {
      if (!a.effectiveDate) return false;
      return a.effectiveDate.toISOString().slice(0,10) === key;
    });
  }

  // ── Week View ─────────────────────────────────────────────────────────────
  function buildWeekDays(refDate) {
    const d   = new Date(refDate);
    const dow = (d.getDay() + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
  }

  // ── Navigation helpers ────────────────────────────────────────────────────
  function prevMonth(date) { return new Date(date.getFullYear(), date.getMonth() - 1, 1); }
  function nextMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 1); }
  function prevWeek(date)  { const d = new Date(date); d.setDate(d.getDate()-7); return d; }
  function nextWeek(date)  { const d = new Date(date); d.setDate(d.getDate()+7); return d; }

  function monthLabel(date) {
    return date.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  }
  function weekLabel(days) {
    if (!days.length) return '';
    const s = days[0].toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    const e = days[6].toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${s} – ${e}`;
  }

  function isToday(date) {
    const t = new Date();
    return date.getFullYear() === t.getFullYear() &&
           date.getMonth()    === t.getMonth()    &&
           date.getDate()     === t.getDate();
  }

  return {
    getCourseColor, getCourseColorMap,
    buildMonthGrid, getEventsForDate,
    buildWeekDays,
    prevMonth, nextMonth, prevWeek, nextWeek,
    monthLabel, weekLabel, isToday,
  };
})();

window.CalendarEngine = CalendarEngine;