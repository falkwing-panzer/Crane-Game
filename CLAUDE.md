# Simulador de grúas 3D

Juego/simulador de grúas móviles en 3D con física, que corre en el navegador.
Autor: Jesus. Idioma de la interfaz y de las respuestas: **español**.

## Origen
`referencia/crane-v20.html` es la versión anterior (un solo archivo HTML, vista en planta + vista lateral,
renderer WebGL propio). **No se edita**: se usa como fuente de datos, lógica de estabilidad y niveles.
Contiene:
- `CRANES`: 11 grúas (SK 60 tipo Spierings, City 25, AT 60, RT 90, AT 220, AT 300-6, AT 450-8, AT 500-8,
  AT 650-8 con plumín abatible, LR 300 orugas, LR 3000 orugas con superlift y contrapeso de radio ajustable)
  con dimensiones de chasis, ejes, radio de llantas, estabilizadores, pluma y masas.
- Modelo de estabilidad: polígono de apoyo, momentos de vuelco por arista (`tipUtil`), factores `KF`,
  LMI = max(utilización/KF, carga/capacidad estructural), `ratedCap` por búsqueda binaria.
- Gancho como péndulo 3D (Verlet) con cable inextensible, viento, velocidad de aterrizaje, cargas frágiles.
- Fases de montaje: estabilizadores, lastre, Y-guy, plumín, erección de grúa torre (SK).
- 13 niveles (`LEVELS`).

## Stack
- Vite + TypeScript
- three.js (render), @dimforge/rapier3d-compat (física)
- Sin frameworks de UI pesados: HTML/CSS simple para el HUD.

## Hardware objetivo (importante)
Laptop con Intel Core Ultra 5 125U, gráfica integrada Intel (memoria compartida), 16 GB RAM.
- Meta: 60 fps a 1080p en esta laptop. Medir antes de añadir efectos.
- Una sola luz con sombras (mapa de 2048 máx.), sin postprocesado pesado.
- Geometrías simples; reutilizar materiales; instancing para piezas repetidas (llantas, celosía).
- Mostrar contador de fps en modo desarrollo.

## Enfoque de física (decisión de diseño)
- La estabilidad de la grúa (vuelco, LMI) se calcula con el **modelo analítico** portado de la referencia,
  no dejándolo al motor de cuerpos rígidos: es más fiel a cómo funciona una grúa real y más estable numéricamente.
- Rapier se usa para: cable + gancho + carga (cadena de cuerpos o joint de distancia), colisiones de la carga
  con el entorno, el vehículo al conducir, y el vuelco una vez que el modelo analítico lo detecta.
- Tándem (izaje con dos grúas): una carga con dos puntos de enganche; cada grúa lleva su parte de la carga
  según la geometría. Planificado para una fase posterior.

## Estructura sugerida
```
src/
  main.ts            arranque, bucle
  render/            escena, cámaras, materiales, modelos de grúas
  physics/           mundo Rapier, cable, carga
  crane/             datos (cranes.ts), estabilidad (stability.ts), cinemática de pluma
  levels/            definición de niveles
  ui/                HUD, LMI, controles
```

## Reglas de trabajo
- Cambios pequeños y verificables; después de cada cambio, correr `npm run dev` y revisar que no hay errores en consola.
- La lógica de estabilidad debe tener pruebas (vitest) con casos de la referencia.
- No inventar especificaciones de grúas: si un dato no está en la referencia, decirlo y preguntar.
- No usar nombres de marca en el juego (Liebherr, Grove, Spierings): usar los nombres de la referencia.
- Commits frecuentes con mensajes claros en español.

## Controles (heredados de la referencia)
Flechas conducir/dirección · A/D giro · W/S elevar pluma · Q/E telescopar · R/F cable · Espacio gancho ·
O estabilizadores · B lastre · Y Y-guy · T/G plumín · M montaje · K/L radio superlift · Shift fino ·
V cámara (en la referencia cambiaba la vista lateral; aquí: orbital libre → seguimiento → cabina del conductor).
Extra (no está en la referencia): **X** reponer la carga en su posición inicial (ayuda de prueba hasta que haya reinicio de nivel) ·
**P** puentear el LMI (sin cortes, para poder probar el vuelco; se apaga al reiniciar).

## Estado y decisiones
Se trabaja por fases (ver `FASES.md`), con `/clear` entre fases. **Al cerrar cada fase, actualizar esta sección**
(estado, decisiones con su porqué, pendientes y medidas de rendimiento) para que la siguiente fase no rehaga ni
contradiga lo anterior. Mantenerla corta: lo que ya dice el código o el historial de git no va aquí.

### Fases terminadas
- **Fase 0** (demo AT 60): escena, AT 60 simplificada, cable/gancho/carga con Rapier, HUD con fps, controles.
- **Fase 1** (estabilidad y LMI): las 11 grúas en `cranes.ts`, port de la estabilidad en `stability.ts`, pruebas contra
  la referencia, LMI / capacidad / radio en el HUD (solo indica; sin bloqueos todavía).
- **Fase 2** (AT 60): estabilizadores (O) animados con elevación del chasis, cortes del LMI (`guard`), tensión del cable
  medida en Rapier para el LMI dinámico, inclinación incipiente (`phi`) y vuelco con cuerpo dinámico de Rapier, cartel y
  Reiniciar. Pruebas en `ops.test.ts` (incluye física: tensión y caída).
- **Fase 3** (conducción AT 60): flechas con el controlador de bicicleta de la referencia, modo `move` (KF 0,45), pick & carry
  al 30 % y bloqueado por LMI, choques del chasis y de las zapatas con obstáculos, ruedas que giran y se orientan, suspensión,
  cámaras (V) y luz de sombras que sigue a la grúa. Pruebas en `drive.test.ts`.

### Mapa del código
- `src/crane/cranes.ts`: `CRANES` (las 11 grúas; el literal se copió tal cual de la referencia y una prueba lo compara),
  `CraneSpec`, `AT60` (= `CRANES.medium`, tipada `WheeledSpec` para el modelo 3D de la fase 0).
- `src/crane/stability.ts`: `KF`, `yNoGuy`, `reach`, `structCap`, `supportRect`, `craneMasses`, `tipUtil`, `lmiStatic`,
  `ratedCap`, `CraneConfig` y `baseConfig(T)`. `tipEdge` (no está en la referencia) = `tipUtil` + qué arista manda
  (0 delante, 1 detrás, 2 izquierda −z, 3 derecha +z).
- `src/crane/reference.ts` (solo pruebas): extrae del HTML (import `?raw`) el bloque `const D … ratedCap` y lo ejecuta.
- `src/crane/kinematics.ts`: `CraneState` (incluye `out`/`outT`, `phi`/`phiV`/`edge`), `stepCrane(…, lim)` con el `guard`
  de la referencia (`StepLimits`: corte por LMI, sin izar si la carga supera la capacidad, inclinada solo recuperar),
  `stepOutriggers`, `carrierLift`, `headPos` (en el marco del chasis apoyado; luego se aplica la pose).
- `src/crane/drive.ts`: `stepDrive` (conducción de `step()` de la referencia), `yawRate`, `minTurnRadius`, `stepSuspension`,
  `axleSteer` (ángulo de cada eje como el dibujo de la referencia). `MOVING` = 0,05 m/s, `CARRY_SPEED` = 0,3.
- `src/crane/ops.ts`: `supportMode` (`out` solo con `out = 1`; `move` con |vd| > 0,05), `toggleOutriggers` (condiciones de la referencia),
  `dynamicStability` (tensión en `gp`), `stepTilt` (phi de la referencia), `TIP_PHI` = 0,06.
- `src/crane/pose.ts`: `carrierPose` = `carrierFrame` (x, z, rumbo h) ∘ elevación y `phi` ∘ `suspensionPose`; `edgeAxis`
  (marco del chasis), `worldToCarrier`, `compose`, cuaterniones sin three.js.
- `src/physics/world.ts`: mundo Rapier; `Physics.step(S, pose)`, `tension`/`gp`, `tipOver()`, `reset()`, `headWorld()`,
  `toggleHook()` (condiciones de enganche de la referencia), `resetLoads()` (tecla X; cada `Load` guarda su `home`),
  `addObstacle`, `carrierBlocked(x, z, h)` y `padsBlocked(S)` (consultas `intersectionsWithShape`), `SITE_HALF` = 150 m.
- `src/render/camera.ts` (`CameraRig`: modos de cámara y luz que sigue a la grúa), `site.ts` (obstáculos de prueba `TEST_OBSTACLES`).
- `src/render/scene.ts`, `craneModel.ts`, `rigging.ts`: escena, grúa, gancho/cable/cargas.
- `src/ui/input.ts`, `hud.ts`: teclas, HUD y cartel de vuelco. En desarrollo, `window.__gruas` (S, C, phys, ctx, dyn, pose,
  cut…) y `__gruas.advance(s)`, que avanza la simulación sin `requestAnimationFrame` (el panel oculto del navegador no
  dibuja cuadros; así se puede probar desde la consola).

### Convenciones
- Unidades: m, t, rad, s. Masas en Rapier en **toneladas**; gravedad 9,81.
- Ejes: y arriba; chasis a lo largo de **+x (frente)**; **−z = izquierda**. Rumbo `h` y dirección `steer` positivos =
  izquierda (antihorario visto desde arriba), avance = (cos h, 0, −sin h); la referencia usa el signo contrario en planta. `slew` positivo = antihorario visto desde arriba
  (A). Pluma en el plano x-y de la superestructura; `headPos` = fórmula de `reach()` de la referencia.
- Física con paso fijo de 1/60 s (máximo 4 pasos por cuadro); render a la frecuencia de la pantalla.
- Cotas no tomadas de la referencia (cabinas, ancho de llanta, nº de tramos, cilindro de elevación) están marcadas
  en el código como "aproximación visual".

### Decisiones
- **Grúa no dinámica en Rapier mientras está de pie**: chasis, superestructura y cabeza (sin colisionador, ancla del cable)
  son cinemáticos y siguen `carrierPose` (elevación por estabilizadores e inclinación `phi`). La estabilidad la decide
  el modelo analítico. Al pasar `phi` de 0,06 rad, `tipOver()` los cambia por **un** cuerpo dinámico (masa y CDG de
  `craneMasses`, alturas aproximadas; inercia diagonal) con la pose y la velocidad de giro del modelo. Su base es el
  rectángulo de apoyo (zapatas o base de neumáticos) para que pivote en la misma arista que el modelo.
- **Vuelco como la referencia**: `phi` crece con u > 1 y **se recupera** si baja (un tirón corto no vuelca); con
  `phi > 0,002` solo se permite subir pluma y recoger. Damping de `phiV` ajustado a 60 Hz (la referencia va a 120 Hz).
  El cartel sale 2,5 s después para ver la caída. Con los cortes del LMI volcar es difícil (como en la referencia):
  hace falta un balanceo o tirón fuerte, o puentear el LMI (P).
- **Cortes del LMI** con el LMI **estático** (`mEval`, carga solo si cuelga) como la referencia; el LMI **dinámico**
  (tensión real) se muestra y mueve `phi`. Con la carga apoyada solo cuenta el gancho, así que se puede bajar la pluma
  y arrastrar la carga (igual que la referencia).
- **Tensión del cable**: la API JS de Rapier no da fuerzas de juntas. Se mide F = Σ m·(a − g) de gancho + carga colgada,
  con la aceleración sacada de las **posiciones** (Rapier corrige el límite del rope moviendo el cuerpo sin cambiar su
  velocidad: con `linvel()` un izado no se notaba). Filtro de 0,1 s. En reposo da exactamente gancho + carga.
- **Amortiguador gancho–carga** (`dampSling`): impulsos iguales y opuestos según la velocidad relativa horizontal. Apaga el
  modo rápido del doble péndulo (gancho liviano oscilando ~0,6 s contra la carga, ±27 % de tensión) sin frenar el
  balanceo grande, porque conserva el momento.
- **Cable** = `JointData.rope` cabeza→gancho; el largo se cambia con `rawSet.jointSetLimits(LinX)` porque la API JS no
  expone `setMaxDistance` (verificado: el largo se respeta). Revisar si se actualiza Rapier.
- **Multibody descartado** (fase 2): la API JS no deja cambiar límites ni motores de un multibody joint, y el cable cambia
  de largo cada cuadro. En su lugar `numSolverIterations = 8` y **`numInternalPgsIterations = 16`**: medido, el cable se
  estiraba metros al izar (1,7 m con 2 t, 7 m con 60 t) y con 16 queda ≤ 6 cm incluso con 200 t bajo un gancho de 0,4 t;
  < 0,02 ms por paso. Al levantar la caja del suelo, con 1 iteración el cable se estiraba 0,8 m y con 16, 0.
- **Eslinga** = rope de 0,5 m del fondo del gancho al centro de la cara superior de la carga (un punto en física;
  4 ramales solo visuales). Soltar exige carga apoyada (contacto + v < 0,3 m/s), como en la referencia.
- **Pruebas contra la referencia**: `loadReference()` en `reference.ts` ejecuta el código original; `stability.test.ts`
  compara en una malla de largo/ángulo/giro/masa con tolerancia 1e-6 (AT 60 out/tire/move, AT 500-8 con/sin Y-guy y
  lastre, LR 3000 con varios radios de superlift, SK 60 torre, AT 650-8 con plumín, resto). Ampliar el `return` del
  arnés si una fase necesita más funciones de la referencia (por ejemplo `guard`, niveles).
- **Estado de montaje fuera de los datos**: la referencia mutaba `T.mCw`, `T.yOn`, `T.jib`, `T.jibRel`, `T.superlift.r`.
  Aquí va en `CraneConfig` (parámetro `C`), así `CRANES` no se modifica nunca. Lastre montado: `C.mCw = cwBase + ballast.m·avance`.
- **Signo lateral**: la referencia usa y = +sin(slew) en el marco del chasis y nosotros −z = izquierda; el apoyo es
  simétrico, así que no cambia resultados. Si algún día hay apoyos asimétricos, revisarlo.
- **LMI**: masa evaluada = gancho + carga solo si cuelga (`mEval` de la referencia). La capacidad mostrada incluye el
  gancho, como en la referencia. Con poca carga y pluma empinada el LMI puede bajar al bajar la pluma: es el vuelco
  hacia atrás (contrapeso), también en la referencia.
- **AT 60 por delante**: en los datos de la referencia la viga delantera (`out.xf = 1,6`) está detrás del eje delantero
  (`tire.xf = 3,4`), así que con la pluma hacia delante la capacidad con estabilizadores es **menor** que sobre neumáticos.
  No se cambió (dato de la referencia); preguntado a Jesús al cerrar la fase 2.
- **Tecla O bloqueada con `phi > 0`** (no está en la referencia): cambiar el apoyo a mitad del vuelco cambiaría la arista.
- **Conducción cinemática, no el vehicle controller de Rapier** (fase 3): reproduce la referencia (y se prueba contra sus
  fórmulas), y la grúa de pie ya es cinemática con la estabilidad analítica; un chasis dinámico de decenas de toneladas sobre
  raycasts temblaría y volcaría por su cuenta. Los choques se comprueban **antes** de mover (caja del chasis desde 0,35 m de
  altura libre contra obstáculos y cargas sueltas, sin gancho ni carga enganchada): el chasis cinemático empujaría todo.
  La posición avanza en el origen del marco del chasis, como la referencia. El volante vuelve solo al centro (referencia).
- **Marcos tras la conducción**: `gp` (mundo) se pasa al marco del chasis con `worldToCarrier` antes de `dynamicStability`;
  la arista de `edgeAxis` se pasa al mundo con `carrierFrame` antes de `tipOver`.
- **Suspensión** (aproximación visual, no está en la referencia): cabeceo 0,006 rad por m/s² y balanceo 0,009 rad por m/s²
  lateral, resorte ω = 5, ζ = 0,6, tope 1°. Va **en la pose** (también en física) para que el cable salga de la cabeza; las
  ruedas van en un grupo que deshace la suspensión.
- **Chasis de la AT 60 más ancho** (pedido por Jesús): `bodyHalf(T)` = 1,7 m (3,4 m) en vez de `half` = 1,38 de la
  referencia, solo para el dibujo y los choques; `CRANES` no cambia y la estabilidad sigue con `tire`/`out` (ojo: las ruedas quedan más afuera que `tire.hw` = 1,25). Cabina del
  conductor a todo el ancho (el largo y la altura siguen la fórmula de la referencia: el techo queda bajo la pluma tumbada)
  y cabina del operador de 2,5 × 0,9 × 1,85 m y llantas de 0,7 m (aproximación visual).
- **Luz con sombras**: se recentra a saltos cada 15 m de recorrido (no cada cuadro) para que las sombras no tiemblen.

### Plan y riesgos conocidos
- **Relación de masas gancho/carga**: resuelto con las iteraciones del solver (ver Decisiones). Volver a medir con las
  grúas grandes (fases 4–6): cabeza cinemática, izado a velocidad plena, estiramiento máximo del cable.
- **Vuelco con otras grúas**: las alturas de las masas en `tipOver` son de la AT 60 (portador, superestructura, contrapeso,
  pluma); las masas extra (plumín, derrick) usan `pivH`. Revisar en las fases 6–7.
- Medir rendimiento **en cada fase** (fps, peor cuadro, draw calls, triángulos del peor caso) y anotarlo aquí.
  Meta orientativa: menos de unas 150 draw calls.

### Rendimiento medido
- Fase 0: 57 draw calls, ~3.000 triángulos, física 0,27 ms y render CPU 1,1 ms por cuadro (panel integrado de la app,
  limitado a 30 fps; **pendiente medir fps reales en la laptop**).
- Fase 1: 60 fps, 56 draw calls, ~3.050 triángulos, física 0,16 ms, render CPU 0,6 ms (panel de la app). El LMI y
  `ratedCap` (26 iteraciones) se calculan cada cuadro sin costo apreciable.
- Fase 2: 61 draw calls de pie / 68 con estabilizadores fuera / 69 volcada; 4.730 triángulos; física ~0,2 ms y render CPU
  ~1,1 ms por cuadro (panel de la app, oculto durante las pruebas: **fps reales pendientes de medir en la laptop**).
- Fase 3: 72 draw calls y ~4.700 triángulos en la vista de seguimiento (46 / 3.900 en cabina); física ~0,2 ms, render CPU
  ~1,1 ms; 60 fps en el panel de la app. **fps reales pendientes de medir en la laptop.**

### Pendientes
- Colisión de la carga con la pluma (no existe todavía).
- Radio de cola: el contrapeso no choca con obstáculos al girar (`boomHit`/contrapeso de la referencia), ni la pluma.
- Terreno (agua, barro, `offroad`) y límites reales de la obra llegan con los niveles (fase 9); ahora el límite es ±150 m.
- Conducción de orugas (`spd.turn`, `crawlMove`): fase 6; `stepDrive` no hace nada si la grúa no tiene `wheelbase`.
- Las alturas del chasis/ruedas son de la AT 60; revisar `CLEARANCE`, el ojo de la cabina y la suspensión con otras grúas.
- La caja despedida 45 m de la fase 1 no se reprodujo con el nuevo ajuste del solver; si vuelve a pasar, anotar cómo.
- Pruebas en el navegador: no teletransportar la pluma (`S.slew = …` de golpe) con el gancho colgado: el salto da un
  tirón enorme en el cable y vuelca la grúa. Usar las teclas con `__gruas.advance`.
- Vite avisa que el bundle pasa de 500 kB por el wasm de Rapier embebido: esperado, no es un error.
