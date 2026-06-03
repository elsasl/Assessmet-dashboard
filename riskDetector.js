// riskDetector.js — Risk Sequence & Insight Detection Engine
// ALERT TYPE 1 — Same-day overlap:  2+ assessments on the same day (≥10% weight)
// ALERT TYPE 2 — Consecutive days:  3+ weekdays IN A ROW (Mon-Fri) each with ≥1 assessment ≥10%
//                Weekend days (Sat/Sun) break the streak — they are never counted.

const RiskDetector = (() => {

  const MIN_WEIGHT       = 10;  // minimum weight % to count
  const MIN_SAME_DAY     = 2;   // assessments on same day to trigger overlap alert
  const MIN_CONSEC_DAYS  = 3;   // consecutive weekdays to trigger cluster alert

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Returns true if date is Mon–Fri
  function isWeekday(date) {
    const dow = date.getDay(); // 0=Sun, 6=Sat
    return dow >= 1 && dow <= 5;
  }

  // Returns the next calendar date (regardless of weekday)
  function nextDay(date) {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // Returns the next WEEKDAY after date (skips Sat/Sun)
  function nextWeekday(date) {
    const d = nextDay(date);
    while (!isWeekday(d)) d.setDate(d.getDate() + 1);
    return d;
  }

  // Are two dates on the same calendar day?
  function sameDay(a, b) {
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  }

  // Is date B the next weekday after date A?
  function isNextWeekday(a, b) {
    return sameDay(nextWeekday(a), b);
  }

  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  // ── TYPE 1: Same-day overlaps ─────────────────────────────────────────────
  // Uses effectiveDate = end_date if available, else start date.
  // end_date is the deadline/exam date — the date that matters for scheduling.
  function detectSameDayOverlaps(data) {
    // Group by YEAR first — overlaps only matter within the same academic year
    // (students in Year 1 are not affected by Year 2 or Year 3 schedules)
    const byYearAndDay = {};
    data
      .filter(a => a.effectiveDate && a.weight !== null && a.weight >= MIN_WEIGHT)
      .forEach(a => {
        const key = `${a.year}__${dateKey(a.effectiveDate)}`;
        if (!byYearAndDay[key]) byYearAndDay[key] = [];
        byYearAndDay[key].push(a);
      });

    return Object.entries(byYearAndDay)
      // Only flag if there are 2+ DIFFERENT courses on the same day within the same year
      .filter(([, items]) => {
        const uniqueCourses = new Set(items.map(a => a.course));
        return uniqueCourses.size >= MIN_SAME_DAY;
      })
      .map(([yearDayKey, items], idx) => {
        const dateStr = yearDayKey.split('__')[1];
        const totalW  = items.reduce((s, a) => s + (a.weight || 0), 0);
        const courses = [...new Set(items.map(a => a.courseName))];
        const year    = items[0]?.year || null;
        const [y, m, d] = dateStr.split('-').map(Number);
        const date    = new Date(y, m - 1, d, 12, 0, 0);
        return {
          id:          `overlap_${idx}`,
          alertType:   'same-day',
          year,
          items,
          courses,
          date,
          startDate:   date,
          endDate:     date,
          daySpan:     0,
          totalWeight: totalW,
          count:       items.length,
          severity:    items.length >= 3 ? 'high' : 'medium',
          label:       `${items.length} assessments on the same day — Year ${year} (${totalW.toFixed(0)}% combined)`,
        };
      })
      .sort((a, b) => a.date - b.date);
  }

  // ── TYPE 2: Consecutive weekdays (per year) ───────────────────────────────
  function detectConsecutiveClusters(data) {
    // Group by academic year — streaks cannot cross year boundaries
    const byYear = {};
    data
      .filter(a => a.effectiveDate && a.weight !== null && a.weight >= MIN_WEIGHT)
      .forEach(a => {
        const y = a.year || 0;
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(a);
      });

    const clusters = [];

    Object.entries(byYear).forEach(([year, yearItems]) => {
      // Build a set of weekdays that have at least one qualifying assessment
      const dayMap = {};
      yearItems.forEach(a => {
        const d = a.effectiveDate;
        if (!isWeekday(d)) return; // ignore weekend assessments for streak
        const key = dateKey(d);
        if (!dayMap[key]) dayMap[key] = { date: new Date(d.getTime()), items: [] };
        dayMap[key].items.push(a);
      });

      // Sort those weekdays chronologically
      const weekdays = Object.values(dayMap).sort((a, b) => a.date - b.date);

      if (weekdays.length < MIN_CONSEC_DAYS) return;

      // Find runs of consecutive weekdays
      let streak = [weekdays[0]];

      for (let i = 1; i < weekdays.length; i++) {
        const prev = streak[streak.length - 1];
        if (isNextWeekday(prev.date, weekdays[i].date)) {
          // Truly the next weekday — extend streak
          streak.push(weekdays[i]);
        } else {
          // Gap — check if completed streak qualifies
          if (streak.length >= MIN_CONSEC_DAYS) {
            clusters.push(_buildCluster(streak, clusters.length, parseInt(year)));
          }
          streak = [weekdays[i]];
        }
      }
      // Check final streak
      if (streak.length >= MIN_CONSEC_DAYS) {
        clusters.push(_buildCluster(streak, clusters.length, parseInt(year)));
      }
    });

    return clusters.sort((a, b) => a.startDate - b.startDate);
  }

  function _buildCluster(dayGroups, idx, year) {
    const allItems  = dayGroups.flatMap(d => d.items);
    const courses   = [...new Set(allItems.map(a => a.courseName))];
    const totalW    = allItems.reduce((s, a) => s + (a.weight || 0), 0);
    const start     = dayGroups[0].date;
    const end       = dayGroups[dayGroups.length - 1].date;
    const daySpan   = Math.round((end - start) / (1000 * 60 * 60 * 24));
    const numDays   = dayGroups.length;
    const numItems  = allItems.length;

    let severity = 'medium';
    if (numDays >= 5 || totalW >= 120) severity = 'critical';
    else if (numDays >= 4 || totalW >= 70) severity = 'high';

    return {
      id:          `cluster_${idx}`,
      alertType:   'cluster',
      items:       allItems,
      dayGroups,
      courses,
      startDate:   start,
      endDate:     end,
      daySpan,
      numDays,
      year,
      totalWeight: totalW,
      severity,
      label:       `${numItems} assessments across ${numDays} consecutive weekdays (${totalW.toFixed(0)}% combined)`,
    };
  }

  // ── Combined entry point ──────────────────────────────────────────────────
  function detectRiskSequences(data) {
    return [
      ...detectSameDayOverlaps(data),
      ...detectConsecutiveClusters(data),
    ].sort((a, b) => a.startDate - b.startDate);
  }

  // ── Insights generator ────────────────────────────────────────────────────
  function generateInsights(data, sequences) {
    const insights = [];

    // TYPE 1 — same-day overlaps
    sequences.filter(s => s.alertType === 'same-day').forEach(ov => {
      insights.push({
        id:        `insight_${ov.id}`,
        alertType: 'same-day',
        type:      ov.severity === 'high' ? 'critical' : 'warning',
        icon:      '📅',
        badge:     'SAME-DAY OVERLAP',
        badgeColor:'#F59E0B',
        title:     `${ov.count} assessments on ${formatDate(dateKey(ov.date))}`,
        detail:    `${ov.courses.join(' · ')} — ${ov.totalWeight.toFixed(0)}% combined weight`,
        filterFn:  a => ov.items.includes(a),
        startDate: ov.startDate,
      });
    });

    // TYPE 2 — consecutive weekday clusters
    sequences.filter(s => s.alertType === 'cluster').forEach(cl => {
      const dowStart = cl.startDate.toLocaleDateString('en-CA', { weekday: 'short' });
      const dowEnd   = cl.endDate.toLocaleDateString('en-CA',   { weekday: 'short' });
      insights.push({
        id:        `insight_${cl.id}`,
        alertType: 'cluster',
        type:      cl.severity === 'critical' ? 'critical' : 'warning',
        icon:      '🔴',
        badge:     `CONSECUTIVE DAYS — YEAR ${cl.year}`,
        badgeColor:'#EF4444',
        title:     `${cl.numDays} consecutive weekdays: ${dowStart} ${formatDateShort(cl.startDate)} → ${dowEnd} ${formatDateShort(cl.endDate)}`,
        detail:    `${cl.courses.slice(0,3).join(' · ')}${cl.courses.length > 3 ? ` +${cl.courses.length-3} more` : ''} — ${cl.totalWeight.toFixed(0)}% combined`,
        filterFn:  a => cl.items.includes(a),
        startDate: cl.startDate,
      });
    });

    // Exam concentration per month
    const byMonth = {};
    data.filter(a => a.effectiveDate && (a.type === 'Final Exam' || a.type === 'Midterm')).forEach(a => {
      const m = a.effectiveDate.toISOString().slice(0, 7);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(a);
    });
    Object.entries(byMonth).forEach(([m, items]) => {
      if (items.length >= 4) {
        insights.push({
          id:        `insight_exam_${m}`,
          alertType: 'exam-concentration',
          type:      'warning',
          icon:      '🎓',
          badge:     'EXAM CONCENTRATION',
          badgeColor:'#8B5CF6',
          title:     `${items.length} exams/midterms in ${formatMonthKey(m)}`,
          detail:    `High exam density — review scheduling`,
          filterFn:  a => items.includes(a),
          startDate: new Date(m + '-01'),
        });
      }
    });

    // Weight overload per course
    const byCourse = {};
    data.filter(a => a.weight).forEach(a => {
      if (!byCourse[a.course]) byCourse[a.course] = { name: a.courseName, total: 0, items: [] };
      byCourse[a.course].total += a.weight;
      byCourse[a.course].items.push(a);
    });
    Object.values(byCourse).forEach(c => {
      if (c.total > 110) {
        insights.push({
          id:        `insight_ow_${c.name}`,
          alertType: 'weight-overload',
          type:      'info',
          icon:      '⚖️',
          badge:     'WEIGHT OVERLOAD',
          badgeColor:'#06B6D4',
          title:     `${c.name}`,
          detail:    `Declared weights total ${c.total.toFixed(0)}% — exceeds 100%`,
          filterFn:  a => c.items.includes(a),
          startDate: null,
        });
      }
    });

    return insights;
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function formatDateShort(date) {
    return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  function formatMonthKey(key) {
    const d = new Date(key + '-01');
    return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  }

  return { detectRiskSequences, detectSameDayOverlaps, detectConsecutiveClusters, generateInsights };
})();

window.RiskDetector = RiskDetector;