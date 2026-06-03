// analyticsEngine.js — Academic Analytics Aggregation Engine

const AnalyticsEngine = (() => {

  function getKPIs(data) {
    const withDates = data.filter(a => a.effectiveDate);
    const byType    = groupBy(data, 'type');
    const byCourse  = groupBy(data, 'course');
    const weights   = data.filter(a => a.weight !== null).map(a => a.weight);
    const avgWeight = weights.length ? (weights.reduce((a,b)=>a+b,0)/weights.length).toFixed(1) : 0;

    return {
      total:          data.length,
      withDates:      withDates.length,
      quizzes:        (byType['Quiz']            || []).length,
      midterms:       (byType['Midterm']         || []).length,
      finals:         (byType['Final Exam']      || []).length,
      assignments:    ((byType['Assignment']||[]).length + (byType['Group Assignment']||[]).length),
      labs:           (byType['Lab']             || []).length,
      osces:          (byType['OSCE']            || []).length,
      courses:        Object.keys(byCourse).length,
      avgWeight:      parseFloat(avgWeight),
    };
  }

  function getByMonth(data) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const counts = {};
    months.forEach(m => counts[m] = 0);
    data.forEach(a => {
      if (a.effectiveDate) {
        const m = months[a.effectiveDate.getMonth()];
        counts[m] = (counts[m] || 0) + 1;
      }
    });
    return months.filter(m => counts[m] > 0).map(m => ({ month: m, count: counts[m] }));
  }

  function getByWeek(data) {
    const weeks = {};
    data.forEach(a => {
      if (!a.effectiveDate) return;
      const d    = new Date(a.effectiveDate);
      const day  = d.getDay();
      const mon  = new Date(d);
      mon.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1));
      const key  = mon.toISOString().slice(0, 10);
      if (!weeks[key]) weeks[key] = { week: key, count: 0, totalWeight: 0, assessments: [] };
      weeks[key].count++;
      weeks[key].totalWeight += a.weight || 0;
      weeks[key].assessments.push(a);
    });
    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));
  }

  function getByCourse(data) {
    const grouped = groupBy(data, 'course');
    return Object.entries(grouped).map(([courseId, items]) => ({
      courseId:   parseInt(courseId),
      courseName: items[0].courseName,
      count:      items.length,
      types:      groupBy(items, 'type'),
      totalWeight: items.filter(a=>a.weight).reduce((s,a)=>s+a.weight,0),
    })).sort((a,b) => b.count - a.count);
  }

  function getTypeDistribution(data) {
    const byType = groupBy(data, 'type');
    return Object.entries(byType).map(([type, items]) => ({
      type,
      count:       items.length,
      avgWeight:   items.filter(a=>a.weight).reduce((s,a,_,arr)=>s+a.weight/arr.length,0).toFixed(1),
    })).sort((a,b) => b.count - a.count);
  }

  function getWeightConcentration(data) {
    const months = {};
    data.filter(a => a.effectiveDate && a.weight).forEach(a => {
      const m = a.effectiveDate.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!months[m]) months[m] = { month: m, totalWeight: 0, count: 0 };
      months[m].totalWeight += a.weight;
      months[m].count++;
    });
    return Object.values(months).sort((a,b) => b.totalWeight - a.totalWeight);
  }

  function getOverlapDays(data) {
    // Group by year + day — overlaps only count within the same academic year
    const byYearDay = {};
    data.filter(a => a.effectiveDate && a.weight !== null && a.weight >= 10).forEach(a => {
      const dateKey = a.effectiveDate.toISOString().slice(0,10);
      const key = `${a.year}__${dateKey}`;
      if (!byYearDay[key]) byYearDay[key] = [];
      byYearDay[key].push(a);
    });
    return Object.entries(byYearDay)
      .filter(([, items]) => new Set(items.map(a => a.course)).size >= 2)
      .map(([key, items]) => ({
        date:  key.split('__')[1],
        year:  items[0]?.year,
        count: items.length,
        assessments: items,
      }))
      .sort((a,b) => b.count - a.count);
  }

  // Utility
  function groupBy(arr, key) {
    return arr.reduce((acc, item) => {
      const k = item[key] !== undefined ? item[key] : 'Unknown';
      if (!acc[k]) acc[k] = [];
      acc[k].push(item);
      return acc;
    }, {});
  }

  return { getKPIs, getByMonth, getByWeek, getByCourse, getTypeDistribution, getWeightConcentration, getOverlapDays, groupBy };
})();

window.AnalyticsEngine = AnalyticsEngine;