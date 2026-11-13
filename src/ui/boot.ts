// Pantalla de carga (fase 13). El HTML y el CSS están en index.html para que se vean mientras baja el JS;
// aquí solo se avanza por etapas reales: descarga (en index.html, sin porcentaje) → física → escena → primer cuadro.

import { t } from '../i18n';

const el = () => document.getElementById('boot');

/** Etapa de la carga: texto y avance 0…1 */
export function bootStage(text: string, p: number) {
  const b = el();
  if (!b) return;
  b.classList.remove('wait');
  b.querySelector<HTMLElement>('.bar u')!.style.width = `${Math.round(p * 100)}%`;
  b.querySelector('#boot-text')!.textContent = t.boot.loading(text, Math.round(p * 100));
}

/** Deja que el navegador pinte la etapa antes de un trabajo largo y síncrono (con la pestaña oculta no hay cuadros: tope de 50 ms). */
export function nextPaint() {
  return new Promise<void>((r) => {
    const t = setTimeout(r, 50);
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }));
  });
}

/** Listo: se desvanece y se quita */
export function bootDone() {
  const b = el();
  if (!b || b.classList.contains('gone')) return;
  // tiempo de carga hasta el primer cuadro: performance.getEntriesByName('gruas-listo')
  performance.mark('gruas-listo');
  b.classList.add('gone');
  setTimeout(() => b.remove(), 500);
}

/** Error al arrancar (WebGL, wasm…): se muestra en la pantalla de carga en vez de quedarse colgada */
export function bootError(err: unknown) {
  const b = el();
  if (!b) return false;
  b.classList.remove('wait', 'gone');
  b.querySelector('.bar')?.remove();
  b.querySelector('#boot-text')!.textContent = t.boot.failed;
  const pre = document.createElement('pre');
  pre.textContent = String(err);
  b.append(pre);
  return true;
}
