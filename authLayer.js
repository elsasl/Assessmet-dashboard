// authLayer.js — Authentication & RBAC stub
// Future: Replace with Firebase Auth, Supabase Auth, or OAuth2 provider

const AuthLayer = (() => {
  const ROLES = { ADMIN: 'admin', INSTRUCTOR: 'instructor', VIEWER: 'viewer' };

  const PERMISSIONS = {
    admin:      ['read', 'write', 'delete', 'export', 'manage_users'],
    instructor: ['read', 'write', 'export'],
    viewer:     ['read'],
  };

  // ── Demo user (replace with real auth flow) ──────────────────────────────
  const currentUser = {
    id:       'demo',
    name:     'Demo Administrator',
    email:    'admin@university.edu',
    role:     ROLES.ADMIN,
    avatar:   null,
    loginAt:  new Date().toISOString(),
  };

  function getCurrentUser()        { return { ...currentUser }; }
  function isAuthenticated()       { return !!currentUser.id; }
  function hasPermission(action)   { return PERMISSIONS[currentUser.role]?.includes(action) ?? false; }
  function hasRole(role)           { return currentUser.role === role; }

  // Stubs — replace with real auth calls
  async function login(email, password)  { console.warn('[AuthLayer] login() stub called'); return currentUser; }
  async function logout()                { console.warn('[AuthLayer] logout() stub called'); }
  async function refreshToken()          { console.warn('[AuthLayer] refreshToken() stub called'); }

  return { ROLES, getCurrentUser, isAuthenticated, hasPermission, hasRole, login, logout, refreshToken };
})();

window.AuthLayer = AuthLayer;