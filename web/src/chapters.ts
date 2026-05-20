export type Chapter = {
  slug: string;     // e.g. "00-intro" or "springboot/00-intro"
  title: string;
  content: string;
  track: string;    // e.g. "typescript" or "springboot"
};

export type Track = {
  id: string;
  label: string;
  chapters: readonly Chapter[];
};

// Vite eager glob: imports every .md from docs/ recursively as a raw string at
// build time. Result is bundled — no runtime fetch needed.
const modules = import.meta.glob('../../docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Track metadata: label and display order. Anything not in TRACK_ORDER falls
// to the end alphabetically.
const TRACK_ORDER = ['typescript', 'springboot'] as const;
const TRACK_LABELS: Record<string, string> = {
  typescript: 'Track TypeScript',
  springboot: 'Track Spring Boot',
};

function extractTitle(md: string): string {
  const match = md.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? 'Sin título';
}

function slugFromPath(path: string): string {
  // '../../docs/00-intro.md'            → 'typescript/00-intro'
  // '../../docs/springboot/00-intro.md' → 'springboot/00-intro'
  //
  // Files at the docs/ root (no subdir) are treated as the default TS track
  // and get a synthesized 'typescript/' prefix in the slug. We do this in
  // code instead of moving files so existing relative md links keep working.
  const trimmed = path.replace(/^.*\/docs\//, '').replace(/\.md$/, '');
  return trimmed.includes('/') ? trimmed : `typescript/${trimmed}`;
}

function trackFromSlug(slug: string): string {
  const idx = slug.indexOf('/');
  return idx >= 0 ? slug.slice(0, idx) : 'typescript';
}

function trackOrder(track: string): number {
  const i = (TRACK_ORDER as readonly string[]).indexOf(track);
  return i >= 0 ? i : TRACK_ORDER.length;
}

export const chapters: readonly Chapter[] = Object.entries(modules)
  .map(([path, content]) => {
    const slug = slugFromPath(path);
    return {
      slug,
      title: extractTitle(content),
      content,
      track: trackFromSlug(slug),
    };
  })
  .sort((a, b) => {
    const trackDiff = trackOrder(a.track) - trackOrder(b.track);
    if (trackDiff !== 0) return trackDiff;
    return a.slug.localeCompare(b.slug);
  });

// Grouped by track, in TRACK_ORDER. Tracks with no chapters are dropped.
export const tracks: readonly Track[] = (() => {
  const knownTracks = TRACK_ORDER.map((id) => ({
    id,
    label: TRACK_LABELS[id] ?? id,
    chapters: chapters.filter((c) => c.track === id),
  }));

  const unknownTrackIds = Array.from(new Set(chapters.map((c) => c.track))).filter(
    (t) => !(TRACK_ORDER as readonly string[]).includes(t),
  );
  const unknownTracks = unknownTrackIds.map((id) => ({
    id,
    label: TRACK_LABELS[id] ?? id,
    chapters: chapters.filter((c) => c.track === id),
  }));

  return [...knownTracks, ...unknownTracks].filter((t) => t.chapters.length > 0);
})();
