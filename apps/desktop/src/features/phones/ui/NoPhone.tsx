import { pair } from '../actions/pairing';
import { Btn } from '@/shared/ui/Button';
import { Empty } from '@/shared/ui/Layout';
export function NoPhone() {
  return <Empty ic="phone" title="尚未配对手机" desc="连接你自己的手机后，会话和设备状态会显示在这里。" actions={<Btn label="配对新手机" onClick={() => pair()} />} />;
}
