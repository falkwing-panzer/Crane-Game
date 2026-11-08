# Simulador de grúas 3D

Simulador de grúas móviles en 3D que corre en el navegador. Conduces la grúa, la apoyas en sus
estabilizadores, montas el lastre y levantas cargas sin volcar. La estabilidad (vuelco, LMI, capacidad
según radio) se calcula con un modelo analítico como el de una grúa real. El cable, el gancho, la carga y
la caída de la grúa usan física de cuerpos rígidos.

Proyecto personal en desarrollo. Hecho con Vite, TypeScript, [three.js](https://threejs.org) y
[Rapier](https://rapier.rs).

## Cómo correrlo

Necesitas [Node.js](https://nodejs.org) 20 o más nuevo.

```bash
npm install
npm run dev
```

Abre la dirección que muestra Vite (normalmente `http://localhost:5173`). Para elegir la grúa usa el
menú **Grúa** del HUD o la dirección `?grua=id` (por ejemplo `?grua=xl` para la AT 500-8).

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con contador de fps |
| `npm test` | Pruebas (vitest): estabilidad contra la referencia, montajes, conducción, física, modelos |
| `npm run build` | Revisa los tipos y genera la versión publicable en `dist/` |
| `npm run preview` | Sirve la versión de `dist/` |

## Grúas

| Grúa | id | Tipo | Estado |
|---|---|---|---|
| City 25 | `small` | Ruedas, compacta | Jugable |
| AT 60 | `medium` | Ruedas | Jugable |
| RT 90 | `rt` | Todo terreno | Jugable |
| AT 220 | `large` | Ruedas | Jugable |
| AT 300-6 | `at300` | Ruedas, con lastre | Jugable |
| AT 450-8 | `at450` | Ruedas, lastre en torre | Jugable |
| AT 500-8 | `xl` | Ruedas, lastre y Y-guy | Jugable |
| LR 300 | `crawler` | Orugas, pluma de celosía | Jugable |
| LR 3000 | `lr` | Orugas, derrick y superlift | Pendiente (fase 6B) |
| AT 650-8 | `at650` | Ruedas, plumín abatible | Pendiente (fase 7) |
| SK 60 | `sk` | Grúa torre autodesplegable | Pendiente (fase 8) |

## Controles

| Tecla | Acción |
|---|---|
| Flechas | Conducir y dirección |
| A / D | Girar la superestructura |
| W / S | Subir / bajar la pluma |
| Q / E | Telescopar |
| R / F | Subir / bajar el cable |
| Espacio | Enganchar / soltar la carga |
| O | Estabilizadores (no en orugas) |
| B | Lastre |
| Y | Y-guy |
| T / G | Plumín |
| M | Montaje |
| K / L | Radio del superlift |
| Shift | Movimiento fino |
| V | Cámara: orbital → seguimiento → cabina |
| X | Devolver la carga a su sitio (ayuda de prueba) |
| P | Puentear el LMI para probar el vuelco |

## Estructura

```
src/
  crane/     datos de las grúas, estabilidad y LMI, cinemática, conducción, montajes, terreno
  physics/   mundo Rapier: cable, gancho, carga, choques, vuelco
  render/    escena, cámaras y modelos 3D de las grúas
  ui/        teclado y HUD
referencia/  versión anterior en un solo HTML (fuente de datos; no se edita) e imágenes de referencia
```

`FASES.md` tiene el plan por fases y `CLAUDE.md` el estado, las decisiones de diseño y el rendimiento
medido.

## Rendimiento

La meta es 60 fps a 1080p en una laptop con gráfica integrada Intel. Medido hasta ahora: 60 fps con la
AT 500-8 con lastre y Y-guy montados (unas 120 draw calls).

## Plan

Siguen la LR 3000 con superlift, la AT 650-8 con plumín, la grúa torre SK 60, el pulido de los modelos,
los niveles, el izaje en tándem con dos grúas y la versión publicada.
