/**
 * Bus de eventos del juego (fase 14). Las reglas, el HUD y el sonido no se llaman entre sí: la partida emite lo que
 * pasa (carga apoyada, golpe, corte del LMI, vuelco, fin del nivel…) y cada uno escucha lo que le interesa.
 * Sin three.js ni Rapier: se puede probar suelto.
 */

/** Lista de oyentes de un bus; `on` devuelve la función que lo quita */
export class Bus<E extends object> {
  private ls = new Map<keyof E, Set<(p: never) => void>>();

  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let s = this.ls.get(k);
    if (!s) this.ls.set(k, (s = new Set()));
    s.add(fn as (p: never) => void);
    return () => { s!.delete(fn as (p: never) => void); };
  }

  /** Llama a los oyentes en el orden en que se suscribieron, en el momento (síncrono) */
  emit<K extends keyof E>(k: K, p: E[K]) {
    const s = this.ls.get(k);
    if (!s) return;
    for (const fn of [...s]) (fn as (p: E[K]) => void)(p);
  }

  /** Quita todos los oyentes (al desmontar una partida) */
  clear() { this.ls.clear(); }

  /** Número de oyentes (pruebas) */
  count(k?: keyof E) {
    if (k !== undefined) return this.ls.get(k)?.size ?? 0;
    let n = 0;
    for (const s of this.ls.values()) n += s.size;
    return n;
  }
}

/** Fin de un nivel: fallo (título y texto) o victoria (null) */
export type Failure = { title: string; text: string } | null;

/**
 * Eventos de la partida. `unit` es el índice de la grúa (en el tándem hay dos); los mensajes de la que no se maneja
 * llevan su nombre delante (lo pone quien los muestra).
 */
export interface GameEvents {
  /** Mensaje para el jugador (s = segundos; once = no reiniciarlo si ya se muestra) */
  say: { text: string; s?: number; once?: boolean; unit?: number };
  /** La carga enganchada empieza a tocar algo bajando (v = velocidad de bajada, m/s) */
  land: { unit: number; v: number; fragile?: number };
  /** La carga enganchada toca algo de costado (v = velocidad horizontal, m/s) */
  strike: { unit: number; v: number };
  /** Golpe que cuenta en un nivel (chasis, plumín, torre): las reglas deciden si se cuenta */
  bump: { unit: number; text: string };
  /** El LMI corta un movimiento (overload: la carga supera la capacidad y se intentó izar) */
  cut: { unit: number; overload: boolean };
  /** Alarma de proximidad a una línea eléctrica (entra en la franja) */
  prox: Record<string, never>;
  /** La grúa empieza a volcar */
  tipping: { unit: number };
  /** Ya cayó: sale el cartel (en un nivel, nivel fallido) */
  tipped: { unit: number; text: string };
  /** Fin del nivel; stars y record solo con victoria */
  end: { fail: Failure; stars?: number; record?: boolean };
  /** Grúas reiniciadas (botón Reiniciar) */
  restart: Record<string, never>;
  /** Tab (tándem): ahora se maneja esta grúa (fase 15: la acción entra en un paso de la simulación) */
  switch: { unit: number };
  /** Se volvió a una instantánea (fase 15): rebobinar o continuar una partida guardada */
  restored: Record<string, never>;
}

export type GameBus = Bus<GameEvents>;
