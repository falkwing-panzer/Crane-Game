import { isCrawler, type CraneSpec, type WheeledSpec } from '../../crane/cranes';
import type { CraneModel } from '../craneModel';
import type { CrawlerModel } from '../crawlerModel';

/** Modelo 3D de una grúa: de ruedas (o torre sobre camión) u orugas; los dos tienen la misma interfaz */
export type CraneView = CraneModel | CrawlerModel;
/** Crea el modelo de una grúa */
export type ModelFactory = (T: CraneSpec) => CraneView;

/**
 * Fase 14: los modelos se traen con import() solo si la partida los usa (las orugas, con su celosía, van en otro
 * archivo que las grúas de ruedas). La física y las cotas (`layout`, `crawlerLayout`) siguen en el archivo principal.
 */
export async function loadModels(specs: CraneSpec[]): Promise<ModelFactory> {
  const [w, c] = await Promise.all([
    specs.some((T) => !isCrawler(T)) ? import('../craneModel') : null,
    specs.some((T) => isCrawler(T)) ? import('../crawlerModel') : null,
  ]);
  return (T) => (isCrawler(T) ? new c!.CrawlerModel(T) : new w!.CraneModel(T as WheeledSpec));
}
