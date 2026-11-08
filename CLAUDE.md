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
- **Fase 4** (modelos de ruedas): City 25, AT 60, RT 90, AT 220, AT 300-6, AT 450-8 y AT 500-8 generados desde `cranes.ts`
  con las fórmulas de `craneModel()` de la referencia; menú "Grúa" en el HUD (`?grua=id`, recarga la página). Pruebas en
  `models.test.ts` (se construyen y nada se atraviesa en todo el recorrido de la pluma ni al girar).
- **Fase 5** (montajes): lastre (B) en AT 300-6, AT 450-8 y AT 500-8; Y-guy (Y) en la AT 500-8 (la AT 650-8 lo tendrá al
  hacer su modelo en la fase 7: la lógica ya es general). Bloqueo de mandos mientras se monta, indicadores en el HUD.
  Pruebas en `assembly.test.ts` y `models.test.ts`.

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
- `src/crane/assembly.ts`: `toggleBallast`/`toggleYGuy` (condiciones de la referencia), `stepAssembly` (avance de `S.cw`/`S.yg`
  y `syncConfig` → `C.mCw`, `C.yOn`), `blockWhileAssembling`, `teleLimit` (35 m sin Y-guy), `outriggersLocked`, `yGuyPhase`.
- `src/crane/pose.ts`: `carrierPose` = `carrierFrame` (x, z, rumbo h) ∘ elevación y `phi` ∘ `suspensionPose`; `edgeAxis`
  (marco del chasis), `worldToCarrier`, `compose`, cuaterniones sin three.js.
- `src/physics/world.ts`: mundo Rapier; `Physics.step(S, pose)`, `tension`/`gp`, `tipOver()`, `reset()`, `headWorld()`,
  `toggleHook()` (condiciones de enganche de la referencia), `resetLoads()` (tecla X; cada `Load` guarda su `home`),
  `addObstacle`, `carrierBlocked(x, z, h)` y `padsBlocked(S)` (consultas `intersectionsWithShape`), `SITE_HALF` = 150 m.
- `src/render/camera.ts` (`CameraRig`: modos de cámara y luz que sigue a la grúa), `site.ts` (obstáculos de prueba `TEST_OBSTACLES`).
- `src/render/models/`: `layout.ts` (todas las cotas del modelo sin three.js: cabina, apoyo de pluma, cola de pluma, ranura de la
  placa, contrapeso `cwDims`, cabrestante, radio de cola `tailR`, `hookScale`/`hookFalls`, `WHEELED_IDS`), `carrier.ts` (chasis y
  cabina), `superstructure.ts` (superestructura, tramos, cabeza con poleas), `builder.ts` (`Parts`: caja, cilindro, extrusión de
  perfil; fusiona por material), `materials.ts` (paleta compartida, materiales por color), `ballastPlates(T, L, cw)` en
  `layout.ts` (placas de lastre) y `yguy.ts` (`yGuyGeom` sin three.js, `YGuyView` instanciado en el grupo de la pluma).
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
- **Y-guy** (`yGuyModel` de la referencia, marco de la pluma): el cable delantero se ata en lo alto de la cabeza (`Lb + 0,1`), no
  1,1 m detrás como la referencia (con la pluma recogida quedaba dentro del tramo base). Sin masa en la estabilidad (referencia).

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
  sombras incluidas). Lastre: 1 InstancedMesh; Y-guy: 4 InstancedMesh, recolocados solo cuando cambian. **Fps en la laptop
  pendientes.**

### Pendientes
- El encuadre de sombras (±45 m) no cubre plumas de 64–85 m enteras; la cámara se escala con el largo del chasis.
- Colisión de la carga con la pluma (no existe todavía).
- Radio de cola: el contrapeso no choca con obstáculos al girar (`boomHit`/contrapeso de la referencia), ni la pluma.
  Con lastre la cola llega a ~7,8 m en la AT 500-8; el colisionador de la superestructura no incluye el lastre.
- Terreno (agua, barro, `offroad`) y límites reales de la obra llegan con los niveles (fase 9); ahora el límite es ±150 m.
- Conducción de orugas (`spd.turn`, `crawlMove`): fase 6; `stepDrive` no hace nada si la grúa no tiene `wheelbase`.
- `CLEARANCE` y la suspensión siguen siendo los de la AT 60; el colisionador de la superestructura (`supBox`) no cubre la
  cabina del operador. Revisar si molesta con otras grúas.
- La caja despedida 45 m de la fase 1 no se reprodujo con el nuevo ajuste del solver; si vuelve a pasar, anotar cómo.
- Pruebas en el navegador: no teletransportar la pluma (`S.slew = …` de golpe) con el gancho colgado: el salto da un
  tirón enorme en el cable y vuelca la grúa. Usar las teclas con `__gruas.advance`.
- Vite avisa que el bundle pasa de 500 kB por el wasm de Rapier embebido: esperado, no es un error.
