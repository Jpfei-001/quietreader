import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AiDetachedPage from './components/AiDetachedPage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('ai-assistant') === '1' ? <AiDetachedPage /> : <App />}
  </React.StrictMode>,
);
