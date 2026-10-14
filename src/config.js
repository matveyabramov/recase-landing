// Public legal documents at the planned site domain root.
export const privacyPolicyUrl = '/privacy-policy.html';
export const personalDataConsentUrl = '/personal-data-consent.html';
import { resolveYandexForms } from './yandex-form-config.js';
export const yandexForms = resolveYandexForms(import.meta.env, location.hostname);

export const LEAD_FORMS = Object.freeze({
  participant: {
    title: 'УЧАСТВУЙ В RE:CASE',
    description: 'Оставь свои контакты для обратной связи по заявке',
  },
  partner: {
    title: 'СТАНЬ ПАРТНЁРОМ',
    description: 'Предложи кейс или присоединяйся к проекту. Оставь контакты для обратной связи по заявке',
  },
});
