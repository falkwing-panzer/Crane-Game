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
O estabilizadores (no en orugas) · B lastre · Y Y-guy · T/G plumín · M montaje · K/L radio superlift · Shift fino ·
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
- **Fase 4** (modelos de ruedas): City 25, AT 60, RT 90, AT 220, AT 300-6, AT 450-8 y AT 500-8 generados desde `cranes.ts`
  con las fórmulas de `craneModel()` de la referencia; menú "Grúa" en el HUD (`?grua=id`, recarga la página). Pruebas en
  `models.test.ts` (se construyen y nada se atraviesa en todo el recorrido de la pluma ni al girar).
- **Fase 5** (montajes): lastre (B) en AT 300-6, AT 450-8 y AT 500-8; Y-guy (Y) en la AT 500-8 (la AT 650-8 lo tendrá al
  hacer su modelo en la fase 7: la lógica ya es general). Bloqueo de mandos mientras se monta, indicadores en el HUD.
  Pruebas en `assembly.test.ts` y `models.test.ts`.
- **Fase 6, parte A** (LR 300): modelo de orugas con pluma de celosía instanciada y caballete, conducción sobre orugas
  (giro en el sitio, `crawler`/`crawlMove`, pick & carry al 45 %), terreno blando de prueba (barro y agua). Pruebas en
  `crawler.test.ts` (conducción, terreno, física) y `models/crawler.test.ts`.
- **Fase 6, parte B** (LR 3000): derrick de celosía con tirantes a la cabeza, al contrapeso y a la bandeja; superlift con
  K/L (guard del LMI, choques de la bandeja al girar, al cambiar el radio y al conducir); cámara, niebla y sombras escaladas
  para 108 m; cable hasta el suelo; amortiguamiento del cable para cargas de cientos de t. Carga de prueba de 800 t
  (`TEST_HEAVY`). Pruebas en `superlift.test.ts` y `models/crawler.test.ts`.
- **Fase 7** (AT 650-8 y contrapeso nuevo): contrapeso de **dos torres** con hueco central, chaflán exterior trasero,
  bastidor con barandilla y argollas en las 4 grúas con lastre; choque de las torres al girar y al montar el lastre.
  AT 650-8 en el menú (generador de ruedas, torre de lastre, Y-guy). Plumín: montaje con M (32 s, por fases), T/G con el
  guard del LMI, cable y gancho en la punta, choques con obstáculos, cargas sueltas y suelo. Pruebas en `jib.test.ts`.
- **Fase 8** (SK 60): grúa torre autodesplegable sobre el camión de 6 ejes. Montaje con M (45 s: levantar, telescopar,
  desplegar pluma; al revés para plegar) con las condiciones de la referencia, carro con Q/E, pluma de 0 a 30° con W/S,
  curva de la torre de `structCap`, choques de torre/pluma/contrapluma, torre plegada en los choques al conducir, vuelco.
  Pruebas en `tower.test.ts` (geometría contra la referencia, montaje, LMI, física) y `models/tower.test.ts`.
- **Fase 8B, parte 1** (contrapesos): el estilo de contrapeso-torres.png en las 11 grúas (tabla aprobada por Jesús):
  City 25, AT 60 y RT 90 un bloque de placas achaflanadas; AT 220 dos torres con bastidor; contrapeso base de AT 300-6 y
  AT 500-8 en placas rectas; LR 300 y LR 3000 dos torres con bastidor de todo el alto y barandilla; bandeja del superlift en
  dos pilas; SK 60 placas achaflanadas en la contrapluma. Choques del contrapeso al girar en todas (salvo la SK). Pruebas en
  `models/counterweight.test.ts`.
- **Fase 8B, parte 2** (remodelado, con orugas y SK incluidas): chasis gris con franjas rojas y blancas, cabina del conductor
  con parabrisas inclinado en dos piezas, cabina del operador con frente inclinado (`details.ts`, la usan las 11 grúas),
  pluma con cantos de abajo achaflanados, cabeza con chapas redondeadas, barandilla y escalerillas. Pruebas en
  `models.test.ts` y `models/crawler.test.ts`. **En la laptop de Jesús: 60 fps.**

### Mapa del código
- `src/crane/cranes.ts`: `CRANES` (las 11 grúas; el literal se copió tal cual de la referencia y una prueba lo compara),
  `CraneSpec`, `AT60` (= `CRANES.medium`, tipada `WheeledSpec` para el modelo 3D de la fase 0), `CrawlerSpec`/`isCrawler`.
- `src/crane/stability.ts`: `KF`, `yNoGuy`, `reach`, `structCap`, `supportRect`, `craneMasses`, `tipUtil`, `lmiStatic`,
  `ratedCap`, `CraneConfig` y `baseConfig(T)`. `tipEdge` (no está en la referencia) = `tipUtil` + qué arista manda
  (0 delante, 1 detrás, 2 izquierda −z, 3 derecha +z).
- `src/crane/reference.ts` (solo pruebas): extrae del HTML (import `?raw`) el bloque `const D … ratedCap` y lo ejecuta.
- `src/crane/kinematics.ts`: `CraneState` (incluye `out`/`outT`, `phi`/`phiV`/`edge`), `stepCrane(…, lim)` con el `guard`
  de la referencia (`StepLimits`: corte por LMI, sin izar si la carga supera la capacidad, inclinada solo recuperar),
  `stepOutriggers`, `carrierLift`, `headPos` (en el marco del chasis apoyado; luego se aplica la pose).
- `src/crane/drive.ts`: `stepDrive` (conducción de `step()` de la referencia), `yawRate`, `minTurnRadius`, `stepSuspension`,
  `axleSteer` (ángulo de cada eje como el dibujo de la referencia). `MOVING` = 0,05 m/s, `CARRY_SPEED` = 0,3.
  Orugas (`stepCrawl`): giro en el sitio a `spd.turn`, invertido marcha atrás; con carga 45 % de velocidad y 50 % de giro;
  `S.trackL`/`trackR` (recorrido de cada oruga, para las tejas) y `S.turnKey` (dirección pulsada).
- `src/crane/terrain.ts`: `SoftZone` (barro/agua, centro y medidas como la referencia), `terrainBlocked`, `padsOnSoft`.
- `src/crane/superlift.ts`: `stepSuperlift` (K/L, 0,5 m/s, guard del LMI y choque), `trayCorners`, `trayHitsTracks`. El radio
  vive en `C.slR`; `Physics.step(S, pose, slR)`, `CrawlerModel.update(S, pose, slR)`, `phys.trayBlocked(x, z, h, slew, slR)`.
  `StepLimits.slewBlocked` deshace un paso de giro si la bandeja choca.
- `src/crane/kinematics.ts` (fase 7): `S.jg`/`jgT`/`jibRel`/`v.jib`, `jibOn(T, S)`, `tipPos` (punta del cable: cabeza o punta
  del plumín; la usan la física, `cableMax` y el vuelco). `StepLimits.jibHit`/`onHit`: si el plumín toca más que al empezar el
  paso, se deshace el paso entero (como `Object.assign(S, prev)` de la referencia).
- `src/crane/tower.ts` (fase 8): `towerGeom(T, S)` (port; además `jlVis`), `towerPivot`/`towerHead`/`towerTip`; `headPos`/`tipPos`
  de `kinematics.ts` las usan con `T.tower` (el carro es `S.Lb`). Estado `S.er`/`erT`. `hitChecked(T, S)`: plumín o torre
  montada (activa `StepLimits.jibHit`). En `assembly.ts`: rama de torre de `toggleMount`, `stepAssembly(…, towerHit)`
  (el montaje se detiene si tocaría algo), `assembling(S, T)`/`blockWhileAssembling(S, inp, T)` (plegada tampoco se mueve
  nada, como la referencia), `towerPhase`. `reference.ts`: `loadTowerReference(T, S)` ejecuta `towerGeom`…`tipPos` del HTML.
- `src/crane/ops.ts`: `supportMode(S, T)` (`out` solo con `out = 1`; `move` con |vd| > 0,05; orugas `crawlMove` en marcha o
  con la dirección pulsada, si no `crawler`), `toggleOutriggers` (condiciones de la referencia),
  `dynamicStability` (tensión en `gp`), `stepTilt` (phi de la referencia), `TIP_PHI` = 0,06.
- `src/crane/assembly.ts`: `toggleBallast`/`toggleYGuy` (condiciones de la referencia), `stepAssembly` (avance de `S.cw`/`S.yg`
  y `syncConfig` → `C.mCw`, `C.yOn`), `blockWhileAssembling`, `teleLimit` (35 m sin Y-guy), `outriggersLocked`, `yGuyPhase`; plumín: `toggleMount`, `jibPhase`,
  `JIB_REST_H`; `syncConfig` pasa `C.jib`/`C.jibRel`.
- `src/crane/pose.ts`: `carrierPose` = `carrierFrame` (x, z, rumbo h) ∘ elevación y `phi` ∘ `suspensionPose`; `edgeAxis`
  (marco del chasis), `worldToCarrier`, `compose`, cuaterniones sin three.js.
- `src/physics/world.ts`: mundo Rapier; `Physics.step(S, pose)`, `tension`/`gp`, `tipOver()`, `reset()`, `headWorld()`,
  `toggleHook()` (condiciones de enganche de la referencia), `resetLoads()` (tecla X; cada `Load` guarda su `home`),
  `addObstacle`, `carrierBlocked(x, z, h)` y `padsBlocked(S)` (consultas `intersectionsWithShape`, sin contar el suelo), `SITE_HALF` = 150 m.
  Fase 7: `towerBox(cw)`, `tailBlocked(S, slew, cw)` (torres de lastre; también son colisionadores de `supBody` que se
  redimensionan con el montaje), `jibHits(S, pose)`, `jibGroundBlocked(S, pose)`, `placeHook` (el gancho salta debajo de la
  nueva punta si el ancla del cable se mueve > 3 m en un paso).
- `src/render/camera.ts` (`CameraRig`: modos de cámara y luz que sigue a la grúa), `site.ts` (obstáculos de prueba `TEST_OBSTACLES`).
- `src/render/models/`: `layout.ts` (todas las cotas del modelo sin three.js: cabina, apoyo de pluma, cola de pluma, ranura de la
  placa, contrapeso `cwDims`, cabrestante, radio de cola `tailR`, `hookScale`/`hookFalls`, `WHEELED_IDS`), `carrier.ts` (chasis y
  cabina), `superstructure.ts` (superestructura, tramos, cabeza con poleas), `builder.ts` (`Parts`: caja, cilindro, extrusión de
  perfil; fusiona por material), `materials.ts` (paleta compartida, materiales por color), `ballastPlates(T, L, cw)` en
  `layout.ts` (placas de lastre) y `yguy.ts` (`yGuyGeom` sin three.js, `YGuyView` instanciado en el grupo de la pluma). Lastre (fase 7):
  `towerPlan`/`towerOutline`/`ballastPlates` → `{ plates, frame, boxes }`. Plumín: `models/jib.ts` (`jibLattice`, `jibGeom` sin
  three.js, `JibView` en el grupo de la superestructura).
- Remodelado (fase 8B parte 2): `models/details.ts` (`operatorCab`, `ladder`, `railing`, `slab` = cristal inclinado),
  `Parts.extX` (extrusión de una sección z-y a lo largo de x), `boomSection(w, h)` en `superstructure.ts`.
- Contrapesos (fase 8B): `blockPieces(BlockSpec)` en `layout.ts` (genérico: dos mitades de placas achaflanadas, hueco, bastidor,
  barandilla, argollas), `fixedBlock(L)` (contrapeso fijo de ruedas), `cwPieces(T, L, cwS)` = fijo + `ballastPlates` (lo dibuja
  `CraneModel` y lo usa `towerBox`); `cwBlock(L)` y `trayBlock(t)` en `crawlerLayout.ts`; `models/plates.ts` (`plateGeo`,
  `PlateMeshes`: 2 InstancedMesh, placas y cajas, `plateColors`). Placas de la SK: `TowerParts.plates` (`OPlate`).
- Grúa torre: `models/tower.ts` (`towerParts` sin three.js: celosías, cajas, `towerDeck`, `foldedTowerBox`) y
  `models/towerView.ts` (3 InstancedMesh recolocados solo si cambian `er`, `ang` o el carro); `CraneModel` usa `TowerView`
  en vez de la superestructura telescópica cuando `T.tower`. `TRUCK_IDS` = `WHEELED_IDS` + `sk` (menú). En `world.ts`:
  `towerHits(S, pose)`, caja de la torre plegada en `carrierBlocked`, `supBox` = plataforma, vuelco con torre y pluma.
- Orugas: `models/crawlerLayout.ts` (cotas sin three.js: orugas, contorno de las tejas `loopPoint`, superestructura, pie de
  pluma, `derrick` y `tray` de la LR 3000), `models/lattice.ts` (`latticeSegs` genérica, `boomLattice`), `render/crawlerModel.ts` (`CrawlerModel`, misma
  interfaz que `CraneModel`: `update`, `eye`, `lateral`, `cab`).
- `src/render/craneModel.ts` (`CraneModel`: grupos rígidos, llantas y estabilizadores instanciados, `eye(S)`, `lateral()`),
  `scene.ts`, `rigging.ts` (gancho escalado y 2/4 ramales).
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
- **Modelos (fase 4)**: cada grupo rígido (chasis, cabina, superestructura, tramo base, cada tramo interior, cabeza) es
  **una malla por material** (geometrías fusionadas); llantas (neumático, llanta, buje) y estabilizadores con InstancedMesh.
  Las cotas viven en `layout.ts` para poder probarlas. La AT 60 conserva chasis ancho y cabina a todo el ancho; las demás
  usan `half` y la cabina de media anchura de la referencia. La RT 90 no tiene cabina de conductor (referencia): la vista
  de cabina usa la del operador y gira con la superestructura.
- **Ajustes a la referencia para que nada se atraviese** (aproximación visual, la estabilidad no cambia): cola del tramo
  base acortada (√((pivH − corona − 5 cm)² − (alto/2)²), 0,2–1 m) y **ranura en la placa base** bajo el pie; frente del
  contrapeso recortado si la pluma alta lo tocaría (City 25, AT 60); cabrestante **encima** del contrapeso (la referencia lo
  metía dentro); cabina del operador a la izquierda por fuera de los soportes del pie (la referencia la ponía a la derecha);
  equipo de cubierta y apoyo de pluma bajo la pluma tumbada y fuera del radio de cola; sin rotativo en la cabina del
  conductor; escape del chasis horizontal; poleas de la cabeza ≤ 0,45·alto + 3 cm; bastidor y cofres más estrechos si no
  caben entre llantas; cajones de estabilizadores recortados para no tocar los guardabarros.
- **Cilindro de elevación**: posiciones de la referencia (base en `front − 0,9`, al 45 % del tramo base). Con la pluma casi
  tumbada queda metido bajo la pluma (no hay altura entre placa y pluma con los `pivH` de la referencia). Aceptado.
- **Gancho**: colisionador de Rapier escalado en ancho/fondo con `hookScale` (0,55·hb × 0,21·hb); el alto sigue fijo (±0,5 m).
- **Luz con sombras**: se recentra a saltos cada 15 m de recorrido (no cada cuadro) para que las sombras no tiemblen.
- **Montajes (fase 5)**: como la referencia, la masa del lastre crece de forma continua (`mCw = cwBase + m·cw`) y el Y-guy solo
  cuenta tensado al 100 %. **Bloqueo** (pedido en FASES, no está en la referencia para lastre/Y-guy): mientras `cw ≠ cwT` o
  `yg ≠ ygT` se anulan giro, pluma, telescopio y cable. Conducir ya está bloqueado (estabilizadores fuera, y O no los recoge
  con lastre o Y-guy). Medido: el lastre completo no provoca vuelco hacia atrás (LMI ≤ 42 % sin carga en todo el recorrido).
- **Lastre en el dibujo** (aproximación visual): `cwDims(cw)` de la referencia, pero las placas van **detrás** del contrapeso
  base y del cabrestante (las de la referencia, de todo el largo, lo atravesarían); 1 placa nueva cada 25 %. AT 450-8 (y
  AT 650-8, `cwStyle: 'stack'`): torre que crece 4,4 m en placas de 0,42 m. La referencia las dibuja **redondas**; aquí son
  **rectangulares** (pedido de Jesús), con la misma planta (`cwLen` × `cwLen`). El cabrestante va **delante** de la torre. `tailR` se
  calcula con el lastre completo. La AT 500-8 llega a 8,24 m de ancho de lastre (`cwWide` = 4,12 es media anchura en la
  referencia); se dejó así.
- **Orugas (fase 6)**: `track` es a la vez el apoyo y la caja de choques (las orugas no tienen suspensión ni dirección, como
  la referencia). Celosía de la pluma: 2 InstancedMesh (cordones y diagonales) colocados **una vez** en el grupo de la pluma
  (largo fijo). Tejas: 1 InstancedMesh que se recoloca solo si cambia `trackL`/`trackR`; arriba avanzan con la marcha.
  **Ajustes a la referencia** (aproximación visual): pie de pluma que se estrecha hacia el bulón y ranura en la plataforma
  (la caja de la referencia se hundía en ella); cuerpo trasero solo hasta el cabrestante y capó a la derecha (el de la
  referencia lo atravesaba la pluma); cabrestante apoyado sobre la plataforma; cabina del operador a la izquierda.
- **Terreno blando**: solo las reglas de la referencia (no calcula presión al suelo, y no se inventó): nadie entra al agua;
  ruedas no entran al barro salvo `offroad` (RT 90); orugas sí; zapatas no en barro ni agua (margen 0,6 m). Zonas de prueba
  `TEST_SOFT` en `site.ts` detrás de la grúa hasta que lleguen los niveles.
- **LR 3000 (fase 6B)**: derrick fijo a 75° como la referencia (no cambia con el radio del superlift); celosía de 3,2 a 1,6 m
  colocada una vez; tirantes (2 a la cabeza, 1 al contrapeso, 4 a la bandeja) en **un** InstancedMesh que se recoloca cada
  cuadro. Bandeja en el suelo (referencia), grupo hijo de la superestructura en x = −slR, y colisionador en `supBody`.
  **Ajustes** (aproximación visual): los tirantes de la bandeja se atan en su mitad trasera, no en las esquinas (con 15 m
  delante atravesarían el contrapeso); soportes del pie del derrick sobre el cuerpo trasero.
- **Bandeja contra las orugas** (no está en la referencia): con `rMin` = 15 m y 7 × 10 m, entre 15 y 15,8 m de radio la bandeja
  pisa la esquina de las orugas al girar unos 14–55°; se bloquea el giro/radio ("tocaría las orugas"). Por encima de 15,8 m, nunca.
- **Choques de la bandeja**: obstáculos y cargas sueltas de más de 0,2 m (consulta de Rapier con margen 0,2 como `boomHit`);
  también al conducir (la referencia solo miraba el chasis).
- **Cable con cargas pesadas** (fase 6B): con 800 t el cable no se estira (< 6 cm), pero la cadena cabeza–gancho–carga quedaba
  rebotando después del despegue y la tensión medida iba de 200 a 2.000 t al izar. Arreglo: (1) `dampRope`, amortiguamiento
  interno del cable **a lo largo del cable** (quita el 30 % por paso de la velocidad radial que no es la del cabrestante ni la
  de la cabeza; no frena el péndulo); (2) aceleración por segunda diferencia de paso 0,1 s (6 pasos), no de un paso; (3) cable
  "flojo" solo si queda 0,25 m más corto (con 2 cm se perdían pasos al izar); (4) filtro de la tensión de 0,3 s (antes 0,1).
  Resultado: ±15 % al izar 800 t a velocidad plena; en reposo exacto. Las pruebas de tirones de las fases 2–3 siguen pasando.
- **Cable**: largo máximo = max(70 m, altura de la cabeza + 3) como la referencia (punta + 3). Las orugas empiezan con el gancho a
  ~5 m del suelo (referencia: punta − 4); las de ruedas conservan los 4 m de cable de la fase 0.
- **Cámara y sombras por grúa**: `CameraRig(…, size, shadowHalf)`. Encuadre de sombras = max(45, pie + pluma·cos(ángulo mínimo)
  + 6, radio superlift + 9): LR 3000 ±85 m, LR 300 ±51 m, de ruedas hasta ~±60 m (antes ±45 fijo); el sol se aleja en
  proporción y `far` crece. Orugas: `size` = max(1,4; pluma / 36) → LR 3000 ≈ 3 (vista inicial, niebla y `maxDistance`).
- **Colisionador de la superestructura de las orugas**: toda la plataforma (del contrapeso al frente, ancho completo y alto del
  contrapeso), con las cotas de `crawlerLayout`. En el vuelco, alturas de contrapeso y derrick con esas cotas.
- **Y-guy** (`yGuyModel` de la referencia, marco de la pluma): el cable delantero se ata en lo alto de la cabeza (`Lb + 0,1`), no
  1,1 m detrás como la referencia (con la pluma recogida quedaba dentro del tramo base). Sin masa en la estabilidad (referencia).

- **Contrapeso de dos torres (fase 7)**: solo dibujo, dentro de la planta de `cwDims` (la masa no cambia). Hueco central
  = 28 % de la media anchura (0,35–0,6 m); chaflán = 30 % del largo × 40 % del ancho de la torre. Placas instanciadas con una
  geometría unitaria achaflanada (la torre izquierda se gira 180° en x, no se refleja). Las 2 placas de arriba del lastre
  completo en el color de la grúa (lastre básico arriba, como la imagen). `stack` (AT 450-8, AT 650-8): pieza base de 0,4 m +
  placas de 0,42 m; `slab` (AT 300-6, AT 500-8): las torres crecen en largo, ancho y alto detrás del contrapeso base, que
  sigue llevando el cabrestante. `tailR` usa el contorno achaflanado.
- **Choque del contrapeso** (no está en la referencia): las torres (cajas sin chaflán + 0,1 m) contra obstáculos y cargas
  sueltas al girar (`slewBlocked`) y al pulsar B con el lastre completo. No al conducir (con lastre no se conduce).
- **Plumín (fase 7)**: lógica de la referencia (`toggleMount`, avance `jg` en `jibDef.t`, `jibRel` al terminar para dejar la
  punta a 0,7 m, T/G a `spd` con guard, `structCap` ≤ `jib.cap`). Disponible siempre con la AT 650-8 (en la referencia solo en
  el nivel "Sobre la nave"); M en otra grúa avisa. **Añadido**: hace falta sitio en el suelo para armarlo (caja de 42 × 1,8 m
  delante de la cabeza); choque del plumín con el suelo (eje a ≥ 0,5 m) además de obstáculos y cargas (8 cajas de 1,5 m).
  Al montarlo el cable pasa a la punta y el gancho se coloca junto a ella en el suelo con 3 m de cable; al desmontar vuelve a
  la cabeza con 4 m. El plumín empieza en la cabeza (la referencia lo dibuja 0,3 m más adelante) para que dibujo y física
  coincidan. Sin colisionador en Rapier (la carga lo atraviesa, como la pluma).

- **Grúa torre (fase 8)**: geometría, montaje, mandos y capacidad como la referencia (`towerGeom`, `toggleMount`, `guard`,
  `structCap`). El cable cuelga de la punta de la torre (+1 m) mientras no está montada y del carro después; arranca con
  1,5 m de cable y al terminar el montaje queda en ≤ 4 m. **Ajustes de dibujo** (aproximación visual, la física usa
  `towerGeom` tal cual): torre articulada en su cordón inferior (la celosía queda arriba tumbada, detrás de pie); pluma
  plegada del otro lado del eje (debajo de la torre tumbada), así no cruza la torre al desplegarse; con la torre tumbada
  todo se dibuja 0,85 m más alto (se anula al levantarla) y la cabina del conductor baja a `dHi + 0,6`; **contrapluma
  plegada sobre la torre** (en la referencia salía 9 m hacia delante) y articulada 2 m detrás de la punta; tramo interior
  de la torre justo encima del exterior al montarla (con H = 2·H0 no pueden solaparse); la cúspide sale con la pluma.
- **Largo de la pluma al desplegarse (`jlVis`)**: con el de la referencia la punta bajaba a 1 m del suelo y atravesaba la
  cubierta del camión; se alarga cuadrático desde el 25 % del despliegue (punta siempre a más de 4 m). Solo dibujo y choques.
- **Choques de la torre** (`towerHits`): torre desde 3 m, pluma y contrapluma (esta no está en la referencia) contra obstáculos y
  cargas sueltas; montada se deshace el paso (como el plumín), montando se detiene el avance. Plegada sobresale 6 m por delante
  del camión: cuenta en `carrierBlocked` ("La torre plegada toca un obstáculo"; no está en la referencia).
- **Vuelco de la SK 60**: CDG de la torre a media altura, contrapeso y pluma arriba (alturas de `towerGeom`); el cuerpo lleva
  cajas de torre y pluma. Con 2 t a 60 m la estabilidad queda en ~53 %: manda el límite estructural (como la referencia).

- **Contrapesos en placas (fase 8B)**: solo dibujo dentro de la planta de `cwDims` (masa y estabilidad sin cambios). Placas de
  ~0,42 m (`round(alto / 0,42)`), las 2 de arriba del color de la grúa. Dos torres solo si el contrapeso mide ≥ 2,5 m de largo
  (AT 220); las cortas son un bloque de dos mitades que se tocan (`zi` = 0), con el chaflán en las dos esquinas traseras. El
  base de las grúas con lastre de placas va en placas **rectas** (las torres de lastre lo tapan por detrás). Orugas: bastidor
  de todo el alto en el hueco porque ahí se atan los tirantes del caballete y del derrick. Bandeja: amarres de los tirantes
  movidos hacia dentro (`w/2 − 2`) para quedar fuera del chaflán. SK 60: 3 placas en dos mitades, chaflán en el extremo de la
  contrapluma, la del extremo del color de la grúa. Todo instanciado (`PlateMeshes`): no añade draw calls a la AT 650-8.
  `tailR` usa el contorno achaflanado (ruedas sin lastre y orugas).
- **Choque del contrapeso al girar en todas las grúas** (fase 8B; antes solo con lastre): `towerBox` sale de `cwPieces` (ruedas)
  o de `cwBlock` (orugas, calculado una vez); `slewBlocked` en todas salvo la SK 60 (su contrapeso va arriba).

- **Remodelado (fase 8B parte 2)**, aproximación visual guiada por `referencia/imagenes/`: el chasis va gris (como las fotos;
  solo cabina, capó y superestructura en el color de la grúa); llantas grises salvo la RT (la AT 500-8 y las de 6 y 8 ejes
  las tenían amarillas en la referencia). La cabina del operador usa `cabin` = color de la grúa al 94 % (antes naranja fijo;
  la RT y las orugas ocultan su cabina buscando ese material). La sección achaflanada cabe en la caja de la pluma (las
  pruebas de choques siguen con la caja). Las chapas de la cabeza no bajan del fondo de la pluma. La escalerilla del capó
  cuenta en `tailR`. **Sin materiales nuevos por grupo** (franjas blancas en `chrome`, barandillas en `dark`): la AT 650-8
  queda en 145 draw calls. **No se hizo**: motón amarrado al parachoques (cambia el estado inicial de la física; se haría
  aparte como "posición de transporte").

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
  ~1,1 ms; 60 fps en el panel de la app. **En la laptop de Jesús: 60 fps estables** (con el chasis ancho y las
  cabinas nuevas, ~90 draw calls). (Capturas sueltas con 12–27 fps no reflejan el uso normal.)
- Fase 4 (AT 500-8, la más pesada): 113–123 draw calls (sombras incluidas) y ~17.200 triángulos; ~1 ms por cuadro de física +
  render CPU (con `gl.finish`) en el panel de la app; 60 fps con el panel visible. AT 60: ~115 draw calls, ~10.800 triángulos.
  **En la laptop de Jesús: 60 fps con la AT 500-8.**
- Fase 5 (AT 500-8 con lastre y Y-guy montados, pluma de 50 m): 120 draw calls y ~17.600 triángulos (vista de seguimiento,
  sombras incluidas). Lastre: 1 InstancedMesh; Y-guy: 4 InstancedMesh, recolocados solo cuando cambian. **En la laptop de
  Jesús: 60 fps.**

- Fase 6A (LR 300): 63 draw calls y ~11.600 triángulos (75 con la carga colgada); física ~0,2 ms, render CPU ~1 ms; 60 fps en
  el panel de la app. **Pendiente medir en la laptop.**
- Fase 6B (LR 3000, vista inicial, sombras incluidas): 86 draw calls y ~21.000 triángulos; render CPU ~1,8 ms; 60 fps en el panel
  de la app (con el panel visible). **En la laptop de Jesús: 60 fps.**

- Fase 7 (AT 650-8 con lastre, Y-guy y plumín montados, pluma de 24 m a 46°): **146 draw calls** y ~30.600 triángulos
  (sombras incluidas), al límite de la meta de 150; render CPU ~3,4 ms con `gl.finish` en el panel de la app; física
  0,18 ms por paso. AT 450-8 con lastre: 118. **En la laptop de Jesús: 60 fps.**

- Fase 8 (SK 60 montada con 2,3 t en el gancho, vista general, sombras incluidas): **92 draw calls** y ~28.400 triángulos;
  render ~2,4 ms con `gl.finish` en el panel de la app. **En la laptop de Jesús: 60 fps.**

- Fase 8B parte 1 (vista inicial o de cerca, sombras incluidas): City 25 120 draw calls (~10.300 triángulos), AT 220 119,
  AT 500-8 con lastre 129, LR 300 74, LR 3000 86 (~22.200 triángulos, igual que antes), SK 60 montada 64 de cerca. La AT 650-8
  no cambia de camino de dibujo (146). **En la laptop de Jesús: 60 fps** (City 25, LR 3000, SK 60).

- Fase 8B parte 2 (vistas de prueba en el panel de la app, sombras incluidas): AT 650-8 montada 145 draw calls y ~31.900
  triángulos (antes 146 / 30.600); AT 500-8 con la pluma tumbada 134 / ~20.000 (antes 136 / 18.700); AT 60 128; RT 90 117;
  LR 300 75; LR 3000 86 / ~23.200; SK 60 plegada 95. **En la laptop de Jesús: 60 fps.**

### Pendientes
- SK 60: el lastre es el de la referencia (3 bloques en la contrapluma); su forma va en la fase 8B. Se puede plegar con el
  cable largo (referencia): el gancho queda en el suelo y se arrastra al conducir. La pluma y la torre no tienen colisionador
  (la carga las atraviesa, como la pluma de las otras grúas).
- Pruebas en el navegador con el panel oculto: no dibuja; para ver capturas se envió el canvas (`toDataURL`) a un servidor
  temporal en el scratchpad (no está en el proyecto).
- Al volcar la LR 3000, la bandeja del superlift se dibuja girando con la grúa (en física desaparece); debería quedarse en el suelo.
- El superlift no cambia el ángulo del derrick (referencia); la bandeja no se puede desmontar (la LR 3000 "ya está montada").
- `dampRope` y el filtro de 0,3 s afectan a todas las grúas: si un tirón se nota menos que antes, revisar `ROPE_DAMP`/`TENSION_TAU`.
- Colisión de la carga con la pluma y el plumín (no existe todavía). La pluma principal no choca con obstáculos (el plumín sí).
- AT 650-8: sin lastre, al subir el plumín apoyado con la pluma el LMI llega a ~90 % (modelo de la referencia).
- Terreno (agua, barro, `offroad`) y límites reales de la obra llegan con los niveles (fase 9); ahora el límite es ±150 m.
- `CLEARANCE` y la suspensión siguen siendo los de la AT 60; el colisionador de la superestructura (`supBox`) no cubre la
  cabina del operador. Revisar si molesta con otras grúas.
- La caja despedida 45 m de la fase 1 no se reprodujo con el nuevo ajuste del solver; si vuelve a pasar, anotar cómo.
- Pruebas en el navegador: no teletransportar la pluma (`S.slew = …` de golpe) con el gancho colgado: el salto da un
  tirón enorme en el cable y vuelca la grúa. Usar las teclas con `__gruas.advance`.
- **Referencias visuales** de Jesús en `referencia/imagenes/` (ver `NOTAS.md`). Orden acordado: 6B → 7 → 8 → 8B
  remodelado y pulido de los vehículos, con el contrapeso de cada grúa → niveles.
  No pulir modelos antes.
- Vite avisa que el bundle pasa de 500 kB por el wasm de Rapier embebido: esperado, no es un error.
