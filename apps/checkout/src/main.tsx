import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { applyAppearance, settleAfterEntrance } from './lib/appearance';

applyAppearance(window.location.search, document.documentElement);
settleAfterEntrance(document.documentElement);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
