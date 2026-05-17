import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Hide the pre-React splash screen once React takes over
const preSplash = document.getElementById('pre-splash');
if (preSplash) {
  preSplash.classList.add('hidden');
  setTimeout(() => preSplash.remove(), 300);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

