import React from 'react';
import ReactDOM from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// During live Web Serial / server bridge testing, stale PWA service-worker
// caches can keep an old JS bundle alive even after the code is replaced.
// Unregistering here makes the browser use the current bundle and prevents
// old fetch URLs such as the wrong /api/live/publish endpoint from persisting.
serviceWorkerRegistration.unregister();
