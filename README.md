# Simulador de grúas 3D

Simulador de grúas móviles en 3D que corre en el navegador. Conduces la grúa, la apoyas en sus
estabilizadores, montas el lastre y levantas cargas sin volcar. La estabilidad (vuelco, LMI, capacidad
según radio) se calcula con un modelo analítico como el de una grúa real. El cable, el gancho, la carga y
la caída de la grúa usan física de cuerpos rígidos.

Tiene 13 niveles: trabajos de obra con cargas, zonas de destino, viento, líneas eléctricas, terreno blando
y límite de tiempo, y una prueba libre para manejar cualquier grúa sin objetivo.

Proyecto personal en desarrollo. Hecho con Vite, TypeScript, [three.js](https://threejs.org) y
[Rapier](https://rapier.rs).

## Cómo correrlo

Necesitas [Node.js](https://nodejs.org) 20 o más nuevo.

```bash
npm install
npm run dev
```

Abre la dirección que muestra Vite (normalmente `http://localhost:5173`). Se abre el menú de niveles.

| Dirección | Qué abre |
|---|---|
| `/` | Menú de niveles, con las estrellas y el récord de cada uno |
| `?nivel=3` | El nivel 3 con su grúa recomendada |
| `?nivel=3&grua=at300` | El nivel 3 con otra grúa permitida |
| `?grua=xl` o `?libre=1` | Prueba libre (por ejemplo `?grua=xl` para la AT 500-8) |

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con contador de fps |
| `npm test` | Pruebas (vitest): estabilidad y niveles contra la referencia, montajes, conducción, física, modelos |
| `npm run build` | Revisa los tipos y genera la versión publicable en `dist/` |
| `npm run preview` | Sirve la versión de `dist/` |

## Niveles

Cada nivel empieza con una ficha: el trabajo, consejos, viento, tiempo de referencia (par) y la elección de
grúa (las que no sirven aparecen desactivadas con el motivo). El turno empieza al pulsar **Empezar turno**.

| # | Nivel | Tipo | Grúa recomendada |
|---|---|---|---|
| 1 | Patio de contenedores | Básico | AT 60 |
| 2 | Calle estrecha | Urbano | City 25 |
| 3 | Subestación | Eléctrico | AT 220 |
| 4 | Puente sobre el río | Infraestructura | AT 220 |
| 5 | Torre de telecomunicaciones | Precisión | AT 60 |
| 6 | Fachada de vidrio | Viento | AT 60 |
| 7 | Pick & carry en el barro | Orugas | LR 300 |
| 8 | Descarga contrarreloj | Contrarreloj | City 25 |
| 9 | Reactor de refinería | Izaje pesado | AT 500-8 |
| 10 | Enfriadora en azotea | Gran altura | AT 500-8 |
| 11 | Sobre la nave | Plumín abatible | AT 650-8 |
| 12 | Patio interior | Grúa torre | SK 60 |
| 13 | Columna de destilación | Izaje extremo | LR 3000 |

- **Se gana** cuando todas las cargas quedan sueltas y quietas dentro de su zona.
- **Se pierde** si la grúa vuelca, si el equipo invade la distancia mínima de una línea eléctrica, si se rompe una
  carga frágil (vidrio que toca a más de 0,5 m/s) o si se acaba el tiempo.
- **Estrellas:** 3, menos una por aterrizajes duros (más de 1,4 m/s), otra por golpes o alarmas de línea y otra por
  pasarse del par. El mejor tiempo y las mejores estrellas se guardan en el navegador.

## Grúas

| Grúa | id | Tipo |
|---|---|---|
| City 25 | `small` | Ruedas, compacta |
| AT 60 | `medium` | Ruedas |
| RT 90 | `rt` | Todo terreno |
| AT 220 | `large` | Ruedas |
| AT 300-6 | `at300` | Ruedas, con lastre |
| AT 450-8 | `at450` | Ruedas, lastre en torre |
| AT 500-8 | `xl` | Ruedas, lastre y Y-guy |
| AT 650-8 | `at650` | Ruedas, lastre, Y-guy y plumín abatible |
| LR 300 | `crawler` | Orugas, pluma de celosía |
| LR 3000 | `lr` | Orugas, derrick y superlift |
| SK 60 | `sk` | Grúa torre autodesplegable sobre camión |

Las 11 son jugables, en los niveles y en la prueba libre.

## Controles

| Tecla | Acción |
|---|---|
| Flechas | Conducir y dirección |
| A / D | Girar la superestructura |
| W / S | Subir / bajar la pluma |
| Q / E | Telescopar (en la grúa torre, mover el carro) |
| R / F | Subir / bajar el cable |
| Espacio | Enganchar / soltar la carga |
| O | Estabilizadores (no en orugas) |
| B | Lastre |
| Y | Y-guy |
| T / G | Plumín |
| M | Montaje (plumín o grúa torre) |
| K / L | Radio del superlift |
| Shift | Movimiento fino |
| V | Cámara: orbital → seguimiento → cabina |
| X | Devolver la carga a su sitio (solo en la prueba libre) |
| P | Puentear el LMI para probar el vuelco (solo en la prueba libre) |

## Estructura

```
src/
  crane/     datos de las grúas, estabilidad y LMI, cinemática, conducción, montajes, terreno
  physics/   mundo Rapier: cable, gancho, carga, choques, vuelco, viento, aterrizajes
  levels/    los 13 niveles, su armado y sus reglas (viento, líneas eléctricas)
  render/    escena, cámaras, escenario de los niveles y modelos 3D de las grúas
  ui/        teclado, HUD, menú y fichas de los niveles
referencia/  versión anterior en un solo HTML (fuente de datos; no se edita) e imágenes de referencia
```

`FASES.md` tiene el plan por fases y `CLAUDE.md` el estado, las decisiones de diseño y el rendimiento
medido.

## Rendimiento

La meta es 60 fps a 1080p en una laptop con gráfica integrada Intel, con menos de unas 150 draw calls.
Medido en la laptop: 60 fps con todas las grúas y sus detalles. En los niveles, el peor caso es la AT 650-8
con lastre, Y-guy y plumín montados en el nivel 11: 144 draw calls (los fps en la laptop están pendientes).

## Plan

Siguen el izaje en tándem con dos grúas, el pulido (calidad gráfica, sonidos) y la versión publicada.
