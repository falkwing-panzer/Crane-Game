import { isCrawler, type WheeledSpec } from '../../crane/cranes';
import { CraneModel } from '../craneModel';
import { CrawlerModel } from '../crawlerModel';
import type { ModelFactory } from './load';

/** Todos los modelos cargados de antemano (pruebas en Node; el juego usa `loadModels`) */
export const allModels: ModelFactory = (T) => (isCrawler(T) ? new CrawlerModel(T) : new CraneModel(T as WheeledSpec));
