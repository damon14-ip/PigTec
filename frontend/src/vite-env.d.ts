/// <reference types="vite/client" />

/**
 * Variables de entorno conocidas del frontend. Se declaran aqui para obtener
 * autocompletado y comprobacion de tipos al usar `import.meta.env`.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
