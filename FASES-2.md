# Simulador de grúas 2.0: fases (prompts para Claude Code)

La versión 1.0 está terminada y publicada (fases 0–12 en `FASES.md`; etiqueta `v1.0` en git). Este archivo sigue la
misma forma:
- Una fase a la vez, con `/clear` antes, y pega el prompt.
- Al terminar: prueba en `npm run dev`, revisa la lista "Para revisar" y di **"haz commit"**.
- Al llevarlo a `main` se publica solo en https://falkwing-panzer.github.io/Crane-Game/ : prueba bien antes.
- Para volver a ver la 1.0 en cualquier momento: `git checkout v1.0` (y `git checkout main` para regresar).

**La idea de la 2.0:** primero **un motor mejor** (bloque A), porque todo lo demás se apoya en él: cambiar de nivel sin
recargar (carrera, escuela), física determinista e instantáneas (repeticiones, editor), un mundo que no sea un plano
vacío, terreno con relieve (escenarios nuevos), render más bonito sin perder los 60 fps. Después, el **contenido**
(bloque B). Todo dentro del límite de la laptop (60 fps, una luz con sombras, ~150 draw calls).

Regla para todo el bloque A: **medir antes y después** (fps, peor cuadro, draw calls, ms de física, tiempo de carga,
tamaño del bundle) y anotarlo en CLAUDE.md. Ninguna fase del motor puede cambiar el resultado de la estabilidad: las
pruebas contra la referencia siguen pasando.

Orden recomendado: **13 → 14 → 15 → 16 → 17 → 18**, y luego el bloque B en el orden que quieras.

---

# Bloque A: el motor

## Fase 13: Listo para el público

```
Lee CLAUDE.md. Fase 13: dejar la versión publicada sólida para alguien que la abre por primera vez.

1. Pantalla de carga: el JS pesa ~1,9 MB comprimido. Muestra "Cargando…" con progreso hasta que Rapier y la
   escena estén listos.
2. Contador de fps y tiempos solo en desarrollo o con ?fps=1 (ahora salen también en la versión publicada).
3. Ayuda de controles: tecla H (y un botón "?") con las teclas agrupadas; que aparezca sola la primera vez.
4. Avisos: sin WebGL, un mensaje claro; en un celular sin teclado, decir que se juega con teclado o mando.
5. Para compartir: favicon, descripción e imagen de vista previa (etiquetas og:).
6. La acción de GitHub (.github/workflows/publicar.yml) corre `npm test` antes de compilar: si falla una
   prueba, no se publica nada.

Antes de programar, dime el plan.
```

Para revisar: abrir el enlace en una ventana privada; el fps no sale sin `?fps=1`; el enlace pegado en WhatsApp
muestra imagen y descripción; en la pestaña Actions se ve el paso de las pruebas.

---

## Fase 14: Motor I: arquitectura, carga y robustez

```
Lee CLAUDE.md. Fase 14: ordenar el motor del juego. No cambia nada de lo que ve el jugador salvo que todo
carga más rápido y aguanta mejor.

1. Perfila primero: tiempo desde abrir el enlace hasta poder jugar, tamaño del bundle, memoria (heap y GPU)
   tras cambiar 5 veces de nivel. Dímelo antes de tocar nada.
2. main.ts creció mucho (Unit, levelRules, tandemRules, cámara, HUD…). Divídelo en piezas con una
   responsabilidad cada una (bucle, sesión de juego, reglas del nivel, entrada, presentación). Que se
   comuniquen con un bus de eventos (carga apoyada, golpe, LMI alto, vuelco, victoria…) para que reglas,
   HUD y sonido no dependan unos de otros. Sin cambiar comportamiento: las pruebas tienen que seguir pasando.
3. Cambiar de nivel o de grúa SIN recargar la página: desmontar la sesión (geometrías, materiales, texturas,
   mundo de Rapier, sonidos, escuchadores) y montar la nueva. Comprobar que la memoria no crece.
4. Carga más rápida: Rapier con su .wasm aparte (no embebido en base64) si la versión lo permite, modelos de
   grúa cargados por partes (import dinámico) y shaders precompilados al cargar (renderer.compile), para que
   no haya tirones la primera vez que aparece algo (plumín, torre, lastre).
5. Robustez: pausa automática al cambiar de pestaña o perder el foco (y al volver, sin pasos de física
   acumulados); recuperarse si se pierde el contexto WebGL (pasa con gráficas integradas al suspender).
6. Teclas configurables (guardado en localStorage), con la tabla actual por defecto.
7. Textos de la interfaz en un archivo de idioma (español), listos para traducir al inglés más adelante.
8. Pruebas en el navegador automáticas (Playwright) en la acción de GitHub: abrir el menú, los 14 niveles y
   las pruebas libres, y comprobar que la consola queda limpia.

Antes de programar, dime el plan.
```

Para revisar: cambiar 10 veces de nivel no aumenta la memoria; el menú abre claramente antes que ahora; cambiar de
pestaña y volver no dispara la grúa; los 14 niveles y las pruebas libres siguen igual.

---

## Fase 15: Motor II: bucle, determinismo y cable

```
Lee CLAUDE.md. Fase 15: mejoras de la simulación.

1. Interpolación del render: la física va a 60 Hz fijos; en pantallas de 120/144 Hz o con cuadros irregulares
   la grúa y el gancho deben dibujarse interpolados entre dos pasos, sin tirones.
2. Determinismo: con las mismas entradas, la misma partida paso a paso. Grabar las entradas por paso y una
   prueba que reproduzca 60 s de un nivel y compare posiciones. Base de las repeticiones y del editor (fase 25).
3. Instantáneas de Rapier (world.takeSnapshot / restoreSnapshot) junto con el estado de la grúa: reiniciar al
   instante sin reconstruir, guardar a mitad de un nivel y "rebobinar 10 s" (solo en la prueba libre y la
   escuela, no cuenta para los récords).
4. Cable: revisar si Rapier 0.21 (o una versión más nueva) da ya las fuerzas/impulsos de las juntas; si sí,
   cambiar la tensión medida por posiciones por la real y comparar las dos antes de quitar la vieja.
   Si actualizar Rapier rompe algo (rawSet.jointSetLimits, numInternalPgsIterations), dímelo antes.
5. Cable visual con catenaria cuando está flojo (hoy es una recta) y ramales que se tensan al izar.
6. Calidad adaptativa: si los fps bajan de forma sostenida, bajar la escala de resolución sola (y subirla
   cuando sobre margen), sin pasar de la calidad elegida.
7. Banco de pruebas de rendimiento (?bench=1): recorre los niveles más pesados y saca un informe (fps medio,
   peor cuadro, draw calls, ms de física y ms de GPU reales con EXT_disjoint_timer_query si el navegador lo
   permite). Lo correremos después de cada fase.

Antes de programar, dime el plan.
```

Para revisar: en 120 Hz se ve suave; la prueba de determinismo pasa; rebobinar deja todo como estaba; la tensión en
reposo sigue siendo exacta (gancho + carga); el informe de ?bench=1 sale igual o mejor que antes.

---

## Fase 16: Motor III: render, efectos y sonido

```
Lee CLAUDE.md. Fase 16: que se vea y suene mejor sin bajar de 60 fps en la laptop.

1. Mide el coste actual por pase (sombras, escena, HUD) con ?bench=1.
2. Iluminación: luz de ambiente de hemisferio, oclusión ambiental horneada en los colores por vértice de las
   grúas (rincones más oscuros), niebla de distancia ajustada por escena.
3. Materiales: probar un material estándar (metal/rugosidad) solo para pintura y cromados en calidad alta,
   manteniendo los colores por vértice y una sola malla por grupo. Si cuesta más de ~1 ms, se queda en Lambert.
4. Nivel de detalle (LOD): la grúa lejana del tándem y las piezas pequeñas (barandillas, escalerillas,
   pilotos) se ocultan o simplifican a distancia.
5. Cámara: que no atraviese el suelo, los obstáculos ni la grúa; transiciones suaves al cambiar de modo.
6. Sombras: ajustar el encuadre a lo que se ve (no a todo el radio de la pluma) cuando la cámara está cerca.
7. Partículas baratas (una draw call por sistema): polvo al conducir y al apoyar las zapatas, humo del escape
   al acelerar, lluvia. Apagadas en calidad baja.
8. Agua de las zonas de agua con movimiento (shader simple, sin reflejos).
9. Sonido 3D (PannerNode): motor, cabrestante y golpes suenan desde su sitio y cambian con la cámara.

Antes de programar, dime el plan. Enséñame capturas antes/después.
```

Para revisar: 60 fps en la laptop en los niveles 11 y 14 con calidad alta; las capturas se ven claramente mejor; la
calidad baja sigue igual o más rápida.

---

## Fase 17: Motor IV: decorado de fondo (que no sea un baseplate)

```
Lee CLAUDE.md. Fase 17: rodear la obra de un entorno creíble. Hoy el mundo es un plano de 400 × 400 m con
cuadrícula, la obra pintada encima y un cielo en degradado.

1. Sistema de decorado: piezas sin física (fuera del alcance de la grúa) o con colisionador estático (si la
   grúa o la carga pueden tocarlas), generadas con una semilla por nivel (siempre el mismo entorno),
   instanciadas (un InstancedMesh por tipo), con LOD y sombras solo cerca. Presupuesto: ~10–15 draw calls.
2. Borde de la obra, en todos los niveles: valla con malla y portón de acceso, casetas de obra, baños
   portátiles, acopios (palés, tubos, ferralla), focos, conos, maquinaria parada (excavadora, hormigonera,
   volquete, carretilla: formas simples, sin marcas).
3. Alrededores según el tipo de nivel: urbano (edificios, calle con farolas), eléctrico (torres de alta
   tensión siguiendo las líneas del nivel), refinería (tanques, chimeneas, racks de tuberías), puente (río y
   otra orilla), barro/orugas (campo, árboles, caminos de tierra), puerto, prueba libre (un patio de
   maquinaria). Te enseño la lista por nivel antes de modelar.
4. Horizonte: un anillo de colinas o perfil de ciudad lejano en una malla, y nubes.
5. Vida: manga de viento y banderas que se mueven con el viento del nivel (ayudan a jugar), algún camión que
   pasa por la calle, trabajadores simples. Todo animado en el shader o con instancias, sin física.
6. El suelo fuera de la obra con variación (tierra, hierba, asfalto) en vez de la cuadrícula; la cuadrícula
   solo en la prueba libre o como opción.

Mide draw calls y fps antes y después en los niveles 11 y 14 (los más pesados).
Antes de programar, dime el plan.
```

Para revisar: ningún nivel parece una placa vacía; 60 fps en la laptop en los niveles 11 y 14; nada del decorado se
mete en la zona de trabajo ni tapa una carga; la manga de viento apunta como el viento del nivel.

---

## Fase 18: Motor V: terreno con relieve

```
Lee CLAUDE.md. Fase 18: suelo con pendiente y desniveles.

1. Terreno con alturas (heightfield de Rapier + malla con el mismo dato), con el suelo plano de siempre en los
   14 niveles actuales; las colinas del horizonte de la fase 17 pasan a ser terreno real.
2. Conducir sobre pendiente: el chasis sigue el terreno (ruedas y orugas), con un límite de pendiente.
3. Nivelación con estabilizadores: cada zapata baja hasta el suelo y el chasis queda nivelado si las
   carreras alcanzan; si no, la grúa queda inclinada.
4. Estabilidad: el modelo de la referencia supone suelo plano. Proponme cómo tener en cuenta una inclinación
   (por ejemplo, desplazar el CDG por el ángulo) y espera mi visto bueno antes de cambiar stability.ts.
   Las pruebas contra la referencia con suelo plano no deben cambiar.
5. Presión sobre el suelo bajo las zapatas: la referencia no la calcula. Pregúntame antes de inventar datos
   (área de zapata, resistencia del terreno).

Antes de programar, dime el plan.
```

Para revisar: los 14 niveles siguen igual; en una rampa de prueba la grúa se nivela, y sin nivelar el LMI lo nota.

---

# Bloque B: contenido (usa el motor nuevo)

## Fase 19: Escuela de operadores (tutorial)

```
Lee CLAUDE.md. Fase 19: tutorial jugable para alguien que nunca ha manejado una grúa.

1. "Escuela" en el menú con 5–6 lecciones cortas con la AT 60: cámara y conducir; estabilizadores; girar,
   subir y telescopar hasta una marca; enganchar, izar y soltar; el LMI y el radio; viento y bajar con Shift.
2. Cada lección son pasos con un objetivo comprobable, un texto corto y la tecla resaltada; avanza solo.
3. Lecciones encadenadas sin recargar (fase 14), con "rebobinar" (fase 15). Guardar las hechas; sugerir el
   nivel 1 al terminar.

Antes de programar, dime el plan.
```

Para revisar: alguien que no conoce el juego termina la escuela sin ayuda y luego pasa el nivel 1.

---

## Fase 20: Tabla de cargas y plan de izaje

```
Lee CLAUDE.md. Fase 20: herramientas de planificación como las de un operador real.

1. Tabla de cargas (tecla C): ratedCap por radio y largo de pluma para la configuración actual, con la posición
   actual marcada. Solo con el modelo de estabilidad que ya existe.
2. Plan de izaje en la ficha: colocar un "fantasma" de la grúa en la vista desde arriba y ver el radio útil
   para cada carga (verde si alcanza con margen, rojo si no).
3. Resumen al terminar: LMI máximo, radio y carga más exigentes.

Antes de programar, dime el plan.
```

Para revisar: la tabla coincide con el LMI en cada punto; el fantasma en verde significa que de verdad se puede.

---

## Fase 21: Modo carrera

```
Lee CLAUDE.md. Fase 21: modo carrera.

1. Empiezas con una City 25 y poco dinero; contratos (los 14 niveles y obras generadas, con su decorado);
   cobras según estrellas y tiempo; multas por golpes, cargas rotas o líneas eléctricas.
2. Comprar o alquilar grúas más grandes, con coste por día.
3. Obras generadas siempre resolubles (comprobar con ratedCap que alguna grúa disponible puede hacerla).
4. Guardado en localStorage, con exportar/importar a un archivo.

Diseña primero el equilibrio de dinero y enséñamelo antes de programar.
```

Para revisar: 30 minutos de partida con progreso claro; nunca sale un contrato imposible.

---

## Fase 22: Aparejos realistas

```
Lee CLAUDE.md. Fase 22: aparejos y movimiento de la carga más realistas.

1. Choque de la carga con la pluma y el plumín (pendiente desde la fase 9).
2. Eslinga de 4 ramales real en física y balancín para cargas largas.
3. Cuerdas guía: orientar la carga con dos teclas en lugar de bloquear su giro; los niveles siguen resolubles.
4. Voltear una carga (de tumbada a de pie) con dos ganchos o en tándem, más pequeña que el nivel 14.

Mide estiramiento del cable y tensión antes y después, como en las fases 2 y 6B.
Antes de programar, dime el plan.
```

Para revisar: las pruebas de física siguen pasando; los niveles 4 y 14 se pueden terminar.

---

## Fase 23: Escenarios nuevos

```
Lee CLAUDE.md. Fase 23: escenarios nuevos con trabajos típicos de grúa (usan el decorado de la fase 17 y el
terreno de la fase 18).

1. Parque eólico en una loma: montar un aerogenerador (tramos de torre, góndola, buje, palas) esperando calmas.
2. Puerto: descargar un barco desde el muelle.
3. Ciudad: calle con edificios, montar un equipo en una azotea.
4. Atardecer y noche con luces de trabajo (una sola luz con sombras).

Pregúntame medidas y pesos de las piezas antes de inventarlos. Pasa ?bench=1 en cada escenario.
```

Para revisar: 60 fps en la laptop en cada escenario; el aerogenerador se monta entero.

---

## Fase 24 (opcional): Inglés

```
Lee CLAUDE.md. Fase 24: traducir el juego al inglés con el archivo de idioma de la fase 14.
Selector de idioma en el menú (guardado), por defecto el del navegador. Los nombres de las grúas no cambian.
```

Para revisar: el juego entero en inglés sin textos sueltos en español; el español sigue igual.

---

## Fase 25: Editor de niveles, repeticiones y compartir

```
Lee CLAUDE.md. Fase 25: editor y retos para compartir (usa el determinismo de la fase 15).

1. Editor en el navegador: obra, grúas permitidas, cajas, zonas, obstáculos, líneas, terreno, decorado,
   viento, tiempo.
2. El nivel va dentro del enlace (codificado en la URL, sin servidor).
3. Repeticiones: reproducir una partida a partir de sus entradas; "compartir mi récord" con un enlace.

Antes de programar, dime el plan.
```

Para revisar: un nivel del editor se abre igual en otro navegador; la repetición coincide con la partida.

---

## Fase 26 (opcional): Celular y tableta

```
Lee CLAUDE.md. Fase 26: jugar en pantalla táctil (en la fase 11 decidimos no hacerlo; ahora quiero probarlo).

1. Mandos táctiles que no tapen la carga.
2. Calidad baja por defecto en móviles (con la calidad adaptativa de la fase 15).
3. Instalable como app (PWA) y que funcione sin internet después de abrirlo una vez.

Antes de programar, dime el plan.
```

Para revisar: el nivel 1 se termina en un celular; en la laptop no cambia nada.

---

## Descartado (por ahora)

- **Física en un Web Worker**: la física cuesta ~0,11 ms por paso; no hay nada que ganar y complica todo.
- **Renderer WebGPU de three.js**: arriesgado con gráficas Intel integradas en el navegador. Como mucho, un
  experimento con vuelta a WebGL si algún día hace falta.
