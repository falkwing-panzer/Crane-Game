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
