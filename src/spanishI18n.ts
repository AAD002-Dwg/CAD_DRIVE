import { AcApI18n } from '@mlightcad/cad-simple-viewer';

/**
 * Diccionario de localización al español para mlightcad (comandos, jigs y textos en pantalla)
 */
export function setupSpanishI18n() {
  try {
    AcApI18n.mergeLocaleMessage('en', {
      command: {
        ACAD: {
          line: { description: 'Trazar líneas rectas' },
          circle: { description: 'Crear círculos de referencia' },
          dimlinear: { description: 'Acotar distancia lineal entre dos puntos' },
          revcloud: { description: 'Trazar nube de revisión para auditoría' },
          mtext: { description: 'Insertar texto técnico o nota' },
          pan: { description: 'Desplazar la vista del plano' },
          zoom: { description: 'Acercar o alejar el plano' },
          select: { description: 'Seleccionar elementos del plano' },
          '-layer': { description: 'Gestión de capas' },
          orthomode: { description: 'Activar/desactivar modo ortogonal (90°)' }
        }
      },
      jig: {
        line: {
          startPoint: 'Indique el primer punto de la línea',
          nextPoint: 'Indique el punto siguiente o presione ESC para terminar'
        },
        circle: {
          center: 'Indique el centro del círculo de revisión',
          centerOrOptions: 'Indique el centro del círculo',
          radius: 'Indique el radio del círculo',
          radiusOrDiameter: 'Indique el radio o diámetro'
        },
        dimlinear: {
          firstExtensionLine: 'Indique el primer punto a medir',
          secondExtensionLine: 'Indique el segundo punto a medir',
          dimensionLineLocation: 'Indique la posición de la línea de cota'
        },
        revcloud: {
          startPoint: 'Indique el punto inicial de la nube de revisión',
          guidePoint: 'Mueva el cursor para formar los arcos de la nube'
        }
      },
      main: {
        shortCutToolbar: {
          more: 'Más herramientas',
          expand: 'Expandir',
          collapse: 'Minimizar'
        },
        drawStyle: {
          color: 'Color de trazo',
          fontSize: 'Tamaño de texto'
        },
        colorPicker: {
          title: 'Selector de Color CAD',
          ok: 'Aceptar',
          cancel: 'Cancelar',
          close: 'Cerrar',
          index: 'Índice de color',
          rgb: 'RGB',
          input: 'Entrada directa'
        }
      }
    });
  } catch (err) {
    console.warn('Could not register Spanish i18n:', err);
  }
}
