// dataParser.js — CSV Parsing & Data Normalization Engine

const DataParser = (() => {

  function parseCSV(rawText) {
    const lines = rawText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = parseCSVLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = values[idx] !== undefined ? values[idx].trim() : '';
      });
      records.push(obj);
    }

    return records;
  }

  // Handles quoted fields with commas inside
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function parseWeight(raw) {
    if (!raw || raw === 'N/A' || raw === '') return null;
    if (raw.toLowerCase() === 'credit/fail') return 0;
    const num = parseFloat(raw.replace('%', ''));
    return isNaN(num) ? null : num;
  }

  function parseDate(dateStr) {
    if (!dateStr || dateStr === 'N/A' || dateStr === 'Varies') return null;
    // For date-only strings like "2026-02-09", parse as local noon to avoid
    // UTC midnight → previous day shift in negative-offset timezones (e.g. Calgary UTC-6).
    // Strings with time already embedded are parsed as-is.
    let normalized = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      // Date only — use local noon
      const [y, m, d] = normalized.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  function normalizeType(raw) {
    if (!raw) return 'Other';
    const t = raw.toLowerCase().trim();
    if (t.includes('quiz'))        return 'Quiz';
    if (t.includes('midterm'))     return 'Midterm';
    if (t.includes('final'))       return 'Final Exam';
    if (t.includes('assignment'))  return 'Assignment';
    if (t.includes('group'))       return 'Group Assignment';
    if (t.includes('lab'))         return 'Lab';
    if (t.includes('osce'))        return 'OSCE';
    if (t.includes('simulation'))  return 'Simulation';
    if (t.includes('bellringer'))  return 'Bellringer';
    if (t.includes('srl'))         return 'SRL Assessment';
    return raw;
  }

  function normalize(records) {
    return records.map((r, idx) => {
      const startDate  = parseDate(r.Date);
      const endDate    = parseDate(r.end_date);
      // Use startDate (exam/assessment day) when available.
      // Fall back to endDate only when no startDate exists (online-only items).
      const effectiveDate = startDate || endDate;

      return {
        _id:            `assess_${idx}`,
        course:         parseInt(r.Course) || 0,
        year:           parseInt(r.Year)   || 0,
        courseName:     r.Course_name      || 'Unknown Course',
        instructor:     r.CC               || '',
        term:           r.Term             || '',
        type:           normalizeType(r.Type),
        rawType:        r.Type             || '',
        details:        r.Assessment_Details || '',
        weight:         parseWeight(r.Weigth),
        weightRaw:      r.Weigth           || '',
        month:          r.Month            || '',
        startDate,
        endDate,
        effectiveDate,
        startTime:      r.Start_time       || '',
        endTime:        r.End_Time         || '',
        duration:       r.Time_Scheduled   || '',
        location:       r.Main_class_Location || '',
        openClosebook:  r.Open_Close_book  || '',
        format:         r.Format           || '',
        calculator:     r.Calculator       || '',
        notes:          r.Notes            || '',
        _updatedAt:     null,
      };
    });
  }

  async function loadFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => { try { resolve(normalize(parseCSV(e.target.result))); } catch(err) { reject(err); } };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  async function loadFromText(text) {
    return normalize(parseCSV(text));
  }

  return { parseCSV, normalize, loadFromFile, loadFromText, parseWeight, parseDate, normalizeType };
})();

window.DataParser = DataParser;