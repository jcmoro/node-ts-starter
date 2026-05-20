# 00 — Introducción al track *Total TypeScript Essentials*

## Qué es este track

Notas de estudio en español sobre el libro gratuito [*Total TypeScript Essentials*](https://www.totaltypescript.com/books/total-typescript-essentials) de **Matt Pocock**, ancladas al código de este repo.

**No es** una traducción ni una copia del libro — eso sería una violación de copyright, y además innecesario (el libro está gratis online). **Es** un compañero de lectura:

- Resúmenes en español de las ideas clave de cada capítulo.
- Ejercicios adaptados a `services/node-api/` y `web/`.
- Notas marcando dónde el libro se solapa con nuestro track TS principal (00–27) y dónde aporta material nuevo.
- Links a la sección original de Matt para el "contenido autoritativo".

**Cómo se lee:** abre cada capítulo del libro de Matt en una pestaña, lee nuestro doc paralelo aquí. Las notas señalan a qué prestar atención y cómo aterrizar las ideas en código.

## Quién es Matt Pocock

Probablemente la voz más activa en la comunidad TypeScript hoy. Creador de *Total TypeScript* (curso advanced de pago), miles de videos cortos en X/YouTube, mantiene varias libs (`type-fest`, `ts-reset`, contribuciones a la doc de TS). Su estilo:

- Modernísimo (siempre actualizado al último Boot del compilador).
- Hands-on (basa el aprendizaje en exercises que rompen y arreglan código).
- Foco en **type-level programming** y patrones idiomáticos.

## Cómo se complementa con nuestro track TS

Nuestro track principal (00–27) tiene como ancla *Effective TypeScript* de Dan Vanderkam — un libro estructurado en 83 "items" con consejos puntuales. Total TS es más temático y procesual: tomas un tema (clases, narrowing, decorators) y lo recorres entero con ejemplos progresivos.

**Solapamientos** (Total TS y nuestro track cubren cosas similares):

- Setup, tsconfig, narrowing, mutability, deriving types, assertions, API design, configuring.

**Huecos reales** que Total TS cubre y nosotros no (o solo de pasada):

- **Cap. 2 — IDE Superpowers**: workflow VSCode + TS Server (productividad práctica).
- **Cap. 8 — Classes**: en profundidad. Nuestro foco senior-functional las saltó.
- **Cap. 9 — TypeScript-only Features**: enums numéricos vs string, namespaces legacy.
- **Cap. 12 — The Weird Parts**: gotchas raros del compilador, sistematizados.
- **Cap. 13 — Modules / Declaration Files**: authoring `.d.ts` para publicar libs npm.

## Plan curricular

Track completo (17 docs). Todos publicados.

| Doc                                                              | Tema                                              | Solapamiento con nuestro track            |
|------------------------------------------------------------------|---------------------------------------------------|--------------------------------------------|
| ✅ 00 (este)                                                      | Introducción                                       | —                                          |
| ✅ [01](./01-kickstart-setup.md)                                  | Kickstart Your TypeScript Setup                    | Solapa con docs 01 + 02                    |
| ✅ [02](./02-ide-superpowers.md)                                  | IDE Superpowers                                    | **Hueco**                                  |
| ✅ [03](./03-development-pipeline.md)                             | TypeScript In The Development Pipeline             | Solapa con docs 10 + 13                    |
| ✅ [04](./04-essential-types.md)                                  | Essential Types and Annotations                    | Solapa con doc 02 (implícito)              |
| ✅ [05](./05-unions-literals-narrowing.md)                        | Unions, Literals, and Narrowing                    | Solapa con docs 04 + 18                    |
| ✅ [06](./06-objects.md)                                          | Objects                                            | Solapa con doc 06                          |
| ✅ [07](./07-mutability.md)                                       | Mutability                                         | Solapa con doc 06 ampliado                 |
| ✅ [08](./08-classes.md)                                          | Classes                                            | **Hueco**                                  |
| ✅ [09](./09-typescript-only-features.md)                         | TypeScript-only Features                           | **Hueco**                                  |
| ✅ [10](./10-deriving-types.md)                                   | Deriving Types                                     | Solapa con docs 19 + 20 + 21               |
| ✅ [11](./11-annotations-and-assertions.md)                       | Annotations and Assertions                         | Solapa con doc 22                          |
| ✅ [12](./12-the-weird-parts.md)                                  | The Weird Parts                                    | **Hueco**                                  |
| ✅ [13](./13-modules-and-declarations.md)                         | Modules, Scripts, and Declaration Files            | **Hueco parcial** (.d.ts authoring)        |
| ✅ [14](./14-configuring-typescript.md)                           | Configuring TypeScript                             | Solapa con doc 02                          |
| ✅ [15](./15-designing-your-types.md)                             | Designing Your Types (= type-level toolkit)        | Solapa con docs 19 + 20 + 21               |
| ✅ [16](./16-utility-folder-development.md)                       | Utility Folder Development (generic functions, predicates, overloads) | Solapa con docs 18 + 19 + 22 |

**Etiqueta "Hueco"** = el capítulo cubre material que no aparece (o solo se menciona) en nuestro track 00–27. Esos son los docs con más contenido propio.

**Etiqueta "Solapa con doc X"** = el material está cubierto en nuestro track. Estos docs son más breves: resumen de qué cuenta Matt + nota "lee también doc X para nuestro framing".

## Convenciones

Las mismas que el track principal:

- **Términos técnicos en inglés** (`narrowing`, `discriminated union`, `type guard`, etc.).
- **Prosa en español**.
- **Comentarios de código** en inglés.
- **Snippets**: cuando se pueda, ejemplos sobre código real del repo. Cuando no, código sintético claramente marcado.

## Créditos y copyright

Todo el crédito conceptual va a [Matt Pocock](https://www.totaltypescript.com/). Estos docs son **notas de estudio derivadas**, no copias. Si encuentras valor en el libro, dale visibilidad — comparte, recomiéndalo, considera comprar [Total TypeScript (advanced)](https://www.totaltypescript.com/) si quieres profundizar más allá del libro gratuito.

---

**Siguiente:** [01 — Kickstart Your TypeScript Setup](./01-kickstart-setup.md)
