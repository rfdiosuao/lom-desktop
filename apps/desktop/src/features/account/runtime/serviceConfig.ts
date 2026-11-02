/** Community builds have no bundled account, billing or device relay service. */
export const CLOUD_UNAVAILABLE = '开源版未包含账号、云端 PA 和手机中转后端。请使用自带 API Key 的通用任务；社区可自行实现兼容服务。';
export const LOM_CLOUD_URL = (import.meta.env.VITE_LOM_CLOUD_URL || '').trim().replace(/\/+$/, '');
export const cloudConfigured = () => /^https?:\/\//.test(LOM_CLOUD_URL);
export function requireCloudService() {
  if (!cloudConfigured()) throw new Error(CLOUD_UNAVAILABLE);
}
