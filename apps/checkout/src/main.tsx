import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

/**
 * Minimal inline splash so the scaffold builds and renders standalone. The
 * behavior half of the surface replaces this with the app state machine.
 */
function Splash() {
  return (
    <div className="bg-brand-black flex h-full items-center justify-center">
      <span className="text-brand-ink text-2xl tracking-tight">Xend</span>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Splash />
  </StrictMode>,
);
