import { type Chapter, chapters, tracks } from './chapters.ts';
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

function trackOfSlug(slug: string): string {
  const idx = slug.indexOf('/');
  return idx >= 0 ? slug.slice(0, idx) : (tracks[0]?.id ?? 'typescript');
}

function firstChapterOfTrack(trackId: string): string {
  return tracks.find((t) => t.id === trackId)?.chapters[0]?.slug ?? '';
}

function defaultSlug(): string {
  return chapters[0]?.slug ?? '';
}

function renderSidebar(activeSlug: string): void {
  const activeTrack = trackOfSlug(activeSlug);

  const switcher = tracks
    .map((t) => {
      const cls = t.id === activeTrack ? 'switch-link active' : 'switch-link';
      const target = firstChapterOfTrack(t.id);
      return `<a href="#/${target}" class="${cls}">${escapeHtml(t.label)}</a>`;
    })
    .join('');

  const currentTrack = tracks.find((t) => t.id === activeTrack);
  const items = (currentTrack?.chapters ?? [])
    .map((c) => {
      const cls = c.slug === activeSlug ? 'active' : '';
      return `<li><a href="#/${c.slug}" class="${cls}">${escapeHtml(c.title)}</a></li>`;
    })
    .join('');

  const footerLink =
    activeTrack === 'springboot'
      ? '<a href="https://docs.spring.io/spring-boot/" target="_blank" rel="noopener">Spring Boot Docs</a>'
      : '<a href="https://effectivetypescript.com/" target="_blank" rel="noopener">Effective TypeScript</a>';

  sidebarEl.innerHTML = `
    <div class="track-switcher">${switcher}</div>
    <nav><ul>${items}</ul></nav>
    <footer>${footerLink}</footer>
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

  // Backwards compat: '00-intro' (no track prefix) → 'typescript/00-intro'.
  // Anything still unknown after that falls back to the default chapter.
  if (slug && !findChapter(slug)) {
    const legacy = findChapter(`typescript/${slug}`);
    navigate(legacy ? legacy.slug : defaultSlug());
    return;
  }

  const resolved = slug || defaultSlug();
  renderSidebar(resolved);
  renderContent(resolved);
}

// Resolve a relative .md link (e.g. "./01-setup.md") against the directory of
// the currently active slug. So when reading "springboot/00-intro", a link to
// "./01-setup.md" navigates to "springboot/01-setup".
function resolveRelativeMd(currentSlug: string, mdFile: string): string {
  const lastSlash = currentSlug.lastIndexOf('/');
  return lastSlash >= 0 ? `${currentSlug.slice(0, lastSlash)}/${mdFile}` : mdFile;
}

// Intercept clicks on `[text](./XX-slug.md)` links so they navigate within the
// SPA instead of triggering a real navigation that would 404.
contentEl.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest('a');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href) return;

  const mdMatch = href.match(/^\.\/(.+?)\.md(?:#.*)?$/);
  if (mdMatch?.[1]) {
    event.preventDefault();
    navigate(resolveRelativeMd(currentRoute().slug, mdMatch[1]));
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
