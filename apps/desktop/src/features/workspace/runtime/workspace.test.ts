import { describe, expect, it } from 'vitest';
import { buildTree } from './workspace';

describe('D01 §2.5 工作文件夹的文件树', () => {
  it('D01 文件夹排在前面，依赖和构建目录不显示', () => {
    const tree = buildTree('/w/作品', [
      { name: 'index.html', full_path: '/w/作品/index.html', is_dir: false },
      { name: 'node_modules', full_path: '/w/作品/node_modules', is_dir: true, children: [{ name: 'x.js', full_path: '/w/作品/node_modules/x.js', is_dir: false }] },
      { name: 'assets', full_path: '/w/作品/assets', is_dir: true, children: [{ name: 'logo.svg', full_path: '/w/作品/assets/logo.svg', is_dir: false }] },
      { name: '.DS_Store', full_path: '/w/作品/.DS_Store', is_dir: false },
    ]);
    expect(tree.name).toBe('作品');
    expect(tree.children?.map(c => c.name)).toEqual(['assets', 'index.html']);
    expect(tree.children?.[0].children?.[0]).toEqual({ name: 'logo.svg', path: '/w/作品/assets/logo.svg', type: 'file' });
  });
});
