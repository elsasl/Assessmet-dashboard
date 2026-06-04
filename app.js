// app.js — Assessment Calendar Dashboard
// Architecture: Calendar + Risk Panel (main) | Overview | Analytics | Data Table (secondary tabs)

(async function () {
  'use strict';

  // ── Module-level state ────────────────────────────────────────────────────
  let _riskYear          = 'all';
  let _highlightedRiskId = null;
  let _dtSortCol         = 'effectiveDate';
  let _dtSortDir         = 'asc';
  let _ovYear            = 'all';
  let _ovMonth           = 'all';
  let _ovType            = 'all';
  let _afCycle           = 'all';
  let _afTerm            = 'all';
  let _csYear            = 'all';
  let _csCourse          = 'all';

  // ── Load CSV ─────────────────────────────────────────────────────────────
  let rawData;
  try {
    const res = await fetch('./data.csv');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawData = await DataParser.loadFromText(await res.text());
    console.info(`[AID] Loaded ${rawData.length} assessments`);
  } catch (err) {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#1E3A5F;color:#EBF1FA;flex-direction:column;gap:16px;padding:32px;text-align:center">
      <div style="font-size:48px">📋</div>
      <h2>Could not load data.csv</h2>
      <p style="color:#90AECB;max-width:400px">${err.message}<br><br>Make sure data.csv is in the same folder and you are using Live Server.</p></div>`;
    return;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  StateManager.loadPreferences();
  applyDarkMode(StateManager.get('darkMode'));

  const colorMap = CalendarEngine.getCourseColorMap(rawData);
  StateManager.set('assessments', rawData);
  await DataService.setData(rawData);
  recomputeRisks(rawData);
  populateFilterDropdowns(rawData);
  StateManager.set('activeTab', null);  // start on calendar+risk view
  applyFiltersAndRender();

  // ── State listeners ───────────────────────────────────────────────────────
  StateManager.on('state:filters',      () => applyFiltersAndRender());
  StateManager.on('state:calendarDate', () => { renderCalendar(); renderRiskPanel(); });
  StateManager.on('state:calendarView', () => { renderCalendar(); renderRiskPanel(); });
  StateManager.on('state:darkMode',     ({ next }) => { applyDarkMode(next); StateManager.persistPreferences(); });

  setupUI();

  // ════════════════════════════════════════════════════════════════════════
  // CORE FILTER + RENDER
  // ════════════════════════════════════════════════════════════════════════
  function applyFiltersAndRender() {
    const all     = StateManager.get('assessments');
    const filters = StateManager.get('filters');
    let   data    = [...all];

    if (filters.year   !== 'all') data = data.filter(a => String(a.year)   === String(filters.year));
    if (filters.month  !== 'all') data = data.filter(a => a.effectiveDate && (a.effectiveDate.getMonth()+1) === parseInt(filters.month));
    if (filters.course !== 'all') data = data.filter(a => String(a.course) === String(filters.course));
    if (filters.type   !== 'all') data = data.filter(a => a.type           === filters.type);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      data = data.filter(a => a.courseName.toLowerCase().includes(q) || a.type.toLowerCase().includes(q) || a.details.toLowerCase().includes(q) || String(a.course).includes(q));
    }

    StateManager.set('filteredData', data);
    renderFilterBar(filters, data.length, all.length);

    // Main view always renders
    renderCalendar();
    renderRiskPanel();

    // Render current view
    const tab = StateManager.get('activeTab');
    renderTab(tab || null);
    // Always re-render overview if active (KPIs + upcoming must update with filters)
    if (tab === 'overview') renderOverview();
  }

  function recomputeRisks(data) {
    const seqs     = RiskDetector.detectRiskSequences(data);
    const insights = RiskDetector.generateInsights(data, seqs);
    StateManager.set('riskSequences', seqs);
    StateManager.set('insights', insights);
  }

  // ════════════════════════════════════════════════════════════════════════
  // TAB SYSTEM
  // ════════════════════════════════════════════════════════════════════════
  function renderTab(tab) {
    const mainView = document.getElementById('main-view');
    const panels   = document.querySelectorAll('.tab-panel');
    const backBtn  = document.getElementById('back-to-calendar');
    panels.forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.top-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    if (!tab) {
      if (mainView) mainView.style.display = 'grid';
      if (backBtn)  backBtn.classList.add('hidden');
      renderCalendar();
      renderRiskPanel();
      return;
    }

    if (mainView) mainView.style.display = 'none';
    if (backBtn)  backBtn.classList.remove('hidden');
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.add('active');

    if (tab === 'overview')  renderOverview();
    if (tab === 'analytics') renderAnalytics();
    if (tab === 'datatable') renderDataTable();
  }

  function switchTab(tab) {
    const current = StateManager.get('activeTab');
    if (current === tab) {
      // Clicking active tab → go back to main calendar view
      StateManager.set('activeTab', null);
      renderTab(null);
    } else {
      StateManager.set('activeTab', tab);
      renderTab(tab);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // RISK PANEL
  // ════════════════════════════════════════════════════════════════════════
  function renderRiskPanel() {
    const allSeqs   = StateManager.get('riskSequences') || [];
    const overlaps  = allSeqs.filter(s => s.alertType === 'same-day');
    const clusters  = allSeqs.filter(s => s.alertType === 'cluster');

    // Year filter buttons
    const yearEl = document.getElementById('risk-year-filter');
    if (yearEl) {
      const years = ['all', ...new Set(allSeqs.map(s => s.year || s.items?.[0]?.year).filter(Boolean)).values()].sort();
      yearEl.innerHTML = years.map(y =>
        `<button class="ry-btn ${y == _riskYear ? 'active' : ''}" data-year="${y}">
          ${y === 'all' ? 'All' : `Yr ${y}`}
        </button>`
      ).join('');
      yearEl.querySelectorAll('.ry-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _riskYear = btn.dataset.year;
          renderRiskPanel();
        });
      });
    }

    const filteredOverlaps = _riskYear === 'all' ? overlaps : overlaps.filter(s => String(s.year) === String(_riskYear));
    const filteredClusters = _riskYear === 'all' ? clusters : clusters.filter(s => String(s.year) === String(_riskYear));

    const body = document.getElementById('risk-panel-body');
    if (!body) return;

    if (!filteredOverlaps.length && !filteredClusters.length) {
      body.innerHTML = '<div class="rp-empty">✅ No risk alerts for this selection</div>';
      return;
    }

    let html = '';

    // Same-Day Overlaps section
    if (filteredOverlaps.length) {
      html += `<div class="rp-section">
        <div class="rp-section-header" data-section="overlaps">
          <span class="rp-section-title rp-title-overlap">
            <span class="rp-title-icon">📅</span>
            Same-Day Overlaps
            <span class="rp-section-count rp-count-overlap">${filteredOverlaps.length}</span>
          </span>
          <span class="rp-section-toggle">▾</span>
        </div>
        <div class="rp-items" id="rp-overlaps">`;
      filteredOverlaps.forEach(seq => {
        const isHighlighted = seq.id === _highlightedRiskId;
        const courseNums    = [...new Set(seq.items.map(a => a.course))];
        html += `<div class="rp-item rp-item-overlap ${isHighlighted ? 'highlighted' : ''}" data-rid="${seq.id}">
          <div class="rp-item-date-row">
            <span class="rp-item-date">${formatDShort(seq.startDate)}</span>
            <span class="rp-item-year-pill" style="background:${colorForYear(seq.year)}">Yr ${seq.year||'?'}</span>
          </div>
          <div class="rp-item-chips">
            ${courseNums.map(cn => `<span class="rp-chip" style="border-color:${colorMap[cn]||'#1A3A6B'};background:${colorMap[cn]||'#1A3A6B'}18">${cn}</span>`).join('')}
          </div>
        </div>`;
      });
      html += '</div></div>';
    }

    // Back-to-Back Days section
    if (filteredClusters.length) {
      html += `<div class="rp-section">
        <div class="rp-section-header" data-section="clusters">
          <span class="rp-section-title rp-title-cluster">
            <span class="rp-title-icon">📆</span>
            Back-to-Back Days
            <span class="rp-section-count rp-count-cluster">${filteredClusters.length}</span>
          </span>
          <span class="rp-section-toggle">▾</span>
        </div>
        <div class="rp-items" id="rp-clusters">`;
      filteredClusters.forEach(seq => {
        const isHighlighted = seq.id === _highlightedRiskId;
        const courseNums    = [...new Set(seq.items.map(a => a.course))];
        const clDays = seq.dayGroups
          ? seq.dayGroups.map(d => d.date.toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'})).join(' · ')
          : `${formatDShort(seq.startDate)} – ${formatDShort(seq.endDate)}`;
        html += `<div class="rp-item rp-item-cluster ${isHighlighted ? 'highlighted' : ''}" data-rid="${seq.id}">
          <div class="rp-item-date-row">
            <span class="rp-item-date">${formatDShort(seq.startDate)} – ${formatDShort(seq.endDate)}</span>
            <span class="rp-item-year-pill" style="background:${colorForYear(seq.year)}">Yr ${seq.year||'?'}</span>
          </div>
          <div class="rp-item-days">${clDays}</div>
          <div class="rp-item-chips">
            ${courseNums.slice(0,4).map(cn => `<span class="rp-chip" style="border-color:${colorMap[cn]||'#1A3A6B'};background:${colorMap[cn]||'#1A3A6B'}18">${cn}</span>`).join('')}
            ${courseNums.length > 4 ? `<span class="rp-chip rp-chip-more">+${courseNums.length-4}</span>` : ''}
          </div>
        </div>`;
      });
      html += '</div></div>';
    }

    body.innerHTML = html;

    // Wire clicks — filter calendar to only this alert's assessments
    body.querySelectorAll('.rp-item').forEach(item => {
      item.addEventListener('click', () => {
        const rid = item.dataset.rid;
        const seq = allSeqs.find(s => s.id === rid);
        if (!seq) return;

        _highlightedRiskId = rid;

        // Filter calendar to show only this alert's assessments
        StateManager.set('filteredData', seq.items);
        StateManager.set('calendarDate', new Date(seq.startDate));
        StateManager.set('calendarView', seq.alertType === 'same-day' ? 'week' : 'month');

        // Show "Show All" banner
        showAlertFilterBanner(seq);

        // Switch to main view if on a tab
        if (StateManager.get('activeTab')) {
          StateManager.set('activeTab', null);
          renderTab(null);
        }
        renderRiskPanel();
        renderCalendar();
      });
    });

    // Section collapse toggles
    body.querySelectorAll('.rp-section-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const section = hdr.dataset.section;
        const items   = document.getElementById(`rp-${section}`);
        const toggle  = hdr.querySelector('.rp-section-toggle');
        if (items) {
          const isHidden = items.style.display === 'none';
          items.style.display = isHidden ? '' : 'none';
          toggle.textContent  = isHidden ? '▾' : '▸';
        }
      });
    });
  }

  function colorForYear(year) {
    const map = { '1': '#1A3A6B', '2': '#0E7490', '3': '#166534' };
    return map[String(year)] || '#6B7280';
  }

  // ════════════════════════════════════════════════════════════════════════
  // CALENDAR
  // ════════════════════════════════════════════════════════════════════════
  function renderCalendar() {
    const view = StateManager.get('calendarView');
    const date = StateManager.get('calendarDate');
    const data = StateManager.get('filteredData');
    const el   = document.getElementById('calendar-body');
    if (!el) return;

    const label = view === 'month' ? CalendarEngine.monthLabel(date) : CalendarEngine.weekLabel(CalendarEngine.buildWeekDays(date));
    document.getElementById('cal-label').textContent = label;

    // Build set of risk dates for highlighting
    const riskDates = new Set();
    if (_highlightedRiskId) {
      const seq = (StateManager.get('riskSequences') || []).find(s => s.id === _highlightedRiskId);
      if (seq) seq.items.forEach(a => { if (a.effectiveDate) riskDates.add(a.effectiveDate.toISOString().slice(0,10)); });
    }

    if (view === 'month') renderMonthView(el, date, data, riskDates);
    else                   renderWeekView(el, date, data, riskDates);
  }

  function renderMonthView(container, date, data, riskDates) {
    const cells = CalendarEngine.buildMonthGrid(date.getFullYear(), date.getMonth());
    const days  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let html = `<div class="cal-month">
      <div class="cal-dow-header">${days.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid">`;

    cells.forEach(cell => {
      const dateKey   = cell.date.toISOString().slice(0,10);
      const events    = CalendarEngine.getEventsForDate(data, cell.date);
      const isToday   = CalendarEngine.isToday(cell.date);
      const isRisk    = riskDates.has(dateKey);
      const cls       = ['cal-cell', !cell.current && 'cal-other', isToday && 'cal-today', isRisk && 'risk-day'].filter(Boolean).join(' ');

      html += `<div class="${cls}">
        <div class="cal-date-num">${isToday ? `<span class="today-dot">${cell.date.getDate()}</span>` : cell.date.getDate()}</div>
        <div class="cal-events">`;
      events.slice(0,3).forEach(ev => {
        const color = colorMap[ev.course] || '#1A3A6B';
        html += `<div class="cal-event" style="background:${color}18;border-left:2px solid ${color}" data-id="${ev._id}">
          <span class="cal-event-dot" style="background:${color}"></span>
          <span class="cal-event-text">${ev.course} · ${ev.type}${ev.weight ? ' '+ev.weight+'%' : ''}</span>
        </div>`;
      });
      if (events.length > 3) html += `<div class="cal-more">+${events.length-3} more</div>`;
      html += `</div></div>`;
    });

    html += '</div></div>';
    container.innerHTML = html;
    container.querySelectorAll('.cal-event').forEach(ev => {
      ev.addEventListener('click', e => { e.stopPropagation(); openAssessmentModal(ev.dataset.id); });
    });
  }

  function renderWeekView(container, date, data, riskDates) {
    const days = CalendarEngine.buildWeekDays(date);
    const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    let html = `<div class="cal-week">
      <div class="cal-week-header">`;
    days.forEach((d,i) => {
      const isToday = CalendarEngine.isToday(d);
      const isRisk  = riskDates.has(d.toISOString().slice(0,10));
      html += `<div class="cal-week-day-head ${isToday?'today-head':''} ${isRisk?'risk-day':''}">
        <div class="week-dow">${DAYS[i]}</div>
        <div class="week-date ${isToday?'today-dot':''}">${d.getDate()}</div>
      </div>`;
    });
    html += '</div><div class="cal-week-body">';
    days.forEach(d => {
      const events  = CalendarEngine.getEventsForDate(data, d);
      const isToday = CalendarEngine.isToday(d);
      const isRisk  = riskDates.has(d.toISOString().slice(0,10));
      html += `<div class="cal-week-col ${isToday?'today-col':''} ${isRisk?'risk-day':''}">`;
      events.forEach(ev => {
        const color = colorMap[ev.course] || '#1A3A6B';
        html += `<div class="cal-week-event" style="background:${color}18;border-left:3px solid ${color}" data-id="${ev._id}">
          <div class="wev-course-num" style="color:${color}">${ev.course}</div>
          <div class="wev-type" style="color:${color}">${ev.type}</div>
          <div class="wev-course">${ev.courseName.split(' ').slice(0,3).join(' ')}</div>
          ${ev.weight ? `<div class="wev-weight" style="color:${color}">${ev.weight}%</div>` : ''}
          ${ev.startTime && ev.startTime !== 'N/A' ? `<div class="wev-time">${ev.startTime.slice(0,5)}</div>` : ''}
        </div>`;
      });
      if (!events.length) html += `<div style="min-height:20px"></div>`;
      html += '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
    container.querySelectorAll('.cal-week-event').forEach(ev => {
      ev.addEventListener('click', () => openAssessmentModal(ev.dataset.id));
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // OVERVIEW TAB
  // ════════════════════════════════════════════════════════════════════════
  // Overview has independent filters — not affected by calendar/other tab filters
  function getOverviewData() {
    // Overview uses the sidebar filters (same as calendar) for consistency
    return StateManager.get('filteredData');
  }

  function renderOverview() {
    const data = getOverviewData();
    const kpis = AnalyticsEngine.getKPIs(data);
    const seqs = StateManager.get('riskSequences') || [];

    // ROW 1 — KPI cards
    const kpiEl = document.getElementById('kpi-grid');
    if (kpiEl) kpiEl.innerHTML = [
      ['Total',        kpis.total,             'blue'],
      ['Quizzes',      kpis.quizzes,           'teal'],
      ['Midterms',     kpis.midterms,          'amber'],
      ['Finals',       kpis.finals,            'red'],
      ['Assignments',  kpis.assignments,       'purple'],
      ['Labs & OSCEs', kpis.labs+kpis.osces,  'green'],
      ['Courses',      kpis.courses,           'indigo'],
      ['Avg Weight',   kpis.avgWeight+'%',     'pink'],
    ].map(([label,val,color]) => `<div class="kpi-card kpi-${color}">
      <div class="kpi-value">${val}</div>
      <div class="kpi-label">${label}</div>
    </div>`).join('');

    // ROW 2 — Charts
    renderMonthlyChart(data);
    renderOverviewHeatmap(data);

    // ROW 3 — Upcoming
    renderUpcoming();

    renderHeaderStats(data.length, StateManager.get('assessments').length, seqs);
  }

  // ── Overview heatmap (compact version of analytics heatmap) ─────────────
  function renderOverviewHeatmap(data) {
    const el = document.getElementById('ov-heatmap');
    if (!el) return;
    const weeks = AnalyticsEngine.getByWeek(data);
    if (!weeks.length) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }
    const max = Math.max(...weeks.map(w => w.count), 1);
    function shade(n) {
      const t = n / max;
      if (t === 0)  return { bg: '#EEF0F4', text: '#9AA0AE' };
      if (t < .25)  return { bg: '#C7D9F0', text: '#1A3A6B' };
      if (t < .50)  return { bg: '#7AAED6', text: '#0F2040' };
      if (t < .75)  return { bg: '#2E6FAF', text: '#fff' };
                    return { bg: '#1A3A6B', text: '#fff' };
    }
    el.innerHTML = `<div class="ov-heatmap-grid">${weeks.map(w => {
      const s   = shade(w.count);
      const lbl = new Date(w.week + 'T12:00:00').toLocaleDateString('en-CA', { month:'short', day:'numeric' });
      return `<div class="ov-heatmap-cell" style="background:${s.bg}" title="${lbl}: ${w.count} assessments" data-week="${w.week}">
        <span style="font-size:12px;font-weight:700;color:${s.text}">${w.count}</span>
        <span style="font-size:9px;color:${s.text};opacity:.8">${lbl}</span>
      </div>`;
    }).join('')}</div>
    <div class="heatmap-legend" style="margin-top:8px">
      <span style="font-size:11px;color:var(--text-3)">Fewer</span>
      <div class="hm-legend-scale">${['#EEF0F4','#C7D9F0','#7AAED6','#2E6FAF','#1A3A6B'].map(bg =>
        `<div class="hm-legend-swatch" style="background:${bg}"></div>`).join('')}
      </div>
      <span style="font-size:11px;color:var(--text-3)">More</span>
    </div>`;
    el.querySelectorAll('.ov-heatmap-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const w = weeks.find(x => x.week === cell.dataset.week);
        if (w) {
          StateManager.set('filteredData', w.assessments);
          StateManager.set('calendarDate', new Date(w.week + 'T12:00:00'));
          StateManager.set('calendarView', 'week');
          StateManager.set('activeTab', null);
          renderTab(null);
        }
      });
    });
  }

  // ── Upcoming assessments ────────────────────────────────────────────────
  // If filters active → show filtered data sorted by date
  // If no filters → show next 14 days from today (or nearest future assessments)
  function renderUpcoming() {
    const el = document.getElementById('ov-upcoming');
    if (!el) return;

    const filters    = StateManager.get('filters');
    const hasFilters = filters.year !== 'all' || filters.month !== 'all' ||
                       filters.course !== 'all' || filters.type !== 'all' || filters.search;

    let upcoming;

    if (hasFilters) {
      // Show filtered assessments sorted by date (limit 20 for readability)
      upcoming = StateManager.get('filteredData')
        .filter(a => a.effectiveDate)
        .sort((a,b) => a.effectiveDate - b.effectiveDate)
        .slice(0, 20);
    } else {
      // No filters — show next 14 days from today
      const all   = StateManager.get('assessments');
      const today = new Date(); today.setHours(0,0,0,0);
      const end   = new Date(today); end.setDate(end.getDate() + 14);
      upcoming = all
        .filter(a => a.effectiveDate && a.effectiveDate >= today && a.effectiveDate <= end)
        .sort((a,b) => a.effectiveDate - b.effectiveDate);

      // If nothing in next 14 days (e.g. historical data), show next 10 assessments
      if (!upcoming.length) {
        upcoming = all
          .filter(a => a.effectiveDate)
          .sort((a,b) => a.effectiveDate - b.effectiveDate)
          .slice(0, 10);
      }
    }

    if (!upcoming.length) {
      el.innerHTML = `<div class="ov-upcoming-empty">
        <span style="font-size:22px">📭</span>
        <span>No assessments found for this selection</span>
      </div>`;
      return;
    }

    const todayStr    = today.toISOString().slice(0,10);
    const tomorrowStr = new Date(today.getTime()+86400000).toISOString().slice(0,10);

    function urgencyBadge(date) {
      const diffDays = Math.round((date - today) / 86400000);
      if (diffDays === 0) return { label: 'Today',     cls: 'urg-today' };
      if (diffDays === 1) return { label: 'Tomorrow',  cls: 'urg-tomorrow' };
      if (diffDays <= 7)  return { label: `In ${diffDays}d`, cls: 'urg-week' };
      return                     { label: `In ${diffDays}d`, cls: 'urg-later' };
    }

    const filters2    = StateManager.get('filters');
    const hasFilters2 = filters2.year !== 'all' || filters2.month !== 'all' ||
                        filters2.course !== 'all' || filters2.type !== 'all' || filters2.search;
    const tableTitle  = hasFilters2 ? `${upcoming.length} assessments matching filters` : `Next assessments from today`;
    const hintEl = document.getElementById('ov-upcoming-hint');
    if (hintEl) hintEl.textContent = hasFilters2 ? 'Showing filtered results · click row to view details' : 'Next 14 days · click row to view details';

    el.innerHTML = `<div class="ov-upcoming-subtitle">${tableTitle}</div>
    <table class="ov-upcoming-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Due In</th>
          <th>Course</th>
          <th>Assessment</th>
          <th>Type</th>
          <th style="text-align:right">Weight</th>
        </tr>
      </thead>
      <tbody>
        ${upcoming.map(a => {
          const color  = colorMap[a.course] || '#1A3A6B';
          const urg    = urgencyBadge(a.effectiveDate);
          return `<tr class="ov-upcoming-row" data-id="${a._id}">
            <td class="ov-up-date">${a.effectiveDate.toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'})}</td>
            <td><span class="ov-urg ${urg.cls}">${urg.label}</span></td>
            <td>
              <span class="ov-course-badge" style="background:${color}">${a.course}</span>
              <span class="ov-course-name">${a.courseName}</span>
            </td>
            <td class="ov-up-detail">${a.details || '—'}</td>
            <td><span class="ov-type-chip" style="color:${color};background:${color}18">${a.type}</span></td>
            <td class="ov-up-weight">${a.weightRaw || '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

    el.querySelectorAll('.ov-upcoming-row').forEach(row => {
      row.addEventListener('click', () => openAssessmentModal(row.dataset.id));
    });
  }

  function renderMonthlyChart(data) {
    const monthly = AnalyticsEngine.getByMonth(data);
    const canvas  = document.getElementById('monthly-chart');
    if (!canvas) return;
    if (window._monthlyChart) window._monthlyChart.destroy();
    const isDark = document.documentElement.classList.contains('dark');
    const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const lc = isDark ? '#7A95B0' : '#6B7280';
    window._monthlyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: monthly.map(m=>m.month.slice(0,3)),
        datasets: [{
          label: 'Assessments',
          data: monthly.map(m=>m.count),
          backgroundColor: isDark ? 'rgba(74,111,165,0.7)' : 'rgba(26,58,107,0.35)',
          borderColor:     isDark ? 'rgba(74,111,165,1)'   : 'rgba(26,58,107,0.8)',
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: lc, font: { size: 12 } }, border: { display: false } },
          y: { grid: { color: gc }, ticks: { color: lc, stepSize: 5 }, border: { display: false }, beginAtZero: true },
        },
      }
    });
  }

  function renderRiskCounters(seqs) {
    const el = document.getElementById('risk-counters');
    if (!el) return;
    const overlaps = seqs.filter(s => s.alertType === 'same-day');
    const clusters = seqs.filter(s => s.alertType === 'cluster');
    const critical = clusters.filter(s => s.severity === 'critical' || s.severity === 'high');
    el.innerHTML = `
      <div class="rc-grid">
        <div class="rc-stat">
          <div class="rc-stat-num" style="color:#B45309">${overlaps.length}</div>
          <div class="rc-stat-lbl">Same-Day Overlaps</div>
        </div>
        <div class="rc-stat">
          <div class="rc-stat-num" style="color:#B91C1C">${clusters.length}</div>
          <div class="rc-stat-lbl">Back-to-Back Streaks</div>
        </div>
        <div class="rc-stat">
          <div class="rc-stat-num" style="color:#6D28D9">${critical.length}</div>
          <div class="rc-stat-lbl">High / Critical</div>
        </div>
      </div>
      ${seqs.length
        ? `<button class="rc-cal-btn" id="rc-cal-btn">View in Calendar →</button>`
        : `<div class="rc-ok">✅ No risk alerts detected</div>`
      }`;
    document.getElementById('rc-cal-btn')?.addEventListener('click', () => {
      StateManager.set('activeTab', null);
      renderTab(null);
    });
  }

  function renderRiskPreview(seqs) {
    const el  = document.getElementById('risk-preview');
    if (!el) return;
    const top = seqs.slice(0, 6);
    if (!top.length) { el.innerHTML = '<div class="empty-state">No risk alerts detected</div>'; return; }
    el.innerHTML = `<table class="rp-table">
      <thead><tr><th>Type</th><th>Date / Period</th><th>Year</th><th>Courses</th><th>Assessments</th><th>Combined Weight</th><th></th></tr></thead>
      <tbody>${top.map(seq => {
        const isOv   = seq.alertType === 'same-day';
        const tc     = isOv ? '#B45309' : '#B91C1C';
        const tbg    = isOv ? '#FFFBEB' : '#FEF2F2';
        const tbd    = isOv ? '#FDE68A' : '#FECACA';
        const tag    = isOv ? 'Same-Day' : 'Back-to-Back';
        const date   = isOv ? formatD(seq.startDate) : `${formatDShort(seq.startDate)} → ${formatDShort(seq.endDate)}`;
        const wc     = seq.totalWeight >= 80 ? '#B91C1C' : seq.totalWeight >= 50 ? '#B45309' : 'var(--text-2)';
        const cNums  = [...new Set(seq.items.map(a => a.course))];
        return `<tr class="rp-row">
          <td><span class="rp-tag" style="color:${tc};background:${tbg};border-color:${tbd}">${tag}</span></td>
          <td class="rp-date">${date}</td>
          <td class="rp-year">${seq.year||seq.items[0]?.year||'—'}</td>
          <td><div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:2px">${cNums.map(cn=>`<span class="rp-course-badge" style="background:${colorMap[cn]||'#1A3A6B'}">${cn}</span>`).join('')}</div>
              <span class="rp-course-names">${seq.courses.slice(0,2).join(', ')}${seq.courses.length>2?` +${seq.courses.length-2}`:''}</span></td>
          <td class="rp-count">${seq.items.length}</td>
          <td class="rp-weight" style="color:${wc}">${seq.totalWeight.toFixed(0)}%</td>
          <td><button class="rp-goto" data-rid="${seq.id}">View →</button></td>
        </tr>`;
      }).join('')}</tbody></table>`;

    el.querySelectorAll('.rp-goto').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const seq = seqs.find(s => s.id === btn.dataset.rid);
        if (!seq) return;
        _highlightedRiskId = seq.id;
        StateManager.set('calendarDate', new Date(seq.startDate));
        StateManager.set('calendarView', seq.alertType === 'same-day' ? 'week' : 'month');
        StateManager.set('activeTab', null);
        renderTab(null);
        renderRiskPanel();
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ANALYTICS TAB
  // ════════════════════════════════════════════════════════════════════════
  function renderAnalytics() {
    const data = StateManager.get('assessments'); // always full data
    renderWeeklyWorkload(data);
    renderTypeDistribution(data);
    renderAvgWeightByType(data);
    renderWeeklyHeatmap(data);
    renderOverlapAnalysis(data);
    renderCourseBreakdown(data);
  }

  function renderWeeklyWorkload(data) {
    const weeks  = AnalyticsEngine.getByWeek(data);
    const canvas = document.getElementById('weekly-chart');
    if (!canvas) return;
    if (window._weeklyChart) window._weeklyChart.destroy();
    const isDark = document.documentElement.classList.contains('dark');
    const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const lc = isDark ? '#7A95B0' : '#6B7280';
    window._weeklyChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: weeks.map(w=>w.week.slice(5)), datasets: [
        { label:'Count', data:weeks.map(w=>w.count), backgroundColor:'#1A3A6B22', borderColor:'#1A3A6B', borderWidth:2, borderRadius:3, yAxisID:'y' },
        { label:'Weight %', data:weeks.map(w=>parseFloat(w.totalWeight.toFixed(1))), type:'line', borderColor:'#B45309', backgroundColor:'#B4530920', tension:.4, fill:true, yAxisID:'y1', pointRadius:3 },
      ]},
      options: { responsive:true, maintainAspectRatio:false,
        plugins: { legend:{ labels:{color:lc} } },
        scales: {
          x: { grid:{color:gc}, ticks:{color:lc, maxTicksLimit:12} },
          y:  { grid:{color:gc}, ticks:{color:lc}, position:'left',  beginAtZero:true, title:{display:true,text:'Assessments',color:lc} },
          y1: { grid:{drawOnChartArea:false}, ticks:{color:'#B45309'}, position:'right', beginAtZero:true, title:{display:true,text:'Weight %',color:'#B45309'} },
        },
      },
    });
  }

  function renderTypeDistribution(data) {
    const types  = AnalyticsEngine.getTypeDistribution(data);
    const canvas = document.getElementById('type-chart');
    if (!canvas) return;
    if (window._typeChart) window._typeChart.destroy();
    const isDark = document.documentElement.classList.contains('dark');
    const lc = isDark ? '#7A95B0' : '#6B7280';
    const colors = ['#1A3A6B','#0E7490','#B45309','#B91C1C','#6D28D9','#166534','#9D174D','#3730A3','#0F766E'];
    window._typeChart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: types.map(t=>t.type), datasets: [{ data:types.map(t=>t.count), backgroundColor:colors.slice(0,types.length), borderWidth:2, borderColor: isDark?'#172438':'#fff' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{color:lc,padding:12,font:{size:11}} } } },
    });
  }

  function renderAvgWeightByType(data) {
    const canvas = document.getElementById('avg-weight-chart');
    if (!canvas) return;
    if (window._avgWeightChart) window._avgWeightChart.destroy();
    const byType = {};
    data.filter(a => a.weight !== null).forEach(a => { if (!byType[a.type]) byType[a.type]=[]; byType[a.type].push(a.weight); });
    const types = Object.entries(byType).map(([type,ws]) => ({ type, avg:ws.reduce((s,w)=>s+w,0)/ws.length, n:ws.length })).sort((a,b)=>b.avg-a.avg);
    const isDark = document.documentElement.classList.contains('dark');
    const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const lc = isDark ? '#7A95B0' : '#6B7280';
    window._avgWeightChart = new Chart(canvas, {
      type:'bar',
      data:{ labels:types.map(t=>t.type), datasets:[{ label:'Avg Weight %', data:types.map(t=>parseFloat(t.avg.toFixed(1))), backgroundColor:'#1A3A6B22', borderColor:'#1A3A6B', borderWidth:1.5, borderRadius:3, borderSkipped:false }] },
      options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=>` ${ctx.parsed.x.toFixed(1)}% avg (n=${types[ctx.dataIndex].n})` }} },
        scales:{ x:{grid:{color:gc},ticks:{color:lc},title:{display:true,text:'Average Weight (%)',color:lc,font:{size:11}}}, y:{grid:{color:gc},ticks:{color:lc,font:{size:11}}} },
      },
    });
  }

  function renderWeeklyHeatmap(data) {
    const el = document.getElementById('heatmap-container');
    if (!el) return;
    const weeks = AnalyticsEngine.getByWeek(data);
    if (!weeks.length) { el.innerHTML='<div class="empty-state">No dated assessments</div>'; return; }
    const max = Math.max(...weeks.map(w=>w.count),1);
    function shade(n) {
      const t = n/max;
      if (t===0)  return {bg:'#EEF0F4',text:'#9AA0AE'};
      if (t<.25)  return {bg:'#C7D9F0',text:'#1A3A6B'};
      if (t<.50)  return {bg:'#7AAED6',text:'#0F2040'};
      if (t<.75)  return {bg:'#2E6FAF',text:'#fff'};
                  return {bg:'#1A3A6B',text:'#fff'};
    }
    el.innerHTML = `<div class="heatmap-grid">${weeks.map(w => {
      const s = shade(w.count);
      const lbl = new Date(w.week+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric'});
      return `<div class="heatmap-cell" style="background:${s.bg}" title="${lbl}: ${w.count}" data-week="${w.week}">
        <span class="hm-count" style="color:${s.text}">${w.count}</span>
        <span class="hm-week"  style="color:${s.text};opacity:.75">${lbl}</span>
      </div>`;
    }).join('')}</div>
    <div class="heatmap-legend"><span>Fewer</span><div class="hm-legend-scale">${['#EEF0F4','#C7D9F0','#7AAED6','#2E6FAF','#1A3A6B'].map(bg=>`<div class="hm-legend-swatch" style="background:${bg}"></div>`).join('')}</div><span>More</span></div>`;
    el.querySelectorAll('.heatmap-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const w = weeks.find(x=>x.week===cell.dataset.week);
        if (w) { StateManager.set('filteredData', w.assessments); StateManager.set('calendarDate', new Date(w.week+'T12:00:00')); StateManager.set('calendarView','week'); StateManager.set('activeTab',null); renderTab(null); }
      });
    });
  }

  function renderOverlapAnalysis(data) {
    const overlaps = AnalyticsEngine.getOverlapDays(data);
    const el       = document.getElementById('overlap-list');
    if (!el) return;
    if (!overlaps.length) { el.innerHTML='<div class="empty-state">No same-day overlaps</div>'; return; }
    el.innerHTML = overlaps.slice(0,10).map(o => {
      const d   = new Date(o.date+'T12:00:00');
      const lbl = d.toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
      return `<div class="overlap-row" data-date="${o.date}">
        <div class="overlap-date">${lbl}${o.year?` · Yr${o.year}`:''}</div>
        <div class="overlap-bar-wrap"><div class="overlap-bar" style="width:${Math.min(100,o.count*25)}%"></div></div>
        <div class="overlap-count">${o.count} assessments</div>
      </div>`;
    }).join('');
    el.querySelectorAll('.overlap-row').forEach(row => {
      row.addEventListener('click', () => {
        StateManager.set('calendarDate', new Date(row.dataset.date+'T12:00:00'));
        StateManager.set('calendarView','week');
        StateManager.set('activeTab', null);
        renderTab(null);
      });
    });
  }

  // ── Analytics filter state ───────────────────────────────────────────────
  function getAnalyticsData() {
    let data = StateManager.get('assessments');
    if (_afCycle !== 'all') {
      // Academic cycle: "2025-2026" means year column 1/2/3 doesn't filter — filter by date range
      const [startYr, endYr] = _afCycle.split('-').map(Number);
      data = data.filter(a => {
        if (!a.effectiveDate) return false;
        const yr = a.effectiveDate.getFullYear();
        const mo = a.effectiveDate.getMonth(); // 0=Jan
        // Academic year: Aug of startYr to Jul of endYr
        return (yr === startYr && mo >= 7) || (yr === endYr && mo <= 6);
      });
    }
    if (_afTerm !== 'all') {
      data = data.filter(a => a.term === _afTerm);
    }
    return data;
  }

  function setupAnalyticsFilters() {
    // Build cycle buttons from data
    const all = StateManager.get('assessments');
    const cycleEl = document.getElementById('af-cycle');
    if (!cycleEl || cycleEl.dataset.built === '1') return;

    // Detect academic years from data dates
    const years = new Set();
    all.filter(a => a.effectiveDate).forEach(a => {
      const yr = a.effectiveDate.getFullYear();
      const mo = a.effectiveDate.getMonth();
      const acYear = mo >= 7 ? yr : yr - 1;
      years.add(acYear);
    });

    const cycles = ['all', ...[...years].sort().map(y => `${y}-${y+1}`)];
    cycleEl.innerHTML = cycles.map(cy =>
      `<button class="af-btn ${cy === _afCycle ? 'active' : ''}" data-cycle="${cy}">
        ${cy === 'all' ? 'All Cycles' : cy}
      </button>`
    ).join('');
    cycleEl.dataset.built = '1';

    cycleEl.querySelectorAll('.af-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _afCycle = btn.dataset.cycle;
        cycleEl.querySelectorAll('.af-btn').forEach(b => b.classList.toggle('active', b.dataset.cycle === _afCycle));
        refreshAnalytics();
      });
    });

    // Term buttons
    document.querySelectorAll('[data-term]').forEach(btn => {
      btn.addEventListener('click', () => {
        _afTerm = btn.dataset.term;
        document.querySelectorAll('[data-term]').forEach(b => b.classList.toggle('active', b.dataset.term === _afTerm));
        refreshAnalytics();
      });
    });
  }

  function refreshAnalytics() {
    const data = getAnalyticsData();
    renderWeeklyWorkload(data);
    renderTypeDistribution(data);
    renderAvgWeightByType(data);
    renderWeeklyHeatmap(data);
    renderOverlapAnalysis(data);
    renderMonthlyWeeklyTable(data);
    renderCourseSummary(data);
    setupDownloadButtons(data);
  }

  function renderAnalytics() {
    setupAnalyticsFilters();
    const data = getAnalyticsData();
    renderWeeklyWorkload(data);
    renderTypeDistribution(data);
    renderAvgWeightByType(data);
    renderWeeklyHeatmap(data);
    renderOverlapAnalysis(data);
    renderMonthlyWeeklyTable(data);
    renderCourseSummary(data);
    setupDownloadButtons(data);
    setupCourseSummaryFilters(data);
  }

  // ── Monthly/Weekly table ────────────────────────────────────────────────
  function renderMonthlyWeeklyTable(data) {
    const el = document.getElementById('monthly-weekly-table');
    if (!el) return;
    const monthly = AnalyticsEngine.getByMonth(data);
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    el.innerHTML = `<table class="cs-table">
      <thead><tr><th>Month</th><th style="text-align:center"># Assessments</th><th style="text-align:center">Avg Weight %</th></tr></thead>
      <tbody>${monthly.map(m => {
        const items   = data.filter(a => a.effectiveDate && MONTHS[a.effectiveDate.getMonth()] === m.month);
        const weights = items.filter(a => a.weight).map(a => a.weight);
        const avg     = weights.length ? (weights.reduce((s,w)=>s+w,0)/weights.length).toFixed(1) : '—';
        return `<tr>
          <td class="cs-td-label">${m.month}</td>
          <td class="cs-td-num" style="text-align:center">${m.count}</td>
          <td class="cs-td-num" style="text-align:center">${avg !== '—' ? avg+'%' : '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  // ── Course Summary ───────────────────────────────────────────────────────
  function setupCourseSummaryFilters(data) {
    const yearEl   = document.getElementById('cs-filter-year');
    const courseEl = document.getElementById('cs-filter-course');
    if (!yearEl || !courseEl) return;

    // Populate year options once
    if (yearEl.dataset.populated !== '1') {
      [...new Set(data.map(a => a.year))].sort().forEach(y => {
        const o = document.createElement('option'); o.value=y; o.textContent=`Year ${y}`; yearEl.appendChild(o);
      });
      yearEl.dataset.populated = '1';
    }
    if (courseEl.dataset.populated !== '1') {
      [...new Map(data.map(a=>[a.course,a.courseName])).entries()].sort((a,b)=>a[0]-b[0]).forEach(([id,name]) => {
        const o = document.createElement('option'); o.value=id; o.textContent=`${id} – ${name.slice(0,24)}`; courseEl.appendChild(o);
      });
      courseEl.dataset.populated = '1';
    }

    yearEl.onchange   = e => { _csYear   = e.target.value; renderCourseSummary(data); };
    courseEl.onchange = e => { _csCourse = e.target.value; renderCourseSummary(data); };
  }

  function renderCourseSummary(data) {
    const el = document.getElementById('course-summary-table');
    if (!el) return;

    let filtered = data;
    if (_csYear   !== 'all') filtered = filtered.filter(a => String(a.year)   === String(_csYear));
    if (_csCourse !== 'all') filtered = filtered.filter(a => String(a.course) === String(_csCourse));

    // Group by course
    const byCourse = {};
    filtered.forEach(a => {
      if (!byCourse[a.course]) byCourse[a.course] = { id:a.course, name:a.courseName, year:a.year, items:[] };
      byCourse[a.course].items.push(a);
    });

    const rows = Object.values(byCourse).sort((a,b) => a.id - b.id);
    if (!rows.length) { el.innerHTML='<div class="empty-state">No data for this selection</div>'; return; }

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    el.innerHTML = `<table class="cs-table cs-summary-table">
      <thead><tr>
        <th>Course</th><th>Year</th><th>Assessments</th>
        <th>Avg Weight %</th><th>Types</th><th>Date Range</th><th>Peak Month</th>
      </tr></thead>
      <tbody>${rows.map(c => {
        const weights   = c.items.filter(a=>a.weight).map(a=>a.weight);
        const avgW      = weights.length ? (weights.reduce((s,w)=>s+w,0)/weights.length).toFixed(1) : '—';
        const dated     = c.items.filter(a=>a.effectiveDate).sort((a,b)=>a.effectiveDate-b.effectiveDate);
        const dateRange = dated.length ? `${formatDShort(dated[0].effectiveDate)} – ${formatDShort(dated[dated.length-1].effectiveDate)}` : '—';
        const byType    = {};
        c.items.forEach(a => { byType[a.type] = (byType[a.type]||0)+1; });
        const typeStr   = Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t,n])=>`${t} (${n})`).join(', ');
        const byMonth   = {};
        dated.forEach(a => { const m = a.effectiveDate.getMonth(); byMonth[m]=(byMonth[m]||0)+1; });
        const peakMonth = Object.entries(byMonth).sort((a,b)=>b[1]-a[1])[0];
        const peak      = peakMonth ? `${MONTHS[peakMonth[0]]} (${peakMonth[1]})` : '—';
        const dot       = colorMap[c.id] || '#1A3A6B';
        return `<tr>
          <td><span class="cs-course-badge" style="background:${dot}">${c.id}</span> ${c.name}</td>
          <td class="cs-td-center">Yr ${c.year}</td>
          <td class="cs-td-num">${c.items.length}</td>
          <td class="cs-td-num">${avgW}${avgW!=='—'?'%':''}</td>
          <td class="cs-td-types">${typeStr}</td>
          <td class="cs-td-range">${dateRange}</td>
          <td class="cs-td-center">${peak}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  // ── Excel/CSV Downloads ─────────────────────────────────────────────────
  function setupDownloadButtons(data) {
    document.querySelectorAll('.dl-btn').forEach(btn => {
      btn.onclick = () => downloadExcel(btn.dataset.dl, data);
    });
  }

  function downloadExcel(type, data) {
    let rows = [], filename = '';

    if (type === 'weekly') {
      const weeks = AnalyticsEngine.getByWeek(data);
      rows = [['Week Starting','# Assessments','Total Weight %','Avg Weight %'],
        ...weeks.map(w => {
          const ws = w.assessments.filter(a=>a.weight).map(a=>a.weight);
          const total = ws.reduce((s,v)=>s+v,0);
          return [w.week, w.count, total.toFixed(1), ws.length?(total/ws.length).toFixed(1):''];
        })];
      filename = 'weekly_workload.csv';
    }
    else if (type === 'types') {
      const types = AnalyticsEngine.getTypeDistribution(data);
      rows = [['Type','Count','Avg Weight %'], ...types.map(t=>[t.type,t.count,t.avgWeight])];
      filename = 'type_distribution.csv';
    }
    else if (type === 'avgweight') {
      const byType = {};
      data.filter(a=>a.weight).forEach(a=>{if(!byType[a.type])byType[a.type]=[];byType[a.type].push(a.weight);});
      rows = [['Type','Avg Weight %','Count'],
        ...Object.entries(byType).map(([t,ws])=>[t,(ws.reduce((s,v)=>s+v,0)/ws.length).toFixed(1),ws.length])];
      filename = 'avg_weight_by_type.csv';
    }
    else if (type === 'monthly') {
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const monthly = AnalyticsEngine.getByMonth(data);
      rows = [['Month','# Assessments','Avg Weight %'],
        ...monthly.map(m => {
          const items = data.filter(a=>a.effectiveDate&&MONTHS[a.effectiveDate.getMonth()]===m.month);
          const ws = items.filter(a=>a.weight).map(a=>a.weight);
          const avg = ws.length?(ws.reduce((s,v)=>s+v,0)/ws.length).toFixed(1):'';
          return [m.month, m.count, avg];
        })];
      filename = 'monthly_assessments.csv';
    }
    else if (type === 'courses') {
      rows = [['Course ID','Course Name','Year','# Assessments','Avg Weight %','Types','Date Range']];
      const byCourse = {};
      data.forEach(a=>{if(!byCourse[a.course])byCourse[a.course]={id:a.course,name:a.courseName,year:a.year,items:[]};byCourse[a.course].items.push(a);});
      Object.values(byCourse).sort((a,b)=>a.id-b.id).forEach(c=>{
        const ws = c.items.filter(a=>a.weight).map(a=>a.weight);
        const avg = ws.length?(ws.reduce((s,v)=>s+v,0)/ws.length).toFixed(1):'';
        const types = [...new Set(c.items.map(a=>a.type))].join('; ');
        const dated = c.items.filter(a=>a.effectiveDate).sort((a,b)=>a.effectiveDate-b.effectiveDate);
        const range = dated.length?`${formatDShort(dated[0].effectiveDate)} – ${formatDShort(dated[dated.length-1].effectiveDate)}`:'';
        rows.push([c.id,`"${c.name}"`,c.year,c.items.length,avg,`"${types}"`,range]);
      });
      filename = 'course_summary.csv';
    }

    const csv  = rows.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ════════════════════════════════════════════════════════════════════════
  // DATA TABLE TAB
  // ════════════════════════════════════════════════════════════════════════
  function renderDataTable() {
    const data = StateManager.get('filteredData');
    const countEl = document.getElementById('dt-count');
    if (countEl) countEl.textContent = `${data.length} assessments`;

    const sorted = [...data].sort((a,b) => {
      let av = a[_dtSortCol], bv = b[_dtSortCol];
      if (av instanceof Date) av = av?.getTime() || 0;
      if (bv instanceof Date) bv = bv?.getTime() || 0;
      if (av == null) av = ''; if (bv == null) bv = '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return _dtSortDir==='asc' ? -1 : 1;
      if (av > bv) return _dtSortDir==='asc' ?  1 : -1;
      return 0;
    });

    const TYPE_COLORS = { 'Quiz':'#0E7490','Midterm':'#B45309','Final Exam':'#B91C1C','Assignment':'#6D28D9','Group Assignment':'#3730A3','Lab':'#166534','OSCE':'#B45309','Simulation':'#1A3A6B','Bellringer':'#9D174D' };
    const tbody = document.getElementById('dt-tbody');
    if (!tbody) return;

    tbody.innerHTML = sorted.map(a => {
      const dot   = colorMap[a.course] || '#1A3A6B';
      const tcolor= TYPE_COLORS[a.type] || '#6B7280';
      const wc    = a.weight >= 30 ? '#B91C1C' : a.weight >= 20 ? '#B45309' : 'var(--text-2)';
      return `<tr class="dt-row" data-id="${a._id}">
        <td><span class="dt-course-badge" style="background:${dot}">${a.course}</span></td>
        <td style="text-align:center;font-weight:700;color:var(--text-2)">${a.year}</td>
        <td class="dt-name" title="${a.courseName}">${a.courseName}</td>
        <td><span class="dt-type-chip" style="background:${tcolor}18;color:${tcolor}">${a.type}</span></td>
        <td class="dt-detail" title="${a.details||''}">${a.details||'—'}</td>
        <td class="dt-weight" style="color:${wc}">${a.weightRaw||'—'}</td>
        <td class="dt-date">${a.effectiveDate?formatD(a.effectiveDate):'TBD'}</td>
        <td style="color:var(--text-3);font-size:11px">${a.startTime&&a.startTime!=='N/A'?a.startTime.slice(0,5):'—'}</td>
        <td style="color:var(--text-3);font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.location||'—'}</td>
        <td style="color:var(--text-3);font-size:11px">${a.format||'—'}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.dt-row').forEach(row => { row.addEventListener('click', () => openAssessmentModal(row.dataset.id)); });

    const table = document.getElementById('dt-table');
    if (table) {
      table.querySelectorAll('thead th').forEach(th => {
        th.classList.remove('sort-asc','sort-desc');
        if (th.dataset.col === _dtSortCol) th.classList.add(_dtSortDir==='asc'?'sort-asc':'sort-desc');
        th.onclick = () => {
          if (_dtSortCol === th.dataset.col) _dtSortDir = _dtSortDir==='asc'?'desc':'asc';
          else { _dtSortCol = th.dataset.col; _dtSortDir = 'asc'; }
          renderDataTable();
        };
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // MODAL
  // ════════════════════════════════════════════════════════════════════════
  function openAssessmentModal(id) {
    const data = StateManager.get('assessments');
    const a    = data.find(x => x._id === id);
    if (!a) return;
    const color = colorMap[a.course] || '#1A3A6B';
    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-box">
        <div class="modal-strip" style="background:${color}"></div>
        <button class="modal-close" id="modal-close">✕</button>
        <div class="modal-header">
          <span class="modal-type-badge" style="background:${color}18;color:${color}">${a.type}</span>
          <h2 class="modal-title">${a.courseName}</h2>
          <div class="modal-subtitle">Course ${a.course} · Year ${a.year} · ${a.term}</div>
        </div>
        <div class="modal-body">
          ${mrow('📋','Details',a.details||'—')}
          ${mrow('⚖️','Weight',a.weightRaw||'—')}
          ${mrow('📅','Date',a.effectiveDate?formatD(a.effectiveDate):'—')}
          ${mrow('🕐','Time',a.startTime&&a.startTime!=='N/A'?`${a.startTime.slice(0,5)}${a.endTime&&a.endTime!=='N/A'?' – '+a.endTime.slice(0,5):''}`: '—')}
          ${mrow('⏱️','Duration',a.duration||'—')}
          ${mrow('📍','Location',a.location||'—')}
          ${mrow('📖','Book Policy',a.openClosebook||'—')}
          ${mrow('💻','Format',a.format||'—')}
          ${mrow('🔢','Calculator',a.calculator||'—')}
          ${a.notes?mrow('📝','Notes',a.notes):''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cal">View in Calendar</button>
          <button class="btn btn-primary"   id="modal-done">Close</button>
        </div>
      </div>`;
    modal.classList.add('open');
    modal.querySelector('#modal-close').onclick    = closeModal;
    modal.querySelector('#modal-backdrop').onclick = closeModal;
    modal.querySelector('#modal-done').onclick     = closeModal;
    modal.querySelector('#modal-cal').onclick      = () => {
      closeModal();
      if (a.effectiveDate) { StateManager.set('calendarDate', new Date(a.effectiveDate)); StateManager.set('calendarView','week'); }
      StateManager.set('activeTab', null);
      renderTab(null);
    };
  }
  function mrow(icon, label, value) {
    return `<div class="modal-row"><span class="mrow-icon">${icon}</span><span class="mrow-label">${label}</span><span class="mrow-value">${value}</span></div>`;
  }
  function closeModal() { const m=document.getElementById('modal'); m.classList.remove('open'); m.innerHTML=''; }

  // ════════════════════════════════════════════════════════════════════════
  // HEADER STATS + FILTER BAR
  // ════════════════════════════════════════════════════════════════════════
  function renderHeaderStats(count, total, seqs) {
    const el = document.getElementById('header-stats');
    if (!el) return;
    const overlaps = (seqs||[]).filter(s => s.alertType==='same-day').length;
    const clusters = (seqs||[]).filter(s => s.alertType==='cluster').length;
    el.innerHTML = `
      <div class="hstat"><strong>${count}</strong> assessments${count!==total?` <span style="color:#B45309;font-size:11px">(filtered)</span>`:''}</div>
      ${overlaps ? `<div class="hstat">📅 <strong>${overlaps}</strong> overlaps</div>` : ''}
      ${clusters ? `<div class="hstat">🔴 <strong>${clusters}</strong> streaks</div>` : ''}`;
  }

  const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

  function renderFilterBar(filters, count, total) {
    const all    = StateManager.get('assessments');
    const active = [];
    if (filters.course !== 'all') { const name = all.find(a=>String(a.course)===String(filters.course))?.courseName||filters.course; active.push({key:'course',label:`Course: ${filters.course} – ${name.slice(0,20)}`}); }
    if (filters.year  !== 'all') active.push({key:'year',  label:`Year ${filters.year}`});
    if (filters.type  !== 'all') active.push({key:'type',  label:`Type: ${filters.type}`});
    if (filters.month !== 'all') active.push({key:'month', label:`Month: ${MONTH_NAMES[parseInt(filters.month)]}`});
    if (filters.search)          active.push({key:'search',label:`"${filters.search}"`});

    const bar   = document.getElementById('active-chips-row');
    const chips = document.getElementById('global-filter-chips');
    if (!bar) { renderHeaderStats(count, total, StateManager.get('riskSequences')); return; }
    if (!active.length) { bar.classList.add('hidden'); renderHeaderStats(count, total, StateManager.get('riskSequences')); return; }
    bar.classList.remove('hidden');
    chips.innerHTML = active.map(f =>
      `<span class="fbar-chip">${f.label}<button class="fbar-chip-x" data-key="${f.key}">×</button></span>`
    ).join('');
    chips.querySelectorAll('.fbar-chip-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const k = btn.dataset.key;
        StateManager.setFilters({[k]: k==='search'?'':'all'});
        if (k==='course') document.getElementById('filter-course').value='all';
        if (k==='year')   document.getElementById('filter-year').value='all';
        if (k==='type')   document.getElementById('filter-type').value='all';
        if (k==='month')  document.getElementById('filter-month').value='all';
        if (k==='search') document.getElementById('search-input').value='';
      });
    });
    renderHeaderStats(count, total, StateManager.get('riskSequences'));
  }

  // ════════════════════════════════════════════════════════════════════════
  // ALERT FILTER BANNER
  // ════════════════════════════════════════════════════════════════════════
  function showAlertFilterBanner() {
    document.getElementById('show-all-btn')?.remove();
    const btn = document.createElement('button');
    btn.id        = 'show-all-btn';
    btn.className = 'show-all-btn';
    btn.textContent = 'Show All Assessments';
    const calCard = document.querySelector('.cal-card');
    if (calCard) calCard.after(btn);
    btn.addEventListener('click', () => {
      StateManager.set('filteredData', StateManager.get('assessments'));
      _highlightedRiskId = null;
      btn.remove();
      renderCalendar();
      renderRiskPanel();
    });
  }


  // ════════════════════════════════════════════════════════════════════════
  // UI SETUP
  // ════════════════════════════════════════════════════════════════════════
  function setupUI() {
    // Secondary tabs
    document.querySelectorAll('.top-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Back to calendar button
    const backBtn = document.getElementById('back-to-calendar');
    if (backBtn) backBtn.addEventListener('click', () => {
      StateManager.set('activeTab', null);
      renderTab(null);
    });

    // Overview "see all" button
    const seeRisk = document.getElementById('overview-see-risk');
    if (seeRisk) seeRisk.addEventListener('click', () => {
      StateManager.set('activeTab', null);
      renderTab(null);
      // scroll to top of main view
      document.getElementById('main-view')?.scrollIntoView({behavior:'smooth'});
    });

    // Calendar nav
    document.getElementById('cal-prev').addEventListener('click', () => {
      const v=StateManager.get('calendarView'), d=StateManager.get('calendarDate');
      StateManager.set('calendarDate', v==='month'?CalendarEngine.prevMonth(d):CalendarEngine.prevWeek(d));
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      const v=StateManager.get('calendarView'), d=StateManager.get('calendarDate');
      StateManager.set('calendarDate', v==='month'?CalendarEngine.nextMonth(d):CalendarEngine.nextWeek(d));
    });
    document.getElementById('cal-today').addEventListener('click', () => StateManager.set('calendarDate', new Date()));
    document.getElementById('cal-month-btn').addEventListener('click', () => {
      document.getElementById('cal-month-btn').classList.add('active');
      document.getElementById('cal-week-btn').classList.remove('active');
      StateManager.set('calendarView','month');
    });
    document.getElementById('cal-week-btn').addEventListener('click', () => {
      document.getElementById('cal-week-btn').classList.add('active');
      document.getElementById('cal-month-btn').classList.remove('active');
      StateManager.set('calendarView','week');
    });

    // Horizontal filter bar
    const filterIds = ['filter-course','filter-year','filter-month','filter-type'];
    document.getElementById('filter-course').addEventListener('change', e => StateManager.setFilters({course:e.target.value}));
    document.getElementById('filter-year').addEventListener('change',   e => StateManager.setFilters({year:  e.target.value}));
    document.getElementById('filter-month').addEventListener('change',  e => StateManager.setFilters({month: e.target.value}));
    document.getElementById('filter-type').addEventListener('change',   e => StateManager.setFilters({type:  e.target.value}));
    document.getElementById('search-input').addEventListener('input',   e => StateManager.setFilters({search:e.target.value}));

    function resetAllFilters() {
      StateManager.resetFilters();
      filterIds.forEach(id => document.getElementById(id).value='all');
      document.getElementById('search-input').value='';
    }

    document.getElementById('reset-filters').addEventListener('click', resetAllFilters);
    document.getElementById('global-filter-clear').addEventListener('click', resetAllFilters);

    // Dark mode
    document.getElementById('dark-toggle').addEventListener('click', () => StateManager.set('darkMode', !StateManager.get('darkMode')));

    // Export CSV
    const expBtn = document.getElementById('export-btn') || document.getElementById('export-btn-top');
    if (expBtn) expBtn.addEventListener('click', exportCSV);

    // ESC closes modal
    document.addEventListener('keydown', e => { if (e.key==='Escape') closeModal(); });
  }

  function populateFilterDropdowns(all) {
    const courseEl = document.getElementById('filter-course');
    const typeEl   = document.getElementById('filter-type');
    const yearEl   = document.getElementById('filter-year');

    const courses = [...new Map(all.map(a=>[a.course,a.courseName])).entries()].sort((a,b)=>a[0]-b[0]);
    courses.forEach(([id,name]) => { const o=document.createElement('option'); o.value=id; o.textContent=`${id} – ${name.slice(0,28)}`; courseEl.appendChild(o); });

    const types = [...new Set(all.map(a=>a.type))].sort();
    types.forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent=t; typeEl.appendChild(o); });

    const years = [...new Set(all.map(a=>a.year))].sort();
    years.forEach(y => { const o=document.createElement('option'); o.value=y; o.textContent=`Year ${y}`; yearEl.appendChild(o); });
  }

  function applyDarkMode(on) {
    document.documentElement.classList.toggle('dark', on);
    const btn = document.getElementById('dark-toggle');
    if (btn) btn.textContent = on ? '☀️' : '🌙';
    // Recharts need rerender on dark mode change
    const tab = StateManager.get('activeTab');
    if (tab === 'analytics') renderAnalytics();
    if (tab === 'overview')  renderOverview();
  }

  function exportCSV() {
    const data   = StateManager.get('filteredData');
    const header = ['Course','Year','Course_name','Type','Assessment_Details','Weight','Date','Start_time','End_time','Location','Format','Notes'];
    const rows   = data.map(a => [a.course,a.year,`"${a.courseName}"`,a.type,`"${a.details}"`,a.weightRaw,a.effectiveDate?a.effectiveDate.toISOString().slice(0,10):'',a.startTime,a.endTime,`"${a.location}"`,a.format,`"${a.notes}"`]);
    const csv    = [header,...rows].map(r=>r.join(',')).join('\n');
    const blob   = new Blob([csv],{type:'text/csv'});
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a'); a.href=url; a.download='assessments_export.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Formatters ─────────────────────────────────────────────────────────
  function formatD(date) {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-CA',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
  }
  function formatDShort(date) {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-CA',{month:'short',day:'numeric'});
  }

})();
