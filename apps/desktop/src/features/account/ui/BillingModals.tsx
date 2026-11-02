import { closeModal } from '@/shared/overlays/controller';
import { formSet } from '@/features/schedules/actions/schedule';
import { fetchModelChoices, pickProvider, redeem, saveKey } from '@/features/settings/actions/settings';
import { Btn } from '@/shared/ui/Button';
import { Spinner, Toggle } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Field, Input } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { PROVIDER_PRESETS } from '@/features/settings/runtime/providers';
import { S } from '@/state/store';
import { cx } from '@/shared/lib/util';

/* ===== 弹窗：充值（兑换码）与添加模型（真实） ===== */

const PACKS: [number, number][] = [[30, 3000], [98, 10500], [298, 33000]];

export function RechargeModal() {
  const f = S.form;
  return (
    <Modal title="充值积分" desc="积分用于总指挥和所有手机调用 Lom 云端模型（1 点 = 0.01 元）。现在可以用兑换码充值，在线支付即将开放。"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={f.redeeming ? '正在兑换…' : '兑换'} variant="primary" onClick={() => void redeem()} disabled={!String(f.code || '').trim() || f.redeeming} /></>}>
      {f.note && <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{f.note}</p>}
      <Field label="兑换码" req hint="积分兑换码和订阅兑换码都在这里兑换"><Input bind="form.code" placeholder="输入收到的兑换码" autoFocus /></Field>
      {f.error && <p className="form-error"><Icon name="info" />{f.error}</p>}
      <div style={{ height: 8 }} />
      <Field label="在线充值" hint="在线支付即将开放">
        <div className="price-grid is-disabled" aria-disabled="true">
          {PACKS.map(([y, c]) => (
            <button key={y} type="button" className={cx('price', f.pack === y && 'is-selected')} disabled>
              <div className="price__amount">¥{y}</div>
              <div className="price__credit">{c.toLocaleString()} 点{y > 30 ? ` · 赠 ${Math.round((c / (y * 100) - 1) * 100)}%` : ''}</div>
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

/* 添加模型：平台、地址、Key、模型名称、视觉输入、OpenAI 接口（Key 由核心加密保存，不上传到麓鸣服务器） */
export function AddKeyModal() {
  const f = S.form;
  const preset = PROVIDER_PRESETS.find(p => p.id === f.provider) ?? PROVIDER_PRESETS[0];
  const ready = !!String(f.baseUrl || '').trim() && !!String(f.key || '').trim() && !!String(f.model || '').trim();
  const q = String(f.model || '').trim().toLowerCase();
  const choices: string[] = (f.models || []).filter((m: string) => !q || m.toLowerCase().includes(q)).slice(0, 60);
  return (
    <Modal title="添加模型" size="sm" className="add-model"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={f.saving ? '正在保存…' : '确定'} variant="primary" onClick={() => void saveKey()} disabled={!ready || f.saving} /></>}>
      <Field label="模型平台" req>
        <select className="input select" value={preset.id} onChange={e => pickProvider(e.target.value)} aria-label="模型平台">
          {PROVIDER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="API 请求地址" req><Input bind="form.baseUrl" placeholder={preset.baseUrl || 'https://…/v1'} autoFocus /></Field>
      <div className="add-model__switch">
        <Toggle on={!!f.fullUrl} onChange={() => formSet('fullUrl', !f.fullUrl)} label="完整 URL" size="sm" />
        <span>完整 URL</span><span className="muted">{f.fullUrl ? '按填写的地址原样请求，不再拼接路径' : '系统会自动拼接请求路径'}</span>
      </div>
      <Field label="API Key" req hint="如需添加多个 API Key 实现自动轮询，用英文逗号或换行分隔。">
        <Input bind="form.key" type="password" placeholder="sk-…" />
      </Field>
      <Field label="模型名称" req>
        <div className="add-model__search">
          <Input bind="form.model" placeholder="输入模型名称，或点右侧搜索读取列表" />
          <button type="button" className="add-model__find" onClick={() => void fetchModelChoices()} disabled={f.listing} aria-label="读取这个平台的模型列表" title="读取模型列表">
            {f.listing ? <Spinner size={14} /> : <Icon name="search" />}
          </button>
        </div>
        {choices.length > 0 && !(f.models as string[]).includes(String(f.model || '').trim()) && (
          <div className="add-model__list" role="listbox" aria-label="可用模型">
            {choices.map(m => <button key={m} type="button" role="option" aria-selected={false} onClick={() => formSet('model', m)}>{m}</button>)}
          </div>
        )}
        {f.listError && <div className="field__hint">{f.listError}</div>}
      </Field>
      <Field label="视觉输入" hint="自动识别会沿用模型目录的能力判断；仅在需要覆盖时手动选择。不支持看图的模型会改用看图工具。">
        <select className="input select" value={f.vision || 'auto'} onChange={e => formSet('vision', e.target.value)} aria-label="视觉输入">
          <option value="auto">自动识别</option><option value="supported">支持看图</option><option value="unsupported">不支持看图</option>
        </select>
      </Field>
      {preset.openai && (
        <Field label="OpenAI 请求接口" hint="仅对使用 OpenAI 兼容协议的模型显示。">
          <select className="input select" value={f.apiMode || 'auto'} onChange={e => formSet('apiMode', e.target.value)} aria-label="OpenAI 请求接口">
            <option value="auto">自动识别（推荐）</option><option value="chat_completions">Chat Completions</option><option value="responses">Responses</option>
          </select>
        </Field>
      )}
      {f.error && <p className="form-error"><Icon name="info" />{f.error}</p>}
    </Modal>
  );
}
