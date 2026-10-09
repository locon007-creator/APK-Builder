import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { SettingsProvider } from './settings.tsx';
import { IS_PREVIEW } from './api.ts';
import { snapshotNow } from './static/mock.ts';
import { setReferenceNow } from './format.ts';
import './styles.css';

if (IS_PREVIEW) setReferenceNow(snapshotNow());
const Router = IS_PREVIEW ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </Router>
  </StrictMode>,
);
