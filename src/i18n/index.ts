import { es, type Lang } from './es';

export type { Lang };

/**
 * Textos del idioma elegido (fase 14: solo español). Para añadir otro: un archivo con el tipo `Lang` y elegirlo aquí
 * (por ejemplo, con `navigator.language` o un ajuste).
 */
export const t: Lang = es;
