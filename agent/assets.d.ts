// Server-side asset imports embedded at build time via Bun import attributes
// (`with { type: "text" }` / `with { type: "file" }`), so they survive
// `bun build --compile`. The frontend's *.png / *.css declarations live in
// src/css.d.ts; this file covers the templates the backend embeds.
declare module "*.tex" {
  const content: string;
  export default content;
}

declare module "*.md" {
  const content: string;
  export default content;
}
