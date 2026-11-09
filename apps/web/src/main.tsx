import '@fontsource-variable/newsreader';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** Starts MSW only in the dev server with VITE_USE_MOCKS=true. Vite removes this from builds. */
async function startMocks(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledFrame: 'bypass', quiet: true });
  }
}

async function start(): Promise<void> {
  await startMocks();
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');
  const { App } = await import('./app/App');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
