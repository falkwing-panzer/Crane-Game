/**
 * Robustez (fase 14): pausa automática al ocultar la pestaña o perder el foco la ventana, y aviso mientras se
 * recupera el contexto WebGL (con gráficas integradas se pierde a veces al suspender la laptop). three.js ya llama a
 * preventDefault al perderlo y vuelve a subir geometrías, texturas y shaders al recuperarlo; aquí se para el juego
 * mientras tanto y, si no vuelve, se ofrece recargar.
 */

/** Motivos de pausa y su texto */
export const PAUSE_TEXT: Record<string, string> = {
  pestaña: 'Juego en pausa: la pestaña está oculta',
  foco: 'Juego en pausa · haz clic en el juego para seguir',
  gráfica: 'Se perdió la gráfica: recuperando…',
};

/** Texto del aviso para una lista de motivos ('' = sin aviso). La gráfica manda. */
export function pauseText(reasons: string[]) {
  if (reasons.includes('gráfica')) return PAUSE_TEXT['gráfica'];
  if (reasons.includes('pestaña')) return PAUSE_TEXT['pestaña'];
  return reasons.length ? PAUSE_TEXT[reasons[0]] ?? 'Juego en pausa' : '';
}

/** Segundos de espera antes de ofrecer recargar si la gráfica no vuelve */
export const GL_GIVE_UP = 6;

interface Pausable { pause(reason: string, on: boolean): void; onPause: (reasons: string[]) => void }

/**
 * Engancha la pausa automática. `block` se llama con cada cambio (para soltar las teclas y no aceptar mandos).
 * Devuelve una función que quita los escuchadores.
 */
export function autoPause(loop: Pausable, canvas: HTMLCanvasElement, root: HTMLElement, block: (on: boolean) => void,
  /** Mostrar el aviso de pausa (no en el menú ni en la ficha, donde no corre nada); el de la gráfica, siempre */
  show: () => boolean = () => true) {
  const el = document.createElement('div');
  el.className = 'panel pause-card';
  el.hidden = true;
  el.setAttribute('role', 'status');
  root.appendChild(el);
  let giveUp = 0;

  loop.onPause = (reasons) => {
    const text = reasons.includes('gráfica') || show() ? pauseText(reasons) : '';
    el.hidden = !text;
    el.textContent = text;
    block(reasons.length > 0);
  };

  const ac = new AbortController();
  const opt = { signal: ac.signal };
  document.addEventListener('visibilitychange', () => loop.pause('pestaña', document.visibilityState === 'hidden'), opt);
  addEventListener('blur', () => loop.pause('foco', true), opt);
  addEventListener('focus', () => loop.pause('foco', false), opt);
  // un clic en la página también le da el foco (por si el evento focus no llega, p. ej. dentro de otro marco)
  addEventListener('pointerdown', () => loop.pause('foco', false), opt);
  canvas.addEventListener('webglcontextlost', () => {
    loop.pause('gráfica', true);
    clearTimeout(giveUp);
    giveUp = window.setTimeout(() => {
      el.innerHTML = 'No se pudo recuperar la gráfica. <button type="button">Recargar</button>';
      el.querySelector('button')!.addEventListener('click', () => location.reload());
    }, GL_GIVE_UP * 1000);
  }, opt);
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(giveUp);
    loop.pause('gráfica', false);
  }, opt);
  return () => { ac.abort(); clearTimeout(giveUp); el.remove(); };
}
