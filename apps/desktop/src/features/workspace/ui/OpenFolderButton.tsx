import { fileManagerName } from '@/core/platform';
import { IconBtn } from '@/shared/ui/Button';
import { prettyPath } from '@/shared/lib/util';
import { S } from '@/state/store';
import { openWorkspaceFolder } from '../runtime/folderActions';

/** WS-ENTRY-01：打开工作文件夹的唯一按钮，顶栏和文件页共用 */
export const openFolderLabel = () => (fileManagerName() ? `在${fileManagerName()}中打开` : '打开工作区文件夹');

export function OpenFolderButton({ dir }: { dir: string }) {
  return <IconBtn ic="folderFilled" label={openFolderLabel()} title={dir ? `${openFolderLabel()}：${prettyPath(dir, S.homeDir)}` : '还没有选择工作文件夹'}
    size="sm" disabled={!dir} onClick={() => { void openWorkspaceFolder(dir); }} />;
}
