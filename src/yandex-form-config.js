// Public URLs only. Preview builds stay offline even with production variables.
export function resolveYandexForms(env, hostname = '') {
  const pages = hostname === 'github.io' || hostname.endsWith('.github.io');
  const enabled = !pages && (env.DEV === true
    ? env.VITE_YANDEX_FORMS_ENABLED !== 'false'
    : env.PROD === true && env.MODE === 'layero' && env.VITE_YANDEX_FORMS_ENABLED === 'true');
  function formUrl(value) {
    try {
      const url = new URL(value);
      if (url.origin !== 'https://forms.yandex.ru' || url.username || url.password
        || !/^\/u\/[a-z0-9]+\/?$/.test(url.pathname)) return '';
      url.searchParams.set('iframe', '1');
      url.hash = '';
      return url.href;
    } catch { return ''; }
  }
  return {
    enabled,
    participant: formUrl(env.VITE_YANDEX_PARTICIPANT_FORM_URL),
    partner: formUrl(env.VITE_YANDEX_PARTNER_FORM_URL),
  };
}
