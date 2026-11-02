import { expect, it } from 'vitest';
import { resolveLomId } from './modelBinding';

const models = { pro: 'new-pro', max: 'new-max', mini: 'mini' };
const legacy = { pro: ['old-pro'], max: ['old-max'], mini: ['mini'] };
it('MODEL-SYNC-01 resolves retired physical models and stable tier selections only for Lom', () => {
  expect(resolveLomId('cloud::old-pro', 'cloud', models, legacy)).toBe('cloud::new-pro');
  expect(resolveLomId('lom-max', 'cloud', models, legacy)).toBe('cloud::new-max');
  expect(resolveLomId('own::old-pro', 'cloud', models, legacy)).toBe('own::old-pro');
  expect(resolveLomId('cloud::unknown', 'cloud', models, legacy)).toBe('cloud::unknown');
  expect(resolveLomId('cloud::old-pro', 'cloud', models, legacy, undefined, ['old-pro'])).toBe('cloud::old-pro');
});
it('MODEL-SYNC-01 ambiguous old tier is not guessed; persisted tier resolves it', () => {
  const shared = { ...legacy, max: ['old-pro'] };
  expect(resolveLomId('cloud::old-pro', 'cloud', models, shared)).toBe('');
  expect(resolveLomId('cloud::old-pro', 'cloud', models, shared, 'max')).toBe('cloud::new-max');
});

it('MODEL-SYNC-01 does not silently select Max when an old Pro name is reused', () => {
  expect(resolveLomId('cloud::old-pro', 'cloud', { ...models, max: 'old-pro' }, legacy)).toBe('');
});
