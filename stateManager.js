// stateManager.js — Centralized State + Event Bus

const StateManager = (() => {
  // ── Initial State ────────────────────────────────────────────────────────
  let _state = {
    assessments:      [],
    filteredData:     [],
    activeTab:        'overview',
    calendarView:     'month',
    calendarDate:     new Date(),
    filters: {
      course:  'all',
      type:    'all',
      month:   'all',
      search:  '',
      year:    'all',
    },
    selectedAssessment: null,
    calendarReturnTab:   null,
    calendarReturnLabel: null,
    darkMode:         false,
    riskSequences:    [],
    insights:         [],
    loading:          false,
  };

  // ── Event Bus ────────────────────────────────────────────────────────────
  const _listeners = {};

  function on(event, cb) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(cb);
    return () => off(event, cb);
  }

  function off(event, cb) {
    if (_listeners[event]) _listeners[event] = _listeners[event].filter(fn => fn !== cb);
  }

  function emit(event, payload) {
    (_listeners[event] || []).forEach(fn => fn(payload));
    (_listeners['*']   || []).forEach(fn => fn({ event, payload }));
  }

  // ── State Accessors ──────────────────────────────────────────────────────
  function getState()              { return { ..._state }; }
  function get(key)                { return _state[key]; }

  function set(key, value) {
    const prev = _state[key];
    _state[key] = value;
    emit(`state:${key}`, { prev, next: value });
    emit('state:change', { key, prev, next: value });
  }

  function setFilters(patch) {
    _state.filters = { ..._state.filters, ...patch };
    emit('state:filters', _state.filters);
    emit('state:change', { key: 'filters', next: _state.filters });
  }

  function resetFilters() {
    setFilters({ course: 'all', type: 'all', month: 'all', search: '', year: 'all' });
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  function persistPreferences() {
    const prefs = { darkMode: _state.darkMode, calendarView: _state.calendarView };
    try { localStorage.setItem('aid_prefs', JSON.stringify(prefs)); } catch {}
  }

  function loadPreferences() {
    try {
      const raw = localStorage.getItem('aid_prefs');
      if (raw) {
        const prefs = JSON.parse(raw);
        Object.assign(_state, prefs);
      }
    } catch {}
  }

  return { on, off, emit, getState, get, set, setFilters, resetFilters, persistPreferences, loadPreferences };
})();

window.StateManager = StateManager;