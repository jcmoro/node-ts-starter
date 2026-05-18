import { type Chapter, chapters } from './chapters.ts';
import { renderMarkdown } from './markdown.ts';
import { currentRoute, navigate, onRouteChange } from './router.ts';

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Element not found: ${selector}`);
  return node;
}

const sidebarEl = el<HTMLElement>('#sidebar');
const contentEl = el<HTMLElement>('#content');

function findChapter(slug: string): Chapter | undefined {
  return chapters.find((c) => c.slug === slug);
}

function defaultSlug(): string {
  return chapters[0]?.slug ?? '';
}

function renderSidebar(activeSlug: string): void {
  const items = chapters
    .map((c) => {
      const cls = c.slug === activeSlug ? 'active' : '';
      return `<li><a href="#/${c.slug}" class="${cls}">${escapeHtml(c.title)}</a></li>`;
    })
    .join('');

  sidebarEl.innerHTML = `
    <h1>Curso TS</h1>
    <nav><ul>${items}</ul></nav>
    <footer>
      <a href="https://effectivetypescript.com/" target="_blank" rel="noopener">Effective TypeScript</a>
    </footer>
  `;
}

function renderContent(slug: string): void {
  const chapter = findChapter(slug);
  if (!chapter) {
    contentEl.innerHTML = `
      <article>
        <h1>Capítulo no encontrado</h1>
        <p>El capítulo <code>${escapeHtml(slug)}</code> no existe.</p>
      </article>
    `;
    return;
  }
  contentEl.innerHTML = `<article>${renderMarkdown(chapter.content)}</article>`;
  contentEl.scrollTo({ top: 0 });
}

function render(): void {
  const { slug } = currentRoute();
  const resolved = findChapter(slug) ? slug : defaultSlug();
  renderSidebar(resolved);
  renderContent(resolved);
}

// Intercept clicks on `[text](./XX-slug.md)` links so they navigate within the SPA
// instead of triggering a real navigation that would 404.
contentEl.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest('a');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href) return;

  const mdMatch = href.match(/^\.\/(.+?)\.md(?:#.*)?$/);
  if (mdMatch?.[1]) {
    event.preventDefault();
    navigate(mdMatch[1]);
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Bootstrap
if (!currentRoute().slug) {
  navigate(defaultSlug());
} else {
  render();
}
onRouteChange(render);
