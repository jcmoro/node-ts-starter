# 00 — Introducción

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

| Capítulo nuestro | Items relevantes (2ª ed) |
|------------------|--------------------------|
| 01 — Runtime y ESM | 3, 72, 73, 79 |
| 02 — tsconfig estricto | 2, 11, 14, 22, 83 |
| 03 — Validación con Zod | 30, 46, 74, 76 |
| 04 — Result type | 22, 32, 34, 59 |
| 05 — Testing con `node --test` | 55, 77 |
| 06 — Branded types | 4, 35, 41, 64 |
| 07 — Servicios y repositorios | 13, 29, 41, 67 |
| 08 — Persistencia SQLite | 30, 46, 74, 76 |
| 09 — Frontend del curso | 22, 75, 76 |
| 10 — Docker y tooling | 2, 65, 78 |
| 11 — Postgres (Supabase) | 30, 35, 41, 74 |
| 12 — Error handling y observabilidad | 33, 34, 41, 59 |
| 13 — CI/CD | 2, 65, 78 |
| 14 — Type-level testing | 50, 55, 56, 77 |
| 15 — Métricas Prometheus | 34, 41, 76, 78 |
| 16 — OpenTelemetry tracing | 27, 33, 41, 76 |

Al final de cada capítulo encontrarás una sección **📖 Lectura paralela** con los items concretos y un link directo al repo del libro.

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
