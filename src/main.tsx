import { createRoot } from 'react-dom/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { App } from './App';
import { setEndpoint, setRecoveryHandler } from './runtime/client';
import type { Endpoint } from './runtime/types';
import './styles/tokens.css';
import './styles/app.css';

if (isTauri()) {
  // The shell supervisor owns the core lifecycle; the UI only follows endpoints.
  setRecoveryHandler(async () => {
    const endpoint = await invoke<Endpoint>('core_endpoint');
    setEndpoint(endpoint);
  });
  void listen<Endpoint>('core://endpoint', event => setEndpoint(event.payload)).catch(() => {});
  void invoke<Endpoint>('core_endpoint').then(setEndpoint).catch(() => { /* surfaced by the runtime panel */ });
}

createRoot(document.getElementById('app')!).render(<App />);
