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
V cámara (en la referencia cambiaba la vista lateral; aquí: orbital libre → seguimiento → cabina del conductor;
en el tándem, además, **cámara libre** fija en la obra que no salta de grúa con Tab).
Extra (no está en la referencia), **solo en la prueba libre**: **X** reponer la carga en su posición inicial ·
**P** puentear el LMI (sin cortes, para poder probar el vuelco; se apaga al reiniciar).
**Espacio** junto al gancho de remolque delantero (grúas de ruedas): amarrar / soltar el gancho (posición de transporte).
Fase 11: **N** silencia el sonido (se guarda). **Mando** (API Gamepad, mapeo standard; mapa en `ui/gamepad.ts`): sticks
marcha/dirección y giro/pluma, LT/RT cable, LB/RB telescopio, cruceta plumín/superlift, A gancho, B estabilizadores,
X lastre, Y cámara, View montaje, Menu Y-guy, clic izq. fino, clic der. cambiar de grúa.
Fase 13: **H** (o el botón "?" de la franja de abajo) abre la ayuda con todas las teclas; **Esc** la cierra.
Fase 14: las teclas se cambian en la ayuda (**Cambiar teclas**); esta tabla es la de por defecto. Esc y el mando son fijos.
Fase 15: **Retroceso** rebobina 10 s (solo en la prueba libre); botón **Guardar** junto al reloj de un nivel.

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
  `models.test.ts` y `models/crawler.test.ts`. **En la laptop de Jesús: 60 fps.** Después (pedido de Jesús con una foto): la
  LR 3000 y la LR 300 llevan equipos sobre el cuerpo trasero (`gear`: grupo de potencia, depósito, radiador, cabrestantes,
  barandillas) y la bandeja del superlift va sobre un remolque con 8 ruedas que ruedan al girar. Detalles en el resto:
  chasis (`detailCarrier`: pilotos de gálibo, calderines de aire, faldones, matrícula y enganche), cabina del conductor
  (limpiaparabrisas, visera, segundo estribo), cabina del operador (limpiaparabrisas, rejilla en el techo), capó (filtro de
  aire), tramo base (`boomBaseDetails`: mangueras con abrazaderas, placas laterales, patines), cabeza (chapa superior y
  anemómetro, salvo con plumín) y plataforma de la SK 60 (armario eléctrico, barandilla y escalerilla en `towerDeck`).
- **Fase 9, parte A** (niveles jugables): los 13 `LEVELS` copiados tal cual, menú de niveles, ficha con la elección de grúa
  (`showBrief`), turno en pausa hasta "Empezar turno", reloj, victoria (`checkWin`), fallos por vuelco y por tiempo,
  estrellas y récords en `localStorage`. Pruebas en `levels/levels.test.ts` (datos contra el HTML) y
  `levels/levels.world.test.ts` (cada nivel con cada grúa permitida se arma sin choques; victoria).
- **Fase 9, parte B** (reglas finas): viento con ráfagas sobre la carga o el gancho, líneas eléctricas (franja de seguridad,
  distancia en el HUD, alarma a 2 m, fallo por contacto), aterrizajes (apoyo, duro > 1,4 m/s, vidrio roto > 0,5 m/s),
  golpes (carga de costado, chasis > 1,2 m/s, plumín o torre) y estrellas con todo eso. Pruebas en `levels/rules.test.ts`
  (`windAt` y `segSeg` contra el HTML, márgenes a las líneas) y `levels/rules.world.test.ts` (viento, apoyos y golpes en Rapier).
- **Fase 10, parte A** (tándem en la prueba libre, `?tandem=1`): dos grúas en el mismo mundo de Rapier (LR 3000 en la
  cabeza, AT 500-8 en el pie, montadas), columna de prueba con dos orejetas, Tab cambia de grúa (la otra queda quieta y
  su física sigue), reparto de la carga medido, LMI de cada grúa con su parte, panel de la otra grúa, doble bloqueo del
  gancho. Pruebas en `physics/tandem.test.ts` y `levels/tandemSetup.test.ts`.
- **Fase 10, parte B** (nivel 14 "Columna en tándem"): columna de 40 m, Ø 5 m y 400 t en un transportador; LR 3000
  (cabeza) y AT 500-8 (pie) fijas y montadas; obra de 120 × 80 m; fallos por LMI > 100 % (0,5 s), cable con carga a
  más de 6° de la vertical (1 s), columna ladeada > 10° y doble bloqueo; victoria con la columna de pie en la
  cimentación. Menú y ficha (sin elección de grúa). Pruebas en `levels/tandemLevel.test.ts`. Partida completa con un
  guion en el navegador: de pie a los 83 s, cimentación a los 5:02, tres estrellas.

- **Fase 11** (pulido): draw calls (nivel 14: 220 → 134), menú de calidad (bajo/medio/alto), sonidos con Web Audio,
  mando, consola limpia en los 14 niveles con cada grúa permitida, las 11 pruebas libres, tándem y menú (60 casos).
  Pruebas en `models/builder.test.ts`, `ui/settings.test.ts`, `ui/audio.test.ts`, `ui/gamepad.test.ts`.

- **Fase 12** (publicación): repositorio público y GitHub Pages en https://falkwing-panzer.github.io/Crane-Game/.
  `vite.config.ts` con `base: './'` (la página vive en `/Crane-Game/`; las URL internas ya usaban `location.pathname`);
  `.github/workflows/publicar.yml` compila (`npm run build`, con tipos) y publica `dist/` en cada push a `main`.
  Decisión con Jesús: Pages con repo público (Netlify/Vercel permitían privado pero había que crear cuenta).
  Comprobado en el enlace público: menú y nivel 1 sin errores en consola.

- **Fase 13** (base de trabajo de la 2.0, `FASES-2.md`; el juego todavía no es para el público): la acción corre
  `npm test` antes de compilar (una prueba rota a propósito en una rama temporal detuvo la acción antes de publicar);
  pantalla de carga; ayuda de controles con H / "?"; contador de fps en desarrollo o con `?fps=1`.
  Pruebas en `ui/help.test.ts`.

- **Fase 14, parte A** (motor: arquitectura y robustez; plan aprobado por Jesús en 3 partes: A = pasos 2 y 5,
  B = 3 y 4, C = 6–8): `main.ts` (651 líneas) dividido en `game/` y `ui/` con un bus de eventos, sin cambiar el
  comportamiento; pausa automática (pestaña oculta, ventana sin foco) y recuperación del contexto WebGL. Pruebas en
  `game/events.test.ts`, `game/loop.test.ts` y `game/session.test.ts` (partida y reglas por el bus en Node).
  Medidas antes de tocar nada (paso 1, `vite preview` en local con caché): primer cuadro 0,7–1,5 s según la página;
  el primer dibujo es un cuadro de 220–460 ms (compilación de shaders); heap 21 MB en el menú y 56–64 MB con la
  LR 3000 o el nivel 14 (modo desarrollo); nivel 14: 57 geometrías (~1,7 MB de vértices), 4 texturas, 18 programas.
  Rapier ocupa 4,34 de los 5,10 MB del bundle (wasm en base64; aparte serían 3,08 MB, 1,17 MB comprimido).
- **Fase 14, parte B** (sin recargas y carga más rápida; dependencias aprobadas por Jesús): `App` monta y desmonta la
  partida sin recargar (física, objetos, memoria de GPU, HUD, oyentes) con la URL en `history`; Rapier sin compat con el
  `.wasm` aparte; modelos con `import()`; shaders precompilados al montar. 30 cambios de partida seguidos: geometrías,
  texturas y programas iguales (37 / 5 / 14), heap estable (~61 MB tras el recolector) y, en Node, la memoria del wasm de
  Rapier igual tras la primera vuelta. Pruebas en `game/dispose.test.ts`.

- **Fase 14, parte C** (teclas, textos y pruebas en el navegador): teclas configurables en la ayuda (guardadas en
  `localStorage`, la tabla de siempre por defecto, botón Restaurar), textos de la interfaz en `i18n/es.ts` (los
  avisos muestran la tecla que tenga el jugador) y Playwright en la acción de GitHub, que ahora también corre en cada
  PR (sin publicar; después, solo ahí: ver "Acción de GitHub y merges"). Pruebas en `ui/keys.test.ts`,
  `ui/help.test.ts` y `e2e/juego.e2e.ts` (30 casos).

- **Fase 15, partes A y B** (motor II; la parte C, cable, va en otro PR): banco de pruebas `?bench=1`, interpolación
  del dibujo entre pasos, calidad adaptativa, entradas por paso con grabación (determinismo), instantáneas de Rapier +
  estado de la partida (reiniciar al instante, rebobinar 10 s en la prueba libre, guardar a mitad de un nivel y
  "Continuar" en la ficha). Pruebas en `game/determinism.test.ts` (60 s del nivel 1, LR 3000 y tándem: la grabación
  y la instantánea, también guardada como texto en una partida nueva, dan el mismo estado exacto), `game/interp.test.ts`
  y dos casos nuevos en `e2e/juego.e2e.ts` (32).

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
- Niveles (fase 9): `src/levels/levels.ts` (`LEVELS`, `WW`/`WD`, `KIND_COL`, tipos), `levels/setup.ts` sin three.js
  (`levelBoxes` = cajas + postes de las líneas, `crateBases` = `surface()` de la referencia, `placeCrane`, `populate(phys, L)`,
  `inZone`/`allPlaced`, `LEVEL_BOUNDS`), `render/levelSite.ts` (`buildLevelSite`), `ui/levelUi.ts` (`LevelUi`: menú, ficha,
  carteles, reloj; `stars`, `saveRecord`, `levelUrl`). En `world.ts`: `Physics(T, S, pose, { testLoad, bounds })`,
  `outside(x, z, m)` (límites de la obra), `placed(load)` (envolvente, fondo e inclinación de una carga suelta y quieta),
  `wind` (fuerza) y `events` (`land`/`strike`). `levels/rules.ts` sin three.js ni Rapier: `windAt`, `windArea`, `windForce`,
  `segSeg`, `lineMargin`, umbrales. `boomFoot(T, S)` en `kinematics.ts`. Reglas por paso en `levelRules()` de `main.ts`.
  URL: `?nivel=1…13[&grua=id]` nivel; `?grua=id` o `?libre=1` prueba libre; sin parámetros, menú.
- Tándem (fase 10): `Physics(…, { site })` comparte mundo, suelo, obstáculos, cargas, terreno y límites; `crew` = grúas del
  mundo; `Physics.stepCrew(units)` = `beforeStep` de cada una, un `world.step()`, `afterStep` de cada una (`step()` es lo
  mismo con una). `Load.lugs` (orejetas, marco de la carga) y `Load.dyn`; `attachedLug`, `slingShare()` (t que lleva esta
  grúa, filtrada), `release()`, `lugWorld()`, `twoBlocked()`, `TWO_BLOCK`. `physics/tandem.ts` (`slingTensions`, sin Rapier).
  `levels/tandemSetup.ts` (`TANDEM_IDS`, `TEST_COLUMN`, `TANDEM_FREE`, `rigged`, `aimHead`, `placeTandem(main, tail, def,
  col)`, `TANDEM_LEVEL`, `ALL_LEVELS` = los 13 + el de tándem, `tandemColumn`, límites `SIDE_MAX`/`ROLL_MAX`/`OVER_T`/
  `SIDE_T`/`SIDE_LOAD`, `cableAngle`, `rollOf`). `Level.size`/`tandem`, `LevelCrate.lugs`/`stand`, `TandemCrane`;
  `levelSize`/`levelBounds` en `setup.ts`; `Load.stand = 'x'` (`placed` mide la inclinación de ese eje). Fallos del
  tándem en `tandemRules()` de `main.ts`; `Unit.over`/`side`/`sideAng`. `LEVELS` sigue siendo solo la referencia. En `main.ts` cada grúa es un
  `Unit` (`controlUnit` antes del paso, `afterUnit` después); `act` = la que se maneja. `CameraRig.follow`, `Hud.other`/`setTitle`,
  `Input.onSwitch` (Tab), `Rigging(…, drawLoads)`.
- Fase 11: `ui/settings.ts` (`QUALITY`, `loadSettings`/`saveSettings`, clave `gruas-ajustes`, `?calidad=` manda;
  `createScene(canvas, calidad)`), `ui/audio.ts` (`soundTargets` sin Web Audio, `Sound`: se arranca con la primera
  tecla o clic; `update` cada cuadro en `draw()`, `thump` con los eventos `land`/`strike`), `ui/gamepad.ts` (`padAxes`,
  `padEdges`; `Input.poll()` una vez por cuadro en `frame()`; `advance()` no lo llama).
- Fase 13: `ui/boot.ts` (`bootStage`, `nextPaint`, `bootDone` en el primer `render`, `bootError`; el HTML y el CSS de la
  pantalla de carga van en `index.html` para que salgan antes de bajar el JS; marca `performance.mark('gruas-listo')`
  al primer cuadro), `ui/help.ts` (`helpGroups(HelpFlags)` sin DOM, `Help`: panel; abierto, `Input.pause(true)` suelta
  las teclas e ignora teclas y mando salvo H/Esc; la simulación sigue), `showFps(dev, search)` y `stickyParams` en
  `settings.ts` (`?fps=` se conserva en `levelUrl`/`homeUrl`). La columna izquierda del HUD es `Hud.left` (flex: fps,
  grúa, Niveles, Calidad; ya no hay `top` fijos). `.claude/launch.json` tiene `preview` (`vite preview`, puerto 4173).
- Fase 14A: `main.ts` solo arranca y conecta. `game/events.ts` (`Bus`, `GameEvents`: say, land, strike, bump, cut,
  prox, tipping, tipped, end, restart; `unit` = índice de la grúa), `game/session.ts` (`sessionDef(search)` lee la URL,
  `Session`: grúas `Unit`, obra, `act`, `running`, `bypass`, `run`, `bus`, `restart`, `switchUnit`, `hanging`,
  `loadOnHook`, `live`), `game/control.ts` (`controlUnit`, `afterUnit`, `IDLE`, `CARD_DELAY`), `game/rules.ts`
  (`LevelRules`: reloj, victoria, viento, aterrizajes, golpes, líneas, tándem, vuelco → `end` con estrellas y récord),
  `game/step.ts` (`GameStep.tick`: reglas, mandos, física, eventos de las cargas al bus, estabilidad), `game/loop.ts`
  (`Loop`: paso fijo, pausa con motivos, `frame(now)` sin DOM), `ui/presenter.ts` (`Presenter`: cámara, HUD, ayuda,
  menú y fichas, sonido; escucha el bus; `camSize`/`shadowHalf`), `ui/commands.ts` (`bindCommands`: teclas → acciones),
  `ui/autoPause.ts` (`autoPause`, `pauseText`). `Input.block(motivo, on)` (la ayuda usa `pause(on)` = motivo `ayuda`).
  `window.__gruas` igual que antes, más `ses`, `game`, `loop`, `view`, `bus` (fase 14B: `app`, `go(search)`; todo lo
  de la partida son getters de la partida montada).
- Fase 14B: `main.ts` solo muestra la carga y trae `app.ts` con `import()`. `app.ts`: `App` (renderer, escena base,
  `Input`, `Sound`, `Loop` y `autoPause` duran toda la visita; `open(search)`/`go(search)` montan la partida; `unmount`;
  `warmUp` precompila; marca `gruas-partida` con la partida lista), `initPhysics()`. `render/dispose.ts` (`disposeTree`,
  `SceneMark`: lo que la partida añadió a la escena), `resetView(ctx)` en `scene.ts`, `Physics.dispose()` (libera el
  mundo si lo creó), `render/models/load.ts` (`loadModels(specs)` → `ModelFactory`, con `import()`),
  `render/models/allModels.ts` (lo mismo de antemano, para las pruebas). `Session(def, scene, makeModel)`. Cada partida
  dibuja su HUD en un `div.session` dentro de `#hud` (se quita entero); el aviso de pausa queda fuera.
- Fase 14C: `ui/keys.ts` sin DOM (`HOLD`/`TAP`/`ACTIONS`, `DEFAULT_KEYS`, `parseKeys`/`loadKeys`/`saveKeys`, clave
  `gruas-teclas` con solo lo que cambia; `rebind` intercambia; `normCode`; `keyLabel`; `withKeys(texto)` cambia cada
  `{acción}` por su tecla). `Input(keys)`: `keyMap`, `setKeys`, `capture` (el editor recibe la siguiente tecla).
  `Help(root, flags, button, host)`: vista de controles o editor (`keysHtml`, `KEY_GROUPS`), `onKeys` →
  `Hud.setKeys()`. `Presenter(…, sound, input, go)`. `i18n/es.ts` (`es`, tipo `Lang`) e `i18n/index.ts` (`t`).
  `playwright.config.ts` + `e2e/*.e2e.ts` (`npm run e2e` compila y prueba; vitest no los toma).
- Fase 15: `game/record.ts` (`Cmd`, `StepInput`, `InputSource`, `Recording`: tramos con las mismas entradas,
  `player(desde)`, `truncate`, JSON), `game/commands.ts` (`runCommand`: las acciones de un toque, antes en
  `ui/commands.ts`), `GameStep` (`push(cmd)` encola para el paso siguiente, `source` = grabación o guion, `rec`,
  `steps`, `snapshot()`/`restore()` → `GameSnap`, `restart()`, `rewind()`, `interp`), `Physics.snapshot()`/`restore()`
  (`PhysSnap`: `world.takeSnapshot()` + `CrewState` de cada grúa por handles + `dyn` de las cargas), `game/interp.ts`
  (`Interp.capture` tras cada paso con dos búferes, `frame(units, alpha)` → `Frame`; `Presenter.draw(…, frame)`,
  `Rigging.update(lat, unitFrame, loads)`), `Loop.alpha`/`steps`, `ui/adaptive.ts` (`AdaptiveScale`), `App.adaptive`/
  `basePr`/`probe`/`resume` (`?continuar=1`), `ui/savegame.ts` (`saveGame`, `loadSave`, `clearSave`, `encodeSnap`/
  `decodeSnap`; clave `gruas-guardado-<nivel>`), `ui/bench.ts` (`BENCH_CASES`, `runBench` → `window.__benchReport`),
  `ui/gpuTimer.ts`. Eventos nuevos del bus: `switch` (Tab llega desde el paso), `restored`. `LevelUi.onSave`/
  `showSave`, `brief(…, cont)`. `LevelRules.winClock`.
- `src/ui/input.ts`, `hud.ts`: teclas, HUD y cartel de vuelco. En desarrollo, `window.__gruas` (S, C, phys, ctx, dyn, pose,
  cut…, de la grúa que se maneja; `units`, todas) y `__gruas.advance(s)`, que avanza la simulación sin `requestAnimationFrame` (el panel oculto del navegador no
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
  queda en 145 draw calls. El motón amarrado al parachoques se hizo después como acción
  del jugador (ver "Amarre del gancho"); no cambia el estado inicial.

- **LR 3000 / LR 300, equipos y remolque** (aproximación visual): en la LR 3000 los equipos van a los lados fuera del ancho
  del derrick (|z| ≥ 2,5) y los cabrestantes en el centro detrás de su pie; en la LR 300, detrás de las patas del caballete
  (bajo su tirante) y el cabrestante de la pluma entre el caballete y el principal; todo bajo el alto del contrapeso, así que el colisionador de la
  superestructura ya los cubre. El remolque cabe en la caja de la bandeja (7 × 10 × 3 m, la de la referencia y la de los
  choques): ruedas de 0,6 m con el eje a lo largo de x (ruedan en z, hacia donde avanza la bandeja al girar; al cambiar el
  radio con K/L patinan), bastidor de 1,3 a 1,55 m y 4 placas encima (antes 6 desde 0,5 m). No dirigen ni se mueven solas.

- **Niveles (fase 9)**: datos sin tocar (prueba contra el HTML). La planta de la referencia (84 × 56 m, z hacia abajo) cae igual
  en nuestro mundo visto desde arriba: coordenadas sin conversión, rumbo con el signo cambiado (todos empiezan en 0). Los
  límites de la obra son 0…84 × 0…56 (margen 0,3 m del chasis, como la referencia). Cambiar de nivel o de grúa ya **no recarga
  la página** (fase 14B: se desmonta la partida y se monta la nueva); Repetir vuelve a la ficha. Tras el vuelco, en un nivel sale el
  cartel de nivel fallido.
- **Cargas sin giro vertical** (`enabledRotations(true, false, true)`, todas las cargas): como la referencia, la carga no gira
  sobre sí misma (como guiada con cuerdas). Sin esto, colgada de un punto, la viga de 22 m del nivel 4 (< 1 m de margen) no se
  podría alinear. Sí se inclina.
- **Victoria**: cada 0,25 s, sin nada enganchado, cada carga suelta y quieta (< 5 cm/s) con su envolvente en planta dentro de
  una zona (± 1 cm), su fondo a la altura de la zona (± 0,1 m; la referencia, 6 cm con alturas exactas) e inclinada < 5°. Una
  zona admite varias cargas (palés, contenedores), como la referencia.
- **Reglas de la parte B**: viento `WINDK·v²·área` (t·m/s²) como fuerza de Rapier sobre la carga enganchada (área = lado mayor ×
  alto × 0,75) o, sin carga, sobre el gancho (0,4 m²). `Physics.events` registra cuándo la carga enganchada **empieza** a tocar
  algo (`land`, con la velocidad de bajada del paso anterior; < 0,15 m/s no cuenta) o a tocar algo de costado (`strike`,
  normal de contacto casi horizontal, cuenta si iba a > 0,25 m/s); `main` lo vacía cada paso. Golpes con espera de 1 s como
  la referencia. Líneas: pie de pluma (`boomFoot`) → cabeza → punta → gancho, y la carga como segmento vertical con su
  radio en planta. La franja roja es un cilindro translúcido de radio `clear`.
- **Plumín sin límite de obra** (fase 9): `jibGroundBlocked` ya no mira el borde de la obra, solo obstáculos. El consejo del
  nivel 11 lo arma "al oeste", y desde x = 14 eso queda fuera de la parcela de 84 m (la referencia no comprobaba sitio).
- **Textos 2D**: tres frases de las fichas hablaban de la planta y la vista lateral; `TEXT_3D` en `levelUi.ts` las muestra
  adaptadas (una prueba comprueba que siguen existiendo en `LEVELS`).
- **Plumín** solo en el nivel 11 (`jib: true`, `jibAvail` de la referencia) y en la prueba libre. **X** y **P** solo en la prueba
  libre. Récords: mejores estrellas y mejor tiempo por nivel (clave `gruas-records`).

- **Tándem: reparto de la carga** (fase 10). Rapier no da la fuerza de las juntas: se resuelve la dinámica de la carga
  (m·a, I·α + ω×Iω medidas por posiciones, como la tensión) con las direcciones de las eslingas y las fuerzas normales
  de los contactos (`contactImpulse`); incógnitas: la tensión de cada eslinga y el rozamiento en el centro de los
  contactos; mínimos cuadrados con T ≥ 0 y eslinga floja (5 cm más corta que su largo) = 0. Sin el momento vertical
  (la carga no gira alrededor de la vertical). Cada grúa: tensión del cable = gancho + su eslinga; su "parte" = la fuerza
  de la eslinga proyectada en su cable. El LMI estático de los cortes usa esa parte medida (siempre cuenta, aunque la
  carga se apoye). Cargas sin orejetas: como antes. El contacto gancho–carga entra en la ecuación del gancho (parte B:
  sin él, el gancho de cola apoyado sobre la columna inclinada sumaba cientos de t a su cable y fallaba por sobrecarga);
  la "parte" de cada grúa = tensión del cable − gancho. La orejeta de cabeza sobresale 1,5 m para que el gancho de la
  LR 3000 cuelgue libre.
- **Eslinga a una orejeta**: se engancha con el fondo del gancho a menos de 1,8 m de una orejeta libre; su largo es la
  distancia en ese momento (≥ 0,5 m). Cada orejeta, una grúa; una carga sin orejetas, una sola grúa. Una grúa puede soltar
  mientras otra sostiene la carga. Amortiguadores (`dampRope`, `dampSling`) en la orejeta, con la masa efectiva en ese punto.
- **Doble bloqueo** (fase 10, para todas las grúas): después de cada paso, el gancho no sube más alto que `TWO_BLOCK`
  (1 m) bajo la cabeza (se baja y pierde la velocidad hacia arriba), salvo con la punta casi en el suelo (plumín recién
  montado). Sin esto el gancho de la grúa de cola subía a través de la pluma. Se descartó una distancia mínima en el cable
  (el gancho rodeaba la esfera, y puesta siempre el paso de física tardaba el doble). Aviso en el HUD.
- **Gancho sin giro propio** (fase 10, todas las grúas; pedido de Jesús, "el gancho se pone wiggly" al izar): `lockRotations`.
  Entre el cable y una carga de cientos de t, el gancho liviano giraba solo hasta 12 rad/s (error del solucionador) y la
  tensión saltaba. Efecto secundario: el balanceo del péndulo se amortigua algo menos (prueba del plumín: 0,6 m en vez de 0,5).
- **Cargas con orejetas giran libres sobre la vertical** (fase 10; las demás siguen bloqueadas como en la fase 9). Con el giro
  bloqueado, mover un gancho de costado arrastraba la columna entera (Jesús: "solo se movía de forma vertical"). El
  solucionador del reparto usa entonces también el momento vertical.
- **Cámara libre del tándem** (pedido de Jesús): cuarto modo de V solo con dos grúas (`CameraRig.enableFree`). Entra
  con una vista amplia centrada entre las grúas y después solo la mueve el ratón: no sigue a nadie y Tab no la mueve.
  La orbital sigue saltando a la grúa activa con Tab, como antes.
- **Amarre del gancho al frente** (pedido de Jesús; no está en la referencia), `crane/tiedown.ts`: en las 8 grúas de ruedas,
  Espacio sin carga al alcance amarra el gancho al gancho de remolque delantero si su fondo está a ≤ 4 m en planta y entre
  −1 y +1,5 m de alto (la RT 90 tiene la cabeza 3,4 m por delante del frente). Amarrado, el gancho es **cinemático** y sigue
  la pose del chasis (girado 90°, lado estrecho hacia el camión); `S.cable` = distancia cabeza–gancho cada paso; tensión =
  gancho; sin doble bloqueo. Se bloquean giro, pluma, telescopio, cable y plumín (conducir no); M avisa. Se suelta con
  Espacio, al reiniciar y al volcar. Eslinga dibujada con los 4 ramales de la carga. Pruebas en `crane/tiedown.test.ts`
  (las 8 grúas: conducir 8 s con curvas mueve el gancho < 0,15 m respecto del chasis; sin amarrar, > 0,3 m).
- **Prueba libre del tándem**: sin obstáculos de prueba; las dos grúas empiezan montadas (estabilizadores, lastre, Y-guy) con
  los ganchos junto a sus orejetas; sin plumín. Columna 40 × 5 × 5 m y 400 t (aprobada por Jesús: la del nivel 13 pesa
  1.200 t y la AT 500-8 no llevaría su mitad). Reiniciar vuelve a colocar las dos.
- **Nivel de tándem (parte B)**, datos aprobados por Jesús (columna, 6°, 10°, 120 × 80 m); lo demás es aproximación del
  juego: columna con la cabeza al oeste y el pie junto a la LR 3000 (al ponerla de pie el radio baja de 72 a ~32 m y la
  cimentación queda a 30 m); transportador sin cabina (la cabina chocaba con el gancho de cabeza); la AT 500-8 con 30 m
  de pluma a 67° (con 16 m su cable medía 6,7 m y el límite de 6° obligaba a cambiar de grúa cada segundo; los
  estabilizadores quedan a 2 m del transportador). Tiro lateral solo si esa grúa lleva > 5 t. El doble bloqueo es fallo
  (pasa si la principal sigue subiendo la columna con la cola enganchada: hay que soltarla cuando ya no lleva carga).

- **Draw calls (fase 11)**: `Parts.build` fusiona los colores lisos de un grupo en **una** malla con colores por vértice
  (`VC_MAT`, Lambert compartido; el color de la paleta en espacio lineal). Cabina, cristal y luces conservan su malla
  (la RT y las orugas ocultan la cabina buscando `pal.cabin`/`pal.glass`; las luces son emisivas). Las mallas de color
  **no proyectan**: cada grupo añade una malla solo de sombra (solo posición, sin cristal) en la capa `SHADOW_LAYER` = 1,
  que la cámara principal no ve y la de sombras sí (`sun.shadow.camera.layers.enable(1)`: three 0.187 usa las capas de
  la cámara de sombras si tienen algo más que la 0). Va al final de la lista que devuelve `build` (se oculta con el resto).
  Si se actualiza three, comprobar que `WebGLShadowMap` sigue mirando `shadow.camera.layers`.
- **Calidad**: alto = lo de antes (2048, antialias, escala hasta 1,5); medio = sombras 1024 y escala 1; bajo = sin
  sombras ni antialias y escala 0,75. Por defecto alto. Cambiarla recarga la página (el antialias es del contexto WebGL).
- **Sonido**: todo sintetizado (sin archivos, sin derechos). Motor siempre al ralentí mientras se juega; sube con la marcha
  y los mandos (también montajes en marcha). Alarma del LMI desde el 90 % (como el ámbar del HUD), rápida con corte; la
  del LMI tapa la de la línea eléctrica. Silencio en pausa y con la grúa volcada.
- **Mando**: la tecla manda; sin tecla, el valor del mando (proporcional: `ramp` ya admite mandos parciales). Zona
  muerta 0,15 reescalada. **Táctil no** (decidido con Jesús: en la laptop no hace falta).

- **Bus de eventos (fase 14)**: síncrono, en orden de suscripción. Las reglas no tocan el HUD ni el sonido: emiten
  `say` y `end`; el `Presenter` pone el nombre de la grúa delante de los mensajes de la que no se maneja (tándem) y
  hace los carteles; el sonido escucha `land`/`strike` con los mismos umbrales que las reglas. El `run` del turno vive
  en la `Session` (lo escriben reglas y `afterUnit`, lo leen HUD y sonido). `GameStep` vacía `phys.events` de cada
  grúa cada paso y los emite (antes se vaciaban en `levelRules` o a mano).
- **Pausa automática (fase 14)**: motivos `pestaña` (visibilitychange), `foco` (blur; se quita con focus o un clic) y
  `gráfica` (webglcontextlost/restored). En pausa: no hay pasos de física, se sigue dibujando, las teclas se sueltan y
  se ignoran (`Input.block`), el sonido se calla; al quitar el último motivo se tira el tiempo acumulado. Aviso solo
  con el turno en marcha (en el menú y la ficha no corre nada), salvo el de la gráfica. No hay pausa si la página
  carga ya sin foco (solo con el evento blur): así el panel de la app sigue igual que antes.
- **Contexto WebGL**: three.js ya hace `preventDefault` y vuelve a subir todo al recuperarlo; comprobado con
  `WEBGL_lose_context` (nivel 1: vuelve a dibujar, 69 draw calls, sin errores de GL). Si no vuelve en 6 s, botón Recargar.

- **Rapier con el `.wasm` aparte (fase 14B)**: en el navegador `vite.config.ts` cambia `@dimforge/rapier3d-compat` por
  `@dimforge/rapier3d` (alias) con `vite-plugin-wasm`; vitest no (`process.env.VITEST`) y sigue con el compat. Las dos
  versiones están **fijadas iguales** (0.21.0): al actualizar Rapier, subir las dos. El paquete sin compat no tiene
  `init()` (llega iniciado al importarlo): `initPhysics()` lo llama solo si existe. En desarrollo, Vite lo empaqueta con
  el nombre del compat (`.vite/deps/@dimforge_rapier3d-compat.js`), pero es el otro (mirar `_metadata.json`).
  `build.target` = es2022 (el plugin necesita `await` de nivel superior).
- **Desmontar sin perder memoria (fase 14B)**: se libera todo lo que cuelga de lo que la partida añadió a la escena,
  también los materiales y geometrías compartidos (three.js los vuelve a subir si otra partida los usa). El mundo de
  Rapier se libera con `world.free()` (primero la grúa que lo comparte). **Trampa encontrada**: el material de
  profundidad compartido del pase de sombras de three.js se queda con la última textura que vio y la volvía a subir
  después de liberarla (2 texturas más por cada nivel 1); las cargas con etiqueta usan `customDepthMaterial` sin
  textura (`PLAIN_DEPTH` en `rigging.ts`). Si se añaden mallas con textura que proyecten sombra, hacer lo mismo.
- **Navegación sin recargar**: los enlaces internos del HUD (`a[href]` a la misma página, sin Ctrl/Mayús/clic medio) y
  los `go()` del selector de grúa y de la ficha usan `history.pushState`; Atrás/Adelante (`popstate`) montan la partida
  de la URL. Mientras se arma la nueva, `.switching` tapa la escena. Cambiar la calidad sigue recargando.
- **Shaders precompilados (`warmUp`)**: antes de hacerla actual, se actualizan los modelos (algunos InstancedMesh crean
  `instanceColor` al actualizarse, y eso cambia el shader), se ponen la cámara y el sol sobre la grúa, se hace visible
  todo lo oculto (plumín, torre, lastre, cabina), `compileAsync` y un dibujo con sombras. Comprobado: después no se
  compila ningún programa al dibujar, al cambiar de cámara ni al montar lastre, Y-guy, plumín o torre.

- **Teclas configurables (fase 14)**: por `KeyboardEvent.code` (posición física; con un teclado AZERTY la W sigue
  donde está). Shift/Ctrl/Alt de los dos lados son la misma tecla. Una tecla por acción; asignar una ocupada
  **intercambia** las dos (nunca hay dos en la misma ni una sin tecla). Esc no se asigna (cierra la ayuda y cancela).
  El mando no se configura. Se guarda solo lo que difiere de la tabla por defecto; lo guardado roto o repetido vuelve
  a la tecla por defecto.
- **Textos (fase 14)**: `es.ts` es un objeto con textos y funciones (para números y nombres); otro idioma = otro
  objeto con el tipo `Lang`. `{acción}` dentro de un texto se cambia por la tecla al mostrarlo (`Hud.say`,
  `showTipped`, carteles de nivel, línea de teclas). Los módulos de la grúa devuelven el texto con `{…}`; el HUD lo
  resuelve. **No se movieron** los datos copiados de la referencia (nombres y notas de las grúas, textos de los
  niveles, también el de tándem): tienen teclas fijas como "(B)" y se traducirán con sus datos.
- **Playwright (fase 14)**: prueba el juego compilado con `vite preview` en Chromium con WebGL por software
  (SwiftShader, pedido con `--enable-unsafe-swiftshader`). Los avisos de rendimiento del driver ("GPU stall due to
  ReadPixels") se filtran: son del entorno. Con SwiftShader va a pocos fps, así que las pruebas abren todo con
  `?calidad=bajo` y una ventana de 960 × 540 (de 4 min a 1 min en la acción; 4 en paralelo sin eso no ayudaba) y
  esperan a que pase algo (tecla pulsada hasta que el cable cambie), nunca un tiempo fijo. `warmUp` usa `compile` (no `compileAsync`) si no hay `KHR_parallel_shader_compile`, porque three avisaba
  en la consola.
- **Acción de GitHub y merges** (decidido con Jesús tras la fase 14C, porque el merge tardaba ~10 min): en cada PR a
  main corren las pruebas unitarias, la compilación y Playwright (~1 min; la acción entera ~1,5 min), sin publicar. Al
  llegar a main (push) solo pruebas unitarias, compilación y publicación (< 1 min): Playwright **no** se repite,
  porque el PR ya prueba el código tal como queda tras el merge. Forma de trabajar: abrir el PR, esperar a que su
  acción pase y entonces hacer el merge (con el permiso de Jesús); después comprobar que la publicación terminó bien.

- **Entradas por paso (fase 15)**: el estado depende solo del estado anterior y de `StepInput` (mandos de la grúa
  que se maneja, conducción y acciones de un toque). Las acciones (Espacio, O, B, Y, M, X, P, Tab) ya no se aplican
  al pulsar: se encolan y entran al principio del paso siguiente (≤ 16 ms después), así quedan en la grabación. La
  cámara, el sonido, la ayuda, rebobinar y guardar no son entradas. Nada de la simulación lee la hora ni números al
  azar (el viento es una función del reloj del turno). Es determinista en la misma máquina y versión de Rapier;
  entre máquinas distintas no está garantizado (haría falta `@dimforge/rapier3d-deterministic`): tenerlo en cuenta
  para el reto diario y el editor.
- **Instantáneas (fase 15)**: `World.restoreSnapshot` crea un mundo nuevo; se libera el viejo y cada grúa vuelve a
  enlazar sus cuerpos, colisionadores y juntas **por handle** (los handles se conservan), y las cargas también. Todo
  lo que la física guarda en JavaScript entra en `CrewState` (filtros e historia de la tensión, amortiguadores, carga
  enganchada, amarre, vuelco…): **si se añade un campo con estado a `Physics`, añadirlo ahí** (la prueba de
  determinismo lo detecta). Los parámetros del solucionador se vuelven a poner al restaurar. En JSON, NaN e ±Infinity
  van como `{"$n": …}` (`lineD` es Infinity sin líneas). Tamaño: 10–13 kB; 0,05–0,15 ms por instantánea.
- **Reiniciar** (Reiniciar del cartel de vuelco) restaura la instantánea del principio del turno, sin reconstruir.
  **Rebobinar**: una instantánea por segundo (11 guardadas), vuelve a la que queda 10 s atrás; recorta la grabación.
  Solo prueba libre (en los niveles avisa). **Guardar** (decidido con Jesús): una partida por nivel en localStorage
  con la grúa con la que se jugaba; cuenta para los récords (el reloj sigue donde estaba); se borra al terminar el
  nivel. "Continuar" monta `?nivel=n&grua=…&continuar=1` y quita el parámetro de la URL.
- **Interpolación (fase 15)**: se dibuja la mezcla del paso anterior y el último con `alpha` = tiempo sobrante / paso
  (un paso de retraso, 16 ms). Se mezclan `S` (salvo los objetivos `edge`, `outT`, `cwT`, `ygT`, `jgT`, `erT`), la pose,
  el gancho, el ancla del cable y las cargas; el HUD y la estabilidad usan el último paso. Captura 0,004–0,008 ms por
  paso, mezcla 0,005–0,014 ms por cuadro.
- **Calidad adaptativa (fase 15)**: lento = media > 1/52 s y el cuadro también; 1,5 s lento → escala × 0,85 (mínimo
  0,5); los cuadros buenos descuentan (a 60 Hz sincronizado, 40 fps son cuadros de 16 y 33 ms alternados). Para subir
  prueba un escalón tras 8 s bien; si no aguanta, espera el doble (hasta 120 s). Nunca pasa de la escala de la calidad
  elegida. Solo con el turno en marcha. Apagada con `?pr=` y con `?bench=1`. El contador de fps muestra la resolución
  si es < 100 %.
- **Banco de pruebas** (`?bench=1`, también en la versión publicada): nivel 14, nivel 11 con la AT 650-8, nivel 9,
  LR 3000, AT 650-8 y SK 60 libres; 1,5 s de calentamiento y 6 s medidos girando la superestructura (guion por
  `GameStep.source`). Para medir desde aquí con la GPU de la laptop sin ver el panel: Playwright sin ventana con
  `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` (da la Intel real, 1920×1080, y el tiempo de GPU).

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
  LR 3000 con equipos y remolque: 96 draw calls y ~28.600 triángulos (vista inicial); LR 300 con equipos: 75 y ~15.200.
  Con los detalles del resto (sin materiales nuevos por grupo): AT 650-8 montada sigue en 145 (~33.200 triángulos), AT 500-8
  134 (~21.500), SK 60 plegada 91 de cerca (~24.100). **En la laptop de Jesús: 60 fps** con todos los detalles.

- Fase 9 parte A (vista inicial de cada nivel con la grúa recomendada, sombras incluidas, panel de la app): el escenario suma
  unos 6 draw calls (cajas y depósitos instanciados, zonas, borde, cables). Máximo: nivel 11 con la AT 650-8, **138** (~22.200
  triángulos, sin montar); AT 500-8 en 9 y 10, 134–135; LR 3000 en 13, 96 (~28.800). **En la laptop de Jesús: 60 fps.**
- Fase 9 parte B: la franja de las líneas suma 1 draw call (AT 220 en el nivel 3: 129). Nivel 11 con la AT 650-8 con lastre,
  Y-guy y plumín montados: **144** draw calls y ~33.200 triángulos. **En la laptop de Jesús: 60 fps.**

- Fase 10 parte A (`?tandem=1`, LR 3000 + AT 500-8 + columna, sombras incluidas, panel de la app): **195 draw calls**
  (~48.000 triángulos), por encima de la meta de 150; 60 fps y render CPU ~7 ms en el panel. Jesús lo probó en la laptop y
  le fue bien (sin cifra de fps). Parte B (nivel 14, vista general): **~222 draw calls**, ~50.000 triángulos, 60 fps en el
  panel. Si en la laptop no da 60 fps: sombras solo de la grúa activa, o menos detalle en la lejana.

- Fase 11 (panel de la app, que es la laptop de Jesús: Intel Graphics de la Core Ultra 5; 1080p, sombras incluidas):
  nivel 14 **134 draw calls** (antes 220), ~50.000 triángulos; render ~1–1,4 ms con `gl.finish` (antes ~2); con calidad
  baja 79. Nivel 11 con la AT 650-8 sin montar 78 (antes 138), nivel 9 77, SK 60 libre 58. El pase de sombras era ~2/3
  del render; la física, 0,11 ms por paso con dos grúas. **Pendiente: fps con el panel visible en uso normal.**

- Fase 13: bundle 5.096.697 → 5.104.708 bytes (+8 kB; ~1,89 MB con gzip), CSS 5,0 → 6,0 kB. Con `vite preview` en local
  (con caché): JS en ~0,1 s y primer cuadro (`gruas-listo`) a ~0,6 s en la LR 3000. **Desde GitHub Pages** (nivel 1, sin
  caché, conexión de la laptop): JS 1,84 MB comprimido en 1,6 s y primer cuadro a 2,4 s. **Pendiente**: fps con el panel
  visible. Avisos de la acción (no fallan todavía): las acciones v4 usan Node 20 (obsoleto) y `ubuntu-latest` pasa a Ubuntu 26.

- Fase 14A: bundle 5.110.160 bytes (+5 kB), CSS 6,4 kB. Draw calls sin cambios (nivel 14: 134; nivel 11: 78; SK 60: 58).
  Menú, 14 niveles, 11 pruebas libres y tándem sin errores ni avisos en consola (recorrido en iframes con `advance`).

- Fase 14B (`vite preview` en local, panel oculto: sin cuadros, así que se mide la partida lista, no el primer cuadro):
  JS 778 kB (182 kB comprimido; antes 5,10 MB / 1,89 MB) + wasm 3,08 MB (1,19 MB comprimido) + modelos aparte (ruedas
  24 kB, orugas 11 kB). Partida lista con los shaders compilados: menú 0,67 s, nivel 1 0,70 s, LR 3000 0,75 s, nivel 14
  0,82 s (antes, primer cuadro a 0,71–1,49 s, con un cuadro de 220–460 ms compilando shaders). Cambiar de partida:
  0,18–0,27 s (modo desarrollo). **Pendiente**: medir el primer cuadro con el panel visible y la carga desde GitHub
  Pages (ver si sirve el .wasm comprimido).

- Fase 15 A+B (`?bench=1` con Chromium sin ventana sobre la Intel Graphics de la laptop por ANGLE/D3D11, 1920×1080,
  calidad alta; antes = `main` con solo el banco añadido). Los 6 casos a 60 fps, peor cuadro 16,8 ms, draw calls
  iguales (nivel 14: 134; nivel 11 AT 650-8: 78; nivel 9: 77; LR 3000: 66; AT 650-8: 79; SK 60: 58). GPU por cuadro,
  antes → después: nivel 14 8,8–9,0 → 8,7–9,0 ms; nivel 11 7,7–8,2 → 7,8–7,9; nivel 9 7,9–8,1 → 7,7–8,1; LR 3000
  7,4–7,6 → 7,4–7,8; AT 650-8 7,4–7,5 → 6,8–7,4; SK 60 8,0–8,2 → 8,2. Render CPU 2,1–4,4 ms en los dos. Física por
  paso (todo el `tick`, sin ventana) 0,48–0,87 → 0,56–0,93 ms: dentro del ruido entre pasadas de la misma versión
  (±0,1). Bundle: `app.js` 778 → 787 kB (185,6 kB comprimido); el banco va en un trozo aparte.
  **Pendiente**: `?bench=1` con el panel visible en uso normal y mirar la interpolación en una pantalla de 120/144 Hz.

### Pendientes
- **Fase 15, parte C** (cable): Rapier 0.21.0 es la última versión en npm y su API JS no da impulsos ni fuerzas de
  las juntas (`RawImpulseJointSet` solo tiene límites y motores): la tensión sigue medida por posiciones. Falta la
  catenaria del cable flojo y los ramales que se tensan al izar.
- Posible mejora de carga: el `.wasm` empieza a bajar cuando ya llegó `app.js` (no se puede precargar desde
  `index.html` porque su nombre lleva hash).
- Textos de datos con teclas fijas ("(B)", "T sube el plumín…") en `LEVELS`, el nivel de tándem y las notas de las
  grúas: si el jugador cambia una tecla, la ficha sigue diciendo la de por defecto. Se resolverá al traducir esos datos.
- Playwright: en local una prueba falló una vez y no se repitió (3 vueltas); en la acción hay 1 reintento. Local:
  `npm run e2e` (~2 min). Tras el merge de la 14C falló en la acción la prueba libre de la LR 3000 (bajar el cable con
  F no lo alarga: el gancho empieza cerca del suelo); ahora sube con R (#27).
- Si la acción del PR sigue lenta: recorrer los niveles en una sola página cambiando de partida sin recargar (no
  cargar el wasm 30 veces).
- `tower.test.ts` "el gancho sigue a la punta…": 0,7 s sola, pero con toda la batería en paralelo pasó una vez de 5 s;
  ahora tiene 20 s de margen.
- Tándem: Jesús jugó el nivel 14 a mano y le pareció bien (el guion de prueba cambia de grúa ~13 veces al ponerla de
  pie). Si algún día resulta muy difícil, lo primero a revisar son la pluma de la cola y los tiempos de `SIDE_T`/`OVER_T`.
  En la prueba libre, girar (A/D) mueve las cabezas a lo largo de la columna; de costado se mueve con la pluma (W/S). Si la principal sigue izando con la cola enganchada, la cola
  queda en doble bloqueo y termina volcando (correcto, pero sin aviso claro todavía).
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
- Vidrio (nivel 6): bajar con Shift a fondo da ~0,47–0,62 m/s, casi en el límite de 0,5 (en la referencia, 0,3 × 2,1 = 0,63):
  hay que soltar F antes de tocar. Es la dificultad prevista por la referencia; si molesta, preguntar antes de cambiarla.
- Jesús probó algunos niveles a mano (no todos de principio a fin).

- Prueba libre: límite ±150 m con el terreno blando de prueba.
- `CLEARANCE` y la suspensión siguen siendo los de la AT 60; el colisionador de la superestructura (`supBox`) no cubre la
  cabina del operador. Revisar si molesta con otras grúas.
- La caja despedida 45 m de la fase 1 no se reprodujo con el nuevo ajuste del solver; si vuelve a pasar, anotar cómo.
- Pruebas en el navegador: no teletransportar la pluma (`S.slew = …` de golpe) con el gancho colgado: el salto da un
  tirón enorme en el cable y vuelca la grúa. Usar las teclas con `__gruas.advance`.
- **Referencias visuales** de Jesús en `referencia/imagenes/` (ver `NOTAS.md`). Orden acordado: 6B → 7 → 8 → 8B
  remodelado y pulido de los vehículos, con el contrapeso de cada grúa → niveles.
  No pulir modelos antes.
- Vite avisaría que `app.js` pasa de 500 kB (three.js y el juego, ~780 kB): `chunkSizeWarningLimit` = 1200.
