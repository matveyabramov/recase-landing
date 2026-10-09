import './styles/tokens.css';
import './styles/global.css';
import './styles/pixel-ui.css';
import './styles/desktop.css';
import './styles/decorations.css';
import './styles/responsive.css';
import './styles/interactions.css';
import './styles/modal.css';
import './styles/motion.css';
import './styles/reveal.css';
import './styles/experts-tabs.css';
import './styles/interactive-motion.css';
import { initLeadCapture } from './modal.js';
import { initNavigation } from './navigation.js';
import { initMotion } from './motion/index.js';
import { initExpertsTabs } from './experts-tabs.js';

initNavigation();
initLeadCapture();
const disposeExpertsTabs = initExpertsTabs();

const disposeMotion = initMotion();
if (import.meta.hot) import.meta.hot.dispose(() => {
  disposeExpertsTabs();
  disposeMotion();
});
