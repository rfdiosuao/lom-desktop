import { cloudConfigured, CLOUD_UNAVAILABLE } from '../runtime/serviceConfig';
import { useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Controls';
import { restoreSession, signIn } from '../runtime/cloud';
import { dragWindow } from '@/core/platform';
import { useStore } from '@/state/store';
import '@/shared/styles/login.css';

/** S04-01: the workspace is mounted only after account verification. */
export function Login() {
  const s = useStore();
  const [register, setRegister] = useState(false);
  const checking = s.cloud === 'checking';
  const busy = checking || s.cloud === 'signing-in';
  if (!cloudConfigured()) return <main className="login-page"><section className="login-card"><h1>开源社区版</h1><p>{CLOUD_UNAVAILABLE}</p></section></main>;
  return (
    <main className="login-page">
      <header className="login-titlebar" onMouseDown={dragWindow} aria-label="窗口标题栏" />
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand login-brand"><img src="/logo.png" alt="Lom" /><span>Lom</span></div>
        <h1 id="login-title">{checking ? '正在恢复登录' : register ? '从一个新想法开始' : '欢迎来到 Lom'}</h1>
        <p className="login-subtitle">{checking ? '正在验证你的账号，请稍候…' : '登录你的账号，继续与 Agent 一起完成。'}</p>
        {checking ? <div className="login-loading" role="status"><Spinner />正在检查登录状态</div> : <>
          <div className="login-tabs" role="group" aria-label="登录或注册">
            <button type="button" aria-pressed={!register} disabled={busy} onClick={() => setRegister(false)}>登录</button>
            <button type="button" aria-pressed={register} disabled={busy} onClick={() => setRegister(true)}>注册</button>
          </div>
          <Btn label={register ? '注册 HEANG 账号' : '使用 HEANG 账号登录'} variant="primary" disabled={busy} onClick={() => void signIn(register ? 'register' : 'login')} />
          <div className="login-divider"><span>或使用以下账号继续</span></div>
          <div className="login-social">
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void signIn('google')}><span className="login-provider" aria-hidden="true">G</span>使用 Google 继续</button>
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void signIn('github')}><svg className="login-provider" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.76-.24.76-.54v-2.09c-3.12.68-3.78-1.33-3.78-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.71 2.62 1.22 3.26.93.1-.72.39-1.22.71-1.5-2.49-.28-5.1-1.25-5.1-5.54 0-1.22.43-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15A10.7 10.7 0 0 1 12 6.19c.95 0 1.9.13 2.8.38 2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.3-2.62 5.26-5.12 5.54.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z" /></svg>使用 GitHub 继续</button>
          </div>
          {s.cloud === 'signing-in' && <p className="login-status" role="status"><Spinner size={16} />请在浏览器完成操作，成功后会自动进入工作台。<br />等待超过 5 分钟后可重新尝试。</p>}
          {s.cloudError && <p className="form-error login-error" role="alert">{s.cloudError}</p>}
          {s.cloud === 'unavailable' && <Btn label="重新验证已保存的登录" variant="link" onClick={() => void restoreSession()} />}
          <p className="login-note">将在浏览器中安全登录，首次使用第三方账号会自动注册。<br />登录后即可使用 Lom 内置模型，无需填写 API Key。</p>
        </>}
      </section>
    </main>
  );
}
