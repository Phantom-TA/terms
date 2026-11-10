/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** AG Grid Enterprise licence key. Designed to be public; without it the grid shows a watermark. */
  readonly VITE_AG_GRID_LICENSE_KEY?: string;
  /** AG Studio licence key, for Cash Studio. Designed to be public, like the grid's. */
  readonly VITE_AG_STUDIO_LICENSE_KEY?: string;
  /** Development only: serve MSW mocks. Ignored by production builds. */
  readonly VITE_USE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css';
declare module '@fontsource-variable/*';
declare module '@fontsource/*';
