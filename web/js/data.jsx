/* ============================================================
   HELM — Mock data, constants, helpers, icon glyphs
   Exposed on window for cross-file (Babel) access.
   ============================================================ */

const ROLE_META = {
  helm:     { color: '#F5A623', label: 'HELM',     icon: '\u2b22', name: 'Helm-Leader' },
  dev:      { color: '#00C2D4', label: 'DEV',      icon: '{ }',    name: 'Dev Team' },
  research: { color: '#9B6DFF', label: 'RESEARCH', icon: '\u2316', name: 'Research Team' },
  qa:       { color: '#2ECC71', label: 'QA',       icon: '\u2713', name: 'Quality A Team' },
  watch:    { color: '#FF3B30', label: 'WATCH',    icon: '\u25ce', name: 'The WatchMen' },
};

const STATUS_COLOR = {
  active: '#00FF94', idle: '#3A4A5C', error: '#FF3B30', done: '#34C759',
};

// ---- Agents ----
const AGENTS = [
  { id: 'helm-leader', name: 'HELM-LEADER', role: 'helm', team: null, status: 'active',
    task: 'Orchestrating OAuth login flow', progress: 100, tokens: 8240, lifetime: 184220, ctx: 0.31, eff: 5 },

  { id: 'ava',    name: 'Ava',    role: 'dev', team: 'dev-team', status: 'active', sub: 'CSS Parser',
    task: 'Parsing auth-styles.css and extracting variables', progress: 72, tokens: 1247, lifetime: 48221, ctx: 0.48, eff: 4 },
  { id: 'ben',    name: 'Ben',    role: 'dev', team: 'dev-team', status: 'active', sub: 'Component Build',
    task: 'Scaffolding LoginForm + OAuthButtons', progress: 40, tokens: 2010, lifetime: 39120, ctx: 0.39, eff: 4 },
  { id: 'carlos', name: 'Carlos', role: 'dev', team: 'dev-team', status: 'partial', sub: 'Test Runner',
    task: 'Wiring vitest harness for auth module', progress: 55, tokens: 1530, lifetime: 22890, ctx: 0.22, eff: 3 },

  { id: 'diana', name: 'Diana', role: 'research', team: 'research-team', status: 'active', sub: 'Codebase Recon',
    task: 'Mapping existing session + token handling', progress: 88, tokens: 1980, lifetime: 51200, ctx: 0.61, eff: 5 },
  { id: 'evan',  name: 'Evan',  role: 'research', team: 'research-team', status: 'active', sub: 'Docs & Patterns',
    task: 'Surveying OAuth2 PKCE best practices', progress: 64, tokens: 1420, lifetime: 33410, ctx: 0.44, eff: 4 },

  { id: 'fiona',  name: 'Fiona',  role: 'qa', team: 'qa-team', status: 'active', sub: 'Logic Review',
    task: 'Reviewing AuthProvider state transitions', progress: 51, tokens: 1190, lifetime: 41330, ctx: 0.35, eff: 4 },
  { id: 'george', name: 'George', role: 'qa', team: 'qa-team', status: 'idle', sub: 'Security Audit',
    task: 'Waiting on Dev changelog', progress: 0, tokens: 640, lifetime: 28770, ctx: 0.12, eff: 5 },

  { id: 'iris', name: 'Iris', role: 'watch', team: 'watchmen', status: 'active', sub: 'Token & Perf',
    task: 'Monitoring token burn across all teams', progress: 100, tokens: 920, lifetime: 90400, ctx: 0.18, eff: 5 },
  { id: 'jax',  name: 'Jax',  role: 'watch', team: 'watchmen', status: 'active', sub: 'Security & Drift',
    task: 'Scanning for secret leaks + spec drift', progress: 100, tokens: 1100, lifetime: 88210, ctx: 0.20, eff: 5 },
];

// ---- Teams (canvas-level grouping) ----
const TEAMS = [
  { id: 'research-team', role: 'research', name: 'RESEARCH TEAM', task: 'Investigate auth + session model', agents: ['diana','evan'] },
  { id: 'dev-team',      role: 'dev',      name: 'DEV TEAM',      task: 'Rebuild auth components + routes', agents: ['ava','ben','carlos'] },
  { id: 'qa-team',       role: 'qa',       name: 'QUALITY A TEAM',task: 'Review + test the auth deliverable', agents: ['fiona','george'] },
  { id: 'watchmen',      role: 'watch',    name: 'THE WATCHMEN',  task: 'Continuous surveillance', agents: ['iris','jax'] },
];

// ---- Tasks ----
const TASKS = [
  { id: 42, title: 'Implement OAuth login flow', priority: 'P1', complexity: 'XL', status: 'in-progress' },
  { id: 43, title: 'Fix auth token refresh bug', priority: 'P1', complexity: 'M', status: 'queued' },
  { id: 44, title: 'Add rate limiting middleware', priority: 'P2', complexity: 'L', status: 'queued' },
  { id: 45, title: 'Write integration tests for API', priority: 'P2', complexity: 'L', status: 'queued' },
];

// ---- Workflow templates ----
const TEMPLATES = [
  { icon: '\ud83d\udd27', name: 'Bug Fix', desc: '3 agents · quick' },
  { icon: '\u26a1', name: 'Feature Sprint', desc: '5 teams · complex' },
  { icon: '\ud83d\udd0d', name: 'Code Review', desc: '2 agents' },
  { icon: '\ud83c\udfd7', name: 'Refactor', desc: '4 agents · long' },
];

// ---- Repo tree ----
const REPO_TREE = [
  { name: 'src', type: 'dir', open: true, children: [
    { name: 'auth', type: 'dir', open: true, children: [
      { name: 'AuthProvider.tsx', type: 'file', touchedBy: 'dev' },
      { name: 'auth-styles.css', type: 'file', touchedBy: 'dev' },
      { name: 'useSession.ts', type: 'file', touchedBy: 'research' },
    ]},
    { name: 'components', type: 'dir', children: [
      { name: 'LoginForm.tsx', type: 'file', touchedBy: 'dev' },
      { name: 'OAuthButtons.tsx', type: 'file' },
    ]},
  ]},
  { name: 'api', type: 'dir', open: true, children: [
    { name: 'routes', type: 'dir', children: [
      { name: 'auth.ts', type: 'file', touchedBy: 'watch' },
    ]},
    { name: 'middleware.ts', type: 'file' },
  ]},
  { name: 'tests', type: 'dir', children: [
    { name: 'auth.test.ts', type: 'file', touchedBy: 'qa' },
  ]},
];

// ---- Artifacts ----
const ARTIFACTS = [
  { id: 'alert-1', type: 'alert', title: 'Token limit approaching', from: 'Iris', role: 'watch', urgent: true,
    content: '## Token Runaway Warning\n\nThe **Dev Team** combined token burn is trending toward the session budget.\n\n- Current: `48.2k` tokens\n- Budget: `60k` tokens\n- Projected at completion: `~71k` (**over by 18%**)\n\nRecommend compressing the Dev Team or enabling Optimize Mode.',
    derived: null, sentTo: 'User', produced: null },

  { id: 'blocker-1', type: 'blocker', title: 'JWT exposed in plain text', from: 'George', role: 'qa', urgent: true,
    severity: 'CRITICAL', blocks: 42, file: 'api/routes/auth.ts', line: '88\u2013102',
    content: '## Security Violation\n\n`JWT secret` is being logged in plain text on **line 94**.\n\n```ts\nconsole.log("issuing token", jwtSecret, payload)\n```\n\nThis exposes the signing secret in production logs. **Must be removed before any merge.**',
    derived: 'changelog-1', sentTo: 'Dev Team', produced: null },

  { id: 'spec-1', type: 'spec', title: 'OAuth Login Flow v1', from: 'Helm-Leader', role: 'helm',
    content: '## OAuth Login Flow \u2014 Spec v1\n\nAssembled from Research Brief + product intent.\n\n### Goals\n- Support Google + GitHub OAuth via PKCE\n- Refresh tokens in `httpOnly` cookies\n- Graceful session expiry UX\n\n### Non-goals\n- SAML / enterprise SSO (later)\n\n### Acceptance\n| Criterion | Status |\n|---|---|\n| PKCE flow | required |\n| httpOnly refresh | required |\n| CSRF protection | required |',
    derived: 'brief-1', sentTo: 'Dev Team', produced: null },

  { id: 'task-42', type: 'task', title: 'Task #042: Auth Login Flow', from: 'Helm-Leader', role: 'helm',
    content: '## Task #042 \u2014 Auth Login Flow\n\nImplement the OAuth login flow per Spec v1.\n\n- [ ] `AuthProvider` context\n- [ ] `LoginForm` + `OAuthButtons`\n- [ ] `/api/routes/auth.ts` token exchange\n- [ ] Tests for happy + expiry paths',
    derived: 'spec-1', sentTo: 'Dev Team', produced: 'changelog-1' },
  { id: 'task-43', type: 'task', title: 'Task #043: Token Refresh', from: 'Helm-Leader', role: 'helm',
    content: '## Task #043 \u2014 Token Refresh\n\nFix the silent refresh failure when the access token expires mid-session.', derived: 'spec-1', sentTo: 'Dev Team', produced: null },

  { id: 'brief-1', type: 'brief', title: 'Research Brief: Auth landscape', from: 'Diana', role: 'research',
    content: '## Research Brief \u2014 Auth Landscape\n\n### Existing handling\nSession is currently stored in `localStorage` via `useSession.ts` \u2014 vulnerable to XSS.\n\n### Options explored\n1. **httpOnly cookie + PKCE** \u2014 recommended\n2. localStorage + rotation \u2014 simpler, weaker\n3. BFF pattern \u2014 most secure, highest effort\n\n### Recommendation\nGo with option 1 for v1.', derived: null, sentTo: 'Helm-Leader', produced: 'spec-1' },

  { id: 'changelog-1', type: 'changelog', title: 'Changelog #1: AuthProvider', from: 'Ava', role: 'dev',
    content: '## Changelog #1\n\n### Added\n- `AuthProvider.tsx` context with token state\n- `OAuthButtons.tsx` for Google + GitHub\n\n### Changed\n- `auth-styles.css` token variables extracted\n\n### Notes\nRefresh token storage still under discussion (see Question from Fiona).', derived: 'task-42', sentTo: 'QA Team', produced: 'review-1' },

  { id: 'suggest-1', type: 'suggestion', title: 'Extract token refresh hook', from: 'Fiona', role: 'qa',
    file: 'src/auth/AuthProvider.tsx', line: 42, impact: 'Low', effort: 'Low',
    content: 'Consider extracting the token refresh logic into a custom hook `useTokenRefresh()`. This would improve reusability across components and isolate the timer effect for testing.', derived: 'changelog-1', sentTo: 'Dev Team', produced: null },
  { id: 'suggest-2', type: 'suggestion', title: 'Memoize OAuth config', from: 'Fiona', role: 'qa',
    file: 'src/components/OAuthButtons.tsx', line: 18, impact: 'Low', effort: 'Low',
    content: 'The OAuth provider config object is rebuilt every render. Memoize with `useMemo` to avoid re-instantiating the client.', derived: 'changelog-1', sentTo: 'Dev Team', produced: null },
  { id: 'suggest-3', type: 'suggestion', title: 'Add loading skeleton', from: 'Fiona', role: 'qa',
    file: 'src/components/LoginForm.tsx', line: 60, impact: 'Low', effort: 'Med',
    content: 'Login submit currently has no pending state. Add a skeleton/spinner so the button reflects the in-flight request.', derived: 'changelog-1', sentTo: 'Dev Team', produced: null },

  { id: 'question-1', type: 'question', title: 'Refresh token storage?', from: 'Fiona', role: 'qa',
    directedAt: 'Dev Team (Ava)', re: 'Task #042', awaiting: 'Ava',
    content: 'Should the refresh token be stored in an `httpOnly` cookie or `localStorage`? This affects the implementation in `AuthProvider` significantly, and changes the CSRF strategy.', derived: 'changelog-1', sentTo: 'Dev Team', produced: null },

  { id: 'test-1', type: 'test', title: 'Test Report: auth.test.ts', from: 'Fiona', role: 'qa',
    content: '## Test Report\n\n| Suite | Pass | Fail | Cov |\n|---|---|---|---|\n| AuthProvider | 12 | 0 | 91% |\n| LoginForm | 8 | 1 | 84% |\n| auth routes | 5 | 0 | 78% |\n\n**1 failing:** `LoginForm > shows error on bad creds` \u2014 missing aria-live region.', derived: 'changelog-1', sentTo: 'Helm-Leader', produced: null },

  { id: 'decision-1', type: 'decision', title: 'Decision: httpOnly cookies', from: 'Helm-Leader', role: 'helm',
    content: '## Architectural Decision\n\n**Chosen:** Store refresh tokens in `httpOnly` cookies.\n\n**Rationale:** XSS resistance outweighs the added CSRF mitigation cost. Aligns with Research Brief recommendation.', derived: 'brief-1', sentTo: 'Archive', produced: null },
];

const ARTIFACT_META = {
  spec:       { color: '#F5A623', icon: '\ud83d\udcc4', label: 'SPEC' },
  task:       { color: '#F5A623', icon: '\u26a1', label: 'TASK' },
  brief:      { color: '#9B6DFF', icon: '\u2316', label: 'RESEARCH BRIEF' },
  changelog:  { color: '#00C2D4', icon: '\u0394', label: 'CHANGELOG' },
  suggestion: { color: '#F5A623', icon: '\u2726', label: 'SUGGESTION' },
  blocker:    { color: '#FF3B30', icon: '\u26d4', label: 'BLOCKER' },
  question:   { color: '#00C2D4', icon: '?', label: 'QUESTION' },
  test:       { color: '#2ECC71', icon: '\u229e', label: 'TEST REPORT' },
  decision:   { color: '#F5A623', icon: '\u25c8', label: 'DECISION LOG' },
  alert:      { color: '#FF3B30', icon: '\u26a0', label: 'ALERT' },
};

// ---- Canvas node layout (logical coords) ----
const NODE_LAYOUT = {
  'helm-leader':   { x: 430, y: 40,  w: 340 },
  'research-team': { x: 80,  y: 330, w: 244 },
  'dev-team':      { x: 460, y: 330, w: 272 },
  'qa-team':       { x: 856, y: 330, w: 244 },
  'watchmen':      { x: 1190,y: 150, w: 244 },
};

// ---- Brain View graph ----
const BRAIN_NODES = [
  { id: 'src', label: 'src', type: 'dir', state: 'warm', cluster: 'src' },
  { id: 'auth', label: 'auth/', type: 'dir', state: 'hot', cluster: 'src', role: 'dev' },
  { id: 'components', label: 'components/', type: 'dir', state: 'warm', cluster: 'src' },
  { id: 'api', label: 'api/', type: 'dir', state: 'warm', cluster: 'api' },
  { id: 'tests', label: 'tests/', type: 'dir', state: 'cold', cluster: 'tests' },

  { id: 'AuthProvider', label: 'AuthProvider.tsx', type: 'file', state: 'hot', cluster: 'src', role: 'dev' },
  { id: 'authstyles', label: 'auth-styles.css', type: 'file', state: 'hot', cluster: 'src', role: 'dev' },
  { id: 'useSession', label: 'useSession.ts', type: 'file', state: 'warm', cluster: 'src', role: 'research' },
  { id: 'LoginForm', label: 'LoginForm.tsx', type: 'file', state: 'warm', cluster: 'src', role: 'dev' },
  { id: 'OAuthButtons', label: 'OAuthButtons.tsx', type: 'file', state: 'cold', cluster: 'src' },
  { id: 'authroute', label: 'auth.ts', type: 'file', state: 'hot', cluster: 'api', role: 'watch' },
  { id: 'middleware', label: 'middleware.ts', type: 'file', state: 'unknown', cluster: 'api' },
  { id: 'authtest', label: 'auth.test.ts', type: 'file', state: 'warm', cluster: 'tests', role: 'qa' },

  { id: 'refreshToken', label: 'refreshToken()', type: 'fn', state: 'hot', cluster: 'src', role: 'dev' },
  { id: 'exchangeCode', label: 'exchangeCode()', type: 'fn', state: 'warm', cluster: 'api', role: 'dev' },
  { id: 'verifyJWT', label: 'verifyJWT()', type: 'fn', state: 'hot', cluster: 'api', role: 'watch' },
  { id: 'useAuth', label: 'useAuth()', type: 'fn', state: 'warm', cluster: 'src', role: 'dev' },

  { id: 'OAuth2', label: 'OAuth 2.0 / PKCE', type: 'concept', state: 'warm', cluster: 'domain' },
  { id: 'Sessions', label: 'Session Model', type: 'concept', state: 'hot', cluster: 'domain' },
  { id: 'CSRF', label: 'CSRF Defense', type: 'concept', state: 'warm', cluster: 'domain' },

  { id: 'jose', label: 'jose', type: 'ext', state: 'cold', cluster: 'api' },
  { id: 'react', label: 'react', type: 'ext', state: 'warm', cluster: 'src' },
];

const BRAIN_LINKS = [
  { s: 'src', t: 'auth', k: 'imports' }, { s: 'src', t: 'components', k: 'imports' },
  { s: 'auth', t: 'AuthProvider', k: 'imports' }, { s: 'auth', t: 'authstyles', k: 'imports' },
  { s: 'auth', t: 'useSession', k: 'imports' }, { s: 'components', t: 'LoginForm', k: 'imports' },
  { s: 'components', t: 'OAuthButtons', k: 'imports' }, { s: 'api', t: 'authroute', k: 'imports' },
  { s: 'api', t: 'middleware', k: 'imports' }, { s: 'tests', t: 'authtest', k: 'imports' },
  { s: 'AuthProvider', t: 'refreshToken', k: 'calls' }, { s: 'AuthProvider', t: 'useAuth', k: 'calls' },
  { s: 'AuthProvider', t: 'useSession', k: 'calls' }, { s: 'LoginForm', t: 'useAuth', k: 'calls' },
  { s: 'LoginForm', t: 'OAuthButtons', k: 'imports' }, { s: 'authroute', t: 'exchangeCode', k: 'calls' },
  { s: 'authroute', t: 'verifyJWT', k: 'calls' }, { s: 'verifyJWT', t: 'jose', k: 'imports' },
  { s: 'refreshToken', t: 'authroute', k: 'calls' }, { s: 'exchangeCode', t: 'OAuth2', k: 'similar' },
  { s: 'AuthProvider', t: 'react', k: 'imports' }, { s: 'useSession', t: 'Sessions', k: 'similar' },
  { s: 'verifyJWT', t: 'CSRF', k: 'similar' }, { s: 'authtest', t: 'AuthProvider', k: 'calls' },
  { s: 'OAuth2', t: 'Sessions', k: 'similar' }, { s: 'CSRF', t: 'Sessions', k: 'similar' },
  { s: 'refreshToken', t: 'useAuth', k: 'inherits' },
];

const BRAIN_STATE_STYLE = {
  hot:     { opacity: 1,   glow: 18 },
  warm:    { opacity: 0.85,glow: 8 },
  cold:    { opacity: 0.4, glow: 0 },
  unknown: { opacity: 0.3, glow: 0 },
};

// ---- Log seed lines ----
const LOG_SEED = [
  { who: 'DIANA',  role: 'research', msg: 'Mapping session handling in useSession.ts' },
  { who: 'AVA',    role: 'dev',      msg: 'Reading: src/auth/AuthProvider.tsx' },
  { who: 'HELM-LEADER', role: 'helm', msg: 'Assembled Spec v1 from Research Brief' },
  { who: 'BEN',    role: 'dev',      msg: 'Scaffolding component: OAuthButtons' },
  { who: 'IRIS',   role: 'watch',    msg: 'Token burn nominal across 4 teams' },
  { who: 'FIONA',  role: 'qa',       msg: 'Reviewing AuthProvider state transitions' },
  { who: 'EVAN',   role: 'research', msg: 'Surveying OAuth2 PKCE best practices' },
  { who: 'JAX',    role: 'watch',    msg: 'Scanning api/routes/auth.ts for secret leaks' },
];

const LOG_TEMPLATES = {
  research: ['Reading: api/routes/auth.ts', 'Indexing: useSession.ts', 'Found pattern: token rotation in legacy code', 'Drafting Research Brief section 3', 'Cross-referencing OAuth2 RFC 7636'],
  dev: ['Reading: src/auth/AuthProvider.tsx', 'Writing: components/LoginForm.tsx', 'Refactoring token refresh effect', 'Completed: Component scaffold for OAuthButtons', 'Running: npm run typecheck'],
  qa: ['Running test suite: auth.test.ts', 'Coverage: AuthProvider 91%', 'Flagged: missing aria-live region', 'Reviewing: changelog #1', 'Verifying: CSRF token rotation'],
  helm: ['Breaking task into 4 sub-tasks', 'Routing Task #042 \u2192 Dev Team', 'Estimating: ~38k tokens', 'Resolving cross-team dependency'],
  watch: ['Token burn nominal across 4 teams', 'No spec drift detected', 'Scanning dependency tree', 'Perf baseline within bounds', '\u26a0 Watching api/routes/auth.ts closely'],
};

const MSG_SEED = [
  { from: 'BEN', to: 'Diana', fromRole: 'dev', msg: 'Need the token type interface' },
  { from: 'DIANA', to: 'Ben', fromRole: 'research', msg: 'Sending AuthTokenResponse type' },
  { from: 'FIONA', to: 'Ava', fromRole: 'qa', msg: 'Question: httpOnly cookie or localStorage?' },
  { from: 'HELM-LEADER', to: 'Dev Team', fromRole: 'helm', msg: 'Spec v1 is ready \u2014 begin implementation' },
];

const COT_LINES = [
  'Analyzing task complexity\u2026',
  '\u25b8 Breaking into 4 sub-tasks',
  '\u25b8 Spawning Research + Dev + QA teams',
  '\u25b8 WatchMen engaged on perimeter',
  '\u25b8 Estimating: ~38k tokens, ~3min',
];

// ---- helpers ----
function fmtTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function fmtCost(tokens) { return '$' + (tokens * 0.000004).toFixed(2); }
function clockNow() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}
function agentById(id) { return AGENTS.find(a => a.id === id); }
function teamById(id) { return TEAMS.find(t => t.id === id); }
function artById(id) { return ARTIFACTS.find(a => a.id === id); }

Object.assign(window, {
  ROLE_META, STATUS_COLOR, AGENTS, TEAMS, TASKS, TEMPLATES, REPO_TREE,
  ARTIFACTS, ARTIFACT_META, NODE_LAYOUT, BRAIN_NODES, BRAIN_LINKS, BRAIN_STATE_STYLE,
  LOG_SEED, LOG_TEMPLATES, MSG_SEED, COT_LINES,
  fmtTokens, fmtCost, clockNow, agentById, teamById, artById,
});
