declare module "virtual:stylesheets" {
  const contents: Record<string, string>;
  /** The font files actually present in `public/fonts/`. */
  export const shippedFonts: string[];
  export default contents;
}
