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
import { initLeadCapture } from './modal.js';
import { initNavigation } from './navigation.js';
import { initMotion } from './motion/index.js';

initNavigation();
initLeadCapture();

const disposeMotion = initMotion();
if (import.meta.hot) import.meta.hot.dispose(disposeMotion);
