export type Chapter = {
  slug: string;
  title: string;
  content: string;
};

// Vite eager glob: imports every .md from docs/ as a raw string at build time.
// The result is bundled — no runtime fetch needed.
const modules = import.meta.glob('../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function extractTitle(md: string): string {
  const match = md.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? 'Sin título';
}

function slugFromPath(path: string): string {
  const file = path.split('/').pop() ?? '';
  return file.replace(/\.md$/, '');
}

export const chapters: readonly Chapter[] = Object.entries(modules)
  .map(([path, content]) => ({
    slug: slugFromPath(path),
    title: extractTitle(content),
    content,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));
