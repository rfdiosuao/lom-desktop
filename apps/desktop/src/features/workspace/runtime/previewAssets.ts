import { api } from '@/core/client';

/* ===== WS-PREVIEW-01：预览页面引用的本地资源内联，并如实记录没能加载的资源 =====
 * 预览在 sandbox iframe 里运行，页面拿不到启动令牌，也访问不到 Lom 的界面，所以本地资源要读出来内联进页面。
 * 读不到的资源不能静默丢掉：每一个都带路径和原因返回给界面（#409）。 */

export interface AssetFailure { path: string; reason: string; }
export interface InlineResult { html: string; failures: AssetFailure[]; total: number; }
export type ReadText = (path: string, workspace: string) => Promise<string>;

export const UNSUPPORTED_MEDIA = '预览暂不支持内联这类媒体资源，页面里它会缺失';
const MAX_REASON = 120;

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const relDirOf = (p: string) => (/[\\/]/.test(p) ? dirOf(p) : '');
const isRelative = (u: string) => !!u && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(u);
const bare = (u: string) => u.split(/[?#]/)[0];
const joinRel = (rel: string, ref: string) => (rel ? `${rel}/${ref}` : ref);
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, MAX_REASON);

interface Base { abs: string; rel: string; }
interface Ctx { workspace: string; read: ReadText; failures: AssetFailure[]; total: number; }

/** 登记一个资源任务：失败时记录路径和原因（同时写控制台，便于排查） */
const track = (ctx: Ctx, path: string, job: Promise<unknown>) => {
  ctx.total += 1;
  return job.catch((e: unknown) => {
    console.warn('预览：无法内联本地资源，保留原引用', path, e);
    ctx.failures.push({ path, reason: reasonOf(e) });
  });
};
const unsupported = (ctx: Ctx, path: string) => { ctx.total += 1; ctx.failures.push({ path, reason: UNSUPPORTED_MEDIA }); };
const image = (ctx: Ctx, path: string) => api<string>('POST', '/api/fs/image-base64', { path, workspace: ctx.workspace });

/** 样式里的 url(...)：相对路径的图片、字体按样式文件所在位置读出来内联 */
async function inlineCssUrls(css: string, base: Base, ctx: Ctx): Promise<string> {
  const re = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
  const refs = new Set<string>();
  for (const m of css.matchAll(re)) if (isRelative(m[2])) refs.add(m[2]);
  const data = new Map<string, string>();
  await Promise.all([...refs].map(ref => track(ctx, joinRel(base.rel, bare(ref)),
    image(ctx, `${base.abs}/${bare(ref)}`).then(d => { data.set(ref, d); }))));
  return css.replace(re, (all, _q: string, ref: string) => (data.has(ref) ? `url("${data.get(ref)}")` : all));
}

const attrs = (doc: Document, selector: string, name: string) =>
  [...doc.querySelectorAll(selector)].map(el => ({ el, value: el.getAttribute(name) || '' })).filter(a => isRelative(a.value));

function stylesheets(doc: Document, page: Base, ctx: Ctx): Promise<unknown>[] {
  return attrs(doc, 'link[rel="stylesheet"][href]', 'href').map(({ el, value }) => track(ctx, value, (async () => {
    const css = await ctx.read(`${page.abs}/${bare(value)}`, ctx.workspace);
    const rel = relDirOf(bare(value));
    const st = doc.createElement('style');
    st.textContent = await inlineCssUrls(css, { abs: dirOf(`${page.abs}/${bare(value)}`), rel }, ctx);
    el.replaceWith(st);
  })()));
}

const scripts = (doc: Document, page: Base, ctx: Ctx) => attrs(doc, 'script[src]', 'src').map(({ el, value }) =>
  track(ctx, value, ctx.read(`${page.abs}/${bare(value)}`, ctx.workspace).then(js => { el.removeAttribute('src'); el.textContent = js; })));

const images = (doc: Document, page: Base, ctx: Ctx) => [
  ...attrs(doc, 'img[src]', 'src').map(({ el, value }) => ({ el, value, name: 'src' })),
  ...attrs(doc, 'video[poster]', 'poster').map(({ el, value }) => ({ el, value, name: 'poster' })),
].map(({ el, value, name }) => track(ctx, value, image(ctx, `${page.abs}/${bare(value)}`).then(d => { el.setAttribute(name, d); })));

function inlineStyleBlocks(doc: Document, page: Base, ctx: Ctx): Promise<unknown>[] {
  return [...doc.querySelectorAll('style')].map(async st => { st.textContent = await inlineCssUrls(st.textContent || '', page, ctx); });
}

/** 音视频及 <source> 目前无法内联：明确记为失败，不让页面静默缺资源 */
function mediaSources(doc: Document, ctx: Ctx) {
  for (const { value } of [...attrs(doc, 'video[src], audio[src], source[src]', 'src'), ...attrs(doc, 'source[srcset]', 'srcset')])
    unsupported(ctx, bare(value));
}

/** 把页面引用的本地样式、脚本、图片内联进来，返回新页面与没能加载的资源 */
export async function inlineAssets(html: string, file: string, workspace: string, read: ReadText): Promise<InlineResult> {
  const page: Base = { abs: dirOf(file), rel: '' };
  const ctx: Ctx = { workspace, read, failures: [], total: 0 };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  mediaSources(doc, ctx);
  await Promise.all([...inlineStyleBlocks(doc, page, ctx), ...stylesheets(doc, page, ctx), ...scripts(doc, page, ctx), ...images(doc, page, ctx)]);
  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, failures: ctx.failures, total: ctx.total };
}
