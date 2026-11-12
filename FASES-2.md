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

Orden recomendado: **13 → 18** (bloque A, el motor), **19 → 25** (bloque B, el juego) y el **lanzamiento** cuando esté
listo; 26–41 cuando quieras.

**Todavía no es para el público.** El enlace existe, pero no se comparte hasta que decidas que el juego está listo:
entonces toca la sección **Lanzamiento al público** (después de la fase 25, sin número; se puede adelantar o atrasar).
Ahí se prepara el enlace para compartir y se prueba con 5–10 personas (mejor si alguna maneja grúas), y lo que digan
decide el orden del resto.

---

# Bloque A: el motor

## Fase 13: Base de trabajo

```
Lee CLAUDE.md. Fase 13: preparar la base para trabajar en la 2.0 (el juego todavía NO sale al público:
nada de esto es para compartir el enlace).

1. La acción de GitHub (.github/workflows/publicar.yml) corre `npm test` antes de compilar: si falla una
   prueba, no se publica nada.
2. Pantalla de carga: el JS pesa ~1,9 MB comprimido. Muestra "Cargando…" con progreso hasta que Rapier y la
   escena estén listos.
3. Ayuda de controles: tecla H (y un botón "?") con las teclas agrupadas, incluidas las que se fueron
   añadiendo (cámara libre del tándem, amarre del gancho).
4. Contador de fps y tiempos: en desarrollo siempre; en la versión publicada solo con ?fps=1.

Antes de programar, dime el plan.
```

Para revisar: en la pestaña Actions se ve el paso de las pruebas (y una prueba rota a propósito impide publicar);
la ayuda con H lista todas las teclas; `?fps=1` muestra el contador en el enlace.

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
   prueba que reproduzca 60 s de un nivel y compare posiciones. Base de las repeticiones, del reto diario y del editor (fases 21, 22 y 28).
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

# Bloque B: el juego (usa el motor nuevo)

Orden recomendado: 19 → 20 → 21 → 22 → 23 → 24 → 25 (la carrera junta casi todo lo anterior), luego el resto.
Las marcadas "opcional" se pueden saltar.

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

## Fase 21: La vista y el tacto del operador

```
Lee CLAUDE.md. Fase 21: que manejar se sienta como estar en la grúa.

1. Cámara del gancho: cámara en la cabeza de la pluma (o en el motón) mirando hacia abajo, como las de las
   grúas grandes. Como modo de V y como recuadro pequeño que se puede activar (ojo con el coste: es otra
   vista; sin sombras y a baja resolución). Mide el coste.
2. Pantalla del LMI en la cabina: en la vista de cabina, una pantalla dentro de la cabina (textura de canvas)
   con radio, carga, capacidad, ángulo y largo de pluma y la barra del LMI; el HUD se oculta en esa vista.
3. Vibración del mando (vibrationActuator de la API Gamepad): suave desde el 90 % de LMI, fuerte en golpes y
   aterrizajes duros, pulso con la alarma de la línea eléctrica. Opción para apagarla.
4. Ayudas activables (para principiantes): línea vertical del gancho al suelo, sombra/marca de la carga en el
   suelo, círculo del radio actual y del radio máximo para la carga colgada.
5. Modo experto: sin porcentaje del LMI ni capacidad en el HUD, solo la alarma; sin ayudas.
6. Repetición del vuelco o del fallo: al fallar, los últimos ~8 s otra vez a cámara lenta desde una cámara
   que muestra la grúa entera (usa la grabación de la fase 15).
7. Accesibilidad: el estado del LMI con forma y texto además del color (daltonismo), tamaño del HUD ajustable.

Antes de programar, dime el plan.
```

Para revisar: con el mando se nota la carga sin mirar el HUD; la cámara del gancho no baja de 60 fps en la laptop; la
repetición del vuelco se entiende.

---

## Fase 22: Puntuación y rejugabilidad

```
Lee CLAUDE.md. Fase 22: razones para volver a jugar.

1. Suavidad: medir el balanceo de la carga, los tirones (picos de tensión sobre la estática) y los arranques y
   paradas bruscos. Proponme si es una 4.ª estrella o una medalla aparte (no quiero romper los récords
   guardados de la 1.0) y los umbrales con datos de partidas reales.
2. Estadísticas guardadas: toneladas izadas, horas de grúa por modelo, izajes, golpes, vuelcos, distancia
   conducida.
3. Logros (unos 25): "100 izajes sin golpe", "nivel 14 sin pasar del 80 % de LMI", "vidrio a menos de 0,2 m/s"…
4. Reto diario: obra generada con la fecha como semilla (la misma para todos ese día, sin servidor), con su
   récord y un enlace para compartir el tiempo.
5. Licencias de operador por familia (ruedas, orugas, torre, tándem): un examen corto con la grúa de esa
   familia; sin licencia, sus niveles quedan bloqueados (opción para desbloquear todo y no frustrar a nadie).

Antes de programar, dime el plan.
```

Para revisar: la suavidad premia lo que un operador llamaría "manejar bien"; los récords de la 1.0 siguen ahí; el reto
diario es igual en dos navegadores el mismo día.

---

## Fase 23: Señalero y seguridad en la obra

```
Lee CLAUDE.md. Fase 23: trabajar con gente en la obra.

1. Señalero (rigger): personaje en el suelo que da órdenes con señales de mano (animación simple) y mensajes de
   radio en texto ("sube despacio", "gira a la izquierda", "para"), calculados desde la posición del gancho y
   el destino. Puede ir con voz sintetizada (speechSynthesis) si suena bien.
2. Niveles "a ciegas": la carga o el destino no se ven desde la cabina (detrás de un edificio, en una azotea);
   solo el señalero y la cámara del gancho. Dos o tres niveles nuevos.
3. Lista de chequeo antes del izaje: nivelación, zona despejada, viento bajo el límite, peso confirmado,
   eslinga correcta. Saltarse un punto resta puntos (o falla en el modo experto).
4. Zona de exclusión: trabajadores en el suelo que se mueven; pasar la carga por encima de una persona
   penaliza (como la línea eléctrica: aviso, alarma y fallo si se insiste).
5. Cesta de personal: levantar operarios con límites más estrictos (velocidad, balanceo, LMI ≤ 50 %, sin
   viento fuerte). Un nivel nuevo.

Te paso la lista de señales que quiero usar antes de animarlas. Antes de programar, dime el plan.
```

Para revisar: un nivel a ciegas se puede terminar solo con el señalero; los trabajadores no se meten en sitios
imposibles; la cesta se siente más delicada que una caja.

---

## Fase 24: Misiones completas

```
Lee CLAUDE.md. Fase 24: trabajos con principio y fin, como en la vida real.

1. Llegar a la obra: conducir la grúa plegada por una calle o carretera (calles con curvas cerradas, puentes
   con límite de peso por eje, cables bajos, tráfico parado) hasta la obra, montarla y hacer el trabajo.
   Con el decorado y el terreno de las fases 17–18. Pregúntame los límites de peso antes de inventarlos.
2. Camiones con horario: las cargas llegan en camiones que entran por el portón; hay que descargarlos antes de
   que llegue el siguiente (cola de camiones, tiempo de espera, multa por retraso).
3. Montaje con grúa auxiliar: una City 25 o AT 60 descarga y coloca el lastre (o tramos de pluma) que llegan
   en camiones, con dos grúas en el mismo mundo como en el tándem. Pregúntame si el montaje de la LR 3000
   necesita datos que no están en la referencia.
4. Clima que cambia durante el nivel: ráfagas que se anuncian en el anemómetro, tormenta con rayos que obliga a
   bajar la pluma y esperar, niebla que reduce la visibilidad.
5. Averías durante el turno: anemómetro que falla (sin dato de viento), fuga hidráulica (la pluma baja sola
   despacio), cable dañado (capacidad reducida). El jugador tiene que reaccionar (bajar la carga, avisar).
   Solo en niveles nuevos o en la carrera, nunca en los 14 de la referencia.

Antes de programar, dime el plan; puede ir en dos partes (1–3 y 4–5).
```

Para revisar: una misión "de la base a la obra" completa se juega de principio a fin; las averías se notan y se
pueden resolver.

---

## Fase 25: Modo carrera

```
Lee CLAUDE.md. Fase 25: modo carrera, que junta lo de las fases 19–24.

1. Empiezas con una City 25, poco dinero y la licencia de ruedas; contratos (los 14 niveles, misiones
   completas, obras generadas); cobras según estrellas, suavidad y tiempo; multas por golpes, cargas rotas,
   líneas eléctricas, zona de exclusión y retrasos de camiones.
2. Comprar o alquilar grúas, con coste por día; mantenimiento (si no se hace, más averías).
3. Obras generadas siempre resolubles (comprobar con ratedCap que alguna grúa disponible puede hacerla).
4. Guardado en localStorage, con exportar/importar a un archivo.

Diseña primero el equilibrio de dinero y enséñamelo antes de programar.
```

Para revisar: 30 minutos de partida con progreso claro; nunca sale un contrato imposible.

---

## Lanzamiento al público (sin número: cuando decidas que está listo)

```
Lee CLAUDE.md. Lanzamiento: el juego ya está listo para compartirlo. Prepara el enlace público para alguien
que lo abre por primera vez.

1. Primera vez: la ayuda de controles (fase 13) sale sola; sugerir la escuela (fase 19) si está hecha.
2. Avisos: sin WebGL, un mensaje claro; en un celular sin teclado, decir que se juega con teclado o mando.
3. Para compartir: favicon, título, descripción e imagen de vista previa (etiquetas og:) para WhatsApp y redes.
4. Botón "Opinión" en el menú que abre un formulario (lo creo yo en Google Forms y te paso el enlace; el
   juego no envía nada por su cuenta).
5. README pensado para jugadores (qué es, cómo se juega, el enlace) y la etiqueta de versión en git
   (por ejemplo v2.0) con un resumen de lo nuevo.
6. Revisión final: consola limpia en todos los niveles y pruebas libres desde el enlace publicado, en una
   ventana privada (sin récords ni ajustes guardados).

Antes de programar, dime el plan.
```

Para revisar: abrir el enlace en una ventana privada como alguien nuevo; el enlace pegado en WhatsApp muestra imagen
y descripción; el botón Opinión abre el formulario. Después: pasar el enlace a 5–10 personas y ordenar el resto de
fases con lo que digan.

---

## Fase 26: Aparejos realistas

```
Lee CLAUDE.md. Fase 26: aparejos y movimiento de la carga más realistas.

1. Choque de la carga con la pluma y el plumín (pendiente desde la fase 9).
2. Eslinga de 4 ramales real en física y balancín para cargas largas.
3. Cuerdas guía: orientar la carga con dos teclas en lugar de bloquear su giro; los niveles siguen resolubles.
4. Voltear una carga (de tumbada a de pie) con dos ganchos o en tándem, más pequeña que el nivel 14.

Mide estiramiento del cable y tensión antes y después, como en las fases 2 y 6B.
Antes de programar, dime el plan.
```

Para revisar: las pruebas de física siguen pasando; los niveles 4 y 14 se pueden terminar.

---

## Fase 27: Escenarios nuevos

```
Lee CLAUDE.md. Fase 27: escenarios nuevos con trabajos típicos de grúa (usan el decorado de la fase 17 y el
terreno de la fase 18).

1. Parque eólico en una loma: montar un aerogenerador (tramos de torre, góndola, buje, palas) esperando calmas.
2. Puerto: descargar un barco desde el muelle.
3. Ciudad: calle con edificios, montar un equipo en una azotea (con señalero).
4. Atardecer y noche con luces de trabajo (una sola luz con sombras).

Pregúntame medidas y pesos de las piezas antes de inventarlos. Pasa ?bench=1 en cada escenario.
```

Para revisar: 60 fps en la laptop en cada escenario; el aerogenerador se monta entero.

---

## Fase 28: Editor de niveles, repeticiones y compartir

```
Lee CLAUDE.md. Fase 28: editor y retos para compartir (usa el determinismo de la fase 15).

1. Editor en el navegador: obra, grúas permitidas, cajas, zonas, obstáculos, líneas, terreno, decorado,
   trabajadores, camiones, viento, clima, tiempo.
2. El nivel va dentro del enlace (codificado en la URL, sin servidor).
3. Repeticiones completas: reproducir una partida a partir de sus entradas; "compartir mi récord" con un enlace.

Antes de programar, dime el plan.
```

Para revisar: un nivel del editor se abre igual en otro navegador; la repetición coincide con la partida.

---

## Fase 29 (opcional): Inglés

```
Lee CLAUDE.md. Fase 29: traducir el juego al inglés con el archivo de idioma de la fase 14.
Selector de idioma en el menú (guardado), por defecto el del navegador. Los nombres de las grúas no cambian.
```

Para revisar: el juego entero en inglés sin textos sueltos en español; el español sigue igual.

---

## Fase 30 (opcional): Tándem cooperativo local

```
Lee CLAUDE.md. Fase 30: dos jugadores en el mismo ordenador, cada uno con su grúa.

1. Jugador 1 con teclado (o mando 1) y jugador 2 con mando 2; cada uno maneja una grúa del tándem a la vez
   (hoy Tab cambia de grúa).
2. Pantalla dividida (dos cámaras) o una cámara compartida que encuadra las dos; mide el coste: dibujar dos
   vistas casi duplica el render. En calidad baja/media, sombras compartidas o sin sombras en la segunda.
3. El nivel 14 y la prueba libre en tándem en modo cooperativo, con el señalero dando órdenes a los dos.

Antes de programar, dime el plan y el coste medido en la laptop.
```

Para revisar: dos personas terminan el nivel 14 juntas; con pantalla dividida sigue a 60 fps (o se dice cuánto da).

---

## Fase 31 (opcional): Récords en línea

```
Lee CLAUDE.md. Fase 31: tabla de récords mundial.

Necesita un servidor (opciones gratuitas: Supabase, Firebase, Cloudflare Workers). Antes de nada,
explícame las opciones, qué datos se guardarían (solo un apodo, sin correo), cómo evitar trampas
(la repetición de la fase 28 permite verificar un récord) y qué cuenta tengo que crear yo.
```

Para revisar: un récord enviado desde un navegador aparece en otro; no se guarda nada personal.

---

## Fase 32 (opcional): Celular y tableta

```
Lee CLAUDE.md. Fase 32: jugar en pantalla táctil (en la fase 11 decidimos no hacerlo; ahora quiero probarlo).

1. Mandos táctiles que no tapen la carga.
2. Calidad baja por defecto en móviles (con la calidad adaptativa de la fase 15).
3. Instalable como app (PWA) y que funcione sin internet después de abrirlo una vez.

Antes de programar, dime el plan.
```

Para revisar: el nivel 1 se termina en un celular; en la laptop no cambia nada.

---

# Bloque C: más trabajos, más máquinas y más jugadores

Ideas para después del bloque B (o antes, si las pruebas con jugadores lo piden). Las cargas difíciles (34) y los accesorios (33)
son las que más realismo dan por menos trabajo.

## Fase 33: Accesorios del gancho

```
Lee CLAUDE.md. Fase 33: herramientas que se cuelgan del gancho en lugar de una eslinga.

1. Sistema de accesorios: se cambian en el suelo (el gancho baja, se suelta uno, se engancha otro), cada uno con
   su masa (cuenta en el LMI) y su colisionador.
2. Bola de demolición: derribar una estructura vieja hecha de piezas con física (se rompen por juntas que ceden
   con el impacto); nivel de demolición con zona de seguridad.
3. Almeja (cuchara bivalva) con la grúa de orugas: abrir/cerrar con una tecla, sacar material de un hoyo y
   cargarlo en un camión (material como muchas esferas pequeñas o un volumen que se vacía; mide el coste).
4. Electroimán: chatarra en un desguace que se pega al imán y cae al cortar la corriente.
5. Pinza para troncos o tubos, y vibrohincador para clavar pilotes (el pilote baja mientras vibra).

Pregúntame masas y medidas de cada accesorio antes de inventarlas. Antes de programar, dime el plan.
```

Para revisar: los accesorios se cambian sin trucos; la demolición no baja de 60 fps en la laptop; la masa del
accesorio se nota en el LMI.

---

## Fase 34: Cargas difíciles

```
Lee CLAUDE.md. Fase 34: cargas que se comportan como las de verdad.

1. Centro de gravedad descentrado: la carga se ladea al despegar; hay que bajarla y enganchar en otro punto
   (varios puntos de enganche marcados) hasta que suba nivelada. La caja de la fase 9 ya se inclina: medir.
2. Peso desconocido: el albarán dice un peso y la carga pesa otro; el jugador lo descubre con la tensión del
   cable y debe abortar si pasa de la capacidad. Penaliza seguir izando con el LMI en rojo.
3. Depósito con líquido: el líquido se mueve al girar y frenar (modelo de péndulo interno que desplaza el CDG,
   no fluidos reales) y empuja la carga.
4. Carga flexible: tubería larga de varios cuerpos unidos con juntas que se dobla si se levanta de un punto;
   con balancín (fase 26) no se dobla.
5. Barcaza con olas: cargar o descargar sobre una base que sube, baja y cabecea.
6. Cambiar los ramales del gancho: más ramales = más capacidad y gancho más lento. La referencia solo los
   dibuja (hookFalls): pregúntame los datos antes de cambiar la capacidad.

Antes de programar, dime el plan.
```

Para revisar: la carga descentrada se nota al despegar y se corrige reenganchando; el peso desconocido se descubre
con la tensión; el depósito empuja al girar rápido.

---

## Fase 35: Trabajos especiales

```
Lee CLAUDE.md. Fase 35: misiones de rescate y de montaje de grúas torre.

1. Rescate: levantar un camión volcado sin dañarlo más (dos puntos de enganche, girarlo con cuidado) y sacar
   un coche de un río (el agua frena y añade peso al salir). Misiones con prisa y tiempo corto.
2. Montar una grúa torre fija por tramos con una grúa móvil: base, tramos de torre, cabeza giratoria,
   contrapluma, contrapeso y pluma, cada pieza en su sitio con tolerancias.
3. Trepado de la grúa torre: subir la grúa tramo a tramo con su jaula de trepado (secuencia de pasos).

La grúa torre fija no está en la referencia: pregúntame medidas y pesos. Antes de programar, dime el plan.
```

Para revisar: la grúa torre montada queda en pie y se puede usar después; el rescate se siente delicado.

---

## Fase 36: Máquinas nuevas

```
Lee CLAUDE.md. Fase 36: otras máquinas de elevación.

Candidatas: grúa articulada sobre camión, manipulador telescópico, grúa pórtico de puerto (contenedores) y
puente grúa en una nave. Ninguna está en la referencia: antes de modelar, dime qué datos necesitas de cada una
(dimensiones, masas, tabla de capacidad o fórmula) y espera a que te los pase. Una máquina por parte, con su
modelo, su estabilidad (pruebas como las de stability.test.ts), sus mandos y un nivel.
```

Para revisar: cada máquina nueva tiene pruebas de estabilidad con mis datos y un nivel jugable.

---

## Fase 37: Ambiente, radio y modo foto

```
Lee CLAUDE.md. Fase 37: ambiente.

1. Nieve y hielo: suelo resbaladizo al conducir (menos agarre), nieve que cae (partículas de la fase 16),
   cargas con hielo que pesan algo más.
2. Radio o música en la cabina: música generada o sin derechos, con volumen y opción de apagarla.
3. Modo foto: pausa, cámara libre, ocultar el HUD, profundidad de campo opcional y guardar una captura (PNG)
   para compartir.

Antes de programar, dime el plan.
```

Para revisar: con hielo se nota al frenar; el modo foto saca capturas limpias.

---

## Fase 38: Modo historia

```
Lee CLAUDE.md. Fase 38: hilo narrativo para la carrera (fase 25).

Una pequeña empresa de grúas: el capataz, el jefe de obra, clientes que llaman. Encargos que crecen de una
City 25 a la LR 3000, con mensajes cortos entre misiones y algún giro (una avería en mal momento, un cliente
con prisa, el gran izaje final). Escríbeme primero el guion (personajes y 10–15 capítulos) para aprobarlo.
```

Para revisar: el guion aprobado se juega de principio a fin; se puede saltar el texto.

---

## Fase 39: Comunidad y distribución

```
Lee CLAUDE.md. Fase 39: llegar a más gente.

1. itch.io: explícame paso a paso cómo crear la cuenta y la página del juego, y prepara un .zip de dist/ que
   funcione allí (rutas relativas, ya están), con capturas y descripción. La acción de GitHub puede generar
   ese .zip en cada versión.
2. Galería de niveles de la comunidad sin servidor: una página del juego con los mejores enlaces del editor
   (fase 28) que yo elijo, guardados en un archivo del repo.
3. Versión de escritorio con Tauri (más ligera que Electron): instalador para Windows. Explícame qué haría
   falta para Steam (costes, requisitos) antes de nada.

Antes de programar, dime el plan.
```

Para revisar: el juego funciona en itch.io igual que en GitHub Pages; el instalador abre el juego sin internet.

---

## Fase 40 (opcional): Realidad virtual

```
Lee CLAUDE.md. Fase 40: vista de cabina en realidad virtual con WebXR (three.js lo soporta).
Mide primero si la laptop llega a los fps que pide unas gafas VR; si no, dímelo antes de seguir. Mandos de
las gafas para las palancas, HUD en la cabina (fase 21).
```

Para revisar: con unas gafas, la cabina se ve estable y sin mareo.

---

## Fase 41 (opcional): Tándem en red

```
Lee CLAUDE.md. Fase 41: dos jugadores en dos casas, cada uno con su grúa del tándem (después del cooperativo
local de la fase 30).

WebRTC entre los dos navegadores; con la física determinista (fase 15) se envían solo las entradas. Hace falta
un servidor mínimo para presentar a los dos jugadores: explícame las opciones gratuitas y qué datos pasan
antes de crear nada.
```

Para revisar: dos personas en redes distintas terminan el nivel 14 sin que las grúas se desincronicen.

---

## Descartado (por ahora)

- **Física en un Web Worker**: la física cuesta ~0,11 ms por paso; no hay nada que ganar y complica todo.
- **Renderer WebGPU de three.js**: arriesgado con gráficas Intel integradas en el navegador. Como mucho, un
  experimento con vuelta a WebGL si algún día hace falta.
