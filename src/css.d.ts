// Allow side-effect imports of CSS (Bun bundles these at runtime).
declare module "*.css";

declare module "*.png" {
  const src: string;
  export default src;
}
