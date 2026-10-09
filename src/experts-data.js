const placeholder = {
  name: 'ИМЯ\u00a0ФАМИЛИЯ',
  position: 'Компания / Должность',
  portrait: './assets/icons/expert-portrait.svg',
};

// Replace individual records with real names, positions and local portraits.
export const expertCategories = [
  {
    id: 'partners',
    label: 'ПАРТНЁРЫ',
    badge: 'Партнёр',
    badgeClass: 'badge-pink',
    people: [
      { ...placeholder, id: 'partner-1' },
      { ...placeholder, id: 'partner-2' },
      { ...placeholder, id: 'partner-3' },
    ],
  },
  {
    id: 'experts',
    label: 'ЭКСПЕРТЫ',
    badge: 'Эксперт',
    badgeClass: 'badge-green',
    people: [
      { ...placeholder, id: 'expert-1' },
      { ...placeholder, id: 'expert-2' },
      { ...placeholder, id: 'expert-3' },
      { ...placeholder, id: 'expert-4' },
    ],
  },
];
