# 09 — Un frontend para el curso (TS + Vite + DOM)

## El problema

Llevamos 9 capítulos en `docs/` como `.md` planos. Para leerlos hay que abrirlos en un editor o en el preview de GitHub. Queremos un **mini sitio navegable** con:

- Sidebar con la lista de capítulos.
- Renderizado bonito (titles, code blocks con syntax highlighting, tablas).
- Navegación entre capítulos sin recargar página.

Y queremos hacerlo **sin abandonar TypeScript**. Nada de "el frontend es JS, el backend es TS". TypeScript desde el `index.html` hasta el handler de eventos.

## El stack (y por qué)

| Pieza              | Elección             | Por qué                                                    |
|--------------------|----------------------|------------------------------------------------------------|
| Build / dev server | **Vite**             | El estándar moderno. Rapidísimo. ESM nativo. TS sin config |
| Framework UI       | **Vanilla DOM**      | Para aprender TS, no un framework. DOM tipa muy bien.      |
| Markdown           | `marked` + `marked-highlight` | Ligero, API simple                                |
| Syntax highlight   | `highlight.js`       | Estándar, temas decentes, integra con marked               |
| Routing            | Hash routing propio  | 15 líneas, suficiente para una SPA estática                |

### ¿Por qué no React?

- **React añade conceptos** (componentes, JSX, hooks, virtual DOM) que **no son de TypeScript**. Aprenderlos ahora te quita foco.
- **El DOM nativo tipa estupendamente** desde que `lib: ["DOM"]` está en `tsconfig.json`. `querySelector` devuelve `Element | null`, los eventos están tipados, etc.
- **Tu siguiente proyecto** quizá sí use React/Vue/Svelte. Cuando llegue, lo aprendes con TS encima. Aquí toca dominar TS desnudo.

> 💡 **Cuándo SÍ React/Vue/Svelte**: cuando tu UI tiene estado complejo, muchos componentes reutilizables, animaciones, formularios con validación bidireccional, etc. Para una doc-site con sidebar + markdown, vanilla es **mejor**.

## Estructura del proyecto

```
node-ts-starter/
├── docs/                ← los .md del curso
├── src/                 ← backend (capítulos 01-08)
└── web/                 ← frontend (este capítulo)
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── main.ts         ← entry point
        ├── chapters.ts     ← descubre y carga los .md
        ├── markdown.ts     ← marked + highlight.js
        ├── router.ts       ← hash routing
        └── styles.css
```

`web/` es un **proyecto npm independiente** con su propio `package.json` y `node_modules`. Comparte el repo, no comparte deps. La única conexión: importa `../../docs/*.md` como recurso.

> 💡 **¿Por qué no un monorepo (workspaces)?** Para dos paquetes que no comparten código, el overhead no compensa. Si en el futuro queremos compartir tipos (p.ej. el contrato HTTP con Zod), entonces sí — npm workspaces o pnpm workspaces es el camino.

## La estrella: `import.meta.glob` de Vite

Mira `web/src/chapters.ts`:

```ts
const modules = import.meta.glob('../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
```

Esto es **magia de Vite**. En tiempo de **build**:

1. Vite encuentra todos los `.md` en `../../docs/`.
2. `query: '?raw'` los importa como **string crudo** (no como JS).
3. `eager: true` los inline en el bundle (sin lazy loading).
4. `import: 'default'` toma el default export del módulo virtual.

Resultado: `modules` es un objeto `{ 'path/to/01-foo.md': '# 01 — ...\n\nContenido...' }` con el contenido de cada archivo en memoria.

**Ventajas**:

- **Cero fetch en runtime** — todo está en el bundle.
- **Añades un capítulo nuevo**: solo creas `09-foo.md`. Vite lo recoge en el siguiente build sin tocar código.
- **TS lo entiende** porque casteamos el resultado.

> 💡 **Comparación**: en Webpack tendrías `require.context` (más feo). En esbuild puro no hay equivalente. **Es una feature distintiva de Vite** y vale oro para sitios estáticos.

### El `as Record<string, string>` es necesario

El tipo que Vite expone por defecto para `import.meta.glob` es `Record<string, () => Promise<unknown>>` (porque por defecto es lazy). Con `eager: true` y `import: 'default'`, el contenido es directamente la string — pero TS no lo infiere automáticamente. Por eso el cast.

Alternativa más segura: validar con Zod (sí, otra vez):

```ts
import { z } from 'zod';

const modulesSchema = z.record(z.string(), z.string());
const modules = modulesSchema.parse(
  import.meta.glob('../../docs/*.md', { query: '?raw', import: 'default', eager: true }),
);
```

Para una app trivial el cast vale. Para algo serio, parsea.

## Tipos del DOM

`lib: ["DOM", "DOM.Iterable"]` en `tsconfig.json` te da los tipos de:

- `document`, `window`, `HTMLElement`, `Element`, `Event`, `MouseEvent`…
- `Node`, `NodeList`, `HTMLCollection`…
- Selectores tipados.

### `querySelector` y narrowing

```ts
function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Element not found: ${selector}`);
  return node;
}

const sidebarEl = el<HTMLElement>('#sidebar');
```

`document.querySelector<T>(...)` devuelve `T | null`. **No es opcional** — el `null` es real. El helper hace dos cosas:

1. **Lanza si no existe** (boot bug — no debería pasar en producción).
2. **Estrecha el tipo** a `T` para que el resto del código no tenga que comprobar `null`.

> 💡 **Patrón típico TS** para boot code: si una invariante del HTML no se cumple, fallar en arranque es mejor que dejar `null` propagándose. **No es lo mismo que la validación de input** — esto son contratos internos.

### Event listeners y `target` narrowing

Mira el interceptor de clicks en `main.ts`:

```ts
contentEl.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest('a');
  if (!link) return;
  // ...
});
```

`event.target` es `EventTarget | null`. **No es `HTMLElement`**. Para usar `.closest('a')` (que es de `Element`), necesitas hacer narrow.

Opciones:

- **`event.target instanceof Element`** ✅ — type guard real, runtime check.
- **`event.target as HTMLElement`** ❌ — mentira si target es `Window` o algo raro.
- **`event.currentTarget`** — siempre el elemento donde está el listener (tipo conocido).

`currentTarget` es a veces mejor que `target`, pero aquí queremos saber **dónde** se hizo click dentro del content (un `<a>` anidado), así que `target` con guard.

## Hash routing en 15 líneas

`web/src/router.ts` entero:

```ts
export type Route = { slug: string };

export function currentRoute(): Route {
  const hash = window.location.hash.slice(1);
  const slug = hash.startsWith('/') ? hash.slice(1) : hash;
  return { slug };
}

export function navigate(slug: string): void {
  window.location.hash = `#/${slug}`;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
```

¿Por qué hash routing y no History API?

- **Hash routing** (`#/foo`) funciona **sin configuración de servidor**. Despliegas el `dist/` en cualquier static hosting (GitHub Pages, S3, Netlify) y va.
- **History API** (`/foo`) necesita que **el servidor reescriba** rutas desconocidas a `index.html`. Más realista, pero requiere config del hosting.

Para una doc-site estática: hash. Para una app real: History API + servidor que rewrita.

## Interceptar links `.md` dentro del contenido

Los `.md` tienen enlaces como `[Anterior](./00-intro.md)`. `marked` los renderiza como `<a href="./00-intro.md">Anterior</a>`. Sin intervención, **el navegador intenta descargar** `./00-intro.md` y 404.

Solución: interceptar el click y traducir a navegación SPA.

```ts
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
```

Notas:

- **`event.preventDefault()`** — sin esto, el navegador hace la navegación nativa y rompe la SPA.
- **El regex** acepta opcionalmente un fragmento (`#anchor`) tras `.md`. Aquí lo descartamos, pero podrías propagarlo.
- **Delegation, no listener por link**. Un solo listener en `contentEl` cubre cualquier link, incluso los que se rendericen después.

## Rendering vanilla con `innerHTML`

```ts
function renderSidebar(activeSlug: string): void {
  const items = chapters
    .map((c) => {
      const cls = c.slug === activeSlug ? 'active' : '';
      return `<li><a href="#/${c.slug}" class="${cls}">${escapeHtml(c.title)}</a></li>`;
    })
    .join('');

  sidebarEl.innerHTML = `<nav><ul>${items}</ul></nav>`;
}
```

**`innerHTML` con escapado**. No usamos un template engine. Las dos reglas:

1. **Datos que vienen de fuera del control del programador → `escapeHtml`**. El `c.title` lo extraemos del primer `# Heading` del markdown. Confiable, pero defendible.
2. **Marcado fijo → string literal**. No hay XSS si nadie inyecta el HTML.

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

Para algo serio: `lit-html` o `Solid` te dan templates con escapado automático y diff incremental. Para 100 líneas de HTML: `innerHTML` es fino.

## El bundle es grande y por qué

```
dist/assets/index-*.js   ~1 MB
```

Casi todo es **`highlight.js`** — incluye soporte para ~190 lenguajes por defecto. Optimización en una línea:

```ts
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
```

Pasa de 1MB → ~100KB. Ejercicio para ti.

## Cómo ejecutarlo

```bash
cd web
npm install        # primera vez
npm run dev        # arranca Vite en http://localhost:5173
npm run build      # genera dist/ para deployment
npm run typecheck  # tsc --noEmit
npm run preview    # sirve dist/ localmente
```

Cuando edites un `.md` en `docs/`, Vite hace HMR — el navegador refresca el contenido sin recarga completa.

## Trampas comunes

### 1. `querySelector` y `null`

```ts
const el = document.querySelector('#foo');
el.classList.add('active'); // ❌ 'el' is possibly 'null'
```

Siempre comprueba o usa un helper que lance. Especialmente importante con `noUncheckedIndexedAccess` (capítulo 02).

### 2. Confundir `target` y `currentTarget` en delegación

```ts
parent.addEventListener('click', (e) => {
  e.currentTarget; // parent (siempre)
  e.target;        // el descendiente clickeado
});
```

Para delegación necesitas `target`, pero **siempre con instanceof guard**.

### 3. `innerHTML` con datos del usuario sin escapar

XSS clásico. Si concatenas input del usuario en `innerHTML` sin escapar, **estás regalando ejecución de JS**. Aquí no hay input del usuario, pero acostúmbrate al patrón.

### 4. Olvidar `event.preventDefault()` en links interceptados

El click ocurre, tu listener corre, **y el navegador sigue navegando**. Bug clásico de SPA novata.

### 5. `import.meta.glob` con paths variables

```ts
const glob = (pattern: string) => import.meta.glob(pattern); // ❌
```

No funciona. **`import.meta.glob` necesita un string literal en tiempo de build** para que Vite pueda analizar el AST y resolver. No es una función normal.

### 6. Servir `docs/` fuera de `web/`

Por defecto, Vite **no permite** acceder a archivos fuera del root del proyecto (`web/`). Por eso `vite.config.ts` tiene:

```ts
server: { fs: { allow: ['..'] } }
```

En producción no aplica (`import.meta.glob` ha inline-ado los archivos en build time). Solo el dev server lo necesita.

## Ejercicio

1. **Reduce el bundle**: cambia `import hljs from 'highlight.js'` por imports selectivos (solo `typescript`, `bash`, `json`). Mide el tamaño de `dist/assets/*.js` antes y después. ¿De qué orden de magnitud es la diferencia?

2. **Añade búsqueda**: un input en la sidebar que filtre la lista de capítulos por título. Sin librerías — `filter()` sobre el array `chapters` y re-renderiza la sidebar. Practica el `addEventListener('input', ...)` con narrowing de `event.target`.

3. **Tabla de contenidos por capítulo**: para el capítulo actual, extrae los `## Section` con un regex y muestra una mini-TOC flotante. Cada link debe hacer scroll suave (`element.scrollIntoView({ behavior: 'smooth' })`).

4. **Reto — Indicador de progreso**: una barra al final de la sidebar que muestre "leíste 5 de 9 capítulos". Persiste en `localStorage` qué slugs se han visitado. Maneja los tipos correctamente (`JSON.parse` devuelve `unknown`).

5. **Reto — Result-aware fetch**: cuando movamos a History API + servidor, los capítulos se cargarán via `fetch('/api/chapters/:slug')`. Diseña un helper `fetchChapter(slug): Promise<Result<Chapter, FetchError>>` reutilizando `Result` del backend. ¿Cómo evitar duplicar el tipo en dos paquetes? Pista: workspace o paquete `shared/`.

6. **Reto — type-safe markdown**: actualmente el title se extrae con regex y se castea. Diseña un parser TS que devuelva `{ title: string; sections: { id: string; title: string; body: string }[] }`. Sin librerías. Practica el parsing manual con `while` y estado.

## 📖 Lectura paralela

*Effective TypeScript* (2ª ed) — items que profundizan este capítulo:

- **[Item 22 — *Understand Type Narrowing*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-inference/narrowing.md)** — `event.target instanceof Element` es narrowing en estado puro. Sin él, no puedes llamar a `.closest('a')`.
- **[Item 75 — *Understand the DOM Hierarchy*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/understand-the-dom.md)** — **el capítulo paralelo del libro**. Por qué `EventTarget` no es `HTMLElement`, por qué `Element` no es `HTMLElement`, etc. Mapa mental imprescindible para vanilla DOM.
- **[Item 76 — *Create an Accurate Model of Your Environment*](https://github.com/danvk/effective-typescript/blob/main/samples/ch-write-run/model-env.md)** — `import.meta.glob`, `import.meta.env`, `?raw` query suffixes: features inyectadas por Vite que tipas via `types: ["vite/client"]` en el tsconfig del web.

---

**Anterior:** [08 — Persistencia con `node:sqlite`](./08-persistencia-sqlite.md)
**Siguiente:** [10 — Docker, Compose, Biome y Makefile](./10-docker-y-tooling.md)
