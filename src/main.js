import './styles/tokens.css';
import './styles/global.css';
import './styles/pixel-ui.css';
import './styles/desktop.css';
import './styles/decorations.css';
import './styles/responsive.css';
import './styles/interactions.css';
import './styles/modal.css';
import { initLeadCapture } from './modal.js';
import { initNavigation } from './navigation.js';

initNavigation();
initLeadCapture();
