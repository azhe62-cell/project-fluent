import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/index.css';
import { App } from './App';
import { ServicesProvider } from './lib/services-context';
import { AuthProvider } from './lib/auth-context';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ServicesProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ServicesProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
