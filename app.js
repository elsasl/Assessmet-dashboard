// app.js — Assessment Calendar Dashboard
// Architecture: Calendar + Risk Panel (main) | Overview | Analytics | Data Table (secondary tabs)

(async function () {
  'use strict';

  // ── Module-level state ────────────────────────────────────────────────────
  let _riskYear          = 'all';
  let _highlightedRiskId = null;
  let _dtSortCol         = 'effectiveDate';
  let _dtSortDir         = 'asc';

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

    // Render active tab or default main view
    const tab = StateManager.get('activeTab');
    renderTab(tab || null);
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
    panels.forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.top-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    if (!tab) {
      // Show calendar + risk panel
      if (mainView) mainView.style.display = 'grid';
      renderCalendar();
      renderRiskPanel();
      return;
    }

    // Hide main view, show tab panel
    if (mainView) mainView.style.display = 'none';
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
        html += `<div class="rp-item rp-item-cluster ${isHighlighted ? 'highlighted' : ''}" data-rid="${seq.id}">
          <div class="rp-item-date-row">
            <span class="rp-item-date">${formatDShort(seq.startDate)} – ${formatDShort(seq.endDate)}</span>
            <span class="rp-item-year-pill" style="background:${colorForYear(seq.year)}">Yr ${seq.year||'?'}</span>
          </div>
          <div class="rp-item-meta">${seq.numDays} consecutive days</div>
          <div class="rp-item-chips">
            ${courseNums.slice(0,4).map(cn => `<span class="rp-chip" style="border-color:${colorMap[cn]||'#1A3A6B'};background:${colorMap[cn]||'#1A3A6B'}18">${cn}</span>`).join('')}
            ${courseNums.length > 4 ? `<span class="rp-chip rp-chip-more">+${courseNums.length-4}</span>` : ''}
          </div>
        </div>`;
      });
      html += '</div></div>';
    }

    body.innerHTML = html;

    // Wire clicks — navigate calendar to that date and highlight
    body.querySelectorAll('.rp-item').forEach(item => {
      item.addEventListener('click', () => {
        const rid = item.dataset.rid;
        const seq = allSeqs.find(s => s.id === rid);
        if (!seq) return;
        _highlightedRiskId = rid;
        StateManager.set('calendarDate', new Date(seq.startDate));
        StateManager.set('calendarView', seq.alertType === 'same-day' ? 'week' : 'month');
        // Switch back to main view if on a tab
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
  function renderOverview() {
    const data = StateManager.get('filteredData');
    const kpis = AnalyticsEngine.getKPIs(data);
    const seqs = StateManager.get('riskSequences') || [];

    const kpiEl = document.getElementById('kpi-grid');
    if (kpiEl) kpiEl.innerHTML = [
      ['📋','Total Assessments',kpis.total,'blue'],
      ['📝','Quizzes',kpis.quizzes,'teal'],
      ['📘','Midterms',kpis.midterms,'amber'],
      ['🎓','Final Exams',kpis.finals,'red'],
      ['📎','Assignments',kpis.assignments,'purple'],
      ['🔬','Labs & OSCEs',kpis.labs+kpis.osces,'green'],
      ['🏫','Courses',kpis.courses,'indigo'],
      ['⚖️','Avg Weight',kpis.avgWeight+'%','pink'],
    ].map(([icon,label,val,color]) => `<div class="kpi-card kpi-${color}">
      <div class="kpi-icon">${icon}</div>
      <div><div class="kpi-value">${val}</div><div class="kpi-label">${label}</div></div>
    </div>`).join('');

    renderMonthlyChart(data);
    renderRiskCounters(seqs);
    renderRiskPreview(seqs);
    renderHeaderStats(data.length, StateManager.get('assessments').length, seqs);
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
      data: { labels: monthly.map(m=>m.month.slice(0,3)), datasets: [{ label:'Assessments', data: monthly.map(m=>m.count), backgroundColor: monthly.map((_,i)=>`hsl(${210+i*15},65%,55%)`), borderRadius: 4, borderSkipped: false }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales: { x:{grid:{color:gc},ticks:{color:lc}}, y:{grid:{color:gc},ticks:{color:lc},beginAtZero:true} } }
    });
  }

  function renderRiskCounters(seqs) {
    const el = document.getElementById('risk-counters');
    if (!el) return;
    const overlaps  = seqs.filter(s => s.alertType === 'same-day');
    const clusters  = seqs.filter(s => s.alertType === 'cluster');
    const critical  = clusters.filter(s => s.severity === 'critical' || s.severity === 'high');
    el.innerHTML = `<div class="rc-row">
      <div class="rc-block rc-overlap"><div class="rc-num">${overlaps.length}</div><div class="rc-lbl">Same-Day Overlaps</div></div>
      <div class="rc-block rc-cluster"><div class="rc-num">${clusters.length}</div><div class="rc-lbl">Back-to-Back Streaks</div></div>
      <div class="rc-block rc-critical"><div class="rc-num">${critical.length}</div><div class="rc-lbl">High/Critical</div></div>
    </div>
    <div class="rc-note">${seqs.length ? 'Visible in Calendar risk panel →' : '✅ No risk alerts detected'}</div>`;
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

  function renderCourseBreakdown(data) {
    const courses = AnalyticsEngine.getByCourse(data);
    const el      = document.getElementById('course-breakdown');
    if (!el) return;
    el.innerHTML = courses.map(c => {
      const color = colorMap[c.courseId] || '#1A3A6B';
      return `<div class="course-row">
        <div class="course-row-dot" style="background:${color}"></div>
        <div class="course-row-name">${c.courseName}</div>
        <div class="course-row-badges">${Object.entries(c.types).map(([t,items])=>`<span class="type-badge">${t}: ${items.length}</span>`).join('')}</div>
        <div class="course-row-weight">${c.totalWeight.toFixed(0)}%</div>
      </div>`;
    }).join('');
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
  // UI SETUP
  // ════════════════════════════════════════════════════════════════════════
  function setupUI() {
    // Secondary tabs
    document.querySelectorAll('.top-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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
