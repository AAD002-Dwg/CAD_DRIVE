import { useState, useRef, useEffect, useCallback } from 'react';
import { useGoogleDrive } from './useGoogleDrive';
import { useAuth } from './useAuth';
import { useRealtimeCollaboration } from './useRealtimeCollaboration';
import { CadViewer } from './CadViewer';
import type { CadViewerRef } from './CadViewer';
import {
  Hand,
  ZoomIn,
  Maximize2,
  Minimize2,
  Focus,
  Pencil,
  Circle,
  Cloud,
  Ruler,
  Camera,
  MessageSquare,
  Layers,
  FolderOpen,
  Laptop,
  Save,
  Share2,
  Download,
  Compass,
  Check,
  X,
  Menu,
  Trash2,
  Eye,
  EyeOff,
  Palette,
  ClipboardList,
  RotateCcw,
  FileCheck2,
  ExternalLink,
  Search,
  Crosshair,
  MapPin
} from 'lucide-react';
import { exportSurveyPackage } from './exportSurveyZip';
import './App.css';

export interface CadPin {
  id: string;
  type: 'photo' | 'comment';
  worldX: number;
  worldY: number;
  note: string;
  photoDataUrl?: string;
  author: string;
  timestamp: string;
  layerName?: string;
}

const BG_THEMES = [
  { id: 'black', label: 'Negro AutoCAD', color: '#000000', icon: '⚫' },
  { id: 'dark', label: 'Azul Noche', color: '#0a0e1a', icon: '🌌' },
  { id: 'slate', label: 'Gris Pizarra', color: '#1e293b', icon: '🔲' },
  { id: 'white', label: 'Blanco Papel', color: '#ffffff', icon: '☀️' }
];

export default function App() {
  // === AUTENTICACIÓN REAL CON GOOGLE ===
  const { user, loading: authLoading, error: authError, isAuthenticated, signInWithGoogle, signInAsGuest, signOutUser } = useAuth();

  // El nombre del usuario viene de Google (verificado), no de un input libre
  const userName = user?.displayName || '';

  // === GOOGLE DRIVE (Google Identity Services con sync-cad-storage) ===
  const { ready: driveReady, authenticated: driveAuthenticated, openPicker, downloadFile, uploadDxf } = useGoogleDrive(user?.email);
  const authenticated = driveAuthenticated;
  
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [parentFolderId, setParentFolderId] = useState<string | undefined>(undefined);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [activeTool, setActiveTool] = useState<'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'revcloud' | 'photo' | 'comment' | 'situate'>('pan');
  const [rotationAngle, setRotationAngle] = useState(0);
  const [userStation, setUserStation] = useState<{ worldX: number; worldY: number; timestamp: string } | null>(null);
  const [screenUserStation, setScreenUserStation] = useState<{ screenX: number; screenY: number } | null>(null);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [isTrackingGps, setIsTrackingGps] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFindingsOpen, setIsFindingsOpen] = useState(false);
  const [findingsSearch, setFindingsSearch] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [cadBgColor, setCadBgColor] = useState('#000000');
  const [layerSearch, setLayerSearch] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  // Compass orientation sensor for "SITUAR"
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      let heading: number | null = null;
      if ((e as any).webkitCompassHeading !== undefined) {
        heading = (e as any).webkitCompassHeading;
      } else if (e.alpha !== null) {
        heading = (360 - e.alpha) % 360;
      }
      if (heading !== null) {
        setDeviceHeading(Math.round(heading));
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  // Toast helper
  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // WCS Anchored Pins (Photos + Comments)
  const [pins, setPins] = useState<CadPin[]>([]);
  const [showPins, setShowPins] = useState(true);
  const [screenPins, setScreenPins] = useState<Array<{ pin: CadPin; screenX: number; screenY: number; isVisible: boolean }>>([]);

  // Save pins to localStorage
  const savePinsToStorage = useCallback((updatedPins: CadPin[]) => {
    if (!currentFileName) return;
    const key = `cad_pins_${currentFileName}`;
    localStorage.setItem(key, JSON.stringify(updatedPins));
  }, [currentFileName]);

  // === COLABORACIÓN EN TIEMPO REAL (Firebase Realtime Database — cross-device) ===
  const {
    peers,
    peerCursors,
    isConnected: realtimeConnected,
    sendCursor: rtSendCursor,
    broadcastPin: rtBroadcastPin,
    broadcastDeletePin: rtBroadcastDeletePin,
  } = useRealtimeCollaboration({
    roomId: currentFileId || currentFileName,
    currentUser: user,
    onPinAdded: (newPin) => {
      setPins(prev => {
        if (prev.some(p => p.id === newPin.id)) return prev;
        const updated = [...prev, newPin];
        savePinsToStorage(updated);
        return updated;
      });
    },
    onPinDeleted: (pinId) => {
      setPins(prev => {
        const updated = prev.filter(p => p.id !== pinId);
        savePinsToStorage(updated);
        return updated;
      });
    },
    onToast: showToast,
  });

  // Proyección de cursores de peers a coordenadas de pantalla
  const [screenPeerCursors, setScreenPeerCursors] = useState<Array<{ user: { userId: string; displayName: string; color: string; photoURL: string | null }; screenX: number; screenY: number }>>([]);

  // Ortho mode
  const [isOrthoEnabled, setIsOrthoEnabled] = useState(false);
  
  // New Photo modal state
  const [pendingWorldCoord, setPendingWorldCoord] = useState<{ x: number; y: number } | null>(null);
  const [newPhotoData, setNewPhotoData] = useState<string | null>(null);
  const [newPhotoNote, setNewPhotoNote] = useState('');
  
  // New Comment modal state
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);
  const [newCommentNote, setNewCommentNote] = useState('');

  // Selected Pin detail modal
  const [selectedPin, setSelectedPin] = useState<CadPin | null>(null);

  // Revision count for layers
  const [revisionCount, setRevisionCount] = useState(1);

  const cadRef = useRef<CadViewerRef>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const attemptedFileIdRef = useRef<string | null>(null);
  const lastTapRef = useRef<number>(0);

  // Sync fullscreen state with document events
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if ((document.documentElement as any).webkitRequestFullscreen) {
          await (document.documentElement as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen error:', err);
      showToast('Pantalla completa no soportada o bloqueada por el navegador.');
    }
  }, [showToast]);

  // Touch gesture: double-tap on canvas to trigger Zoom Extents
  const handleCanvasTouchEnd = useCallback((_e: React.TouchEvent<HTMLDivElement>) => {
    if (activeTool !== 'pan') return;
    const now = Date.now();
    if (now - lastTapRef.current < 320) {
      cadRef.current?.zoomExtents();
      showToast('📐 Vista centrada en pantalla');
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [activeTool, showToast]);


  // Leer parametros de URL al montar (archivo compartido via link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedFileId = params.get('fileId');
    const sharedFileName = params.get('fileName') || 'Plano_Compartido.dwg';

    if (sharedFileId) {
      setCurrentFileId(sharedFileId);
      setCurrentFileName(sharedFileName);
    }
  }, []);

  // Load CAD pins from localStorage whenever currentFileName changes
  useEffect(() => {
    if (currentFileName) {
      const key = `cad_pins_${currentFileName}`;
      const savedPins = localStorage.getItem(key);
      if (savedPins) {
        try {
          setPins(JSON.parse(savedPins));
        } catch (e) {
          console.error('Error parsing stored pins:', e);
        }
      } else {
        setPins([]);
      }
    }
  }, [currentFileName]);

  // Dynamic RAF loop — only runs when there are pins, peer cursors, or user station to project
  useEffect(() => {
    const hasPins = pins.length > 0;
    const hasCursors = peers.length > 0;
    const hasStation = userStation !== null;
    if (!hasPins && !hasCursors && !hasStation) {
      setScreenPins([]);
      setScreenPeerCursors([]);
      setScreenUserStation(null);
      return;
    }

    let active = true;
    const updateScreenEntities = () => {
      if (!active) return;
      if (cadRef.current && viewerContainerRef.current) {
        const rect = viewerContainerRef.current.getBoundingClientRect();

        // 1. Project Pins
        if (hasPins) {
          setScreenPins(pins.map(p => {
            const pt = cadRef.current?.worldToScreen(p.worldX, p.worldY);
            if (!pt) return { pin: p, screenX: -999, screenY: -999, isVisible: false };
            return { pin: p, screenX: pt.x, screenY: pt.y, isVisible: pt.x >= -30 && pt.x <= rect.width + 30 && pt.y >= -30 && pt.y <= rect.height + 30 };
          }));
        } else {
          setScreenPins([]);
        }

        // 2. Project Peer Cursors (from Firebase peerCursors Map)
        if (hasCursors) {
          const projected: Array<{ user: { userId: string; displayName: string; color: string; photoURL: string | null }; screenX: number; screenY: number }> = [];
          peers.forEach(peer => {
            const cursorPos = peerCursors.get(peer.userId);
            if (cursorPos) {
              const pt = cadRef.current?.worldToScreen(cursorPos.worldX, cursorPos.worldY);
              if (pt && pt.x >= -20 && pt.x <= rect.width + 20 && pt.y >= -20 && pt.y <= rect.height + 20) {
                projected.push({ user: peer, screenX: pt.x, screenY: pt.y });
              }
            }
          });
          setScreenPeerCursors(projected);
        } else {
          setScreenPeerCursors([]);
        }

        // 3. Project User Station ("Estás aquí")
        if (userStation) {
          const pt = cadRef.current?.worldToScreen(userStation.worldX, userStation.worldY);
          if (pt && pt.x >= -60 && pt.x <= rect.width + 60 && pt.y >= -60 && pt.y <= rect.height + 60) {
            setScreenUserStation({ screenX: pt.x, screenY: pt.y });
          } else {
            setScreenUserStation(null);
          }
        } else {
          setScreenUserStation(null);
        }
      }
      animFrameRef.current = requestAnimationFrame(updateScreenEntities);
    };

    animFrameRef.current = requestAnimationFrame(updateScreenEntities);
    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [pins, peers, peerCursors, userStation]);

  // GPS displacement tracking from anchor point
  const anchorGpsRef = useRef<{ lat: number; lon: number; anchorWorldX: number; anchorWorldY: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const handleToggleGpsTracking = useCallback(() => {
    if (isTrackingGps) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setIsTrackingGps(false);
      anchorGpsRef.current = null;
      showToast('🛰️ Seguimiento GPS detenido');
      return;
    }

    if (!navigator.geolocation) {
      showToast('Geolocalización no soportada por el navegador.');
      return;
    }

    if (!userStation) {
      showToast('Primero pulse en el plano para situar su punto de partida.');
      return;
    }

    setIsTrackingGps(true);
    showToast('🛰️ Obteniendo señal satelital GPS...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        anchorGpsRef.current = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          anchorWorldX: userStation.worldX,
          anchorWorldY: userStation.worldY
        };
        showToast(`🛰️ GPS calibrado (±${Math.round(pos.coords.accuracy)}m). Rastreando recorrido.`);

        watchIdRef.current = navigator.geolocation.watchPosition(
          (watchPos) => {
            if (!anchorGpsRef.current) return;
            const deltaLat = watchPos.coords.latitude - anchorGpsRef.current.lat;
            const deltaLon = watchPos.coords.longitude - anchorGpsRef.current.lon;
            const metersY = deltaLat * 110574;
            const metersX = deltaLon * (111320 * Math.cos((watchPos.coords.latitude * Math.PI) / 180));

            setUserStation({
              worldX: anchorGpsRef.current.anchorWorldX + metersX,
              worldY: anchorGpsRef.current.anchorWorldY + metersY,
              timestamp: new Date().toLocaleTimeString()
            });
          },
          (err) => {
            console.warn('GPS watch error:', err);
          },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        );
      },
      () => {
        setIsTrackingGps(false);
        showToast('No se pudo acceder a la señal GPS. Revise los permisos.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [isTrackingGps, userStation, showToast]);

  // Clean up GPS watch on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);


  // Descargar plano compartido (directamente con API Key si es público o con token si está autenticado)
  const handleLoadSharedFile = useCallback(async () => {
    const fileIdToLoad = currentFileId || new URLSearchParams(window.location.search).get('fileId');
    if (!fileIdToLoad) return;

    setIsLoading(true);
    setLoadingMsg(`Cargando plano compartido (${currentFileName || 'DWG'})...`);
    const buffer = await downloadFile(fileIdToLoad);
    if (buffer) {
      setFileBuffer(buffer);
      showToast(`Plano cargado exitosamente.`);
    } else {
      showToast('⚠️ No se pudo descargar el plano (Error 404). El dueño del archivo debe configurarlo en Drive como "Cualquier persona que tenga el vínculo".');
    }
    setIsLoading(false);
  }, [currentFileId, currentFileName, downloadFile, showToast]);

  // Auto-download file if shared URL parameter is present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedFileId = params.get('fileId');

    if (!sharedFileId || fileBuffer) return;
    if (attemptedFileIdRef.current === sharedFileId) return;

    attemptedFileIdRef.current = sharedFileId;
    handleLoadSharedFile();
  }, [fileBuffer, handleLoadSharedFile]);

  const handlePickDriveFile = () => {
    setIsMobileMenuOpen(false);
    openPicker(async (fileId, fileName, folderId) => {
      setCurrentFileId(fileId);
      setCurrentFileName(fileName);
      setParentFolderId(folderId);
      
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('fileId', fileId);
      newUrl.searchParams.set('fileName', fileName);
      window.history.pushState({}, '', newUrl.toString());

      setIsLoading(true);
      setLoadingMsg(`Descargando ${fileName} desde Google Drive...`);
      
      const buffer = await downloadFile(fileId);
      if (buffer) {
        setFileBuffer(buffer);
        showToast(`Plano ${fileName} cargado correctamente.`);
      } else {
        showToast('Error al descargar el archivo desde Google Drive.');
      }
      setIsLoading(false);
    });
  };

  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadLocalFile(file);
    e.target.value = '';
  };

  const loadLocalFile = (file: File) => {
    setIsMobileMenuOpen(false);
    const validExtensions = ['.dwg', '.dxf'];
    const isCad = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    if (!isCad) {
      showToast('Por favor selecciona un archivo .dwg o .dxf válido.');
      return;
    }

    setIsLoading(true);
    setLoadingMsg(`Procesando archivo local ${file.name}...`);

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result instanceof ArrayBuffer) {
        setCurrentFileId(null);
        setCurrentFileName(file.name);
        setParentFolderId(undefined);
        setFileBuffer(evt.target.result);
        showToast(`Plano local "${file.name}" cargado.`);
      } else {
        showToast('Error al leer el archivo local.');
      }
      setIsLoading(false);
    };
    reader.onerror = () => {
      showToast('Error al leer el archivo seleccionado.');
      setIsLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadLocalFile(e.dataTransfer.files[0]);
    }
  };

  const handleCopyShareLink = () => {
    setIsMobileMenuOpen(false);
    if (!currentFileId) {
      showToast('Este plano es local. Para compartirlo con un enlace, ábrelo desde Google Drive.');
      return;
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}?fileId=${currentFileId}&fileName=${encodeURIComponent(currentFileName || 'Plano.dwg')}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('🔗 ¡Enlace copiado! En Drive, asegurate de que el archivo tenga permiso "Cualquier persona con el vínculo".');
  };

  // Tool change & Revision Cloud with Layer metadata
  const handleToolChange = (tool: 'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'revcloud' | 'photo' | 'comment' | 'situate') => {
    setActiveTool(tool);

    if (tool === 'revcloud') {
      // Create dedicated revision layer with structured metadata: REV_01_AUTOR_FECHA_HORA
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = now.toTimeString().slice(0, 5).replace(/:/g, '');
      const cleanAuthor = userName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'REVISOR';
      const revLayerName = `REV_${String(revisionCount).padStart(2, '0')}_${cleanAuthor}_${dateStr}_${timeStr}`;
      
      cadRef.current?.createRevisionLayer(revLayerName, 1); // Red layer
      setRevisionCount(prev => prev + 1);
      showToast(`☁️ Capa activa: ${revLayerName}`);
    } else if (tool === 'situate') {
      showToast('📍 Modo SITUAR: Toque en el plano para definir su ubicación actual.');
    }

    if (tool !== 'photo' && tool !== 'comment' && tool !== 'situate') {
      cadRef.current?.setTool(tool as any);
    }
  };

  const handleCancelTool = () => {
    cadRef.current?.cancelCommand();
    setActiveTool('pan');
    setPendingWorldCoord(null);
    setIsCommentModalOpen(false);
    showToast('Comando cancelado');
  };

  const handleToggleOrtho = () => {
    const next = !isOrthoEnabled;
    setIsOrthoEnabled(next);
    cadRef.current?.setOrthoMode(next);
    showToast(next ? '📐 Modo Ortogonal (ORTO) ACTIVADO (F8)' : '📐 Modo Ortogonal DESACTIVADO');
  };

  // Keyboard shortcut listener for F8 (Ortho) and Escape (Cancel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        handleToggleOrtho();
      } else if (e.key === 'Escape') {
        handleCancelTool();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOrthoEnabled]);

  // DXF Export to Google Drive (Revision Layers & Marks)
  const handleSaveRevisionDrive = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Exportando marcas y entidades en formato DXF...');

    try {
      const dxfBuffer = await cadRef.current.exportRevisionDxfBuffer(pins);
      if (!dxfBuffer) {
        showToast('No se pudo generar el archivo DXF. Asegúrate de tener el plano abierto.');
        setIsLoading(false);
        return;
      }

      setLoadingMsg('Guardando revisión en Google Drive...');
      
      const dateStr = new Date().toISOString().slice(0, 10);
      const baseName = currentFileName.substring(0, currentFileName.lastIndexOf('.')) || currentFileName;
      const revisionFileName = `${baseName}_REV_${userName.replace(/\s+/g, '_')}_${dateStr}.dxf`;

      const success = await uploadDxf(revisionFileName, dxfBuffer, parentFolderId);
      if (success) {
        showToast(`¡Revisión guardada como "${revisionFileName}" en Google Drive!`);
      } else {
        showToast('Error al subir a Drive. Usa "Exportar Marcas" para guardarlo localmente.');
      }
    } catch (e) {
      console.error(e);
      showToast('Ocurrió un error al guardar la revisión.');
    } finally {
      setIsLoading(false);
    }
  };

  // Direct Local Lightweight Revision DXF Download
  const handleDownloadRevisionDxf = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Generando DXF liviano con marcas y fotos de obra...');

    try {
      const dxfBuffer = await cadRef.current.exportRevisionDxfBuffer(pins);
      if (!dxfBuffer) {
        showToast('No se pudo generar el DXF de revisión.');
        setIsLoading(false);
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const baseName = currentFileName.substring(0, currentFileName.lastIndexOf('.')) || currentFileName;
      const downloadFileName = `${baseName}_REVISION_MARCAS_${dateStr}.dxf`;

      const blob = new Blob([dxfBuffer], { type: 'application/dxf;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`🎯 Capa de revisión "${downloadFileName}" descargada.`);
    } catch (e) {
      console.error(e);
      showToast('Error al generar el DXF de revisión.');
    } finally {
      setIsLoading(false);
    }
  };

  // Export Complete Survey Package (ZIP with DXF + Photos + HTML Report)
  const handleExportZipPackage = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Generando paquete completo (DXF + Fotos + Informe)...');

    try {
      const dxfBuffer = await cadRef.current.exportRevisionDxfBuffer(pins);
      if (!dxfBuffer) {
        showToast('No se pudo generar el DXF de marcas.');
        setIsLoading(false);
        return;
      }

      await exportSurveyPackage(pins, dxfBuffer, currentFileName, userName);
      showToast('📦 ¡Paquete de relevamiento descargado con éxito!');
    } catch (e) {
      console.error(e);
      showToast('Error al empaquetar el relevamiento.');
    } finally {
      setIsLoading(false);
    }
  };

  // Screenshot / Snapshot Capture with annotations burned in
  const handleCaptureScreenshot = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current) return;

    try {
      setIsLoading(true);
      setLoadingMsg('Generando captura con marcas del plano...');
      const dataUrl = cadRef.current.captureCanvas(pins);
      setIsLoading(false);
      if (!dataUrl) {
        showToast('No se pudo capturar la imagen del plano.');
        return;
      }

      if (navigator.share && navigator.canShare) {
        try {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const file = new File([blob], `${currentFileName || 'Plano'}_captura.png`, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: `Captura de Plano - ${currentFileName}`,
              text: `Revisión de obra por ${userName}`,
              files: [file]
            });
            showToast('📸 Captura compartida exitosamente.');
            return;
          }
        } catch (err) {
          console.warn('Web Share fallback:', err);
        }
      }

      const a = document.createElement('a');
      a.href = dataUrl;
      const baseName = currentFileName?.substring(0, currentFileName.lastIndexOf('.')) || 'Plano';
      a.download = `${baseName}_Captura.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('📸 Captura descargada con éxito.');
    } catch (e) {
      setIsLoading(false);
      console.error('Screenshot error:', e);
      showToast('Error al capturar la pantalla.');
    }
  };

  // Click on Canvas for WCS-anchored Photos, Comments or Operator Station
  const handleCanvasClickForPin = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'photo' && activeTool !== 'comment' && activeTool !== 'situate') return;
    if (!viewerContainerRef.current || !cadRef.current) return;

    const rect = viewerContainerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert Screen Pixels directly to CAD World Coordinates (WCS)
    const worldPoint = cadRef.current.screenToWorld(screenX, screenY);
    if (!worldPoint) {
      showToast('No se pudieron obtener las coordenadas del plano.');
      return;
    }

    if (activeTool === 'situate') {
      setUserStation({
        worldX: worldPoint.x,
        worldY: worldPoint.y,
        timestamp: new Date().toLocaleTimeString()
      });
      setActiveTool('pan');
      showToast(`📍 Operador situado en WCS (${worldPoint.x.toFixed(1)}, ${worldPoint.y.toFixed(1)})`);
      return;
    }

    setPendingWorldCoord(worldPoint);

    if (activeTool === 'photo') {
      setActiveTool('pan'); // Reset immediately to prevent camera loop
      cameraInputRef.current?.click();
    } else if (activeTool === 'comment') {
      setActiveTool('pan');
      setNewCommentNote('');
      setIsCommentModalOpen(true);
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingWorldCoord) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === 'string') {
        setNewPhotoData(evt.target.result);
        setNewPhotoNote('');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!viewerContainerRef.current || !cadRef.current) return;
    const rect = viewerContainerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = cadRef.current.screenToWorld(screenX, screenY);
    if (worldPt) {
      rtSendCursor(worldPt.x, worldPt.y); // Firebase Realtime Database
    }
  };

  const handleSavePhotoPin = () => {
    if (!newPhotoData || !pendingWorldCoord) return;

    const newPin: CadPin = {
      id: 'photo_' + Date.now(),
      type: 'photo',
      worldX: pendingWorldCoord.x,
      worldY: pendingWorldCoord.y,
      photoDataUrl: newPhotoData,
      note: newPhotoNote.trim() || 'Foto de obra sin observaciones',
      author: userName,
      timestamp: new Date().toLocaleString()
    };

    const updated = [...pins, newPin];
    setPins(updated);
    savePinsToStorage(updated);
    rtBroadcastPin(newPin); // Firebase — cross-device

    setNewPhotoData(null);
    setPendingWorldCoord(null);
    setActiveTool('pan');
    showToast('📍 ¡Foto anclada exactamente a la geometría del plano!');
  };

  const handleSaveCommentPin = () => {
    if (!newCommentNote.trim() || !pendingWorldCoord) return;

    const newPin: CadPin = {
      id: 'comment_' + Date.now(),
      type: 'comment',
      worldX: pendingWorldCoord.x,
      worldY: pendingWorldCoord.y,
      note: newCommentNote.trim(),
      author: userName,
      timestamp: new Date().toLocaleString()
    };

    const updated = [...pins, newPin];
    setPins(updated);
    savePinsToStorage(updated);
    rtBroadcastPin(newPin); // Firebase — cross-device

    setIsCommentModalOpen(false);
    setPendingWorldCoord(null);
    setActiveTool('pan');
    showToast('💬 ¡Comentario fijado al plano en coordenadas CAD!');
  };

  const handleDeletePin = (pinId: string) => {
    const updated = pins.filter(p => p.id !== pinId);
    setPins(updated);
    savePinsToStorage(updated);
    rtBroadcastDeletePin(pinId); // Firebase — cross-device
    setSelectedPin(null);
    showToast('Marcador eliminado.');
  };


  // Filter layers
  const rawLayers = cadRef.current?.getLayers() || [];
  const filteredLayers = rawLayers.filter(l => 
    l.name.toLowerCase().includes(layerSearch.toLowerCase())
  );
  const visibleLayersCount = rawLayers.filter(l => l.visible).length;

  // Screen 0: Loading Firebase Auth state
  if (authLoading) {
    return (
      <div className="welcome-screen">
        <div className="welcome-card glass-panel" style={{ textAlign: 'center', gap: 16 }}>
          <div className="spinner" style={{ margin: '0 auto' }}></div>
          <p style={{ color: 'var(--text-muted)', marginTop: 12 }}>Verificando sesion...</p>
        </div>
      </div>
    );
  }

  // Screen 1: Google Sign-In (identidad verificada por Google)
  if (!isAuthenticated) {
    return (
      <div className="welcome-screen">
        <div className="welcome-card glass-panel">
          <div className="app-logo-icon" style={{ width: 64, height: 64, margin: '0 auto 20px auto', fontSize: '1.6rem' }}>
            CAD
          </div>
          <h1>CAD Drive Obra</h1>
          <p className="subtitle">
            {currentFileName
              ? `Te compartieron el plano "${currentFileName}". Ingresa con tu cuenta de Google para comenzar la revision.`
              : 'Visor y marcado de planos en obra. Compatible con celulares y computadoras.'}
          </p>

          {authError && (
            <div className="auth-error-banner" style={{ textAlign: 'left', fontSize: '0.82rem', lineHeight: 1.45 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Aviso de Autenticación</div>
              <div>{authError}</div>
              {authError.includes('Firebase Console') && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: '0.78rem' }}>
                  <strong>Cómo agregar tu IP en Firebase (en 30 segundos):</strong>
                  <ol style={{ paddingLeft: 18, marginTop: 4, marginBottom: 2 }}>
                    <li>Abre <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>Firebase Console</a> &gt; tu proyecto.</li>
                    <li>Ve a <strong>Authentication</strong> &gt; pestaña <strong>Settings</strong> &gt; <strong>Authorized domains</strong>.</li>
                    <li>Clic en <strong>Add domain</strong> y pega <code>192.168.0.8</code> (sin http ni puerto).</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          <button
            className="btn btn-google"
            onClick={signInWithGoogle}
            disabled={authLoading}
            style={{ width: '100%', padding: '14px', fontSize: '1rem', marginTop: 8 }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continuar con Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <span style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <span>o para pruebas locales</span>
            <span style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => signInAsGuest('Inspector Obra')}
            style={{ 
              width: '100%', 
              padding: '12px', 
              fontSize: '0.95rem', 
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.06)',
              borderColor: 'rgba(255,255,255,0.15)'
            }}
          >
            👷 Ingresar en Modo Obra Local (Sin cuenta)
          </button>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
            El modo local permite abrir planos DWG/DXF, tomar fotos, notas, medir y exportar ZIP sin requerir internet.
          </p>
        </div>
      </div>
    );
  }

  // Screen 2: Main Workspace
  return (
    <div 
      className="app-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file inputs */}
      <input 
        type="file" 
        ref={localFileInputRef} 
        accept=".dwg,.dxf" 
        style={{ display: 'none' }} 
        onChange={handleLocalFileSelect} 
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        accept="image/*" 
        capture="environment" 
        style={{ display: 'none' }} 
        onChange={handleCameraCapture} 
      />

      {/* Top Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="app-logo">
            <div className="app-logo-icon">
              <Compass size={18} strokeWidth={2.5} />
            </div>
            <div className="app-title-block">
              <h1 className="app-title">CAD DRIVE</h1>
              <span className="app-badge-obra">OBRA & RELEVAMIENTO</span>
            </div>
          </div>

          {/* Active File Pill & Survey Counter */}
          {currentFileName && (
            <div className="active-file-pill">
              <span className="active-file-name" title={currentFileName}>
                {currentFileName}
              </span>
              <button 
                className="findings-badge-btn"
                onClick={() => setIsFindingsOpen(!isFindingsOpen)}
                title="Ver lista de relevamiento (fotos y notas)"
              >
                <ClipboardList size={13} />
                <span>{pins.length}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Header Actions */}
        <div className="header-actions">
          {/* Background Theme Selector Dropdown */}
          <div className="theme-selector-wrapper">
            <button 
              className="btn btn-ghost btn-sm theme-btn" 
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
              title="Cambiar color de fondo del plano"
            >
              <Palette size={16} />
              <span className="theme-btn-label">{BG_THEMES.find(t => t.color === cadBgColor)?.icon}</span>
            </button>
            {isThemeMenuOpen && (
              <div className="theme-dropdown glass-panel">
                <div className="theme-dropdown-header">Fondo del Plano</div>
                <div className="theme-presets-list">
                  {BG_THEMES.map(theme => (
                    <button 
                      key={theme.id}
                      className={`theme-option ${cadBgColor.toLowerCase() === theme.color.toLowerCase() ? 'active' : ''}`}
                      onClick={() => {
                        setCadBgColor(theme.color);
                        setIsThemeMenuOpen(false);
                      }}
                    >
                      <div className="theme-option-left">
                        <div className="theme-color-preview" style={{ backgroundColor: theme.color, border: theme.color === '#ffffff' ? '1px solid #cbd5e1' : undefined }}></div>
                        <div className="theme-option-title">{theme.label}</div>
                      </div>
                      {cadBgColor.toLowerCase() === theme.color.toLowerCase() && <Check size={14} className="theme-active-icon" />}
                    </button>
                  ))}
                </div>

                {/* Custom Color Input */}
                <div className="theme-custom-picker">
                  <span className="theme-custom-label">Personalizado:</span>
                  <div className="theme-color-input-wrapper">
                    <input 
                      type="color" 
                      value={cadBgColor.startsWith('#') && cadBgColor.length === 7 ? cadBgColor : '#000000'} 
                      onChange={(e) => setCadBgColor(e.target.value)} 
                      className="theme-native-color-picker"
                      title="Elegir cualquier color"
                    />
                    <span className="theme-color-hex">{cadBgColor.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Live Multi-user Collaborators Avatars */}
          {peers.length > 0 && (
            <div className="collaborators-group" title="Colaboradores en tiempo real">
              {peers.map((peer) => (
                peer.photoURL ? (
                  <img
                    key={peer.userId}
                    src={peer.photoURL}
                    className="collaborator-avatar collaborator-avatar-photo"
                    style={{ border: `2px solid ${peer.color}` }}
                    title={`${peer.displayName} (en línea)`}
                    alt={peer.displayName}
                  />
                ) : (
                  <div
                    key={peer.userId}
                    className="collaborator-avatar"
                    style={{ backgroundColor: peer.color }}
                    title={`${peer.displayName} (en línea)`}
                  >
                    {peer.displayName.slice(0, 2).toUpperCase()}
                  </div>
                )
              ))}
            </div>
          )}

          {/* User Identity */}
          <div className="user-badge" title={`Conectado como ${user?.email}`}>
            {user?.photoURL ? (
              <img src={user.photoURL} className="user-avatar-photo" alt={userName} referrerPolicy="no-referrer" />
            ) : (
              <span className={`status-dot ${realtimeConnected ? 'connected' : 'disconnected'}`}></span>
            )}
            <span className="user-badge-name">{userName}</span>
          </div>

          {/* Desktop Direct Actions */}
          <div className="desktop-actions">
            <button className="btn btn-ghost btn-sm" onClick={handlePickDriveFile} title="Abrir desde Google Drive" disabled={!driveReady}>
              <FolderOpen size={15} />
              <span>Drive</span>
            </button>

            <button className="btn btn-ghost btn-sm" onClick={() => localFileInputRef.current?.click()} title="Abrir archivo local DWG/DXF">
              <Laptop size={15} />
              <span>Local</span>
            </button>

            {fileBuffer && (
              <>
                {authenticated && (
                  <button className="btn btn-accent btn-sm" onClick={handleSaveRevisionDrive} title="Guardar revisión en Google Drive">
                    <Save size={15} />
                    <span>Guardar Drive</span>
                  </button>
                )}

                <button className="btn btn-accent btn-sm" onClick={handleExportZipPackage} title="Descargar paquete completo: DXF + Carpeta de Fotos + Informe">
                  <Download size={15} />
                  <span>Exportar Marcas (DXF / ZIP)</span>
                </button>

                <button className="btn btn-ghost btn-sm" onClick={handleCaptureScreenshot} title="Captura de pantalla para WhatsApp">
                  <Camera size={15} />
                  <span>Captura</span>
                </button>
              </>
            )}

            {/* Fullscreen Button */}
            <button 
              className="btn btn-ghost btn-sm btn-fullscreen" 
              onClick={handleToggleFullscreen}
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa (Modo Obra)'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            {currentFileId && (
              <button className="btn btn-ghost btn-sm" onClick={handleCopyShareLink} title="Copiar enlace del plano">
                <Share2 size={15} />
              </button>
            )}
          </div>

          {/* Mobile Overflow Menu Toggle */}
          <button 
            className="btn btn-ghost btn-icon mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            title="Menú de opciones"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {isMobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="mobile-drawer glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Compass size={18} className="text-accent" />
                <h3 style={{ margin: 0 }}>Menú de Obra</h3>
              </div>
              <button className="btn-icon btn-ghost" onClick={() => setIsMobileMenuOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="mobile-drawer-items">
              <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); localFileInputRef.current?.click(); }}>
                <Laptop size={18} />
                <span>Abrir Archivo Local (.dwg / .dxf)</span>
              </button>
              
              <button className="drawer-item" onClick={handlePickDriveFile}>
                <FolderOpen size={18} />
                <span>Abrir Plano desde Google Drive</span>
              </button>

              <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); handleToggleFullscreen(); }}>
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                <span>{isFullscreen ? 'Salir de Pantalla Completa' : 'Modo Pantalla Completa'}</span>
              </button>

              {fileBuffer && (
                <>
                  <div className="drawer-divider"></div>
                  
                  <button className="drawer-item accent" onClick={() => { setIsMobileMenuOpen(false); setIsFindingsOpen(true); }}>
                    <ClipboardList size={18} />
                    <span>Ver Relevamiento ({pins.length} fotos/notas)</span>
                  </button>

                  {authenticated && (
                    <button className="drawer-item accent" onClick={handleSaveRevisionDrive}>
                      <Save size={18} />
                      <span>Guardar Revisión en Drive</span>
                    </button>
                  )}
                  <button className="drawer-item accent" onClick={() => { setIsMobileMenuOpen(false); handleToggleOrtho(); }}>
                    <Compass size={18} />
                    <span>Modo Ortogonal: {isOrthoEnabled ? 'ACTIVADO' : 'DESACTIVADO'}</span>
                  </button>
                  <button className="drawer-item" onClick={handleExportZipPackage}>
                    <Download size={18} />
                    <span>Exportar Paquete Relevamiento (ZIP + Fotos)</span>
                  </button>
                  <button className="drawer-item" onClick={handleDownloadRevisionDxf}>
                    <FileCheck2 size={18} />
                    <span>Descargar Solo Archivo DXF Liviano</span>
                  </button>
                  <button className="drawer-item" onClick={handleCaptureScreenshot}>
                    <Camera size={18} />
                    <span>Captura PNG / Compartir</span>
                  </button>
                  <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); setShowPins(!showPins); }}>
                    {showPins ? <EyeOff size={18} /> : <Eye size={18} />}
                    <span>{showPins ? 'Ocultar Marcadores' : 'Mostrar Marcadores'}</span>
                  </button>

                  <div className="drawer-divider"></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '4px 8px' }}>Color de Fondo del Plano:</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {BG_THEMES.map(theme => (
                      <button 
                        key={theme.id}
                        className={`drawer-item ${cadBgColor === theme.color ? 'accent' : ''}`}
                        style={{ padding: '8px 10px', fontSize: '0.78rem' }}
                        onClick={() => {
                          setCadBgColor(theme.color);
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        {theme.icon} {theme.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {currentFileId && (
                <button className="drawer-item" onClick={handleCopyShareLink}>
                  <Share2 size={18} />
                  <span>Copiar Enlace Compartible</span>
                </button>
              )}

              {/* Cerrar sesión */}
              <div className="drawer-divider"></div>
              <button className="drawer-item danger" onClick={() => { setIsMobileMenuOpen(false); signOutUser(); }}>
                <ExternalLink size={18} />
                <span>Cerrar Sesión ({userName})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Canvas / Viewer Container */}
      <main 
        ref={viewerContainerRef} 
        className="viewer-container"
        onClick={handleCanvasClickForPin}
        onPointerMove={handlePointerMove}
        onTouchEnd={handleCanvasTouchEnd}
      >
        {/* Drag & Drop Overlay */}
        {isDraggingFile && (
          <div className="drag-drop-overlay">
            <div className="drag-drop-box">
              <FolderOpen size={48} className="text-accent" />
              <h3>Suelta tu archivo DWG o DXF aquí</h3>
              <p>Se abrirá automáticamente en el visor.</p>
            </div>
          </div>
        )}
        {fileBuffer && activeTool !== 'pan' && (
          <div className="active-tool-banner">
            <div className="active-tool-info">
              <span className="active-tool-badge">
                {activeTool === 'line' && <Pencil size={15} />}
                {activeTool === 'circle' && <Circle size={15} />}
                {activeTool === 'mtext' && <MessageSquare size={15} />}
                {activeTool === 'dimension' && <Ruler size={15} />}
                {activeTool === 'revcloud' && <Cloud size={15} />}
                {activeTool === 'photo' && <Camera size={15} />}
                {activeTool === 'comment' && <MessageSquare size={15} />}
                {activeTool === 'situate' && <MapPin size={15} />}
                {activeTool === 'zoom' && <ZoomIn size={15} />}
                {activeTool === 'select' && <Crosshair size={15} />}
                <span style={{ textTransform: 'capitalize' }}>{activeTool === 'situate' ? 'Situar' : activeTool}</span>
              </span>
              <span className="active-tool-desc">
                {activeTool === 'line' && 'Haz clic o arrastra para trazar marcas.'}
                {activeTool === 'circle' && 'Haz clic para trazar círculos de revisión.'}
                {activeTool === 'mtext' && 'Haz clic en el plano para escribir texto técnico.'}
                {activeTool === 'dimension' && 'Haz clic en dos puntos para acotar distancia.'}
                {activeTool === 'revcloud' && 'Dibuja la nube sobre la zona a auditar.'}
                {activeTool === 'photo' && 'Toca el punto del plano para anexar foto de obra.'}
                {activeTool === 'comment' && 'Toca el punto del plano para insertar observación.'}
                {activeTool === 'situate' && 'Toque en el plano donde se encuentra ubicado en la obra.'}
                {activeTool === 'zoom' && 'Desliza o pellizca para acercar/alejar.'}
                {activeTool === 'select' && 'Toca elementos para seleccionarlos.'}
              </span>
            </div>
            <button className="btn-cancel-tool" onClick={handleCancelTool} title="Cancelar comando">
              <X size={15} />
              <span>Salir (ESC)</span>
            </button>
          </div>
        )}

        {/* Floating Canvas Controls HUD (Non-colliding) */}
        {fileBuffer && (
          <div className="canvas-hud">
            {/* Rotation & Compass button */}
            <button 
              className="canvas-hud-btn compass-hud-btn" 
              onClick={() => {
                const next = (rotationAngle + 90) % 360;
                setRotationAngle(next);
                showToast(`🧭 Orientación: ${next}°`);
              }}
              title={`Rotar plano 90° (Actual: ${rotationAngle}°)`}
            >
              <Compass 
                size={18} 
                style={{ 
                  transform: `rotate(${rotationAngle}deg)`, 
                  transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' 
                }} 
              />
              <span className="hud-degree-label">{rotationAngle === 0 ? 'N' : `${rotationAngle}°`}</span>
            </button>

            {rotationAngle !== 0 && (
              <button 
                className="canvas-hud-btn" 
                onClick={() => {
                  setRotationAngle(0);
                  showToast('🧭 Orientación restablecida a 0°');
                }}
                title="Restablecer orientación al Norte (0°)"
              >
                <RotateCcw size={15} />
              </button>
            )}


            <button 
              className={`canvas-hud-btn ${!showPins ? 'muted' : ''}`} 
              onClick={() => setShowPins(!showPins)} 
              title={showPins ? 'Ocultar marcadores' : 'Mostrar marcadores'}
            >
              {showPins ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>

            <button 
              className="canvas-hud-btn findings-hud-btn" 
              onClick={() => setIsFindingsOpen(!isFindingsOpen)} 
              title="Abrir Lista de Relevamiento de Obra"
            >
              <ClipboardList size={17} />
              {pins.length > 0 && <span className="canvas-hud-badge">{pins.length}</span>}
            </button>
          </div>
        )}

        {/* CAD Canvas or Empty State */}
        {fileBuffer ? (
          <>
            <CadViewer 
              ref={cadRef}
              fileData={fileBuffer}
              fileName={currentFileName}
              bgColor={cadBgColor}
              rotation={rotationAngle}
              onRotationChange={(angle) => setRotationAngle(angle)}
              onLoaded={() => {
                setIsLoading(false);
                showToast('Plano renderizado con éxito.');
              }}
              onError={(err) => {
                setIsLoading(false);
                showToast(typeof err === 'string' ? err : 'Error al cargar visor.');
              }}
            />

            {/* Live Peer Cursors in WCS */}
            {screenPeerCursors.map(({ user, screenX, screenY }) => (
              <div 
                key={user.userId}
                className="peer-cursor"
                style={{ 
                  left: `${screenX}px`, 
                  top: `${screenY}px`,
                  pointerEvents: 'none'
                }}
              >
                <svg className="peer-cursor-pointer" width="18" height="18" viewBox="0 0 16 16" fill={user.color}>
                  <path d="M0 0l4.5 13.5 2.5-4.5 4.5-2.5L0 0z" stroke="#000" strokeWidth="1" />
                </svg>
                <span className="peer-cursor-label" style={{ backgroundColor: user.color }}>
                  {user.displayName || 'Usuario'}
                </span>
              </div>
            ))}

            {/* Operator Station: "Estás Aquí" Beacon with Heading Cone */}
            {screenUserStation && (
              <div 
                className="user-station-pin"
                style={{ 
                  left: `${screenUserStation.screenX}px`, 
                  top: `${screenUserStation.screenY}px`,
                  pointerEvents: 'none'
                }}
              >
                <div className="station-radar-pulse"></div>
                {deviceHeading !== null && (
                  <div 
                    className="station-heading-cone" 
                    style={{ transform: `rotate(${deviceHeading - rotationAngle}deg)` }}
                  />
                )}
                <div className="station-dot">
                  <MapPin size={14} className="station-icon" />
                </div>
                <div className="station-tag">Estás aquí</div>
              </div>
            )}

            {/* WCS-Projected Interactive Pins (Photos and Comments) */}
            {showPins && screenPins.map(({ pin, screenX, screenY, isVisible }) => {
              if (!isVisible) return null;
              return (
                <div 
                  key={pin.id}
                  className={`cad-pin-marker ${pin.type}`}
                  style={{ left: `${screenX}px`, top: `${screenY}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPin(pin);
                  }}
                  title={`${pin.type === 'photo' ? 'Foto' : 'Nota'} de ${pin.author}: ${pin.note}`}
                >
                  <div className="pin-pulse"></div>
                  <div className="pin-icon">
                    {pin.type === 'photo' ? <Camera size={14} strokeWidth={2.5} /> : <MessageSquare size={14} strokeWidth={2.5} />}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="empty-state">
            {currentFileId ? (
              <div className="shared-plan-card glass-panel">
                <FolderOpen size={48} className="text-accent" style={{ margin: '0 auto 12px auto' }} />
                <h3>Plano Compartido</h3>
                <p className="shared-file-title">
                  {currentFileName || 'Plano de obra'}
                </p>
                <p className="shared-file-desc">
                  Te uniste a la sala de relevamiento. Si no se cargó automáticamente, haz clic abajo para reintentar.
                </p>
                <button 
                  className="btn btn-accent" 
                  onClick={handleLoadSharedFile}
                  disabled={isLoading}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <RotateCcw size={16} />
                  <span>Reintentar Carga del Plano</span>
                </button>
              </div>
            ) : (
              <div className="empty-state-card glass-panel">
                <div className="empty-state-icon">
                  <Compass size={36} strokeWidth={2} />
                </div>
                <h2>Visor CAD de Obra</h2>
                <p>
                  Abre planos DWG/DXF en segundos, mide distancias, traza nubes de revisión, anexa fotos geolocalizadas y exporta tus marcas.
                </p>
                <div className="empty-state-actions">
                  <button className="btn btn-accent" onClick={() => localFileInputRef.current?.click()}>
                    <Laptop size={18} />
                    <span>Abrir Plano Local</span>
                  </button>
                  <button className="btn btn-ghost" onClick={handlePickDriveFile} disabled={!driveReady}>
                    <FolderOpen size={18} />
                    <span>Google Drive</span>
                  </button>
                </div>
                <p className="drag-hint">O arrastra tu archivo DWG/DXF directamente aquí</p>
              </div>
            )}
          </div>
        )}

        {/* Operator Station Floating Contextual HUD */}
        {fileBuffer && userStation && (
          <div className="station-quick-hud glass-panel">
            <div className="station-hud-info">
              <span className="station-hud-dot"></span>
              <span className="station-coords">Posición: ({userStation.worldX.toFixed(1)}, {userStation.worldY.toFixed(1)})</span>
              {deviceHeading !== null && <span className="station-heading-tag">🧭 {deviceHeading}°</span>}
            </div>
            <div className="station-hud-actions">
              <button 
                className="btn btn-sm btn-accent" 
                onClick={() => {
                  setPendingWorldCoord({ x: userStation.worldX, y: userStation.worldY });
                  cameraInputRef.current?.click();
                }}
                title="Anexar foto en mi posición actual"
              >
                <Camera size={14} />
                <span>Foto Aquí</span>
              </button>
              <button 
                className="btn btn-sm btn-ghost" 
                onClick={() => {
                  setPendingWorldCoord({ x: userStation.worldX, y: userStation.worldY });
                  setNewCommentNote('');
                  setIsCommentModalOpen(true);
                }}
                title="Anexar nota en mi posición actual"
              >
                <MessageSquare size={14} />
                <span>Nota Aquí</span>
              </button>
              <button 
                className={`btn btn-sm ${isTrackingGps ? 'btn-accent' : 'btn-ghost'}`} 
                onClick={handleToggleGpsTracking}
                title="Activar o pausar seguimiento GPS satelital"
              >
                <span>{isTrackingGps ? '🛰️ GPS Activo' : '🛰️ Rastrear GPS'}</span>
              </button>
              <button 
                className="btn-icon btn-ghost btn-sm" 
                onClick={() => setUserStation(null)}
                title="Quitar punto de posición"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Floating Modern Ergonomic Toolbar (Desktop & Tablet) */}
        {fileBuffer && (
          <div className="toolbar-dock glass-panel">
            {/* Group 1: Navigation */}
            <div className="toolbar-group">
              <button 
                className={`toolbar-btn ${activeTool === 'pan' ? 'active' : ''}`} 
                onClick={() => handleToolChange('pan')}
                title="Mover (Pan)"
              >
                <Hand size={19} />
                <span className="toolbar-tooltip">Mover</span>
              </button>
              <button 
                className={`toolbar-btn ${activeTool === 'zoom' ? 'active' : ''}`} 
                onClick={() => handleToolChange('zoom')}
                title="Zoom"
              >
                <ZoomIn size={19} />
                <span className="toolbar-tooltip">Zoom</span>
              </button>
              <button 
                className="toolbar-btn" 
                onClick={() => cadRef.current?.zoomExtents()}
                title="Centrar Todo (Zoom Extents)"
              >
                <Focus size={19} />
                <span className="toolbar-tooltip">Centrar</span>
              </button>
            </div>

            <div className="toolbar-divider"></div>

            {/* Group 2: Measurement & Drawing */}
            <div className="toolbar-group">
              <button 
                className={`toolbar-btn ${activeTool === 'dimension' ? 'active' : ''}`} 
                onClick={() => handleToolChange('dimension')}
                title="Medición / Cota Lineal"
              >
                <Ruler size={19} />
                <span className="toolbar-tooltip">Medir</span>
              </button>
              <button 
                className={`toolbar-btn ${activeTool === 'revcloud' ? 'active' : ''}`} 
                onClick={() => handleToolChange('revcloud')}
                title="Nube de Revisión"
              >
                <Cloud size={19} />
                <span className="toolbar-tooltip">Nube</span>
              </button>
              <button 
                className={`toolbar-btn desktop-only ${activeTool === 'line' ? 'active' : ''}`} 
                onClick={() => handleToolChange('line')}
                title="Trazar Línea"
              >
                <Pencil size={19} />
                <span className="toolbar-tooltip">Línea</span>
              </button>
              <button 
                className={`toolbar-btn desktop-only ${activeTool === 'circle' ? 'active' : ''}`} 
                onClick={() => handleToolChange('circle')}
                title="Trazar Círculo"
              >
                <Circle size={19} />
                <span className="toolbar-tooltip">Círculo</span>
              </button>
              <button 
                className={`toolbar-btn ${isOrthoEnabled ? 'active-ortho' : ''}`} 
                onClick={handleToggleOrtho} 
                title={`Modo Ortogonal (F8) [${isOrthoEnabled ? 'ON' : 'OFF'}]`}
              >
                <Compass size={19} />
                <span className="toolbar-tooltip">Modo Ortogonal</span>
              </button>
            </div>

            <div className="toolbar-divider"></div>

            {/* Group 3: Obra & Relevamiento (High Visibility) */}
            <div className="toolbar-group">
              <button 
                className={`toolbar-btn ${activeTool === 'situate' ? 'active' : ''}`} 
                onClick={() => handleToolChange('situate')}
                title="Situar mi posición actual en la obra"
              >
                <MapPin size={19} />
                <span className="toolbar-tooltip">Situar</span>
              </button>

              <button 
                className={`toolbar-btn toolbar-btn-highlight ${activeTool === 'photo' ? 'active' : ''}`} 
                onClick={() => handleToolChange('photo')}
                title="Anexar Foto de Obra con Cámara"
              >
                <Camera size={20} />
                {pins.filter(p => p.type === 'photo').length > 0 && (
                  <span className="toolbar-badge photo-badge">
                    {pins.filter(p => p.type === 'photo').length}
                  </span>
                )}
                <span className="toolbar-tooltip">Foto Obra</span>
              </button>

              <button 
                className={`toolbar-btn ${activeTool === 'comment' ? 'active' : ''}`} 
                onClick={() => handleToolChange('comment')}
                title="Añadir Nota / Comentario"
              >
                <MessageSquare size={19} />
                {pins.filter(p => p.type === 'comment').length > 0 && (
                  <span className="toolbar-badge comment-badge">
                    {pins.filter(p => p.type === 'comment').length}
                  </span>
                )}
                <span className="toolbar-tooltip">Nota</span>
              </button>

              <button 
                className={`toolbar-btn ${isFindingsOpen ? 'active' : ''}`} 
                onClick={() => setIsFindingsOpen(!isFindingsOpen)}
                title="Lista de Relevamiento de Obra"
              >
                <ClipboardList size={19} />
                <span className="toolbar-tooltip">Relevamiento</span>
              </button>
            </div>

            <div className="toolbar-divider"></div>

            {/* Group 4: Layers */}
            <div className="toolbar-group">
              <button 
                className={`toolbar-btn ${isSidebarOpen ? 'active' : ''}`} 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                title="Gestión de Capas"
              >
                <Layers size={19} />
                <span className="toolbar-tooltip">Capas</span>
              </button>
            </div>
          </div>
        )}

        {/* Layers Sidebar */}
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Layers size={18} className="text-accent" />
                <h3 style={{ margin: 0 }}>Capas del Plano</h3>
              </div>
              <span className="sidebar-subtitle">{visibleLayersCount} de {rawLayers.length} visibles</span>
            </div>
            <button className="sidebar-close" onClick={() => setIsSidebarOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="sidebar-toolbar">
            <div className="sidebar-search-box">
              <Search size={15} className="search-icon" />
              <input 
                type="text" 
                className="layer-search-input" 
                placeholder="Buscar capa..."
                value={layerSearch}
                onChange={(e) => setLayerSearch(e.target.value)}
              />
            </div>
            <div className="layer-quick-actions">
              <button 
                className="btn-layer-action" 
                onClick={() => cadRef.current?.setAllLayersVisible(true)}
                title="Mostrar todas las capas"
              >
                <Eye size={13} /> Todas
              </button>
              <button 
                className="btn-layer-action" 
                onClick={() => cadRef.current?.setAllLayersVisible(false)}
                title="Ocultar todas las capas"
              >
                <EyeOff size={13} /> Ninguna
              </button>
            </div>
          </div>

          <div className="sidebar-content">
            {filteredLayers.length > 0 ? (
              filteredLayers.map((layer) => (
                <div key={layer.name} className="layer-item">
                  <div 
                    className="layer-color-swatch" 
                    style={{ backgroundColor: `#${layer.color.toString(16).padStart(6, '0')}` }} 
                  />
                  <span className="layer-name" title={layer.name}>
                    {layer.name.startsWith('REV_') ? `☁️ ${layer.name}` : layer.name}
                  </span>
                  <button 
                    className={`layer-toggle ${layer.visible ? 'on' : ''}`}
                    onClick={() => cadRef.current?.toggleLayer(layer.name)}
                    title={layer.visible ? 'Apagar capa' : 'Encender capa'}
                  >
                    {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </div>
              ))
            ) : (
              <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                {rawLayers.length === 0 ? 'No hay capas disponibles.' : 'No se encontraron capas coincidentes.'}
              </div>
            )}
          </div>
        </aside>

        {/* Survey / Findings Drawer (Relevamiento de Obra) */}
        <aside className={`sidebar findings-drawer ${isFindingsOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClipboardList size={18} className="text-accent" />
                <h3 style={{ margin: 0 }}>Relevamiento de Obra</h3>
              </div>
              <span className="sidebar-subtitle">
                {pins.filter(p => p.type === 'photo').length} fotos • {pins.filter(p => p.type === 'comment').length} notas
              </span>
            </div>
            <button className="sidebar-close" onClick={() => setIsFindingsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="sidebar-toolbar">
            <div className="sidebar-search-box">
              <Search size={15} className="search-icon" />
              <input 
                type="text" 
                className="layer-search-input" 
                placeholder="Filtrar por autor o nota..."
                value={findingsSearch}
                onChange={(e) => setFindingsSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="sidebar-content findings-list">
            {pins
              .filter(p => 
                p.note.toLowerCase().includes(findingsSearch.toLowerCase()) || 
                p.author.toLowerCase().includes(findingsSearch.toLowerCase())
              )
              .map((pin) => (
                <div 
                  key={pin.id} 
                  className="finding-card" 
                  onClick={() => setSelectedPin(pin)}
                >
                  <div className="finding-header">
                    <span className={`finding-type-badge ${pin.type}`}>
                      {pin.type === 'photo' ? <Camera size={12} /> : <MessageSquare size={12} />}
                      <span>{pin.type === 'photo' ? 'Foto de Obra' : 'Nota'}</span>
                    </span>
                    <span className="finding-time">{pin.timestamp.split(',')[1] || pin.timestamp}</span>
                  </div>

                  {pin.type === 'photo' && pin.photoDataUrl && (
                    <div className="finding-thumb-wrapper">
                      <img src={pin.photoDataUrl} alt="Miniatura" className="finding-thumb" />
                    </div>
                  )}

                  <p className="finding-note">{pin.note}</p>
                  
                  <div className="finding-footer">
                    <span className="finding-author">👷 {pin.author}</span>
                    <span className="finding-wcs">({pin.worldX.toFixed(1)}, {pin.worldY.toFixed(1)})</span>
                  </div>
                </div>
              ))}

            {pins.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Camera size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <p style={{ margin: 0, fontSize: '0.85rem' }}>No hay fotos ni notas registradas aún.</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.78rem', opacity: 0.8 }}>
                  Toca la herramienta de cámara o nota para anexar observaciones sobre el plano.
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Modal: New Photo Capture / Note */}
      {newPhotoData && (
        <div className="modal-overlay" onClick={() => { setNewPhotoData(null); setPendingWorldCoord(null); setActiveTool('pan'); }}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Camera size={18} className="text-accent" />
                <h3 style={{ margin: 0 }}>Anexar Foto de Obra</h3>
              </div>
              <button className="btn-icon btn-ghost" onClick={() => { setNewPhotoData(null); setPendingWorldCoord(null); setActiveTool('pan'); }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="photo-preview-container">
                <img src={newPhotoData} alt="Foto capturada" className="photo-preview-img" />
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Observación Técnica del Relevamiento:</label>
                <textarea 
                  className="input-field" 
                  rows={3} 
                  placeholder="Ej: Fisura en columna C-4 / Encofrado listo para hormigonar"
                  value={newPhotoNote}
                  onChange={(e) => setNewPhotoNote(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                Coordenadas WCS: ({pendingWorldCoord?.x.toFixed(2)}, {pendingWorldCoord?.y.toFixed(2)}) • <strong>{userName}</strong>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setNewPhotoData(null); setPendingWorldCoord(null); setActiveTool('pan'); }}>
                Cancelar
              </button>
              <button className="btn btn-accent" onClick={handleSavePhotoPin}>
                <Save size={15} />
                <span>Fijar en el Plano</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Comment Note */}
      {isCommentModalOpen && (
        <div className="modal-overlay" onClick={() => { setIsCommentModalOpen(false); setPendingWorldCoord(null); setActiveTool('pan'); }}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquare size={18} className="text-accent" />
                <h3 style={{ margin: 0 }}>Agregar Comentario de Obra</h3>
              </div>
              <button className="btn-icon btn-ghost" onClick={() => { setIsCommentModalOpen(false); setPendingWorldCoord(null); setActiveTool('pan'); }}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Comentario o Instrucción Técnica:</label>
                <textarea 
                  className="input-field" 
                  rows={4} 
                  placeholder="Ej: Modificar cota de antepecho a 1.10m según detalle de carpintería"
                  value={newCommentNote}
                  onChange={(e) => setNewCommentNote(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Autor: <strong>{userName}</strong> • {new Date().toLocaleTimeString()}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setIsCommentModalOpen(false); setPendingWorldCoord(null); setActiveTool('pan'); }}>
                Cancelar
              </button>
              <button className="btn btn-accent" onClick={handleSaveCommentPin} disabled={!newCommentNote.trim()}>
                <Save size={15} />
                <span>Fijar Comentario</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Pin Details (Photo or Comment) */}
      {selectedPin && (
        <div className="modal-overlay" onClick={() => setSelectedPin(null)}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {selectedPin.type === 'photo' ? <Camera size={18} className="text-accent" /> : <MessageSquare size={18} className="text-accent" />}
                <h3 style={{ margin: 0 }}>{selectedPin.type === 'photo' ? 'Foto de Relevamiento' : 'Nota de Obra'}</h3>
              </div>
              <button className="btn-icon btn-ghost" onClick={() => setSelectedPin(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {selectedPin.type === 'photo' && selectedPin.photoDataUrl && (
                <div className="photo-preview-container full">
                  <img src={selectedPin.photoDataUrl} alt="Foto de obra ampliada" className="photo-full-img" />
                </div>
              )}
              <div className="photo-detail-info">
                <p className="photo-note-text">{selectedPin.note}</p>
                <div className="photo-meta">
                  <span>👷 <strong>{selectedPin.author}</strong></span>
                  <span>📅 {selectedPin.timestamp}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Posición WCS: ({selectedPin.worldX.toFixed(2)}, {selectedPin.worldY.toFixed(2)})
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-danger btn-sm" onClick={() => handleDeletePin(selectedPin.id)}>
                <Trash2 size={15} />
                <span>Eliminar</span>
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedPin.type === 'photo' && selectedPin.photoDataUrl && (
                  <a 
                    href={selectedPin.photoDataUrl} 
                    download={`Foto_Obra_${selectedPin.id}.jpg`} 
                    className="btn btn-ghost btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    <Download size={15} />
                    <span>Descargar</span>
                  </a>
                )}
                <button className="btn btn-accent btn-sm" onClick={() => setSelectedPin(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern CAD Loading Overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="cad-loader-card glass-panel">
            <div className="cad-loader-graphic">
              <div className="cad-loader-ring outer"></div>
              <div className="cad-loader-ring inner"></div>
              <div className="cad-loader-crosshair"></div>
              <div className="cad-loader-icon">
                <Compass size={32} className="cad-loader-compass" />
              </div>
            </div>
            <div className="cad-loader-brand">CAD DRIVE OBRA</div>
            <div className="loading-text">{loadingMsg || 'Cargando plano...'}</div>
            <div className="cad-loader-bar">
              <div className="cad-loader-bar-fill"></div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
