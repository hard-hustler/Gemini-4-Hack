import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/styles.css';

// No StrictMode: drei's <Html> labels create nested React roots, and StrictMode's
// double mount makes them log unmount races on every render.
createRoot(document.getElementById('root')!).render(<App />);
