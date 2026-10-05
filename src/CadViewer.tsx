import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import {
  AcApDocManager,
  AcEdOpenMode
} from '@mlightcad/cad-simple-viewer';
import {
  AcDbDatabaseConverterManager,
  AcDbFileType
} from '@mlightcad/data-model';
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter';
import { generateCompliantDxf } from './dxfGenerator';
import { setupSpanishI18n } from './spanishI18n';

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
  captureCanvas: (pins?: any[]) => string | null;
  getCanvasElement: () => HTMLCanvasElement | null;
  screenToWorld: (screenX: number, screenY: number) => { x: number; y: number } | null;
  worldToScreen: (worldX: number, worldY: number) => { x: number; y: number } | null;
  onCameraChange?: (callback: () => void) => () => void;
  rotateView: (deltaDegrees: number) => void;
  setRotation: (degrees: number) => void;
  getRotation: () => number;
}

interface CadViewerProps {
  fileData: ArrayBuffer | null;
  fileName: string | null;
  bgColor?: string;
  rotation?: number;
  onLoaded?: () => void;
  onError?: (err: any) => void;
  onCameraUpdate?: () => void;
  onRotationChange?: (angle: number) => void;
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

export const CadViewer = forwardRef<CadViewerRef, CadViewerProps>(({ 
  fileData, 
  fileName, 
  bgColor = '#111827', 
  rotation = 0,
  onLoaded, 
  onError,
  onRotationChange 
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const docManagerRef = useRef<AcApDocManager | null>(null);
  const [layers, setLayers] = useState<Array<{ name: string; color: number; visible: boolean }>>([]);
  const [layouts, setLayouts] = useState<string[]>(['Model']);
  const [activeLayout, setActiveLayout] = useState<string>('Model');
  const [localRotation, setLocalRotation] = useState<number>(rotation);

  // Apply rotation natively to WebGL camera so that viewport panning and mouse deltas are never inverted
  const applyRotationToCamera = (degrees: number) => {
    if (!docManagerRef.current) return;
    try {
      const curDoc = docManagerRef.current.curDocument as any;
      const curView = (docManagerRef.current.curView || curDoc?.view) as any;
      if (!curView) return;

      const rad = (degrees * Math.PI) / 180;
      const layoutView = curView.activeLayoutView;
      const camera = layoutView?.internalCamera || curView.internalCamera;
      if (camera) {
        // Aligned with AutoCAD / Three.js 2D camera twist
        camera.up.set(-Math.sin(rad), Math.cos(rad), 0);
        camera.setRotationFromEuler(new THREE.Euler(0, 0, rad));
        camera.updateProjectionMatrix();
        if (layoutView?._cameraControls) {
          layoutView._cameraControls.update();
        }
        if (curView._layoutViewManager && curView._scene) {
          curView._layoutViewManager.render(curView._scene);
        } else if (typeof curView.render === 'function') {
          curView.render();
        }
        curView._isDirty = true;
      }
    } catch (e) {
      console.warn('Error applying camera rotation:', e);
    }
  };

  // Sync external rotation prop and apply to WebGL camera
  useEffect(() => {
    setLocalRotation(rotation);
    applyRotationToCamera(rotation);
  }, [rotation]);

  useEffect(() => {
    ensureDwgConverter();
    setupSpanishI18n();
  }, []);

  // Suppress axes gizmo (UCS icon) at bottom left completely
  const suppressAxes = () => {
    if (!docManagerRef.current) return;
    try {
      const curDoc = docManagerRef.current.curDocument as any;
      const view = (docManagerRef.current.curView || curDoc?.view) as any;
      if (!view) return;

      // 1. Iterate over all layout views inside layoutViewManager
      const layoutMgr = view._layoutViewManager;
      if (layoutMgr && layoutMgr._layoutViews) {
        layoutMgr._layoutViews.forEach((lv: any) => {
          if (lv) {
            if (lv._axesGizmo) {
              try { lv._axesGizmo.dispose?.(); } catch (e) {}
              lv._axesGizmo = null;
            }
            const proto = Object.getPrototypeOf(lv);
            if (proto && proto.createAxesGizmo) {
              proto.createAxesGizmo = () => null;
            }
          }
        });
      }

      // 2. Clear on active layout view
      if (view.activeLayoutView) {
        const lv = view.activeLayoutView;
        if (lv._axesGizmo) {
          try { lv._axesGizmo.dispose?.(); } catch (e) {}
          lv._axesGizmo = null;
        }
        const proto = Object.getPrototypeOf(lv);
        if (proto && proto.createAxesGizmo) {
          proto.createAxesGizmo = () => null;
        }
      }

      // 3. Command line fallbacks
      docManagerRef.current.sendStringToExecute('ucsicon\noff\n');

      // 4. Force scene refresh
      if (view._layoutViewManager && view._scene) {
        view._layoutViewManager.render(view._scene);
      } else if (typeof view.render === 'function') {
        view.render();
      }
      view._isDirty = true;
    } catch (e) {
      console.warn('Error suppressing axes gizmo:', e);
    }
  };

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
        // Open document in WRITE mode so drawing tools work
        const success = await mgr.openDocument(fileName, fileData, {
          mode: AcEdOpenMode.Write
        });

        if (success) {
          suppressAxes();
          setTimeout(suppressAxes, 300);
          setTimeout(suppressAxes, 1200);
          if (onLoaded) onLoaded();
          refreshLayers();
          refreshLayouts();
          if (localRotation !== 0) {
            setTimeout(() => applyRotationToCamera(localRotation), 250);
          }
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
        const layerList = summaries.map((s: any) => {
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

  // Two-finger touch rotation gesture detection
  const initialTouchAngleRef = useRef<number | null>(null);
  const initialRotationRef = useRef<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getTouchAngle = (touches: TouchList) => {
      const t1 = touches[0];
      const t2 = touches[1];
      return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialTouchAngleRef.current = getTouchAngle(e.touches);
        initialRotationRef.current = localRotation;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialTouchAngleRef.current !== null) {
        const currentAngle = getTouchAngle(e.touches);
        const delta = currentAngle - initialTouchAngleRef.current;
        // Avoid tiny unintended finger twitches
        if (Math.abs(delta) > 4) {
          const newRot = Math.round(((initialRotationRef.current + delta) % 360 + 360) % 360);
          setLocalRotation(newRot);
          applyRotationToCamera(newRot);
          if (onRotationChange) onRotationChange(newRot);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialTouchAngleRef.current = null;
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [localRotation, onRotationChange]);

  useImperativeHandle(ref, () => ({
    zoomExtents: () => {
      if (!docManagerRef.current) return;
      try {
        const curDoc = docManagerRef.current.curDocument as any;
        const curView = (docManagerRef.current.curView || curDoc?.view) as any;
        if (curView && typeof curView.zoomToFitDrawing === 'function') {
          curView.zoomToFitDrawing();
        } else if (curView && typeof curView.zoomToSmartExtents === 'function') {
          curView.zoomToSmartExtents();
        } else {
          docManagerRef.current.sendStringToExecute('zoom\ne\n');
        }
        if (localRotation !== 0) {
          setTimeout(() => applyRotationToCamera(localRotation), 250);
        }
      } catch (e) {
        console.error('Error in zoomExtents:', e);
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
        const curDoc = docManagerRef.current.curDocument as any;
        if (curDoc?.database) {
          curDoc.database.orthomode = enabled ? 1 : 0;
        }
        docManagerRef.current.sendStringToExecute(`orthomode\n${enabled ? 1 : 0}\n`);
      } catch (e) {
        console.error('Error setting ortho mode:', e);
      }
    },
    setTool: (tool) => {
      if (!docManagerRef.current) return;
      try {
        switch (tool) {
          case 'pan':
            docManagerRef.current.sendStringToExecute('pan\n');
            break;
          case 'zoom':
            docManagerRef.current.sendStringToExecute('zoom\n');
            break;
          case 'select':
            docManagerRef.current.sendStringToExecute('select\n');
            break;
          case 'line':
            docManagerRef.current.sendStringToExecute('line\n');
            break;
          case 'circle':
            docManagerRef.current.sendStringToExecute('circle\n');
            break;
          case 'mtext':
            docManagerRef.current.sendStringToExecute('mtext\n');
            break;
          case 'dimension':
            // High-precision distance measurement tool (dist)
            docManagerRef.current.sendStringToExecute('dist\n');
            break;
          case 'revcloud':
            docManagerRef.current.sendStringToExecute('revcloud\n');
            break;
        }
      } catch (e) {
        console.error('Error setting tool:', e);
      }
    },
    createRevisionLayer: (layerName: string, colorIndex = 1) => {
      if (!docManagerRef.current?.curDocument) return;
      try {
        docManagerRef.current.sendStringToExecute(`-layer m "${layerName}" c ${colorIndex} "${layerName}"  `);
        setTimeout(() => refreshLayers(), 300);
      } catch (e) {
        console.error('Error creating revision layer:', e);
      }
    },
    exportDxfBuffer: async (pins: any[] = []) => {
      const db = docManagerRef.current?.curDocument?.database;
      return generateCompliantDxf(db, pins, false);
    },
    exportRevisionDxfBuffer: async (pins: any[] = []) => {
      const db = docManagerRef.current?.curDocument?.database;
      return generateCompliantDxf(db, pins, true);
    },

    screenToWorld: (screenX: number, screenY: number) => {
      if (!docManagerRef.current || !containerRef.current) return null;
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
      if (!docManagerRef.current || !containerRef.current) return null;
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
        setTimeout(suppressAxes, 100);
        setTimeout(suppressAxes, 400);
        if (localRotation !== 0) {
          setTimeout(() => applyRotationToCamera(localRotation), 250);
        }
      } catch (e) {
        console.error('Error switching layout:', e);
      }
    },
    // Enhanced Screenshot Composite: Forces fresh WebGL frame & overlays survey pins
    captureCanvas: (pins: any[] = []) => {
      if (!containerRef.current || !docManagerRef.current) return null;
      try {
        const mgr = docManagerRef.current;
        const curView = (mgr.curView || (mgr.curDocument as any)?.view) as any;
        if (curView) {
          if (typeof curView.render === 'function') {
            curView.render();
          } else if (curView._layoutViewManager && curView._scene) {
            curView._layoutViewManager.render(curView._scene);
          }
        }
        
        const webglCanvas = containerRef.current.querySelector('canvas');
        if (!webglCanvas) return null;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = webglCanvas.width;
        exportCanvas.height = webglCanvas.height;
        const ctx = exportCanvas.getContext('2d');
        if (!ctx) return webglCanvas.toDataURL('image/png');

        // Draw CAD background
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(webglCanvas, 0, 0);

        // Draw survey pin markers if any
        if (pins && pins.length > 0 && curView && typeof curView.worldToScreen === 'function') {
          const dpr = window.devicePixelRatio || 1;
          const rect = containerRef.current.getBoundingClientRect();
          const scaleX = exportCanvas.width / (rect.width || 1);
          const scaleY = exportCanvas.height / (rect.height || 1);

          pins.forEach((pin, i) => {
            const screenPt = curView.worldToScreen({ x: pin.worldX, y: pin.worldY });
            if (screenPt && typeof screenPt.x === 'number' && typeof screenPt.y === 'number') {
              const px = screenPt.x * scaleX;
              const py = screenPt.y * scaleY;

              ctx.save();
              ctx.beginPath();
              ctx.arc(px, py, 13 * dpr, 0, Math.PI * 2);
              ctx.fillStyle = pin.type === 'photo' ? '#ef4444' : '#0284c7';
              ctx.shadowColor = 'rgba(0,0,0,0.5)';
              ctx.shadowBlur = 6 * dpr;
              ctx.fill();
              ctx.lineWidth = 2 * dpr;
              ctx.strokeStyle = '#ffffff';
              ctx.stroke();

              ctx.fillStyle = '#ffffff';
              ctx.font = `bold ${10 * dpr}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(String(i + 1), px, py);

              if (pin.note) {
                const label = pin.note.length > 24 ? pin.note.substring(0, 22) + '...' : pin.note;
                ctx.font = `${9 * dpr}px sans-serif`;
                const textWidth = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
                ctx.fillRect(px - textWidth / 2 - 4 * dpr, py + 16 * dpr, textWidth + 8 * dpr, 14 * dpr);
                ctx.fillStyle = '#f8fafc';
                ctx.fillText(label, px, py + 23 * dpr);
              }
              ctx.restore();
            }
          });
        }

        return exportCanvas.toDataURL('image/png');
      } catch (e) {
        console.error('Error capturing canvas:', e);
        return null;
      }
    },
    getCanvasElement: () => {
      return containerRef.current?.querySelector('canvas') || null;
    },
    rotateView: (delta: number) => {
      const next = ((localRotation + delta) % 360 + 360) % 360;
      setLocalRotation(next);
      applyRotationToCamera(next);
      if (onRotationChange) onRotationChange(next);
    },
    setRotation: (angle: number) => {
      const normalized = (angle % 360 + 360) % 360;
      setLocalRotation(normalized);
      applyRotationToCamera(normalized);
      if (onRotationChange) onRotationChange(normalized);
    },
    getRotation: () => localRotation
  }));

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: bgColor, touchAction: 'none', overflow: 'hidden' }}>
      <div 
        ref={containerRef} 
        className="viewer-canvas-wrapper" 
        style={{ 
          width: '100%', 
          height: '100%', 
          position: 'relative', 
          touchAction: 'none'
        }} 
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
                setTimeout(suppressAxes, 200);
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


