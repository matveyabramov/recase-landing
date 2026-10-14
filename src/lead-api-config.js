// Public build settings only. A production bundle also refuses other hosts at runtime.
export function resolveLeadApi(env) {
  const url = env.VITE_LEAD_API_URL || '';
  const origin = env.VITE_SITE_ORIGIN || '';
  let valid = false;
  try {
    const api = new URL(url);
    const site = new URL(origin);
    valid = api.protocol === 'https:' && !api.username && !api.password
      && api.pathname === '/api/lead.php' && !api.search && !api.hash
      && site.protocol === 'https:' && site.origin === origin;
  } catch { /* Missing/invalid production settings keep the form offline. */ }
  return {
    enabled: env.PROD === true && env.MODE === 'layero'
      && env.VITE_LEAD_API_ENABLED === 'true' && valid,
    url,
    origin,
  };
}
