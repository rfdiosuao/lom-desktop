import { installFileDrop } from '@/features/chat/actions/fileDrop';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/shared/styles/tokens.css';
import '@/shared/styles/components.css';
import '@/shared/styles/layout.css';
import '@/shared/styles/history.css';
import '@/shared/styles/views.css';
import '@/shared/styles/search.css';
import '@/shared/styles/composer.css';
import '@/shared/styles/float.css';
import '@/shared/styles/personal.css';
import '@/features/teams/activity/teamActivity.css';
import '@/shared/styles/app.css';
import { S } from '@/state/store';

/* 仅开发模式：在控制台里检查状态树 */
if (import.meta.env.DEV) (window as unknown as { __lom: typeof S }).__lom = S;

const removeFileDrop = installFileDrop();
if (import.meta.hot) import.meta.hot.dispose(removeFileDrop);

const root = document.getElementById('app');
if (!root) throw new Error('缺少 #app 挂载点');
createRoot(root).render(<StrictMode><App /></StrictMode>);
