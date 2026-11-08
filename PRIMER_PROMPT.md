# Primer mensaje para Claude Code

Copia y pega esto en Claude Code después de abrirlo en la carpeta del proyecto:

---

Lee CLAUDE.md y referencia/crane-v20.html. Quiero empezar la versión 3D.

Fase 0 (solo esto, nada más):
1. Crea el proyecto con Vite + TypeScript, three.js y @dimforge/rapier3d-compat.
2. Escena de prueba: suelo, cielo, una luz con sombra, cámara orbital.
3. Una grúa AT 60 simplificada (cajas y cilindros) con las dimensiones de la referencia:
   chasis, 3 ejes con llantas, superestructura que gira, pluma que sube/baja y telescopa.
4. Cable y gancho con Rapier, y una caja de carga que se pueda enganchar.
5. Contador de fps visible.
6. Controles A/D, W/S, Q/E, R/F, Espacio como en la referencia.

Antes de programar, dime el plan en pocos pasos. Cuando termines, dime cómo correrlo
y qué debo revisar para medir el rendimiento en mi laptop.

---

## Fases siguientes (pedir una a la vez)
1. Portar el modelo de estabilidad (tipUtil, LMI, ratedCap) a `src/crane/stability.ts` con pruebas.
2. Estabilizadores y conducción del vehículo.
3. Resto de grúas, empezando por AT 500-8 y RT 90.
4. Niveles 1–13 de la referencia.
5. Montajes (lastre, Y-guy, plumín, grúa torre SK, superlift).
6. Izaje en tándem con dos grúas.
