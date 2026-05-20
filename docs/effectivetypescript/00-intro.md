# 00 — Introducción al track *Effective TypeScript*

> Para una vista global del repo y los tres tracks disponibles, ver [`docs/README.md`](../README.md).

## Para quién es esto

Este curso está pensado para alguien que **ya programa backend** (Java, Go, PHP, Python u otros) y necesita aprender **TypeScript moderno** sin pasar por la curva clásica "qué es una variable". El objetivo no es aprender JavaScript, sino entender qué aporta TS sobre JS y cómo escribirlo de forma **idiomática**.

Asunciones que hago sobre ti:

- Sabes qué es un tipo, un generic, una interface, polimorfismo, etc.
- Has lidiado con sistemas de tipos estructurales (Go) y nominales (Java).
- Te interesa el "porqué" más que el "qué" — las reglas las puedes buscar; la intuición no.

## Cómo está organizado

Cada capítulo tiene esta estructura fija:

1. **Problema** — qué dolor concreto resuelve el concepto.
2. **Cómo lo resuelve TS** — la mecánica, con snippets del **código real de este repo**, no ejemplos inventados.
3. **Comparación** — paralelos con Java/Go/Python para anclar la idea.
4. **Trampas** — lo que sorprende al venir de otros lenguajes.
5. **Ejercicio** — algo concreto para hacer en el repo y ver el efecto.

No hay "Hello World". El repo arranca ya con un servidor HTTP real (Hono), validación (Zod), y configuración estricta. Aprendemos sobre código que se parece al que escribirás en producción.

## Cómo usarlo

- Lee el capítulo entero antes de tocar nada.
- Luego abre el archivo del repo que se menciona y léelo con el capítulo al lado.
- Haz el ejercicio. Romper cosas a propósito enseña más que escribirlas bien a la primera.
- Si una analogía con Java/Go no te cuadra, ignórala — es un ancla, no una equivalencia exacta.

## Mapping con *Effective TypeScript*

El curso no sustituye al libro de Dan Vanderkam (https://effectivetypescript.com/), lo **acompaña**. Hay un [repo oficial](https://github.com/danvk/effective-typescript) con los 83 items, sus "Things to Remember" y todos los code samples — vamos a referenciarlos directamente.

**Los números son de la 2ª edición** (mayo 2024). Si solo tienes la 1ª edición, busca por concepto.

### Track Effective TypeScript — base (00–17)

Fundamentos + stack realista, anclado al libro [*Effective TypeScript* (2ª ed.)](https://effectivetypescript.com/) de Dan Vanderkam. Cada capítulo apunta al código en `services/node-api/` y `web/`.

| Capítulo                                                          | Items *Effective TS* (2ª ed) |
|-------------------------------------------------------------------|------------------------------|
| ✅ 00 (este)                                                       | —                            |
| ✅ [01 — Runtime y ESM](./01-runtime-y-esm.md)                     | 3, 72, 73, 79                |
| ✅ [02 — tsconfig estricto](./02-tsconfig-strict.md)               | 2, 11, 14, 22, 83            |
| ✅ [03 — Validación con Zod](./03-validacion-con-zod.md)           | 30, 46, 74, 76               |
| ✅ [04 — Result type](./04-result-type.md)                         | 22, 32, 34, 59               |
| ✅ [05 — Testing con `node --test`](./05-testing-node-test.md)     | 55, 77                       |
| ✅ [06 — Branded types](./06-branded-types.md)                     | 4, 14, 35, 41, 64            |
| ✅ [07 — Servicios y repositorios](./07-servicios-y-repositorios.md) | 13, 29, 41, 67             |
| ✅ [08 — Persistencia SQLite](./08-persistencia-sqlite.md)         | 30, 46, 74, 76               |
| ✅ [09 — Frontend del curso](./09-frontend-curso.md)               | 22, 75, 76                   |
| ✅ [10 — Docker y tooling](./10-docker-y-tooling.md)               | 2, 65, 78                    |
| ✅ [11 — Postgres (Supabase)](./11-supabase-postgres.md)           | 30, 35, 41, 74               |
| ✅ [12 — Error handling y observabilidad](./12-error-handling-y-observabilidad.md) | 33, 34, 41, 59 |
| ✅ [13 — CI/CD](./13-ci-cd.md)                                     | 2, 65, 78                    |
| ✅ [14 — Type-level testing](./14-type-level-testing.md)           | 50, 55, 56, 77               |
| ✅ [15 — Métricas Prometheus](./15-metricas-prometheus.md)         | 34, 41, 76, 78               |
| ✅ [16 — OpenTelemetry tracing](./16-opentelemetry-tracing.md)     | 27, 33, 41, 76               |
| ✅ [17 — Stack observabilidad](./17-observabilidad-stack.md)       | 41, 65, 76, 78               |

### Track Effective TypeScript — avanzado (18–27)

Cubre los huecos teóricos del track base: narrowing profundo, generics y type-level programming, mapped/conditional types, evolución de APIs públicas. Mismo libro de referencia (*Effective TypeScript*), capítulos más densos. Léelo cuando el código del repo te resulte familiar — los conceptos se referencian entre sí.

| Capítulo                                                                          | Items *Effective TS* (2ª ed) |
|-----------------------------------------------------------------------------------|------------------------------|
| ✅ [18 — Narrowing y type guards](./18-narrowing-y-type-guards.md)                | 5, 22, 42, 59                |
| ✅ [19 — Generics avanzados](./19-generics-avanzados.md)                          | 26, 50, 51, 52               |
| ✅ [20 — Conditional types e `infer`](./20-conditional-types-e-infer.md)          | 50, 51, 52, 53               |
| ✅ [21 — Template literal y mapped types](./21-template-literal-y-mapped-types.md) | 14, 15, 53                  |
| ✅ [22 — Overloads y `satisfies`](./22-overloads-y-satisfies.md)                  | 21, 49, 50                   |
| ✅ [23 — Declaration merging](./23-declaration-merging.md)                        | 13, 79, 82                   |
| ✅ [24 — `Symbol` y `unique symbol`](./24-symbol-y-unique-symbol.md)              | 53, 64                       |
| ✅ [25 — Index signatures y `Record`](./25-index-signatures-y-record.md)          | 17, 33, 60                   |
| ✅ [26 — Async, `Promise<T>`, `Awaited<T>`](./26-async-promise-awaited.md)        | 27, 31, 42                   |
| ✅ [27 — API design y evolución de tipos](./27-api-design-y-evolucion.md)         | 30, 41, 51, 78               |

Al final de cada capítulo encontrarás una sección **📖 Lectura paralela** con los items concretos y un link directo al repo del libro.

### Tracks relacionados

- [Track Total TypeScript](../totaltypescript/00-intro.md) — notas propias sobre el libro de Matt Pocock, complementarias a este track.
- [Track Spring Boot](../springboot/00-intro.md) — guía paralela en Java/Spring para `services/spring-api/`. Independiente de este track.

## Convenciones

- **Términos técnicos en inglés**: `narrowing`, `discriminated union`, `type guard`, `inference`, `generic`, `branded type`. Traducirlos rompe el puente con la documentación oficial y Stack Overflow.
- **Comentarios en el código**: también en inglés (es lo idiomático en proyectos TS open-source).
- **Prosa**: español.

## Qué NO vas a encontrar aquí

- Sintaxis básica de JS (variables, funciones, async/await).
- Comparación entre TS y otros transpiladores (Flow, JSDoc-types).
- React, Next.js, ni nada de frontend (por ahora). El stack es backend Node.

---

**Siguiente:** [01 — Runtime y ESM](./01-runtime-y-esm.md)
