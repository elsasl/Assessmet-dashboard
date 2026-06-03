// app.js — Main Orchestration Layer
// Assessment Intelligence Dashboard

(async function () {
  'use strict';

  // ── Embedded CSV data ────────────────────────────────────────────────────
  // ── Load data from external CSV file ───────────────────────────────────
  let rawData;
  try {
    const response = await fetch('./data.csv');
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const csvText = await response.text();
    rawData = await DataParser.loadFromText(csvText);
    console.info(`[AID] Loaded ${rawData.length} assessments from data.csv`);
  } catch (err) {
    console.error('[AID] Failed to load data.csv:', err);
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#1E2A3A;color:#E2EAF4;flex-direction:column;gap:16px;text-align:center;padding:32px">
        <div style="font-size:48px">📋</div>
        <h2 style="font-size:22px;font-weight:700">Could not load data.csv</h2>
        <p style="color:#7A95B0;max-width:400px">${err.message}<br><br>Make sure <strong>data.csv</strong> is in the same folder as index.html and you are running through a local server (VS Code Live Server, <code>npx serve</code>, etc.).</p>
      </div>`;
    return;
  }
  const colorMap   = CalendarEngine.getCourseColorMap(rawData);
  StateManager.set('assessments', rawData);
  await DataService.setData(rawData);
  recomputeAnalytics(rawData);
  applyFiltersAndRender();

  // ── Wire up global events ─────────────────────────────────────────────────
  StateManager.on('state:filters', () => applyFiltersAndRender());
  StateManager.on('state:activeTab', ({ next }) => renderActiveTab(next));
  StateManager.on('state:calendarDate', () => renderCalendar());
  StateManager.on('state:calendarView', () => renderCalendar());
  StateManager.on('state:darkMode',  ({ next }) => { applyDarkMode(next); StateManager.persistPreferences(); });

  setupGlobalUI();

  // ── Filter + Render ───────────────────────────────────────────────────────
  function applyFiltersAndRender() {
    const all     = StateManager.get('assessments');
    const filters = StateManager.get('filters');
    let   data    = [...all];

    if (filters.course !== 'all') data = data.filter(a => String(a.course) === String(filters.course));
    if (filters.year   !== 'all') data = data.filter(a => String(a.year)   === String(filters.year));
    if (filters.type   !== 'all') data = data.filter(a => a.type           === filters.type);
    if (filters.month  !== 'all') {
      const m = parseInt(filters.month);
      data = data.filter(a => a.effectiveDate && (a.effectiveDate.getMonth() + 1) === m);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      data = data.filter(a =>
        a.courseName.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)       ||
        a.details.toLowerCase().includes(q)    ||
        String(a.course).includes(q)
      );
    }

    StateManager.set('filteredData', data);
    renderActiveTab(StateManager.get('activeTab'));
    renderFilterBar(filters, data.length, all.length);
    populateFilterDropdowns(all);
  }

  // ── Filter Bar ────────────────────────────────────────────────────────────
  const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

  function renderFilterBar(filters, count, total) {
    const allData = StateManager.get('assessments');
    const active = [];
    if (filters.course !== 'all') {
      const name = allData.find(a => String(a.course) === String(filters.course))?.courseName || filters.course;
      active.push({ key: 'course', label: `Course: ${filters.course} – ${name.slice(0,20)}` });
    }
    if (filters.year  !== 'all') active.push({ key: 'year',  label: `Year ${filters.year}` });
    if (filters.type  !== 'all') active.push({ key: 'type',  label: `Type: ${filters.type}` });
    if (filters.month !== 'all') active.push({ key: 'month', label: `Month: ${MONTH_NAMES[parseInt(filters.month)]}` });
    if (filters.search)          active.push({ key: 'search',label: `"${filters.search}"` });

    // Single global filter bar
    const bar   = document.getElementById('global-filter-bar');
    const txt   = document.getElementById('global-filter-text');
    const chips = document.getElementById('global-filter-chips');
    if (!bar) return;
    if (!active.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    txt.textContent = `${count} of ${total} assessments`;
    chips.innerHTML = active.map(f =>
      `<span class="fbar-chip">${f.label}<button class="fbar-chip-x" data-key="${f.key}">×</button></span>`
    ).join('');
    chips.querySelectorAll('.fbar-chip-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const k = btn.dataset.key;
        const reset = { course:'all', year:'all', type:'all', month:'all', search:'' };
        StateManager.setFilters({ [k]: reset[k] });
        if (k === 'course') document.getElementById('filter-course').value = 'all';
        if (k === 'year')   document.getElementById('filter-year').value   = 'all';
        if (k === 'type')   document.getElementById('filter-type').value   = 'all';
        if (k === 'month')  document.getElementById('filter-month').value  = 'all';
        if (k === 'search') document.getElementById('search-input').value  = '';
      });
    });

    // Header stats
    renderHeaderStats(count, total);
  }

  // ── Custom filter banner (when Risk/Insight/Analytics filtered data) ──────
  function renderCustomFilterBanner() {
    const all      = StateManager.get('assessments');
    const filtered = StateManager.get('filteredData');
    const banner   = document.getElementById('custom-filter-banner');
    if (!banner) return;

    if (filtered.length < all.length) {
      // Check if this is a sidebar filter or a custom "Filter to these" selection
      const filters  = StateManager.get('filters');
      const hasSidebar = filters.course !== 'all' || filters.year !== 'all' ||
                         filters.type !== 'all' || filters.month !== 'all' || filters.search;
      if (!hasSidebar) {
        // Custom filtered — show banner
        banner.classList.remove('hidden');
        banner.querySelector('.cfb-count').textContent =
          `Showing ${filtered.length} of ${all.length} assessments (custom selection)`;
      } else {
        banner.classList.add('hidden');
      }
    } else {
      banner.classList.add('hidden');
    }
  }

  function renderHeaderStats(count, total) {
    const el = document.getElementById('header-stats');
    if (!el) return;
    const seqs = StateManager.get('riskSequences') || [];
    const overlaps = seqs.filter(s => s.alertType === 'same-day').length;
    const clusters = seqs.filter(s => s.alertType === 'cluster').length;
    el.innerHTML = `
      <div class="hstat"><strong>${count}</strong> assessments${count !== total ? ` <span style="color:var(--amber);font-size:10px">(filtered)</span>` : ''}</div>
      ${overlaps ? `<div class="hstat">📅 <strong>${overlaps}</strong> overlaps</div>` : ''}
      ${clusters ? `<div class="hstat">🔴 <strong>${clusters}</strong> clusters</div>` : ''}
    `;
  }

  function recomputeAnalytics(data) {
    const seqs     = RiskDetector.detectRiskSequences(data);
    const insights = RiskDetector.generateInsights(data, seqs);
    StateManager.set('riskSequences', seqs);
    StateManager.set('insights', insights);
  }

  // ── Tab Rendering ─────────────────────────────────────────────────────────
  function renderActiveTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.top-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.add('active');

    if (tab === 'overview')  renderOverview();
    if (tab === 'risk')      renderRiskTab();
    if (tab === 'calendar')  renderCalendar();
    if (tab === 'analytics') { renderAnalytics(); }
    if (tab === 'datatable') renderDataTable();
    // Never show custom filter banner on Analytics — it always uses full data
    if (tab === 'analytics') {
      document.getElementById('custom-filter-banner')?.classList.add('hidden');
    } else {
      renderCustomFilterBanner();
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // OVERVIEW TAB
  // ════════════════════════════════════════════════════════════════════════════
  function renderOverview() {
    const data      = StateManager.get('filteredData');
    const kpis      = AnalyticsEngine.getKPIs(data);
    const sequences = StateManager.get('riskSequences');

    // KPI cards
    const kpiEl = document.getElementById('kpi-grid');
    if (kpiEl) kpiEl.innerHTML = `
      ${kpiCard('📋', 'Total Assessments', kpis.total, 'blue')}
      ${kpiCard('📝', 'Quizzes', kpis.quizzes, 'teal')}
      ${kpiCard('📘', 'Midterms', kpis.midterms, 'amber')}
      ${kpiCard('🎓', 'Final Exams', kpis.finals, 'red')}
      ${kpiCard('📎', 'Assignments', kpis.assignments, 'purple')}
      ${kpiCard('🔬', 'Labs & OSCEs', kpis.labs + kpis.osces, 'green')}
      ${kpiCard('🏫', 'Courses', kpis.courses, 'indigo')}
      ${kpiCard('⚖️', 'Avg Weight', kpis.avgWeight + '%', 'pink')}
    `;

    renderMonthlyChart(data);
    renderRiskCounters(sequences);
    renderRiskPreview(sequences);
    renderHeaderStats(data.length, StateManager.get('assessments').length);
  }

  function renderRiskPreview(sequences) {
    const el = document.getElementById('risk-preview');
    if (!el) return;
    const top = sequences.slice(0, 6);
    if (!top.length) { el.innerHTML = '<div class="empty-state">No risk alerts detected</div>'; return; }

    el.innerHTML = `
      <table class="rp-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Date / Period</th>
            <th>Year</th>
            <th>Courses involved</th>
            <th># Assessments</th>
            <th>Combined Weight</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${top.map(seq => {
            const isOverlap = seq.alertType === 'same-day';
            const tagColor  = isOverlap ? '#B45309' : '#B91C1C';
            const tagBg     = isOverlap ? '#FFFBEB' : '#FEF2F2';
            const tagBorder = isOverlap ? '#FDE68A' : '#FECACA';
            const tag       = isOverlap ? 'Same-Day Overlap' : 'Back-to-Back Days';
            const dateLabel = isOverlap
              ? formatD(seq.startDate)
              : `${formatD(seq.startDate)} → ${formatD(seq.endDate)}`;
            const year      = seq.year || seq.items[0]?.year || '—';
            const courses   = seq.courses.slice(0,2).join(', ') + (seq.courses.length > 2 ? ` +${seq.courses.length-2}` : '');
            const weight    = seq.totalWeight.toFixed(0);
            const wColor    = seq.totalWeight >= 80 ? '#B91C1C' : seq.totalWeight >= 50 ? '#B45309' : 'var(--text-2)';
            const courseNums = [...new Set(seq.items.map(a => a.course))];
            return `<tr class="rp-row" data-id="${seq.id}">
              <td>
                <span class="rp-tag" style="color:${tagColor};background:${tagBg};border-color:${tagBorder}">${tag}</span>
              </td>
              <td class="rp-date">${dateLabel}</td>
              <td class="rp-year">${year}</td>
              <td class="rp-courses">
                <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:3px">
                  ${courseNums.map(cn => `<span class="rp-course-badge" style="background:${colorMap[cn]||'#1A3A6B'}">${cn}</span>`).join('')}
                </div>
                <span class="rp-course-names">${courses}</span>
              </td>
              <td class="rp-count">${seq.items.length}</td>
              <td class="rp-weight" style="color:${wColor}">${weight}%</td>
              <td><button class="rp-goto">View →</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    el.querySelectorAll('.rp-row').forEach(row => {
      row.addEventListener('click', () => switchTab('risk'));
      row.querySelector('.rp-goto').addEventListener('click', e => { e.stopPropagation(); switchTab('risk'); });
    });
  }

  function kpiCard(icon, label, value, color) {
    return `<div class="kpi-card kpi-${color}">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-body">
        <div class="kpi-value">${value}</div>
        <div class="kpi-label">${label}</div>
      </div>
    </div>`;
  }

  function renderMonthlyChart(data) {
    const monthly = AnalyticsEngine.getByMonth(data);
    const canvas  = document.getElementById('monthly-chart');
    if (!canvas) return;
    if (window._monthlyChart) { window._monthlyChart.destroy(); }
    const dm = StateManager.get('darkMode');
    const gridColor = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const labelColor= dm ? '#94a3b8' : '#64748b';
    window._monthlyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels:   monthly.map(m => m.month.slice(0,3)),
        datasets: [{
          label: 'Assessments',
          data:  monthly.map(m => m.count),
          backgroundColor: monthly.map((_, i) => `hsl(${210 + i*12},80%,60%)`),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} assessments` } } },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: labelColor } },
          y: { grid: { color: gridColor }, ticks: { color: labelColor, stepSize: 1 }, beginAtZero: true },
        },
      },
    });
  }

  // ── Risk counters ──────────────────────────────────────────────────────
  function renderRiskCounters(sequences) {
    const el = document.getElementById('risk-counters');
    if (!el) return;
    const overlaps    = sequences.filter(s => s.alertType === 'same-day');
    const clusters    = sequences.filter(s => s.alertType === 'cluster');
    const critClusters= clusters.filter(s => s.severity === 'critical' || s.severity === 'high');
    el.innerHTML = `
      <div class="rc-row">
        <div class="rc-block rc-overlap">
          <div class="rc-num">${overlaps.length}</div>
          <div class="rc-lbl">📅 Same-Day<br>Overlaps</div>
        </div>
        <div class="rc-block rc-cluster">
          <div class="rc-num">${clusters.length}</div>
          <div class="rc-lbl">🔴 Consecutive<br>Clusters</div>
        </div>
        <div class="rc-block rc-critical">
          <div class="rc-num">${critClusters.length}</div>
          <div class="rc-lbl">⚠️ High/Critical<br>Severity</div>
        </div>
      </div>
      <div class="rc-note">${sequences.length ? 'See Risk tab for details' : '✅ No risk alerts detected'}</div>`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RISK TAB — subtabs: overlaps | clusters | insights
  // ════════════════════════════════════════════════════════════════════════════
  let _activeRiskId    = null;
  let _activeClusterId = null;
  let _activeClusterYear = 'all';
  let _activeInsightType = 'all';

  function renderRiskTab() {
    const sequences = StateManager.get('riskSequences');
    const insights  = StateManager.get('insights');
    const overlaps  = sequences.filter(s => s.alertType === 'same-day');
    const clusters  = sequences.filter(s => s.alertType === 'cluster');

    // Update count badges
    const ovBadge = document.getElementById('overlap-count-badge');
    const clBadge = document.getElementById('cluster-count-badge');
    if (ovBadge) { ovBadge.textContent = overlaps.length; ovBadge.style.color = overlaps.length ? '#D97706' : 'var(--text-3)'; }
    if (clBadge) { clBadge.textContent = clusters.length; clBadge.style.color = clusters.length ? '#DC2626' : 'var(--text-3)'; }

    renderOverlapInbox(overlaps);
    renderClusterInbox(clusters);
    renderInsights(insights);
    setupSubtabs();
  }

  function setupSubtabs() {
    document.querySelectorAll('.subtab').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById(btn.dataset.subtab);
        if (panel) panel.classList.add('active');
      };
    });
  }

  // ── Same-day overlap inbox ───────────────────────────────────────────────
  let _activeOverlapYear = 'all';

  function renderOverlapInbox(overlaps) {
    const listEl   = document.getElementById('overlap-inbox-list');
    const detailEl = document.getElementById('overlap-inbox-detail');
    const yearTabEl= document.getElementById('overlap-year-tabs');
    if (!listEl) return;

    if (!overlaps.length) {
      listEl.innerHTML = '<div class="empty-state">✅ No same-day overlaps detected</div>';
      if (detailEl) detailEl.innerHTML = '<div class="risk-detail-empty">No overlaps to show</div>';
      if (yearTabEl) yearTabEl.innerHTML = '';
      return;
    }

    // Year filter tabs
    const years = ['all', ...new Set(overlaps.flatMap(o => o.items.map(a => a.year))).values()].filter(y => y !== undefined);
    if (yearTabEl) {
      yearTabEl.innerHTML = years.map(y =>
        `<button class="cyt-btn ${y == _activeOverlapYear ? 'active':''}" data-year="${y}">
          ${y === 'all' ? 'All Years' : `Year ${y}`}
          <span style="font-size:11px;opacity:.7"> · ${y === 'all' ? overlaps.length : overlaps.filter(o=>o.items.some(a=>a.year==y)).length}</span>
        </button>`
      ).join('');
      yearTabEl.querySelectorAll('.cyt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _activeOverlapYear = btn.dataset.year;
          renderOverlapInbox(overlaps);
        });
      });
    }

    const filtered = _activeOverlapYear === 'all' ? overlaps
      : overlaps.filter(o => o.items.some(a => String(a.year) === String(_activeOverlapYear)));

    listEl.innerHTML = filtered.map(seq => {
      const isActive = seq.id === _activeRiskId;
      const courseNums = [...new Set(seq.items.map(a => a.course))];
      return `<div class="risk-inbox-row ${isActive?'active':''}" data-id="${seq.id}"
          style="border-left-color:#D97706">
        <div class="rir-top">
          <span class="rir-tag" style="color:#B45309;background:#FEF3C7">📅 SAME DAY</span>
          <span class="rir-sev sev-${seq.severity}">${seq.severity}</span>
        </div>
        <div class="rir-date">${formatD(seq.startDate)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:3px">
          ${courseNums.map(cn => `<span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:10px;color:#fff;background:${colorMap[cn]||'#6366f1'}">${cn}</span>`).join('')}
        </div>
        <div class="rir-courses">${seq.courses.slice(0,2).join(', ')}${seq.courses.length>2?` +${seq.courses.length-2}`:''}</div>
        <div class="rir-weight">${seq.totalWeight.toFixed(0)}% combined · ${seq.items.length} assessments</div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.risk-inbox-row').forEach(row => {
      row.addEventListener('click', () => {
        _activeRiskId = row.dataset.id;
        listEl.querySelectorAll('.risk-inbox-row').forEach(r => r.classList.toggle('active', r.dataset.id === _activeRiskId));
        renderRiskDetail(filtered.find(s => s.id === _activeRiskId), detailEl);
      });
    });

    if (!filtered.find(s => s.id === _activeRiskId) && filtered.length) {
      _activeRiskId = filtered[0].id;
      listEl.querySelector('.risk-inbox-row')?.classList.add('active');
    }
    renderRiskDetail(filtered.find(s => s.id === _activeRiskId), detailEl);
  }

  // ── Consecutive cluster inbox ────────────────────────────────────────────
  function renderClusterInbox(clusters) {
    const listEl   = document.getElementById('cluster-inbox-list');
    const detailEl = document.getElementById('cluster-inbox-detail');
    const yearTabEl= document.getElementById('cluster-year-tabs');
    if (!listEl) return;

    if (!clusters.length) {
      listEl.innerHTML = '<div class="empty-state">✅ No consecutive clusters detected</div>';
      if (detailEl) detailEl.innerHTML = '<div class="risk-detail-empty">No clusters to show</div>';
      if (yearTabEl) yearTabEl.innerHTML = '';
      return;
    }

    // Year filter tabs
    const years = ['all', ...new Set(clusters.map(c => c.year)).values()].filter(Boolean);
    if (yearTabEl) {
      yearTabEl.innerHTML = years.map(y =>
        `<button class="cyt-btn ${y == _activeClusterYear ? 'active':''}" data-year="${y}">
          ${y === 'all' ? 'All Years' : `Year ${y}`}
          <span style="font-size:10px;opacity:.7"> · ${y === 'all' ? clusters.length : clusters.filter(c=>c.year==y).length}</span>
        </button>`
      ).join('');
      yearTabEl.querySelectorAll('.cyt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _activeClusterYear = btn.dataset.year;
          renderClusterInbox(clusters);
        });
      });
    }

    const filtered = _activeClusterYear === 'all' ? clusters : clusters.filter(c => String(c.year) === String(_activeClusterYear));

    listEl.innerHTML = filtered.map(seq => {
      const isActive   = seq.id === _activeClusterId;
      const courseNums = [...new Set(seq.items.map(a => a.course))];
      return `<div class="risk-inbox-row ${isActive?'active':''}" data-id="${seq.id}"
          style="border-left-color:#DC2626">
        <div class="rir-top">
          <span class="rir-tag" style="color:#991B1B;background:#FEE2E2">🔴 B2B · Yr ${seq.year||'?'}</span>
          <span class="rir-sev sev-${seq.severity}">${seq.severity}</span>
        </div>
        <div class="rir-date">${formatD(seq.startDate)} → ${formatD(seq.endDate)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin:3px 0">
          ${courseNums.map(cn => `<span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:10px;color:#fff;background:${colorMap[cn]||'#6366f1'}">${cn}</span>`).join('')}
        </div>
        <div class="rir-courses">${seq.courses.slice(0,2).join(', ')}${seq.courses.length>2?` +${seq.courses.length-2}`:''}</div>
        <div class="rir-weight">${seq.totalWeight.toFixed(0)}% · ${seq.numDays} days · ${seq.items.length} assessments</div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.risk-inbox-row').forEach(row => {
      row.addEventListener('click', () => {
        _activeClusterId = row.dataset.id;
        listEl.querySelectorAll('.risk-inbox-row').forEach(r => r.classList.toggle('active', r.dataset.id === _activeClusterId));
        renderRiskDetail(filtered.find(s => s.id === _activeClusterId), detailEl);
      });
    });

    // Auto-select first
    if (!filtered.find(s => s.id === _activeClusterId) && filtered.length) {
      _activeClusterId = filtered[0].id;
      listEl.querySelector('.risk-inbox-row')?.classList.add('active');
    }
    renderRiskDetail(filtered.find(s => s.id === _activeClusterId), detailEl);
  }

  function renderRiskDetail(seq, el) {
    if (!el) return;
    if (!seq) { el.innerHTML = '<div class="risk-detail-empty">← Select an alert to see details</div>'; return; }
    const isOverlap   = seq.alertType === 'same-day';
    const accentColor = isOverlap ? '#D97706' : '#DC2626';
    const bgColor     = isOverlap ? '#FEF3C7' : '#FEE2E2';
    el.innerHTML = `
      <div class="rid-header" style="border-top:4px solid ${accentColor}">
        <span class="rid-type-tag" style="color:${accentColor};background:${bgColor}">
          ${isOverlap ? '📅 SAME-DAY OVERLAP' : `🔴 BACK-TO-BACK DAYS · YEAR ${seq.year||'?'}`}
        </span>
        <h3 class="rid-title">${seq.label}</h3>
        <div class="rid-meta">
          📅 ${formatD(seq.startDate)}${seq.daySpan>0?' → '+formatD(seq.endDate):''}
          &nbsp;·&nbsp; <strong>${seq.totalWeight.toFixed(0)}%</strong> combined weight
          &nbsp;·&nbsp; ${seq.items.length} assessments
        </div>
        <div class="rid-courses">${seq.courses.map(name=>`<span class="course-chip">${name}</span>`).join('')}</div>
      </div>
      <div class="rid-items">
        ${seq.items.map(a => {
          const col = colorMap[a.course] || '#6366f1';
          return `<div class="rid-item" style="border-left:4px solid ${col}">
            <div class="rid-item-header">
              <span class="rid-course-badge" style="background:${col}">${a.course}</span>
              <span class="rid-item-type-chip" style="background:${col}18;color:${col};border:1px solid ${col}40">${a.type}</span>
              ${a.weight ? `<span class="rid-item-weight">${a.weight}%</span>` : ''}
            </div>
            <div class="rid-item-name">${a.courseName}</div>
            <div class="rid-item-date">📅 Due/Scheduled: ${a.effectiveDate ? formatD(a.effectiveDate) : (a.startDate ? formatD(a.startDate) : 'TBD')}${a.endTime && a.endTime !== 'N/A' ? ' · ends ' + a.endTime.slice(0,5) : (a.startTime && a.startTime !== 'N/A' ? ' · ' + a.startTime.slice(0,5) : '')}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="rid-actions">
        <button class="btn btn-primary rid-cal-btn">📅 View in Calendar</button>
        <button class="btn btn-secondary rid-filter-btn">Filter to these</button>
      </div>`;

    el.querySelector('.rid-cal-btn').addEventListener('click', () => {
      StateManager.set('filteredData', seq.items);
      if (seq.startDate) StateManager.set('calendarDate', new Date(seq.startDate));
      StateManager.set('calendarReturnTab', 'risk');
      StateManager.set('calendarReturnLabel', isOverlap ? '← Back to Same-Day Overlaps' : '← Back to Back-to-Back Days');
      switchTab('calendar');
    });
    el.querySelector('.rid-filter-btn').addEventListener('click', () => {
      StateManager.set('filteredData', seq.items);
      renderCustomFilterBanner();
    });
  }

  // ── Insights (used by Risk tab insights subtab) ──────────────────────────
  function renderInsights(insights) {
    renderInsightsTimeline(insights);
    renderInsightsTable(insights);

    const filterEl = document.getElementById('insights-type-filters');
    if (!filterEl) return;
    const types = ['all', ...new Set(insights.map(i => i.alertType))];
    const labels = { all:'All', 'same-day':'📅 Same-Day', cluster:'🔴 Clusters',
      'exam-concentration':'🎓 Exams', 'weight-overload':'⚖️ Weight' };
    filterEl.innerHTML = types.map(t =>
      `<button class="insight-filter-btn ${t===_activeInsightType?'active':''}" data-itype="${t}">${labels[t]||t}</button>`
    ).join('');
    filterEl.querySelectorAll('.insight-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeInsightType = btn.dataset.itype;
        filterEl.querySelectorAll('.insight-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.itype===_activeInsightType));
        renderInsightsTable(insights);
      });
    });
  }

  function renderInsightsTimeline(insights) {
    const el = document.getElementById('insights-timeline');
    if (!el) return;
    const dated = insights.filter(i => i.startDate).sort((a,b) => a.startDate - b.startDate);
    if (!dated.length) { el.style.display='none'; return; }
    el.style.display = '';
    const months = {};
    dated.forEach(ins => {
      const m = ins.startDate.toISOString().slice(0,7);
      if (!months[m]) months[m] = [];
      months[m].push(ins);
    });
    el.innerHTML = `<div class="timeline-scroll">` +
      Object.entries(months).map(([m, items]) => {
        const label = new Date(m+'-01').toLocaleDateString('en-CA',{month:'short',year:'2-digit'});
        const dots  = items.map(ins =>
          `<span class="tl-dot" title="${ins.title}" style="background:${ins.badgeColor}" data-iid="${ins.id}"></span>`
        ).join('');
        return `<div class="tl-month">
          <div class="tl-month-label">${label}</div>
          <div class="tl-dots">${dots}</div>
          <div class="tl-count">${items.length}</div>
        </div>`;
      }).join('') + `</div>`;
  }

  function renderInsightsTable(insights) {
    const tbody = document.getElementById('insights-tbody');
    if (!tbody) return;
    const filtered = _activeInsightType === 'all' ? insights : insights.filter(i => i.alertType === _activeInsightType);
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="padding:20px">No insights for this filter</td></tr>`;
      return;
    }
    const extractWeight = detail => { const m = detail.match(/(\d+(?:\.\d+)?)%/); return m ? m[1]+'%' : '—'; };
    tbody.innerHTML = filtered.map((ins, i) => `
      <tr class="it-row" data-insight="${i}" data-iid="${ins.id}">
        <td><span class="it-badge" style="background:${ins.badgeColor}18;color:${ins.badgeColor};border-color:${ins.badgeColor}30">${ins.icon} ${ins.badge}</span></td>
        <td class="it-date">${ins.startDate ? formatD(ins.startDate) : '—'}</td>
        <td class="it-year">${ins.alertType==='cluster'?(ins.badge.match(/YEAR (\d)/)?.[1]||'—'):'—'}</td>
        <td class="it-title">${ins.title}</td>
        <td class="it-weight" title="Combined weight of all assessments in this alert">${extractWeight(ins.detail)}</td>
        <td><button class="it-goto">→ Calendar</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('.it-row').forEach(row => {
      const doNav = () => {
        const idx = parseInt(row.dataset.insight);
        const ins = filtered[idx];
        if (!ins) return;
        const all  = StateManager.get('assessments');
        const filt = all.filter(ins.filterFn);
        StateManager.set('filteredData', filt);
        const first = filt.filter(a => a.effectiveDate).sort((a,b) => a.effectiveDate - b.effectiveDate)[0];
        if (first) StateManager.set('calendarDate', new Date(first.effectiveDate));
        StateManager.set('calendarReturnTab', 'risk');
        StateManager.set('calendarReturnLabel', '← Back to Insights');
        switchTab('calendar');
      };
      row.addEventListener('click', doNav);
      row.querySelector('.it-goto').addEventListener('click', e => { e.stopPropagation(); doNav(); });
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // DATA TABLE TAB
  // ════════════════════════════════════════════════════════════════════════════
  let _dtSortCol = 'effectiveDate';
  let _dtSortDir = 'asc';

  function renderDataTable() {
    const data  = StateManager.get('filteredData');
    const countEl = document.getElementById('dt-count');
    if (countEl) countEl.textContent = `${data.length} assessments`;

    const sorted = [...data].sort((a, b) => {
      let av = a[_dtSortCol], bv = b[_dtSortCol];
      if (av instanceof Date) av = av?.getTime() || 0;
      if (bv instanceof Date) bv = bv?.getTime() || 0;
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return _dtSortDir === 'asc' ? -1 : 1;
      if (av > bv) return _dtSortDir === 'asc' ?  1 : -1;
      return 0;
    });

    const tbody = document.getElementById('dt-tbody');
    if (!tbody) return;

    const TYPE_COLORS = {
      'Quiz':'#06B6D4','Midterm':'#F59E0B','Final Exam':'#EF4444',
      'Assignment':'#8B5CF6','Group Assignment':'#6366F1','Lab':'#10B981',
      'OSCE':'#F97316','Simulation':'#3B82F6','Bellringer':'#EC4899',
    };

    tbody.innerHTML = sorted.map(a => {
      const dot   = colorMap[a.course] || '#6366f1';
      const tcolor= TYPE_COLORS[a.type] || '#9AA0AE';
      return `<tr class="dt-row" data-id="${a._id}">
        <td><span class="dt-course-badge" style="background:${dot}">${a.course}</span></td>
        <td style="text-align:center;font-weight:700;color:var(--text-2)">${a.year}</td>
        <td class="dt-name" title="${a.courseName}">${a.courseName}</td>
        <td><span class="dt-type-chip" style="background:${tcolor}18;color:${tcolor}">${a.type}</span></td>
        <td class="dt-detail" title="${a.details||''}">${a.details||'—'}</td>
        <td class="dt-weight" style="color:${a.weight>=30?'var(--red)':a.weight>=20?'var(--amber)':'var(--text-2)'}">${a.weightRaw||'—'}</td>
        <td class="dt-date">${a.effectiveDate?formatD(a.effectiveDate):'TBD'}</td>
        <td style="color:var(--text-3);font-size:11px">${a.startTime?a.startTime.slice(0,5):'—'}</td>
        <td style="color:var(--text-3);font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.location||'—'}</td>
        <td style="color:var(--text-3);font-size:11px">${a.format||'—'}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.dt-row').forEach(row => {
      row.addEventListener('click', () => openAssessmentModal(row.dataset.id));
    });

    // Column sort headers
    const table = document.getElementById('dt-table');
    if (table) {
      table.querySelectorAll('thead th').forEach(th => {
        th.classList.remove('sort-asc','sort-desc');
        if (th.dataset.col === _dtSortCol) th.classList.add(_dtSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        th.onclick = () => {
          if (_dtSortCol === th.dataset.col) _dtSortDir = _dtSortDir === 'asc' ? 'desc' : 'asc';
          else { _dtSortCol = th.dataset.col; _dtSortDir = 'asc'; }
          renderDataTable();
        };
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CALENDAR TAB
  // ════════════════════════════════════════════════════════════════════════════
  function renderCalendar() {
    const view        = StateManager.get('calendarView');
    const date        = StateManager.get('calendarDate');
    const data        = StateManager.get('filteredData');
    const returnTab   = StateManager.get('calendarReturnTab');
    const returnLabel = StateManager.get('calendarReturnLabel');
    const el          = document.getElementById('calendar-body');
    if (!el) return;

    // Update header
    const label = view === 'month'
      ? CalendarEngine.monthLabel(date)
      : CalendarEngine.weekLabel(CalendarEngine.buildWeekDays(date));
    document.getElementById('cal-label').textContent = label;

    // Show/update return button
    let returnBar = document.getElementById('cal-return-bar');
    if (returnTab) {
      if (!returnBar) {
        returnBar = document.createElement('div');
        returnBar.id = 'cal-return-bar';
        returnBar.className = 'cal-return-bar';
        document.getElementById('tab-calendar').insertBefore(returnBar, document.querySelector('.cal-toolbar'));
      }
      returnBar.innerHTML = `
        <button class="cal-return-btn" id="cal-return-btn">
          ${returnLabel || '← Back'}
        </button>
        <span class="cal-return-note">Showing filtered assessments · 
          <button class="cal-return-clear">Show all</button>
        </span>`;
      returnBar.querySelector('#cal-return-btn').addEventListener('click', () => {
        switchTab(returnTab);
        StateManager.set('calendarReturnTab', null);
      });
      returnBar.querySelector('.cal-return-clear').addEventListener('click', () => {
        StateManager.set('filteredData', StateManager.get('assessments'));
        StateManager.set('calendarReturnTab', null);
        returnBar.remove();
        renderCalendar();
      });
    } else if (returnBar) {
      returnBar.remove();
    }

    if (view === 'month') renderMonthView(el, date, data);
    else                   renderWeekView(el, date, data);
  }

  function renderMonthView(container, date, data) {
    const cells = CalendarEngine.buildMonthGrid(date.getFullYear(), date.getMonth());
    const days  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    let html = `<div class="cal-month">
      <div class="cal-dow-header">${days.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid">`;

    cells.forEach(cell => {
      const events  = CalendarEngine.getEventsForDate(data, cell.date);
      const isToday = CalendarEngine.isToday(cell.date);
      const cls     = ['cal-cell', !cell.current && 'cal-other', isToday && 'cal-today'].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${cell.date.toISOString().slice(0,10)}">
        <div class="cal-date-num ${isToday?'today-dot':''}">${cell.date.getDate()}</div>
        <div class="cal-events">`;
      events.slice(0,3).forEach(ev => {
        const color = colorMap[ev.course] || '#6366f1';
        html += `<div class="cal-event" style="background:${color}20;border-left:3px solid ${color}"
          data-id="${ev._id}" title="${ev.courseName}: ${ev.type}${ev.details?' – '+ev.details:''}">
          <span class="cal-event-dot" style="background:${color}"></span>
          <span class="cal-event-text">${ev.type}${ev.weight?` ${ev.weight}%`:''}</span>
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

  function renderWeekView(container, date, data) {
    const days   = CalendarEngine.buildWeekDays(date);
    const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    let html = `<div class="cal-week">
      <div class="cal-week-header">`;
    days.forEach((d,i) => {
      const isToday = CalendarEngine.isToday(d);
      html += `<div class="cal-week-day-head ${isToday?'today-head':''}">
        <div class="week-dow">${DAYS[i]}</div>
        <div class="week-date ${isToday?'today-dot':''}">${d.getDate()}</div>
      </div>`;
    });
    html += '</div><div class="cal-week-body">';

    days.forEach(d => {
      const events = CalendarEngine.getEventsForDate(data, d);
      const isToday = CalendarEngine.isToday(d);
      html += `<div class="cal-week-col ${isToday?'today-col':''}">`;
      events.forEach(ev => {
        const color = colorMap[ev.course] || '#6366f1';
        html += `<div class="cal-week-event" style="background:${color}18;border-left:4px solid ${color}"
          data-id="${ev._id}">
          <div class="wev-course-num" style="color:${color}">${ev.course}</div>
          <div class="wev-type" style="color:${color}">${ev.type}</div>
          <div class="wev-course">${ev.courseName.split(' ').slice(0,3).join(' ')}</div>
          ${ev.weight ? `<div class="wev-weight" style="color:${color}">${ev.weight}%</div>` : ''}
          ${ev.startTime ? `<div class="wev-time">${ev.startTime.slice(0,5)}</div>` : ''}
        </div>`;
      });
      if (!events.length) html += `<div class="wev-empty"></div>`;
      html += '</div>';
    });

    html += '</div></div>';
    container.innerHTML = html;
    container.querySelectorAll('.cal-week-event').forEach(ev => {
      ev.addEventListener('click', () => openAssessmentModal(ev.dataset.id));
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ANALYTICS TAB
  // ════════════════════════════════════════════════════════════════════════════
  function renderAnalytics() {
    // Analytics always shows ALL assessments regardless of active filters.
    // It has its own internal filters (year, course) if needed in future.
    const data = StateManager.get('assessments');
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
    const dm = StateManager.get('darkMode');
    const gc = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const lc = dm ? '#94a3b8' : '#64748b';
    window._weeklyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels:   weeks.map(w => w.week.slice(5)),
        datasets: [
          { label: 'Count', data: weeks.map(w => w.count), backgroundColor: '#3B82F620', borderColor: '#3B82F6', borderWidth: 2, borderRadius: 4, yAxisID: 'y' },
          { label: 'Weight %', data: weeks.map(w => parseFloat(w.totalWeight.toFixed(1))), type: 'line', borderColor: '#F59E0B', backgroundColor: '#F59E0B20', tension: 0.4, fill: true, yAxisID: 'y1', pointRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: lc } } },
        scales: {
          x:  { grid: { color: gc }, ticks: { color: lc, maxTicksLimit: 12 } },
          y:  { grid: { color: gc }, ticks: { color: lc }, position: 'left', beginAtZero: true, title: { display: true, text: 'Assessments', color: lc } },
          y1: { grid: { drawOnChartArea: false }, ticks: { color: '#F59E0B' }, position: 'right', beginAtZero: true, title: { display: true, text: 'Weight %', color: '#F59E0B' } },
        },
      },
    });
  }

  function renderTypeDistribution(data) {
    const types  = AnalyticsEngine.getTypeDistribution(data);
    const canvas = document.getElementById('type-chart');
    if (!canvas) return;
    if (window._typeChart) window._typeChart.destroy();
    const dm = StateManager.get('darkMode');
    const lc = dm ? '#94a3b8' : '#64748b';
    const colors = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#EC4899','#84CC16','#F97316'];
    window._typeChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels:   types.map(t => t.type),
        datasets: [{ data: types.map(t => t.count), backgroundColor: colors.slice(0,types.length), borderWidth: 2,
          borderColor: dm ? '#1e293b' : '#ffffff' }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: lc, padding: 12, font: { size: 11 } } } },
      },
    });
  }

  function renderAvgWeightByType(data) {
    const canvas = document.getElementById('avg-weight-chart');
    if (!canvas) return;
    if (window._avgWeightChart) window._avgWeightChart.destroy();

    // Group by type, compute average weight
    const byType = {};
    data.filter(a => a.weight !== null).forEach(a => {
      if (!byType[a.type]) byType[a.type] = [];
      byType[a.type].push(a.weight);
    });
    const types  = Object.entries(byType)
      .map(([type, weights]) => ({ type, avg: weights.reduce((s,w)=>s+w,0)/weights.length, n: weights.length }))
      .sort((a,b) => b.avg - a.avg);

    const isDark = document.documentElement.classList.contains('dark');
    const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const lc = isDark ? '#7A95B0' : '#6B7280';

    window._avgWeightChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels:   types.map(t => t.type),
        datasets: [{
          label:           'Avg Weight %',
          data:            types.map(t => parseFloat(t.avg.toFixed(1))),
          backgroundColor: '#1A3A6B22',
          borderColor:     '#1A3A6B',
          borderWidth:     1.5,
          borderRadius:    4,
          borderSkipped:   false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: ctx => ` ${ctx.parsed.x.toFixed(1)}% avg  (n=${types[ctx.dataIndex].n})`,
          }},
        },
        scales: {
          x: { grid: { color: gc }, ticks: { color: lc }, title: { display: true, text: 'Average Weight (%)', color: lc, font: { size: 11 } } },
          y: { grid: { color: gc }, ticks: { color: lc, font: { size: 11 } } },
        },
      },
    });
  }

  function renderWeeklyHeatmap(data) {
    const el = document.getElementById('heatmap-container');
    if (!el) return;

    const weeks = AnalyticsEngine.getByWeek(data);
    if (!weeks.length) { el.innerHTML = '<div class="empty-state">No dated assessments</div>'; return; }

    const counts = weeks.map(w => w.count);
    const max    = Math.max(...counts, 1);

    // 5 shades based on count relative to max
    function shade(count) {
      const t = count / max;
      if (t === 0)   return { bg: '#EEF0F4', text: '#9AA0AE' };
      if (t < 0.25)  return { bg: '#C7D9F0', text: '#1A3A6B' };
      if (t < 0.50)  return { bg: '#7AAED6', text: '#0F2040' };
      if (t < 0.75)  return { bg: '#2E6FAF', text: '#ffffff' };
      return                 { bg: '#1A3A6B', text: '#ffffff' };
    }

    const cells = weeks.map(w => {
      const s     = shade(w.count);
      const label = new Date(w.week + 'T00:00:00').toLocaleDateString('en-CA', { month:'short', day:'numeric' });
      return `<div class="heatmap-cell" style="background:${s.bg}" title="${label}: ${w.count} assessments" data-week="${w.week}">
        <span class="hm-count" style="color:${s.text}">${w.count}</span>
        <span class="hm-week"  style="color:${s.text};opacity:.75">${label}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="heatmap-grid">${cells}</div>
      <div class="heatmap-legend">
        <span>Fewer</span>
        <div class="hm-legend-scale">
          ${['#EEF0F4','#C7D9F0','#7AAED6','#2E6FAF','#1A3A6B'].map(bg =>
            `<div class="hm-legend-swatch" style="background:${bg}"></div>`).join('')}
        </div>
        <span>More assessments</span>
      </div>`;

    el.querySelectorAll('.heatmap-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const weekDate = new Date(cell.dataset.week + 'T00:00:00');
        const week = weeks.find(w => w.week === cell.dataset.week);
        if (week) {
          StateManager.set('filteredData', week.assessments);
          StateManager.set('calendarDate', weekDate);
          StateManager.set('calendarView', 'week');
          StateManager.set('calendarReturnTab', 'analytics');
          StateManager.set('calendarReturnLabel', '← Back to Analytics');
          switchTab('calendar');
        }
      });
    });
  }

  function renderOverlapAnalysis(data) {
    const overlaps = AnalyticsEngine.getOverlapDays(data);
    const el       = document.getElementById('overlap-list');
    if (!el) return;
    if (!overlaps.length) { el.innerHTML = '<div class="empty-state">No overlapping assessment days</div>'; return; }
    el.innerHTML = overlaps.slice(0,10).map(o => {
      const date = new Date(o.date + 'T00:00:00');
      const label= date.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' });
      const bar  = Math.min(100, o.count * 20);
      return `<div class="overlap-row" role="button" tabindex="0" data-date="${o.date}">
        <div class="overlap-date">${label}</div>
        <div class="overlap-bar-wrap"><div class="overlap-bar" style="width:${bar}%"></div></div>
        <div class="overlap-count">${o.count} assessments</div>
      </div>`;
    }).join('');

    el.querySelectorAll('.overlap-row').forEach(row => {
      row.addEventListener('click', () => {
        const d   = new Date(row.dataset.date + 'T00:00:00');
        StateManager.set('calendarDate', d);
        StateManager.set('calendarView', 'week');
        StateManager.set('calendarReturnTab', 'analytics');
        StateManager.set('calendarReturnLabel', '← Back to Analytics');
        switchTab('calendar');
      });
    });
  }

  function renderCourseBreakdown(data) {
    const courses = AnalyticsEngine.getByCourse(data);
    const el      = document.getElementById('course-breakdown');
    if (!el) return;
    el.innerHTML = courses.map(c => {
      const color = colorMap[c.courseId] || '#6366f1';
      return `<div class="course-row">
        <div class="course-row-dot" style="background:${color}"></div>
        <div class="course-row-name">${c.courseName}</div>
        <div class="course-row-badges">
          ${Object.entries(c.types).map(([t,items]) =>
            `<span class="type-badge">${t}: ${items.length}</span>`
          ).join('')}
        </div>
        <div class="course-row-weight">${c.totalWeight.toFixed(0)}%</div>
      </div>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODALS
  // ════════════════════════════════════════════════════════════════════════════
  function openAssessmentModal(id) {
    const data = StateManager.get('assessments');
    const a    = data.find(x => x._id === id);
    if (!a) return;
    StateManager.set('selectedAssessment', a);
    const color = colorMap[a.course] || '#6366f1';
    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-box">
        <div class="modal-strip" style="background:${color}"></div>
        <button class="modal-close" id="modal-close">✕</button>
        <div class="modal-header">
          <span class="modal-type-badge" style="background:${color}20;color:${color}">${a.type}</span>
          <h2 class="modal-title">${a.courseName}</h2>
          <div class="modal-subtitle">Course ${a.course} · Year ${a.year} · ${a.term}</div>
        </div>
        <div class="modal-body">
          ${modalRow('📋', 'Details',       a.details         || '—')}
          ${modalRow('⚖️', 'Weight',        a.weightRaw       || '—')}
          ${modalRow('📅', 'Date',          a.effectiveDate ? formatD(a.effectiveDate) : '—')}
          ${modalRow('🕐', 'Time',          a.startTime ? `${a.startTime.slice(0,5)}${a.endTime?' – '+a.endTime.slice(0,5):''}` : '—')}
          ${modalRow('⏱️', 'Duration',      a.duration         || '—')}
          ${modalRow('📍', 'Location',      a.location         || '—')}
          ${modalRow('📖', 'Book Policy',   a.openClosebook    || '—')}
          ${modalRow('💻', 'Format',        a.format           || '—')}
          ${modalRow('🔢', 'Calculator',    a.calculator       || '—')}
          ${a.notes ? modalRow('📝', 'Notes', a.notes) : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-view-cal">View in Calendar</button>
          <button class="btn btn-primary" id="modal-done">Done</button>
        </div>
      </div>`;
    modal.classList.add('open');
    modal.querySelector('#modal-close').onclick    = closeModal;
    modal.querySelector('#modal-backdrop').onclick = closeModal;
    modal.querySelector('#modal-done').onclick     = closeModal;
    modal.querySelector('#modal-view-cal').onclick = () => {
      closeModal();
      if (a.effectiveDate) {
        StateManager.set('calendarDate', a.effectiveDate);
        StateManager.set('calendarView', 'month');
      }
      switchTab('calendar');
    };
  }

  function modalRow(icon, label, value) {
    return `<div class="modal-row"><span class="mrow-icon">${icon}</span>
      <span class="mrow-label">${label}</span><span class="mrow-value">${value}</span></div>`;
  }

  function openRiskModal(seq) {
    const modal = document.getElementById('modal');
    const clr   = { critical: '#EF4444', high: '#F97316', medium: '#F59E0B' }[seq.severity];
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-box">
        <div class="modal-strip" style="background:${clr}"></div>
        <button class="modal-close" id="modal-close">✕</button>
        <div class="modal-header">
          <span class="modal-type-badge" style="background:${clr}20;color:${clr}">⚠️ RISK SEQUENCE</span>
          <h2 class="modal-title">${seq.label}</h2>
          <div class="modal-subtitle">${formatD(seq.startDate)} → ${formatD(seq.endDate)}</div>
        </div>
        <div class="modal-body">
          <div class="risk-modal-courses">${seq.courses.map(c=>`<span class="course-chip">${c}</span>`).join('')}</div>
          <div class="risk-modal-items">
            ${seq.items.map(a => {
              const col = colorMap[a.course] || '#6366f1';
              return `<div class="rmi" style="border-left:3px solid ${col}">
                <div class="rmi-type" style="color:${col}">${a.type}${a.weight?` — ${a.weight}%`:''}</div>
                <div class="rmi-name">${a.courseName}</div>
                <div class="rmi-date">${a.effectiveDate?formatD(a.effectiveDate):'TBD'}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="risk-view-cal">View in Calendar</button>
          <button class="btn btn-primary" id="modal-done">Close</button>
        </div>
      </div>`;
    modal.classList.add('open');
    modal.querySelector('#modal-close').onclick    = closeModal;
    modal.querySelector('#modal-backdrop').onclick = closeModal;
    modal.querySelector('#modal-done').onclick     = closeModal;
    modal.querySelector('#risk-view-cal').onclick  = () => {
      closeModal();
      StateManager.set('filteredData', seq.items);
      StateManager.set('calendarDate', seq.startDate);
      switchTab('calendar');
    };
  }

  function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('open');
    modal.innerHTML = '';
  }

  // ── UI Setup ──────────────────────────────────────────────────────────────
  function setupGlobalUI() {
    // Tab navigation (top tabs)
    document.querySelectorAll('.top-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Card "view all" links
    document.querySelectorAll('.card-link-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Custom filter banner clear
    const cfbClear = document.getElementById('cfb-clear');
    if (cfbClear) cfbClear.addEventListener('click', () => {
      StateManager.set('filteredData', StateManager.get('assessments'));
      StateManager.set('calendarReturnTab', null);
      document.getElementById('custom-filter-banner')?.classList.add('hidden');
      renderActiveTab(StateManager.get('activeTab'));
    });

    // Global filter clear
    const gfc = document.getElementById('global-filter-clear');
    if (gfc) gfc.addEventListener('click', () => {
      StateManager.resetFilters();
      document.getElementById('filter-course').value = 'all';
      document.getElementById('filter-type').value   = 'all';
      document.getElementById('filter-year').value   = 'all';
      document.getElementById('filter-month').value  = 'all';
      document.getElementById('search-input').value  = '';
    });

    // Calendar nav
    document.getElementById('cal-prev').addEventListener('click', () => {
      const view = StateManager.get('calendarView');
      const date = StateManager.get('calendarDate');
      StateManager.set('calendarDate', view === 'month' ? CalendarEngine.prevMonth(date) : CalendarEngine.prevWeek(date));
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      const view = StateManager.get('calendarView');
      const date = StateManager.get('calendarDate');
      StateManager.set('calendarDate', view === 'month' ? CalendarEngine.nextMonth(date) : CalendarEngine.nextWeek(date));
    });
    document.getElementById('cal-today').addEventListener('click', () => {
      StateManager.set('calendarDate', new Date());
    });
    document.getElementById('cal-month-btn').addEventListener('click', () => StateManager.set('calendarView','month'));
    document.getElementById('cal-week-btn').addEventListener('click',  () => StateManager.set('calendarView','week'));

    // Dark mode
    document.getElementById('dark-toggle').addEventListener('click', () => {
      StateManager.set('darkMode', !StateManager.get('darkMode'));
    });

    // Filters
    document.getElementById('filter-course').addEventListener('change', e => StateManager.setFilters({ course: e.target.value }));
    document.getElementById('filter-type').addEventListener('change',   e => StateManager.setFilters({ type:   e.target.value }));
    document.getElementById('filter-year').addEventListener('change',   e => StateManager.setFilters({ year:   e.target.value }));
    document.getElementById('filter-month').addEventListener('change',  e => StateManager.setFilters({ month:  e.target.value }));
    document.getElementById('search-input').addEventListener('input',   e => StateManager.setFilters({ search: e.target.value }));
    document.getElementById('reset-filters').addEventListener('click',  () => {
      StateManager.resetFilters();
      document.getElementById('filter-course').value = 'all';
      document.getElementById('filter-type').value   = 'all';
      document.getElementById('filter-year').value   = 'all';
      document.getElementById('filter-month').value  = 'all';
      document.getElementById('search-input').value  = '';
    });


    // Export CSV
    document.getElementById('export-btn').addEventListener('click', exportCSV);

    // Keyboard: ESC closes modal
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }

  function switchTab(tab) {
    // Clear calendar return bar if navigating away from calendar manually
    if (tab !== 'calendar') {
      StateManager.set('calendarReturnTab', null);
      const bar = document.getElementById('cal-return-bar');
      if (bar) bar.remove();
    }
    StateManager.set('activeTab', tab);
  }

  function populateFilterDropdowns(all) {
    const courseSelect = document.getElementById('filter-course');
    const typeSelect   = document.getElementById('filter-type');
    const yearSelect   = document.getElementById('filter-year');

    if (courseSelect.dataset.populated !== '1') {
      const courses = [...new Map(all.map(a => [a.course, a.courseName])).entries()].sort((a,b)=>a[0]-b[0]);
      courses.forEach(([id, name]) => {
        const opt = document.createElement('option');
        opt.value = id; opt.textContent = `${id} – ${name.slice(0,30)}`;
        courseSelect.appendChild(opt);
      });
      courseSelect.dataset.populated = '1';
    }
    if (typeSelect.dataset.populated !== '1') {
      const types = [...new Set(all.map(a => a.type))].sort();
      types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        typeSelect.appendChild(opt);
      });
      typeSelect.dataset.populated = '1';
    }
    if (yearSelect.dataset.populated !== '1') {
      const years = [...new Set(all.map(a => a.year))].sort();
      years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = `Year ${y}`;
        yearSelect.appendChild(opt);
      });
      yearSelect.dataset.populated = '1';
    }
  }

  function applyDarkMode(on) {
    document.documentElement.classList.toggle('dark', on);
    const btn = document.getElementById('dark-toggle');
    if (btn) btn.textContent = on ? '☀️' : '🌙';
  }

  function exportCSV() {
    const data   = StateManager.get('filteredData');
    const header = ['Course','Year','Course_name','Type','Assessment_Details','Weight','Date','Start_time','End_time','Location','Format','Notes'];
    const rows   = data.map(a => [
      a.course, a.year, `"${a.courseName}"`, a.type, `"${a.details}"`,
      a.weightRaw, a.effectiveDate ? a.effectiveDate.toISOString().slice(0,10) : '',
      a.startTime, a.endTime, `"${a.location}"`, a.format, `"${a.notes}"`,
    ]);
    const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'assessments_export.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // Utility
  function formatD(date) {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-CA', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
  }

})();