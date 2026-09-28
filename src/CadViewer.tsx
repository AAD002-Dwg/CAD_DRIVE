import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import {
  AcApDocManager,
  AcEdOpenMode
} from '@mlightcad/cad-simple-viewer';
import {
  AcDbDatabaseConverterManager,
  AcDbFileType
} from '@mlightcad/data-model';
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter';

export interface CadViewerRef {
  zoomExtents: () => void;
  setTool: (tool: 'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'revcloud' | 'photo' | 'comment') => void;
  setOrthoMode: (enabled: boolean) => void;
  cancelCommand: () => void;
  exportDxfBuffer: (pins?: any[]) => Promise<ArrayBuffer | null>;
  exportRevisionDxfBuffer: (pins: any[]) => Promise<ArrayBuffer | null>;
  getLayers: () => Array<{ name: string; color: number; visible: boolean }>;
  toggleLayer: (layerName: string) => void;
  setAllLayersVisible: (visible: boolean) => void;
  createRevisionLayer: (layerName: string, colorIndex?: number) => void;
  getLayouts: () => string[];
  switchLayout: (layoutName: string) => void;
  captureCanvas: () => string | null;
  getCanvasElement: () => HTMLCanvasElement | null;
  screenToWorld: (screenX: number, screenY: number) => { x: number; y: number } | null;
  worldToScreen: (worldX: number, worldY: number) => { x: number; y: number } | null;
  onCameraChange?: (callback: () => void) => () => void;
}

interface CadViewerProps {
  fileData: ArrayBuffer | null;
  fileName: string | null;
  bgColor?: string;
  onLoaded?: () => void;
  onError?: (err: any) => void;
  onCameraUpdate?: () => void;
}


// Register DWG Converter once
let isConverterRegistered = false;
function ensureDwgConverter() {
  if (isConverterRegistered) return;
  try {
    const dwgParserUrl = '/assets/libredwg-parser-worker.js';
    AcDbDatabaseConverterManager.instance.register(
      AcDbFileType.DWG,
      new AcDbLibreDwgConverter({
        convertByEntityType: false,
        useWorker: true,
        parserWorkerUrl: dwgParserUrl
      })
    );
    isConverterRegistered = true;
  } catch (e) {
    console.error('Error registering DWG converter:', e);
  }
}

function buildCompliantDxf(docManager: AcApDocManager | null, pins: any[] = []): ArrayBuffer | null {
  try {
    const doc = docManager?.curDocument;
    const db = doc?.database as any;

    const knownLayers = new Map<string, number>();
    knownLayers.set('0', 7);
    knownLayers.set('REV_MARCAS', 1); // Red
    knownLayers.set('REV_FOTOS', 4);  // Cyan
    knownLayers.set('REV_NOTAS', 2);  // Yellow
    knownLayers.set('REV_MEDIDAS', 3); // Green

    // Extract all layer names and colors from database if present
    try {
      if (db?.tables?.layerTable) {
        for (const lRec of db.tables.layerTable.newIterator()) {
          if (lRec.name) {
            const col = lRec.color?.colorIndex != null ? Math.abs(lRec.color.colorIndex) : 7;
            knownLayers.set(lRec.name, col || 7);
          }
        }
      }
    } catch (layerErr) {
      console.warn('Layer iteration fallback:', layerErr);
    }

    const lines: string[] = [
      '0', 'SECTION',
      '2', 'HEADER',
      '9', '$ACADVER',
      '1', 'AC1014', // AutoCAD R14 / 2000 universal standard (no broken class tables or dictionary handles)
      '9', '$HANDSEED',
      '5', '20000',
      '9', '$DWGCODEPAGE',
      '3', 'ANSI_1252',
      '9', '$INSUNITS',
      '70', '0',
      '9', '$MEASUREMENT',
      '70', '1',
      '9', '$CECOLOR',
      '62', '256',
      '9', '$CLAYER',
      '8', '0',
      '9', '$CELTYPE',
      '6', 'ByLayer',
      '9', '$LTSCALE',
      '40', '1.0',
      '9', '$TEXTSTYLE',
      '7', 'STANDARD',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'TABLES',
      '0', 'TABLE',
      '2', 'VPORT',
      '70', '1',
      '0', 'VPORT',
      '2', '*ACTIVE',
      '70', '0',
      '10', '0.0',
      '20', '0.0',
      '11', '1.0',
      '21', '1.0',
      '12', '0.0',
      '22', '0.0',
      '40', '1000.0',
      '41', '1.4',
      '0', 'ENDTAB',
      '0', 'TABLE',
      '2', 'LTYPE',
      '70', '1',
      '0', 'LTYPE',
      '2', 'CONTINUOUS',
      '70', '0',
      '3', 'Solid line',
      '72', '65',
      '73', '0',
      '40', '0.0',
      '0', 'ENDTAB',
      '0', 'TABLE',
      '2', 'LAYER',
      '70', String(knownLayers.size)
    ];

    // Write all registered layers
    for (const [lName, lColor] of knownLayers.entries()) {
      lines.push(
        '0', 'LAYER',
        '2', lName,
        '70', '0',
        '62', String(lColor),
        '6', 'CONTINUOUS'
      );
    }
    lines.push('0', 'ENDTAB');

    lines.push(
      '0', 'TABLE',
      '2', 'STYLE',
      '70', '1',
      '0', 'STYLE',
      '2', 'STANDARD',
      '70', '0',
      '40', '0.0',
      '41', '1.0',
      '50', '0.0',
      '71', '0',
      '42', '2.5',
      '3', 'txt',
      '4', '',
      '0', 'ENDTAB',
      '0', 'TABLE',
      '2', 'APPID',
      '70', '1',
      '0', 'APPID',
      '2', 'ACAD',
      '70', '0',
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'BLOCKS',
      '0', 'ENDSEC',
      '0', 'SECTION',
      '2', 'ENTITIES'
    );

    // 1. Export all drawn entities in the active CAD database (Lines, Circles, Arcs, Polylines, Text, Dimensions, etc.)
    try {
      if (db?.tables?.blockTable) {
        for (const btr of db.tables.blockTable.newIterator()) {
          if (btr.isModelSapce || btr.isModelSpace) {
            for (const entity of btr.newIterator()) {
              const entLayer = entity.layer || 'REV_MARCAS';
              const entColor = entity.color?.colorIndex != null ? String(Math.abs(entity.color.colorIndex)) : '256';

              if (entity.dxfTypeName === 'LINE') {
                lines.push(
                  '0', 'LINE',
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.startPoint?.x ?? 0),
                  '20', String(entity.startPoint?.y ?? 0),
                  '30', String(entity.startPoint?.z ?? 0),
                  '11', String(entity.endPoint?.x ?? 0),
                  '21', String(entity.endPoint?.y ?? 0),
                  '31', String(entity.endPoint?.z ?? 0)
                );
              } else if (entity.dxfTypeName === 'CIRCLE') {
                lines.push(
                  '0', 'CIRCLE',
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.center?.x ?? 0),
                  '20', String(entity.center?.y ?? 0),
                  '30', String(entity.center?.z ?? 0),
                  '40', String(entity.radius ?? 1)
                );
              } else if (entity.dxfTypeName === 'ARC') {
                lines.push(
                  '0', 'ARC',
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.center?.x ?? 0),
                  '20', String(entity.center?.y ?? 0),
                  '30', String(entity.center?.z ?? 0),
                  '40', String(entity.radius ?? 1),
                  '50', String((entity.startAngle ?? 0) * 180 / Math.PI),
                  '51', String((entity.endAngle ?? Math.PI * 2) * 180 / Math.PI)
                );
              } else if (entity.dxfTypeName === 'LWPOLYLINE' || entity.dxfTypeName === 'POLYLINE') {
                const vertices = entity.vertices || [];
                lines.push(
                  '0', 'LWPOLYLINE',
                  '8', entLayer,
                  '62', entColor,
                  '90', String(vertices.length),
                  '70', entity.isClosed ? '1' : '0'
                );
                for (const v of vertices) {
                  lines.push('10', String(v.x ?? v.position?.x ?? 0), '20', String(v.y ?? v.position?.y ?? 0));
                  if (v.bulge != null && v.bulge !== 0) {
                    lines.push('42', String(v.bulge));
                  }
                }
              } else if (entity.dxfTypeName === 'MTEXT' || entity.dxfTypeName === 'TEXT') {
                lines.push(
                  '0', 'TEXT',
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.location?.x ?? entity.position?.x ?? 0),
                  '20', String(entity.location?.y ?? entity.position?.y ?? 0),
                  '30', String(entity.location?.z ?? entity.position?.z ?? 0),
                  '40', String(entity.textHeight ?? entity.height ?? 2.5),
                  '1', String(entity.text || entity.contents || ''),
                  '7', 'STANDARD'
                );
              } else if (entity.dxfTypeName === 'POINT') {
                lines.push(
                  '0', 'POINT',
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.position?.x ?? entity.location?.x ?? 0),
                  '20', String(entity.position?.y ?? entity.location?.y ?? 0),
                  '30', String(entity.position?.z ?? entity.location?.z ?? 0)
                );
              } else if (entity.dxfTypeName === 'ELLIPSE') {
                lines.push(
                  '0', 'ELLIPSE',
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.center?.x ?? 0),
                  '20', String(entity.center?.y ?? 0),
                  '30', String(entity.center?.z ?? 0),
                  '11', String(entity.majorAxis?.x ?? 1),
                  '21', String(entity.majorAxis?.y ?? 0),
                  '31', String(entity.majorAxis?.z ?? 0),
                  '40', String(entity.radiusRatio ?? 0.5),
                  '41', String(entity.startParam ?? 0),
                  '42', String(entity.endParam ?? (Math.PI * 2))
                );
              } else if (entity.dxfTypeName === 'SOLID' || entity.dxfTypeName === '3DFACE') {
                lines.push(
                  '0', entity.dxfTypeName,
                  '8', entLayer,
                  '62', entColor,
                  '10', String(entity.firstCorner?.x ?? 0),
                  '20', String(entity.firstCorner?.y ?? 0),
                  '30', String(entity.firstCorner?.z ?? 0),
                  '11', String(entity.secondCorner?.x ?? 0),
                  '21', String(entity.secondCorner?.y ?? 0),
                  '31', String(entity.secondCorner?.z ?? 0),
                  '12', String(entity.thirdCorner?.x ?? 0),
                  '22', String(entity.thirdCorner?.y ?? 0),
                  '32', String(entity.thirdCorner?.z ?? 0),
                  '13', String(entity.fourthCorner?.x ?? entity.thirdCorner?.x ?? 0),
                  '23', String(entity.fourthCorner?.y ?? entity.thirdCorner?.y ?? 0),
                  '33', String(entity.fourthCorner?.z ?? entity.thirdCorner?.z ?? 0)
                );
              }
            }
          }
        }
      }
    } catch (iterErr) {
      console.warn('Entity iteration fallback:', iterErr);
    }

    // 2. Export all Photo Pins and Comment Notes with clear labels
    if (pins && pins.length > 0) {
      for (const pin of pins) {
        const isPhoto = pin.type === 'photo';
        const layer = isPhoto ? 'REV_FOTOS' : 'REV_NOTAS';
        const color = isPhoto ? '4' : '2';
        const title = isPhoto ? `FOTO: ${pin.author}` : `NOTA: ${pin.author}`;
        const noteClean = (pin.note || '').replace(/[\r\n]+/g, ' ');

        // Marker Circle
        lines.push(
          '0', 'CIRCLE',
          '8', layer,
          '62', color,
          '10', String(pin.worldX),
          '20', String(pin.worldY),
          '30', '0.0',
          '40', '3.0'
        );

        // Center Point
        lines.push(
          '0', 'POINT',
          '8', layer,
          '62', color,
          '10', String(pin.worldX),
          '20', String(pin.worldY),
          '30', '0.0'
        );

        // Annotation Text
        lines.push(
          '0', 'TEXT',
          '8', layer,
          '62', color,
          '10', String(pin.worldX + 4.0),
          '20', String(pin.worldY + 4.0),
          '30', '0.0',
          '40', '2.5',
          '1', `${title} | ${pin.timestamp} | ${noteClean}`,
          '7', 'STANDARD'
        );
      }
    }

    lines.push('0', 'ENDSEC', '0', 'EOF');
    const dxfStr = lines.join('\r\n');
    const encoder = new TextEncoder();
    const u8 = encoder.encode(dxfStr);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  } catch (e) {
    console.error('Error generating compliant DXF:', e);
    return null;
  }
}


export const CadViewer = forwardRef<CadViewerRef, CadViewerProps>(({ fileData, fileName, bgColor = '#111827', onLoaded, onError }, ref) => {

  const containerRef = useRef<HTMLDivElement>(null);
  const docManagerRef = useRef<AcApDocManager | null>(null);
  const [layers, setLayers] = useState<Array<{ name: string; color: number; visible: boolean }>>([]);
  const [layouts, setLayouts] = useState<string[]>(['Model']);
  const [activeLayout, setActiveLayout] = useState<string>('Model');

  useEffect(() => {
    ensureDwgConverter();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let manager: AcApDocManager | undefined;
    try {
      const workerUrls = {
        dwgParser: '/assets/libredwg-parser-worker.js',
        mtextRender: '/assets/mtext-renderer-worker.js'
      };

      manager = AcApDocManager.createInstance({
        container: containerRef.current,
        autoResize: true,
        webworkerFileUrls: workerUrls
      });
      docManagerRef.current = manager || null;
    } catch (e) {
      console.warn('DocManager instance might already exist:', e);
      docManagerRef.current = AcApDocManager.instance;
    }
  }, []);

  useEffect(() => {
    if (!fileData || !fileName || !docManagerRef.current) return;

    const loadDocument = async () => {
      try {
        const mgr = docManagerRef.current!;
        // Open document in WRITE mode so drawing tools work!
        const success = await mgr.openDocument(fileName, fileData, {
          mode: AcEdOpenMode.Write
        });

        if (success) {
          if (onLoaded) onLoaded();
          refreshLayers();
          refreshLayouts();
        } else {
          if (onError) onError('No se pudo abrir el archivo CAD.');
        }
      } catch (err) {
        console.error('Error opening CAD document:', err);
        if (onError) onError(err);
      }
    };

    loadDocument();
  }, [fileData, fileName]);

  const refreshLayers = () => {
    if (!docManagerRef.current?.curDocument) return;
    try {
      const doc = docManagerRef.current.curDocument;
      if (doc.layerService) {
        const summaries = doc.layerService.getLayerSummaries();
        const layerList = summaries.map((s) => {
          let c = 0xffffff;
          if (typeof s.color === 'string') {
            c = parseInt(s.color.replace('#', ''), 16) || 0xffffff;
          } else if (typeof s.color === 'number') {
            c = s.color;
          }
          return {
            name: s.name,
            color: c,
            visible: s.on.toLowerCase() === 'yes'
          };
        });
        setLayers(layerList);
        return;
      }
    } catch (e) {
      console.warn('Falling back to database layer table:', e);
    }

    try {
      const db = docManagerRef.current.curDocument.database as any;
      const layerTable = db?.tables?.layerTable || db?.layerTable;
      const layerList: Array<{ name: string; color: number; visible: boolean }> = [];
      
      if (layerTable && layerTable.records) {
        for (const record of layerTable.records) {
          layerList.push({
            name: record.name || '0',
            color: record.color?.color || 0xffffff,
            visible: !record.isOff
          });
        }
      }
      setLayers(layerList);
    } catch (e) {
      console.error('Error fetching layers:', e);
    }
  };

  const refreshLayouts = () => {
    if (!docManagerRef.current?.curDocument) return;
    try {
      const db = docManagerRef.current.curDocument.database as any;
      const layoutDict = db?.objects?.layout;
      const names: string[] = [];

      if (layoutDict && layoutDict.records) {
        for (const record of layoutDict.records) {
          if (record && record.layoutName) {
            names.push(record.layoutName);
          }
        }
      }
      if (names.length > 0) {
        // Sort with 'Model' first
        names.sort((a, b) => {
          if (a.toLowerCase() === 'model') return -1;
          if (b.toLowerCase() === 'model') return 1;
          return a.localeCompare(b);
        });
        setLayouts(names);
      }
    } catch (e) {
      console.error('Error refreshing layouts:', e);
    }
  };

  // Sync background color with WebGL canvas
  useEffect(() => {
    if (!docManagerRef.current?.curView || !bgColor) return;
    try {
      const hex = bgColor.replace('#', '');
      const colorNum = parseInt(hex, 16);
      if (!isNaN(colorNum)) {
        docManagerRef.current.curView.backgroundColor = colorNum;
      }
    } catch (e) {
      console.warn('Error updating canvas background color:', e);
    }
  }, [bgColor]);

  useImperativeHandle(ref, () => ({
    zoomExtents: () => {
      if (!docManagerRef.current) return;
      try {
        docManagerRef.current.sendStringToExecute('zoom e');
      } catch (e) {
        console.error(e);
      }
    },
    cancelCommand: () => {
      if (!docManagerRef.current) return;
      try {
        docManagerRef.current.sendStringToExecute('^C^C');
      } catch (e) {
        console.error('Error cancelling command:', e);
      }
    },
    setOrthoMode: (enabled: boolean) => {
      if (!docManagerRef.current) return;
      try {
        docManagerRef.current.sendStringToExecute(enabled ? 'orthomode 1 ' : 'orthomode 0 ');
      } catch (e) {
        console.error('Error setting ortho mode:', e);
      }
    },
    setTool: (tool) => {
      if (!docManagerRef.current) return;
      try {
        switch (tool) {
          case 'pan':
            docManagerRef.current.sendStringToExecute('pan');
            break;
          case 'zoom':
            docManagerRef.current.sendStringToExecute('zoom');
            break;
          case 'select':
            docManagerRef.current.sendStringToExecute('select');
            break;
          case 'line':
            docManagerRef.current.sendStringToExecute('line');
            break;
          case 'circle':
            docManagerRef.current.sendStringToExecute('circle');
            break;
          case 'mtext':
            docManagerRef.current.sendStringToExecute('mtext');
            break;
          case 'dimension':
            // Configure compact, proportional dimension style (text height 2.5, arrow size 2.5, scale 1.0)
            docManagerRef.current.sendStringToExecute('dimtxt 2.5 dimasz 2.5 dimscale 1.0 dimdec 2 dimlinear ');
            break;
          case 'revcloud':
            docManagerRef.current.sendStringToExecute('revcloud');
            break;
        }
      } catch (e) {
        console.error('Error setting tool:', e);
      }
    },
    createRevisionLayer: (layerName: string, colorIndex = 1) => {
      if (!docManagerRef.current?.curDocument) return;
      try {
        // Create or switch to revision layer with specified color
        docManagerRef.current.sendStringToExecute(`-layer m "${layerName}" c ${colorIndex} "${layerName}"  `);
        setTimeout(() => refreshLayers(), 300);
      } catch (e) {
        console.error('Error creating revision layer:', e);
      }
    },
    exportDxfBuffer: async (pins: any[] = []) => {
      return buildCompliantDxf(docManagerRef.current, pins);
    },
    exportRevisionDxfBuffer: async (pins: any[]) => {
      return buildCompliantDxf(docManagerRef.current, pins);
    },

    screenToWorld: (screenX: number, screenY: number) => {
      if (!docManagerRef.current) return null;
      try {
        const view = docManagerRef.current.curView || (docManagerRef.current.curDocument as any)?.view;
        if (view && typeof view.screenToWorld === 'function') {
          const pt = view.screenToWorld({ x: screenX, y: screenY });
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number' && !isNaN(pt.x) && !isNaN(pt.y)) {
            return { x: pt.x, y: pt.y };
          }
        }
      } catch (e) {
        console.error('Error in screenToWorld:', e);
      }
      return null;
    },
    worldToScreen: (worldX: number, worldY: number) => {
      if (!docManagerRef.current) return null;
      try {
        const view = docManagerRef.current.curView || (docManagerRef.current.curDocument as any)?.view;
        if (view && typeof view.worldToScreen === 'function') {
          const pt = view.worldToScreen({ x: worldX, y: worldY });
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number' && !isNaN(pt.x) && !isNaN(pt.y)) {
            return { x: pt.x, y: pt.y };
          }
        }
      } catch (e) {
        console.error('Error in worldToScreen:', e);
      }
      return null;
    },
    getLayers: () => layers,
    toggleLayer: (layerName: string) => {
      if (!docManagerRef.current?.curDocument) return;
      try {
        const doc = docManagerRef.current.curDocument;
        if (doc.layerService) {
          const layer = layers.find(l => l.name === layerName);
          if (layer) {
            doc.layerService.setLayerOn(layerName, !layer.visible);
            refreshLayers();
            return;
          }
        }
      } catch (e) {
        console.error('Error toggling layer:', e);
      }
    },
    setAllLayersVisible: (visible: boolean) => {
      if (!docManagerRef.current?.curDocument) return;
      try {
        const doc = docManagerRef.current.curDocument;
        if (doc.layerService) {
          layers.forEach(layer => {
            doc.layerService.setLayerOn(layer.name, visible);
          });
          refreshLayers();
        }
      } catch (e) {
        console.error('Error setting all layers visibility:', e);
      }
    },
    getLayouts: () => layouts,
    switchLayout: (layoutName: string) => {
      if (!docManagerRef.current) return;
      try {
        setActiveLayout(layoutName);
        docManagerRef.current.sendStringToExecute(`ctab ${layoutName}`);
      } catch (e) {
        console.error('Error switching layout:', e);
      }
    },
    captureCanvas: () => {
      if (!containerRef.current) return null;
      const canvas = containerRef.current.querySelector('canvas');
      if (!canvas) return null;
      try {
        return canvas.toDataURL('image/png');
      } catch (e) {
        console.error('Error capturing canvas:', e);
        return null;
      }
    },
    getCanvasElement: () => {
      return containerRef.current?.querySelector('canvas') || null;
    }
  }));



  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: bgColor }}>
      <div 
        ref={containerRef} 
        className="viewer-canvas-wrapper" 
        style={{ width: '100%', height: '100%', position: 'relative' }} 
      />
      {/* Layout Tabs (Model / Presentaciones) */}
      {layouts.length > 1 && (
        <div className="layout-tabs">
          {layouts.map((name) => (
            <button
              key={name}
              className={`layout-tab ${activeLayout === name ? 'active' : ''}`}
              onClick={() => {
                setActiveLayout(name);
                docManagerRef.current?.sendStringToExecute(`ctab ${name}`);
              }}
            >
              {name === 'Model' ? '📐 Model' : `📄 ${name}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

