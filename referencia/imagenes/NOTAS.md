# Referencias visuales (aportadas por Jesús)

Solo como guía de **forma** para pulir los modelos. Los datos de estabilidad siguen saliendo de
`crane-v20.html`. En el juego no se usan nombres de marca (los de las imágenes son de fábrica).

## Sistema de contrapeso (`contrapeso-torres.png`)
- **Bastidor central** que se fija a la cola de la superestructura (en la imagen, base de 10 t).
  Bajo él van piezas de 5 t que hacen de base de cada torre.
- **Dos torres**, una a cada lado del bastidor, con un hueco en el centro (ahí va el cabrestante / el
  bastidor). No es un bloque macizo de todo el ancho.
- Las torres son **placas apiladas de 10 t** de igual planta. Las de la base (gris, "lastre adicional")
  van abajo y las de arriba (amarillo, "lastre básico") encima. En la imagen hay 100 t de base + 40 t
  adicionales = 140 t.
- Planta de cada placa: rectangular con la **esquina exterior trasera achaflanada**; el canto es grueso
  (~0,4–0,5 m por placa).
- Barandillas y escalerillas sobre el bastidor central, entre las torres. Hay una cadena/argolla arriba de
  cada torre para izarla.
- En la AT de 5 ejes (`at5ejes-cotas.webp`), el contrapeso se ve en gris detrás de la superestructura,
  apilado y a la altura del pie de la pluma.
- En la de 8 ejes (`at8ejes-yguy-plumin.png`) el lastre es una **torre alta** detrás de la cola, más
  alta que la cabina del operador.

**Para nuestros modelos:** hoy `ballastPlates` dibuja las placas en un solo bloque detrás del contrapeso
base (AT 300-6, AT 500-8) o como una torre (AT 450-8, AT 650-8). Lo que se pulirá: dos torres
separadas con hueco central, chaflán exterior, bastidor central con barandillas. La masa total y `cwDims`
de la referencia no cambian.

## AT de 5 ejes (`at5ejes-cotas.webp`, `at5ejes-foto.webp`)
Cotas de la imagen (mm): largo total 14 480, voladizo delantero 2 028 + 2 435 hasta el 1.er eje, ejes
2 580 / 1 650 / 2 010 / 1 650, voladizo trasero 2 127; pluma recogida 12 330; giro trasero 3 620.
- Pluma tumbada **sobre la cabina del conductor**, cabeza adelante; motón del gancho colgado y amarrado
  al parachoques delantero.
- Cabina del operador a la izquierda de la pluma; cilindro de elevación detrás de la cabina del conductor.
- Estabilizadores entre ejes 2–3 y detrás del último eje; chasis gris, ruedas grandes con llanta gris.
- (No hay una grúa de 5 ejes en `CRANES`: no se añade sin preguntar.)

## Derrick y superlift (`derrick-superlift.png`)
Mástil derrick detrás de la pluma principal, plumín abatible de celosía, bandeja de superlift **colgada**
del derrick por tirantes detrás de la grúa (separada del contrapeso de la superestructura). Útil para la
LR 3000 (fase 6B) y la AT 650-8.

## AT de 8 ejes (`at8ejes-yguy-plumin.png`)
Y-guy sobre el tramo base, plumín de celosía abatible en la cabeza con sus tirantes, torre de lastre alta
atrás. Referencia para la AT 650-8 (fase 7).

## Modos de dirección (`direccion-modos.png`)
Programas de dirección de un portador de 5 ejes: carretera (ejes traseros activos según velocidad),
todas las ruedas, cangrejo, ejes traseros independientes, y trasero bloqueado/centrado. Ahora la conducción
usa el modelo de bicicleta de la referencia; esto sería una mejora futura (preguntar antes).
