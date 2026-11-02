import { invoke } from '@tauri-apps/api/core';

export const openProjectLink = (link: 'repository' | 'documentation') =>
  invoke<void>('project_link_open', { link });
