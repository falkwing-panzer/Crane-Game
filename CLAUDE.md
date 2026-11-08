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
O estabilizadores · B lastre · Y Y-guy · T/G plumín · M montaje · K/L radio superlift · Shift fino · V vista.
Extra (no está en la referencia): **X** reponer la carga en su posición inicial (ayuda de prueba hasta que haya reinicio de nivel).

## Estado y decisiones
Se trabaja por fases (ver `FASES.md`), con `/clear` entre fases. **Al cerrar cada fase, actualizar esta sección**
(estado, decisiones con su porqué, pendientes y medidas de rendimiento) para que la siguiente fase no rehaga ni
contradiga lo anterior. Mantenerla corta: lo que ya dice el código o el historial de git no va aquí.

### Fases terminadas
- **Fase 0** (demo AT 60): escena, AT 60 simplificada, cable/gancho/carga con Rapier, HUD con fps, controles.
- **Fase 1** (estabilidad y LMI): las 11 grúas en `cranes.ts`, port de la estabilidad en `stability.ts`, pruebas contra
  la referencia, LMI / capacidad / radio en el HUD (solo indica; sin bloqueos todavía).

### Mapa del código
- `src/crane/cranes.ts`: `CRANES` (las 11 grúas; el literal se copió tal cual de la referencia y una prueba lo compara),
  `CraneSpec`, `AT60` (= `CRANES.medium`, tipada `WheeledSpec` para el modelo 3D de la fase 0).
- `src/crane/stability.ts`: `KF`, `yNoGuy`, `reach`, `structCap`, `supportRect`, `craneMasses`, `tipUtil`, `lmiStatic`,
  `ratedCap`, `CraneConfig` y `baseConfig(T)`.
- `src/crane/reference.ts` (solo pruebas): extrae del HTML (import `?raw`) el bloque `const D … ratedCap` y lo ejecuta.
- `src/crane/kinematics.ts`: `CraneState`, `stepCrane` (rampas de velocidad, límites, Shift = ×0,3), `headPos`.
- `src/physics/world.ts`: mundo Rapier; `Physics.step(S)`, `toggleHook()` (condiciones de enganche de la referencia),
  `resetLoads()` (tecla X; cada `Load` guarda su `home`).
- `src/render/scene.ts`, `craneModel.ts`, `rigging.ts`: escena, grúa, gancho/cable/cargas.
- `src/ui/input.ts`, `hud.ts`: teclas y HUD. En desarrollo, `window.__gruas = { S, C, phys, ctx }` para depurar.

### Convenciones
- Unidades: m, t, rad, s. Masas en Rapier en **toneladas**; gravedad 9,81.
- Ejes: y arriba; chasis a lo largo de **+x (frente)**; **−z = izquierda**. `slew` positivo = antihorario visto desde arriba
  (A). Pluma en el plano x-y de la superestructura; `headPos` = fórmula de `reach()` de la referencia.
- Física con paso fijo de 1/60 s (máximo 4 pasos por cuadro); render a la frecuencia de la pantalla.
- Cotas no tomadas de la referencia (cabinas, ancho de llanta, nº de tramos, cilindro de elevación) están marcadas
  en el código como "aproximación visual".

### Decisiones
- **Grúa no dinámica en Rapier**: chasis = colisionador fijo, superestructura = cinemática, cabeza de pluma = cinemática
  sin colisionador (ancla del cable). La estabilidad la decide el modelo analítico.
- **Cable** = `JointData.rope` cabeza→gancho; el largo se cambia con `rawSet.jointSetLimits(LinX)` porque la API JS no
  expone `setMaxDistance` (verificado: el largo se respeta). Revisar si se actualiza Rapier.
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
- **LMI en la demo**: modo `tire` (la AT 60 aún no tiene estabilizadores); masa evaluada = gancho + carga solo si
  cuelga (`mEval` de la referencia). La capacidad mostrada incluye el gancho, como en la referencia. Con poca carga y
  pluma empinada el LMI puede bajar al bajar la pluma: es el vuelco hacia atrás (contrapeso), también en la referencia.

### Plan y riesgos conocidos
- **Relación de masas gancho/carga** (0,4 t frente a cargas de cientos de t; gancho de 40 t en la LR 3000): con impulse
  joints el cable se estira y vibra. Plan: pasar cabeza→gancho→carga a **multibody joints** en la fase 2, antes de las
  grúas grandes (también resuelve el cambio de largo del cable).
- **Vuelco** (fase 2): al pasar del modelo analítico a Rapier, iniciar el cuerpo con la inclinación y velocidad del modelo.
- **Conducción** (fase 3): preferencia por un controlador cinemático propio (bicicleta con dirección en todos los ejes)
  en vez del vehicle controller de Rapier; confirmar al implementarla.
- Medir rendimiento **en cada fase** (fps, peor cuadro, draw calls, triángulos del peor caso) y anotarlo aquí.
  Meta orientativa: menos de unas 150 draw calls.

### Rendimiento medido
- Fase 0: 57 draw calls, ~3.000 triángulos, física 0,27 ms y render CPU 1,1 ms por cuadro (panel integrado de la app,
  limitado a 30 fps; **pendiente medir fps reales en la laptop**).
- Fase 1: 60 fps, 56 draw calls, ~3.050 triángulos, física 0,16 ms, render CPU 0,6 ms (panel de la app). El LMI y
  `ratedCap` (26 iteraciones) se calculan cada cuadro sin costo apreciable.

### Pendientes
- Colisión de la carga con la pluma (no existe todavía).
- En la prueba de la fase 1 la caja de 2 t salió despedida unos 45 m al balancearla: confirma el riesgo del cable con
  impulse joints. Tenerlo en cuenta al pasar a multibody en la fase 2.
- Vite avisa que el bundle pasa de 500 kB por el wasm de Rapier embebido: esperado, no es un error.
