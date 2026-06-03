// dataService.js — Data Persistence Abstraction Layer
// Future: Swap localStorage calls with Firebase / Supabase / REST API

const DataService = (() => {
  const STORAGE_KEY  = 'aid_assessments_v1';
  const CHANGES_KEY  = 'aid_changes_v1';
  const _subscribers = {};

  // ── Internal helpers ─────────────────────────────────────────────────────
  function _emit(event, payload) {
    (_subscribers[event] || []).forEach(fn => fn(payload));
    (_subscribers['*']   || []).forEach(fn => fn({ event, payload }));
  }

  // ── Public API ───────────────────────────────────────────────────────────
  async function getData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('[DataService] getData error', e);
      return null;
    }
  }

  async function setData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      _emit('data:loaded', data);
      return true;
    } catch (e) {
      console.error('[DataService] setData error', e);
      return false;
    }
  }

  async function saveChanges(changes) {
    // Future: POST /api/assessments/batch
    const existing = JSON.parse(localStorage.getItem(CHANGES_KEY) || '[]');
    existing.push({ ...changes, savedAt: new Date().toISOString() });
    localStorage.setItem(CHANGES_KEY, JSON.stringify(existing));
    _emit('data:changed', changes);
    return { success: true };
  }

  async function updateAssessment(id, patch) {
    // Future: PATCH /api/assessments/:id
    const data = await getData();
    if (!data) return { success: false, error: 'No data' };
    const idx = data.findIndex(a => a._id === id);
    if (idx === -1) return { success: false, error: 'Not found' };
    data[idx] = { ...data[idx], ...patch, _updatedAt: new Date().toISOString() };
    await setData(data);
    _emit('assessment:updated', data[idx]);
    return { success: true, data: data[idx] };
  }

  function subscribeToChanges(event, callback) {
    if (!_subscribers[event]) _subscribers[event] = [];
    _subscribers[event].push(callback);
    return () => { _subscribers[event] = _subscribers[event].filter(fn => fn !== callback); };
  }

  async function clearCache() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CHANGES_KEY);
    _emit('cache:cleared', null);
  }

  return { getData, setData, saveChanges, updateAssessment, subscribeToChanges, clearCache };
})();

window.DataService = DataService;