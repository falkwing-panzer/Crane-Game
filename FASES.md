# Fases del juego-gruas — prompts para Claude Code

Cómo usar este archivo:
- Una fase a la vez. Antes de cada fase escribe `/clear` y luego pega el prompt.
- Al terminar cada fase: prueba con `npm run dev`, revisa la lista "Para revisar", y si está bien escribe **"haz commit"**.
- Si algo falla, descríbelo con lo que ves ("la pluma atraviesa el chasis", "baja a 25 fps al girar") antes de pasar a la siguiente fase.
- Si una fase sale muy grande, pídele que la divida: "hazlo en dos partes, primero X".

---

## Fase 1 — Estabilidad y LMI (la lógica, sin gráficos)

```
Lee CLAUDE.md. Fase 1: portar la lógica de estabilidad de referencia/crane-v20.html.

1. Crea src/crane/cranes.ts con los datos de TODAS las grúas del objeto CRANES de la referencia,
   con tipos TypeScript (interface CraneSpec). Copia los números tal cual, no los cambies.
2. Crea src/crane/stability.ts portando: structCap (incluido yNoGuy y la curva de la torre),
   reach, supportRect, craneMasses (con jib, derrick, superlift como masa "solo restaura"),
   tipUtil, lmiStatic, ratedCap y los factores KF.
3. Pruebas con vitest: para 4–5 casos (AT 60 con estabilizadores, AT 60 sobre ruedas,
   AT 500-8 con y sin Y-guy, LR 3000 con superlift) ejecuta la función de la referencia y la nueva
   y comprueba que dan el mismo resultado (tolerancia 1e-6).
   Para obtener los valores de la referencia puedes extraer el bloque de funciones del HTML a un
   script temporal de Node.
4. Conecta el LMI a la demo: muestra en pantalla % de LMI, capacidad nominal (t) y radio (m)
   para la AT 60 de la Fase 0.

No cambies el render ni la física de la demo salvo para mostrar esos datos.
Antes de programar, dime el plan.
```

Para revisar: `npm test` pasa; el LMI sube al bajar la pluma o alargarla; con la carga pesada pasa de 100 %.

---

## Fase 2 — Estabilizadores, límites del LMI y vuelco

```
Lee CLAUDE.md. Fase 2, sobre la AT 60:

1. Estabilizadores con la tecla O: animación de vigas que salen y gatos que bajan, el chasis se
   levanta un poco. Mientras no estén puestos se usa el modo "tire" (KF 0.66); puestos, "out".
2. LMI con cortes como en la referencia (función guard): a 90 % aviso amarillo, a 100 % se bloquean
   los movimientos que aumentan el momento (bajar pluma, telescopar afuera, subir carga), pero se
   permiten los que lo reducen.
3. Vuelco: si la utilización real pasa de 1 (por ejemplo con estabilizadores recogidos y carga
   colgando), la grúa se vuelca. Detecta el vuelco con el modelo analítico y a partir de ahí
   deja que Rapier haga la caída del cuerpo de la grúa. Mensaje de "Grúa volcada" y botón reiniciar.
4. Usa la tensión real del cable (Rapier) para el momento de la carga, así un balanceo fuerte
   o un tirón también cuentan.

Antes de programar, dime el plan.
```

Para revisar: sin estabilizadores la capacidad baja; el LMI bloquea pero deja recoger; volcar se ve creíble y no tiembla.

---

## Fase 3 — Conducción

```
Lee CLAUDE.md. Fase 3: conducción de la AT 60.

1. Flechas: acelerar/frenar y dirección. Dirección en todos los ejes como en la referencia
   (allSteer), con el radio de giro que salga de wheelbase y steerMax.
2. No se puede conducir con estabilizadores puestos.
3. Se puede conducir con carga colgando (pick & carry) pero con KF "move" (0.45) y velocidad limitada.
4. Llantas que giran y se orientan. Suspensión simple (puede ser visual).
5. Cámara que sigue a la grúa (tecla V cambia entre orbital libre, seguimiento y vista de cabina).

Usa un controlador cinemático o el vehicle controller de Rapier, lo que sea más estable;
explícame por qué elegiste uno.
Antes de programar, dime el plan.
```

Para revisar: se maneja fluido; no atraviesa obstáculos; con carga y curva cerrada el LMI sube.

---

## Fase 4 — Modelos 3D de las grúas (parte 1: móviles de ruedas)

```
Lee CLAUDE.md. Fase 4: modelos 3D detallados.

Crea src/render/models/ con un generador de modelo por grúa a partir de cranes.ts.
Usa como guía la función craneModel de la referencia (chasis estilo europeo: cabina baja y
plana delante del primer eje, motor bajo la cubierta, guardabarros, cajas de estabilizadores
con franjas de peligro, pluma telescópica por secciones, cabezal con poleas, gancho con poleas).

Haz en esta fase: City 25, AT 60, RT 90, AT 220, AT 300-6, AT 450-8 y AT 500-8.
- Llantas con InstancedMesh.
- Materiales compartidos (amarillo grúa, gris, negro, cristal).
- Selector de grúa en un menú simple para probarlas.
- Mide los fps con la AT 500-8 y dímelos.

Antes de programar, dime el plan.
```

Para revisar: proporciones correctas comparadas con la referencia; nada atraviesa nada; fps estables.

---

## Fase 5 — Lastre y Y-guy

```
Lee CLAUDE.md. Fase 5: montajes de las grúas grandes.

1. Lastre (tecla B): montaje del contrapeso por fases como en la referencia (toggleBallast);
   sin lastre la capacidad es menor y no se puede levantar ciertas cargas.
2. Y-guy (tecla Y) para AT 500-8 y AT 650-8: despliegue por fases (yGuyModel y toggleYGuy en la
   referencia), con cables de arriostramiento visibles; afecta structCap mediante yNoGuy.
3. Bloqueo de funciones mientras se monta (como "assembling" en la referencia).
4. Indicadores en el HUD de cada montaje.

Antes de programar, dime el plan.
```

---

## Fase 6 — Grúas de orugas y superlift

```
Lee CLAUDE.md. Fase 6: LR 300 y LR 3000.

1. Modelos de orugas con pluma de celosía (usa InstancedMesh para las barras de celosía).
2. Conducción sobre orugas (giro en el sitio), modos KF crawler / crawlMove.
3. LR 3000: derrick, mástil y carro de superlift con radio ajustable (teclas K/L) entre rMin y rMax;
   el superlift solo restaura (no vuelca hacia atrás) como en la referencia.
4. Terreno blando: las orugas reparten mejor la presión que los gatos.

Antes de programar, dime el plan. Mide fps con la LR 3000 y dímelos.
```

---

## Fase 7 — Plumín abatible (AT 650-8)

```
Lee CLAUDE.md. Fase 7: AT 650-8 con plumín abatible.

1. Modelo de la AT 650-8.
2. Montaje del plumín (tecla M) por fases: el plumín se ensambla en el suelo, se fija a la cabeza
   de la pluma y se levanta. Usa la lógica de jibDef, jibRel y el montaje "jg" de la referencia.
3. Teclas T/G para el ángulo del plumín; capacidad limitada por jibDef.cap.
4. Colisiones del plumín con el entorno durante el montaje.

Antes de programar, dime el plan.
```

---

## Fase 8 — Grúa torre autodesplegable (SK 60)

```
Lee CLAUDE.md. Fase 8: SK 60 (grúa móvil que se convierte en torre).

1. Modelo del camión y de la torre de celosía con pluma horizontal y carro (trolley).
2. Erección por fases (tecla M) siguiendo towerGeom de la referencia: levantar torre,
   telescopar, desplegar pluma. Al recoger, al revés.
3. En modo torre: Q/E mueve el carro, A/D gira, R/F cable. Capacidad según la curva de la torre
   en structCap.

Antes de programar, dime el plan.
```

---

## Fase 9 — Niveles

```
Lee CLAUDE.md. Fase 9: niveles.

1. Porta los 13 niveles de LEVELS de la referencia a src/levels/ (posición de la grúa, obstáculos,
   líneas eléctricas, terreno blando, viento, cargas, zonas de destino, tiempo).
2. Pantalla de selección de nivel y ficha de briefing (como showBrief en la referencia).
3. Condiciones de victoria y fallo (checkWin, fail): carga en zona, velocidad de aterrizaje,
   cargas frágiles, contacto con líneas eléctricas, vuelco.
4. Guarda el mejor tiempo por nivel en localStorage.
5. Haz un test automático (Playwright o un script) que compruebe que cada nivel carga sin errores.

Antes de programar, dime el plan.
```

---

## Fase 10 — Izaje en tándem (dos grúas)

```
Lee CLAUDE.md. Fase 10: izaje en tándem.

1. Una carga larga (viga o columna) con dos puntos de enganche, uno por grúa.
2. El jugador cambia de grúa activa con Tab; la otra mantiene su posición.
3. Reparto de carga real según la geometría y la tensión de cada cable (Rapier); cada grúa tiene
   su propio LMI con esa parte de la carga.
4. Fallo si una grúa se sobrecarga o la carga se inclina más de un límite.
5. Un nivel nuevo de tándem: levantar y girar una columna de destilación entre dos grúas
   (por ejemplo LR 3000 como principal y AT 500-8 de cola).

Antes de programar, dime el plan y qué simplificaciones vas a hacer.
```

---

## Fase 11 — Pulido y rendimiento

```
Lee CLAUDE.md. Fase 11: pulido.

1. Perfila el rendimiento en el peor nivel; dime dónde se va el tiempo y optimiza
   (instancing, sombras, menos draw calls).
2. Menú de calidad gráfica (bajo/medio/alto).
3. Sonidos simples (motor, cable, alarma del LMI).
4. Controles táctiles o de mando si es sencillo.
5. Revisa que no haya errores en consola en ningún nivel.

Antes de programar, dime el plan.
```

---

## Fase 12 — Publicarlo

```
Lee CLAUDE.md. Fase 12: publicar el juego.

Ayúdame a subir el proyecto a GitHub y publicarlo gratis (GitHub Pages, Netlify o Vercel,
dime cuál conviene) para tener un enlace que pueda compartir. Explícame cada paso,
yo nunca lo he hecho.
```
