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
  setTool: (tool: 'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension') => void;
  exportDxfBuffer: () => Promise<ArrayBuffer | null>;
  getLayers: () => Array<{ name: string; color: number; visible: boolean }>;
  toggleLayer: (layerName: string) => void;
  getLayouts: () => string[];
  switchLayout: (layoutName: string) => void;
}

interface CadViewerProps {
  fileData: ArrayBuffer | null;
  fileName: string | null;
  onLoaded?: () => void;
  onError?: (err: any) => void;
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

export const CadViewer = forwardRef<CadViewerRef, CadViewerProps>(({ fileData, fileName, onLoaded, onError }, ref) => {
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

  useImperativeHandle(ref, () => ({
    zoomExtents: () => {
      if (!docManagerRef.current) return;
      try {
        docManagerRef.current.sendStringToExecute('zoom e');
      } catch (e) {
        console.error(e);
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
        }
      } catch (e) {
        console.error('Error setting tool:', e);
      }
    },
    exportDxfBuffer: async () => {
      if (!docManagerRef.current?.curDocument) return null;
      try {
        const db = docManagerRef.current.curDocument.database as any;
        if (db && typeof db.exportDxf === 'function') {
          const dxfStr = db.exportDxf();
          const encoder = new TextEncoder();
          return encoder.encode(dxfStr).buffer;
        }
      } catch (e) {
        console.error('Error exporting DXF:', e);
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
    getLayouts: () => layouts,
    switchLayout: (layoutName: string) => {
      if (!docManagerRef.current) return;
      try {
        setActiveLayout(layoutName);
        docManagerRef.current.sendStringToExecute(`ctab ${layoutName}`);
      } catch (e) {
        console.error('Error switching layout:', e);
      }
    }
  }));

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
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
