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
  cancelCommand: () => void;
  exportDxfBuffer: () => Promise<ArrayBuffer | null>;
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

function sanitizeDxfHeader(dxfText: string): string {
  const headerStart = dxfText.search(/0\r?\nSECTION\r?\n2\r?\nHEADER/);
  if (headerStart === -1) return dxfText;

  const endSecMatch = dxfText.substring(headerStart).search(/0\r?\nENDSEC/);
  if (endSecMatch === -1) return dxfText;

  const headerEnd = headerStart + endSecMatch;
  const endSecFullMatch = dxfText.substring(headerEnd).match(/^0\r?\nENDSEC\r?\n/);
  const skipLen = endSecFullMatch ? endSecFullMatch[0].length : 8;

  // Extract drawing version or default to modern AutoCAD 2018 (AC1032)
  const verMatch = dxfText.match(/9\r?\n\$ACADVER\r?\n1\r?\n([^\r\n]+)/);
  const acadVer = verMatch ? verMatch[1].trim() : 'AC1032';

  // Extract handseed if available
  const handseedMatch = dxfText.match(/9\r?\n\$HANDSEED\r?\n5\r?\n([^\r\n]+)/);
  const handseed = handseedMatch ? handseedMatch[1].trim() : 'FFFF';

  // Standard, 100% compliant AutoCAD DXF header without unsupported or malformed variables
  const standardHeader = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', acadVer,
    '9', '$HANDSEED',
    '5', handseed,
    '9', '$DWGCODEPAGE',
    '3', 'UTF-8',
    '9', '$INSUNITS',
    '70', '0',
    '9', '$LUNITS',
    '70', '2',
    '9', '$LUPREC',
    '70', '4',
    '9', '$UNITMODE',
    '70', '0',
    '9', '$MEASUREMENT',
    '70', '1',
    '9', '$LTSCALE',
    '40', '1.0',
    '9', '$CELTSCALE',
    '40', '1.0',
    '9', '$CECOLOR',
    '62', '256',
    '9', '$CLAYER',
    '8', '0',
    '9', '$CELTYPE',
    '6', 'ByLayer',
    '9', '$TEXTSTYLE',
    '7', 'Standard',
    '9', '$DIMSTYLE',
    '2', 'Standard',
    '9', '$ANGBASE',
    '50', '0.0',
    '9', '$ANGDIR',
    '70', '0',
    '9', '$AUNITS',
    '70', '0',
    '9', '$AUPREC',
    '70', '0',
    '9', '$EXTMIN',
    '10', '-10000.0',
    '20', '-10000.0',
    '30', '0.0',
    '9', '$EXTMAX',
    '10', '10000.0',
    '20', '10000.0',
    '30', '0.0',
    '9', '$PDMODE',
    '70', '0',
    '9', '$PDSIZE',
    '40', '0.0',
    '9', '$OSMODE',
    '70', '0',
    '9', '$ORTHOMODE',
    '70', '0',
    '0', 'ENDSEC'
  ].join('\r\n');

  const restOfDxf = dxfText.substring(headerEnd + skipLen).replace(/\r?\n/g, '\r\n');
  return standardHeader + '\r\n' + restOfDxf;
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
            docManagerRef.current.sendStringToExecute('dimlinear');
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
    exportDxfBuffer: async () => {
      if (!docManagerRef.current?.curDocument) return null;
      try {
        const doc = docManagerRef.current.curDocument;
        const db = doc.database as any;
        if (db && typeof db.dxfOut === 'function') {
          // Initialize key system variables to prevent missing group codes in AutoCAD
          if (db.angbase == null || isNaN(db.angbase)) db.angbase = 0;
          if (db.angdir == null || isNaN(db.angdir)) db.angdir = 0;
          if (db.aunits == null || isNaN(db.aunits)) db.aunits = 0;
          if (db.auprec == null || isNaN(db.auprec)) db.auprec = 0;
          if (db.insunits == null || isNaN(db.insunits)) db.insunits = 0;
          if (db.lunits == null || isNaN(db.lunits)) db.lunits = 2;
          if (db.luprec == null || isNaN(db.luprec)) db.luprec = 4;
          if (db.unitmode == null || isNaN(db.unitmode)) db.unitmode = 0;
          if (db.measurement == null || isNaN(db.measurement)) db.measurement = 1;
          if (db.ltscale == null || isNaN(db.ltscale)) db.ltscale = 1;
          if (db.celtscale == null || isNaN(db.celtscale)) db.celtscale = 1;
          if (db.cmlscale == null || isNaN(db.cmlscale)) db.cmlscale = 1;
          if (!db.extmin || isNaN(db.extmin.x)) db.extmin = { x: 0, y: 0, z: 0 };
          if (!db.extmax || isNaN(db.extmax.x)) db.extmax = { x: 1000, y: 1000, z: 0 };

          // Export using modern AutoCAD 2018 DXF dialect (AC1032) in ASCII format
          const rawDxf = db.dxfOut(undefined, 6, 'AC1032', { format: 'ascii' });
          let dxfStr = typeof rawDxf === 'string' ? rawDxf : new TextDecoder().decode(rawDxf);
          
          // Sanitize header to ensure 100% AutoCAD compliance
          dxfStr = sanitizeDxfHeader(dxfStr);

          const encoder = new TextEncoder();
          const u8 = encoder.encode(dxfStr);
          return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
        }
      } catch (e) {
        console.error('Error exporting DXF via db.dxfOut:', e);
      }
      return null;
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

