import { expertCategories } from './experts-data.js';

export function initExpertsTabs() {
  const section = document.querySelector('.experts');
  const tablist = section?.querySelector('[role="tablist"]');
  const track = section?.querySelector('.experts-track');
  const template = section?.querySelector('#expert-card-template');
  if (!tablist || !track || !template) return () => {};

  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  if (tabs.length !== expertCategories.length || panels.some(panel => !panel)) return () => {};

  expertCategories.forEach((category, index) => {
    const cards = category.people.map(person => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.personId = person.id;
      card.querySelector('h3').textContent = person.name;
      card.querySelector('p').textContent = person.position;
      card.querySelector('img').src = person.portrait;
      const badge = card.querySelector('.badge');
      badge.textContent = category.badge;
      badge.classList.add(category.badgeClass);
      return card;
    });
    panels[index].replaceChildren(...cards);
    tabs[index].textContent = `${category.label} (${category.people.length})`;
  });

  let selected = 0;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };

  function select(index) {
    if (index === selected) return;
    // The persistent track owns Scroll Reveal; only its contents switch.
    track.dataset.tabsSwitched = '';
    tabs.forEach((tab, tabIndex) => {
      const active = tabIndex === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[tabIndex].hidden = !active;
    });
    selected = index;
    track.scrollTo({ left: 0, behavior: 'instant' });
  }

  tablist.addEventListener('click', event => {
    const index = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (index !== -1) select(index);
  }, options);

  tablist.addEventListener('keydown', event => {
    const index = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (index === -1) return;
    const destinations = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    const next = destinations[event.key];
    select(next);
    tabs[next].focus({ preventScroll: true });
    // Native buttons provide Enter/Space activation as well as click.
  }, options);

  tablist.hidden = false;
  return () => listeners.abort();
}
