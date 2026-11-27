// Fase 28: obras del editor y repeticiones dentro del enlace, sin servidor. JSON → deflate (CompressionStream del
// navegador, sin dependencias) → base64 para URL. Las obras van en la consulta (?obra=…, ~1–2 kB); las repeticiones
// pueden ser más largas y van detrás de # (?repeticion=h#…): esa parte no se manda al servidor de GitHub Pages.

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (code: string) => {
  const s = atob(code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Objeto → código para el enlace */
export async function pack(v: unknown): Promise<string> {
  return toB64(await through(new TextEncoder().encode(JSON.stringify(v)), new CompressionStream('deflate-raw')));
}

/** Código → objeto (null si no vale) */
export async function unpack(code: string): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await through(fromB64(code), new DecompressionStream('deflate-raw'))));
  } catch {
    return null;
  }
}

/** Códigos ya descomprimidos: sessionDef es síncrona, así que la app los prepara antes de montar la partida */
const cache = new Map<string, unknown>();
export const cached = (code: string | null) => (code ? cache.get(code) ?? null : null);

/** Parámetros con código: ?obra=… y ?repeticion=… (con 'h', el código va detrás de #) */
export const CODE_PARAMS = ['obra', 'repeticion', 'editor'] as const;

/** Código de un parámetro (o el de detrás de #) */
export function codeOf(params: URLSearchParams, key: (typeof CODE_PARAMS)[number], hash = '') {
  const v = params.get(key);
  if (v === 'h') return hash.replace(/^#/, '') || null;
  return v;
}

/** Descomprime los códigos de la URL y los deja listos para sessionDef */
export async function prepareShared(search: string, hash = '') {
  const p = new URLSearchParams(search);
  for (const k of CODE_PARAMS) {
    const c = codeOf(p, k, hash);
    if (c && !cache.has(c)) cache.set(c, await unpack(c));
  }
}

/** Para las pruebas */
export const remember = (code: string, v: unknown) => cache.set(code, v);
