import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';
createRoot(document.getElementById('app')!).render(<App />);
