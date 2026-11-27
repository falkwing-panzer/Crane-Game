import { CRANES, type CraneId } from '../crane/cranes';
import { jobSources, type Job } from '../game/session';
import { loadLicenses } from '../game/licenses';
import { loadRecords } from '../ui/levelUi';
import { loadSchool } from '../ui/schoolUi';
import { t } from '../i18n';
import { loadCareer, offerLevel, rentOf } from './career';

/** Licencias en la carrera: las ganadas, más siempre la de ruedas (se empieza con ella) */
export const careerLic = () => ({ ...loadLicenses(loadRecords(), loadSchool()), ruedas: 1 });

/** ?contrato=k[&grua=id]: la oferta k de la carrera guardada, con las averías por desgaste de la grúa propia */
export function contractJob(p: URLSearchParams): Job | null {
  const raw = p.get('contrato');
  if (raw === null) return null;
  const c = loadCareer(), k = Number(raw), o = c?.offers[k];
  if (!c || !o) return null;
  const base = offerLevel(o);
  if (!base) return null;
  const want = p.get('grua') as CraneId | null, id = want && base.cranes.includes(want) ? want : base.rec;
  const own = c.fleet.find((f) => f.id === id);
  const L = offerLevel(o, own?.wear ?? 0, c.seed + c.day * 13 + k)!;
  const tc = t.career;
  const note = `${tc.pay(o.pay)} · ${own ? tc.own(CRANES[id].name, own.wear) : tc.rent(CRANES[id].name, rentOf(id))}` +
    (L.events?.some((e) => e.kind === 'leak' || e.kind === 'cable') && own && own.wear >= 60 ? ` · ${tc.worn}` : '');
  return { kind: 'contrato', L, key: `contrato-${c.day}-${k}`, head: tc.head(c.day), url: `?contrato=${k}`, offer: k, note };
}

jobSources.push(contractJob);
