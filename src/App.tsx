import { useState, useRef, useEffect, useCallback } from 'react';
import { useGoogleDrive } from './useGoogleDrive';
import { CadViewer } from './CadViewer';
import type { CadViewerRef } from './CadViewer';
import { RealtimeManager } from './realtime/RealtimeManager';
import type { UserPresence, RealtimeMessage } from './realtime/types';
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
  { id: 'white', label: 'Blanco Papel', color: '#ffffff', icon: '⚪' }
];

export default function App() {
  const { 
    ready, 
    authenticated, 
    handleAuthClick, 
    handleSignoutClick, 
    openPicker, 
    downloadFile, 
    uploadDxf 
  } = useGoogleDrive();

  const [userName, setUserName] = useState('');
  const [isIdentified, setIsIdentified] = useState(false);
  
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [parentFolderId, setParentFolderId] = useState<string | undefined>(undefined);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [activeTool, setActiveTool] = useState<'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'revcloud' | 'photo' | 'comment'>('pan');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [cadBgColor, setCadBgColor] = useState('#000000');
  const [layerSearch, setLayerSearch] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  // Multiusuario Realtime State
  const [peers, setPeers] = useState<UserPresence[]>([]);
  const [screenPeerCursors, setScreenPeerCursors] = useState<Array<{ user: UserPresence; screenX: number; screenY: number }>>([]);
  const realtimeRef = useRef<RealtimeManager | null>(null);

  // Ortho mode
  const [isOrthoEnabled, setIsOrthoEnabled] = useState(false);

  // WCS Anchored Pins (Photos + Comments)
  const [pins, setPins] = useState<CadPin[]>([]);
  const [showPins, setShowPins] = useState(true);
  const [screenPins, setScreenPins] = useState<Array<{ pin: CadPin; screenX: number; screenY: number; isVisible: boolean }>>([]);
  
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

  // Initialize Realtime Collaboration Manager
  useEffect(() => {
    if (!isIdentified || !userName) return;

    const roomId = currentFileId || currentFileName || 'default_room';
    const rt = new RealtimeManager(roomId, userName);
    realtimeRef.current = rt;

    const unsubPresence = rt.onPresenceChange((activePeers) => {
      setPeers(activePeers);
    });

    const unsubMessages = rt.onMessage((msg: RealtimeMessage) => {
      if (msg.type === 'pin_add') {
        const newPin = msg.payload?.pin as CadPin;
        if (newPin) {
          setPins(prev => {
            if (prev.some(p => p.id === newPin.id)) return prev;
            const updated = [...prev, newPin];
            savePinsToStorage(updated);
            return updated;
          });
          showToast(`👷 ${msg.sender.userName} agregó una ${newPin.type === 'photo' ? 'foto' : 'nota'} al plano.`);
        }
      } else if (msg.type === 'pin_delete') {
        const pinId = msg.payload?.pinId;
        if (pinId) {
          setPins(prev => {
            const updated = prev.filter(p => p.id !== pinId);
            savePinsToStorage(updated);
            return updated;
          });
        }
      }
    });

    return () => {
      unsubPresence();
      unsubMessages();
      rt.destroy();
      realtimeRef.current = null;
    };
  }, [isIdentified, userName, currentFileId, currentFileName]);


  // Check saved name and URL parameters on mount
  useEffect(() => {
    const savedName = localStorage.getItem('cadViewerUserName');
    if (savedName) {
      setUserName(savedName);
      setIsIdentified(true);
    }

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

  // Save pins to localStorage
  const savePinsToStorage = useCallback((updatedPins: CadPin[]) => {
    if (!currentFileName) return;
    const key = `cad_pins_${currentFileName}`;
    localStorage.setItem(key, JSON.stringify(updatedPins));
  }, [currentFileName]);

  // Dynamic RAF loop to project CAD World Coordinates (WCS) to Screen Pixels (Pins + Peer Cursors)
  useEffect(() => {
    let active = true;

    const updateScreenEntities = () => {
      if (!active) return;

      if (cadRef.current && viewerContainerRef.current) {
        const containerRect = viewerContainerRef.current.getBoundingClientRect();
        
        // 1. Project Pins
        if (pins.length > 0) {
          const projected = pins.map((p) => {
            const pt = cadRef.current?.worldToScreen(p.worldX, p.worldY);
            if (!pt) {
              return { pin: p, screenX: -999, screenY: -999, isVisible: false };
            }
            const isInside = pt.x >= -30 && pt.x <= containerRect.width + 30 && pt.y >= -30 && pt.y <= containerRect.height + 30;
            return {
              pin: p,
              screenX: pt.x,
              screenY: pt.y,
              isVisible: isInside
            };
          });
          setScreenPins(projected);
        } else {
          setScreenPins([]);
        }

        // 2. Project Peer Cursors
        if (peers.length > 0) {
          const projectedCursors: Array<{ user: UserPresence; screenX: number; screenY: number }> = [];
          peers.forEach(peer => {
            if (peer.cursor) {
              const pt = cadRef.current?.worldToScreen(peer.cursor.worldX, peer.cursor.worldY);
              if (pt && pt.x >= -20 && pt.x <= containerRect.width + 20 && pt.y >= -20 && pt.y <= containerRect.height + 20) {
                projectedCursors.push({ user: peer, screenX: pt.x, screenY: pt.y });
              }
            }
          });
          setScreenPeerCursors(projectedCursors);
        } else {
          setScreenPeerCursors([]);
        }
      }

      animFrameRef.current = requestAnimationFrame(updateScreenEntities);
    };

    animFrameRef.current = requestAnimationFrame(updateScreenEntities);

    return () => {
      active = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [pins, peers]);


  // Auto-download file if shared URL parameter is present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedFileId = params.get('fileId');

    if (sharedFileId && isIdentified && !fileBuffer && !isLoading) {
      const loadSharedFile = async () => {
        setIsLoading(true);
        setLoadingMsg(`Cargando plano compartido (${currentFileName})...`);
        const buffer = await downloadFile(sharedFileId);
        if (buffer) {
          setFileBuffer(buffer);
          showToast(`Plano ${currentFileName} cargado exitosamente.`);
        } else {
          showToast('No se pudo descargar el plano. Verifica permisos de acceso.');
        }
        setIsLoading(false);
      };
      loadSharedFile();
    }
  }, [isIdentified, downloadFile]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleIdentify = (e: React.FormEvent) => {
    e.preventDefault();
    if (userName.trim()) {
      setIsIdentified(true);
      localStorage.setItem('cadViewerUserName', userName);
    }
  };

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
    showToast('🔗 ¡Enlace de revisión copiado al portapapeles!');
  };

  // Tool change & Revision Cloud with Layer metadata
  const handleToolChange = (tool: 'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'revcloud' | 'photo' | 'comment') => {
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
    }

    if (tool !== 'photo' && tool !== 'comment') {
      cadRef.current?.setTool(tool);
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

  // DXF Export to Google Drive (Full Plan + Annotations)
  const handleSaveRevisionDrive = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Exportando marcas y entidades en formato DXF...');

    try {
      const dxfBuffer = await cadRef.current.exportDxfBuffer(pins);
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
        showToast('Error al subir a Drive. Usa "Descargar DXF" para guardarlo localmente.');
      }
    } catch (e) {
      console.error(e);
      showToast('Ocurrió un error al guardar la revisión.');
    } finally {
      setIsLoading(false);
    }
  };

  // Direct Local DXF Download (Full Plan + Annotations)
  const handleDownloadLocalDxf = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Generando archivo DXF completo para descarga...');

    try {
      const dxfBuffer = await cadRef.current.exportDxfBuffer(pins);
      if (!dxfBuffer) {
        showToast('No se pudo generar el archivo DXF.');
        setIsLoading(false);
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const baseName = currentFileName.substring(0, currentFileName.lastIndexOf('.')) || currentFileName;
      const downloadFileName = `${baseName}_Completo_${dateStr}.dxf`;

      const blob = new Blob([dxfBuffer], { type: 'application/dxf;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`💾 Archivo completo "${downloadFileName}" descargado.`);
    } catch (e) {
      console.error(e);
      showToast('Error al descargar el archivo DXF.');
    } finally {
      setIsLoading(false);
    }
  };

  // Direct Local Lightweight Revision DXF Download (Only markups, clouds, photos, notes)
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

  // Screenshot / Snapshot Capture
  const handleCaptureScreenshot = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current) return;

    try {
      const dataUrl = cadRef.current.captureCanvas();
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
      a.download = `${currentFileName || 'Plano'}_Captura.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('📸 Captura descargada.');
    } catch (e) {
      console.error('Screenshot error:', e);
      showToast('Error al capturar la pantalla.');
    }
  };

  // Click on Canvas for WCS-anchored Photos or Comments
  const handleCanvasClickForPin = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'photo' && activeTool !== 'comment') return;
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

    setPendingWorldCoord(worldPoint);

    if (activeTool === 'photo') {
      cameraInputRef.current?.click();
    } else if (activeTool === 'comment') {
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
    if (!viewerContainerRef.current || !cadRef.current || !realtimeRef.current) return;
    const rect = viewerContainerRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPt = cadRef.current.screenToWorld(screenX, screenY);
    if (worldPt) {
      realtimeRef.current.sendCursor(worldPt.x, worldPt.y);
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
    realtimeRef.current?.broadcastPin(newPin);

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
    realtimeRef.current?.broadcastPin(newPin);

    setIsCommentModalOpen(false);
    setPendingWorldCoord(null);
    setActiveTool('pan');
    showToast('💬 ¡Comentario fijado al plano en coordenadas CAD!');
  };

  const handleDeletePin = (pinId: string) => {
    const updated = pins.filter(p => p.id !== pinId);
    setPins(updated);
    savePinsToStorage(updated);
    realtimeRef.current?.broadcastDeletePin(pinId);
    setSelectedPin(null);
    showToast('Marcador eliminado.');
  };


  // Filter layers
  const rawLayers = cadRef.current?.getLayers() || [];
  const filteredLayers = rawLayers.filter(l => 
    l.name.toLowerCase().includes(layerSearch.toLowerCase())
  );
  const visibleLayersCount = rawLayers.filter(l => l.visible).length;

  // Screen 1: Welcome / Identify Screen
  if (!isIdentified) {
    return (
      <div className="welcome-screen">
        <div className="welcome-card glass-panel">
          <div className="app-logo-icon" style={{ width: 56, height: 56, margin: '0 auto 16px auto', fontSize: '1.4rem' }}>
            CAD
          </div>
          <h1>CAD Drive Obra</h1>
          <p className="subtitle">
            {currentFileName 
              ? `Te han compartido el plano "${currentFileName}". Identifícate con tu nombre para comenzar la revisión.` 
              : 'Visor y marcado de planos en obra compatible con celulares y computadoras. Identifícate para registrar tus firmas y fotos.'}
          </p>
          <form onSubmit={handleIdentify} className="welcome-form">
            <input 
              type="text" 
              className="input-field"
              placeholder="Tu Nombre / Rol (Ej: Arq. Alan - Obra 2)" 
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-accent" style={{ padding: '14px', fontSize: '1rem' }}>
              🚀 Ingresar al Visor
            </button>
          </form>
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
        <div className="app-logo">
          <div className="app-logo-icon">CAD</div>
          <div>
            <h1 className="app-title">CAD Drive Viewer</h1>
            <p className="app-subtitle">Revisión Móvil & Obra</p>
          </div>
        </div>

        {/* User status & quick actions */}
        <div className="header-actions">
          {/* Background Theme Selector Dropdown */}
          <div className="theme-selector-wrapper">
            <button 
              className="btn btn-ghost btn-sm theme-btn" 
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
              title="Cambiar color de fondo del plano"
            >
              🎨 {BG_THEMES.find(t => t.color === cadBgColor)?.icon}
            </button>
            {isThemeMenuOpen && (
              <div className="theme-dropdown glass-panel">
                <div className="theme-dropdown-header">Color de Fondo</div>
                {BG_THEMES.map(theme => (
                  <button 
                    key={theme.id}
                    className={`theme-option ${cadBgColor === theme.color ? 'active' : ''}`}
                    onClick={() => {
                      setCadBgColor(theme.color);
                      setIsThemeMenuOpen(false);
                    }}
                  >
                    <span>{theme.icon} {theme.label}</span>
                    <div className="theme-color-preview" style={{ backgroundColor: theme.color }}></div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Live Multi-user Collaborators Avatars */}
          {peers.length > 0 && (
            <div className="collaborators-group" title="Usuarios colaborando en este plano en tiempo real">
              {peers.map((c) => (
                <div 
                  key={c.userId} 
                  className="collaborator-avatar" 
                  style={{ backgroundColor: c.color }}
                  title={`${c.userName} (Revisor en línea)`}
                >
                  {c.userName.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          )}

          <span className="user-badge" title={`Conectado como ${userName}`}>
            <span className={`status-dot ${authenticated ? 'connected' : 'disconnected'}`}></span>
            <span className="user-badge-name">{userName}</span>
          </span>

          {/* Desktop Direct Actions */}
          <div className="desktop-actions">
            {!authenticated ? (
              <button className="btn btn-ghost btn-sm" onClick={handleAuthClick} disabled={!ready} title="Conectar Drive">
                🔑 Drive
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={handlePickDriveFile} title="Abrir desde Google Drive">
                📂 Drive
              </button>
            )}

            <button className="btn btn-ghost btn-sm" onClick={() => localFileInputRef.current?.click()} title="Abrir archivo desde este equipo">
              💻 Abrir Local
            </button>

            {fileBuffer && (
              <>
                <button 
                  className={`btn btn-sm ${isOrthoEnabled ? 'btn-accent' : 'btn-ghost'}`} 
                  onClick={handleToggleOrtho} 
                  title="Modo Ortogonal (F8) - Forzar líneas y cotas a 90°"
                >
                  📐 {isOrthoEnabled ? 'ORTO: ON' : 'Orto'}
                </button>

                {authenticated && (
                  <button className="btn btn-accent btn-sm" onClick={handleSaveRevisionDrive} title="Guardar revisión en Google Drive">
                    💾 Guardar en Drive
                  </button>
                )}

                <button className="btn btn-accent btn-sm" onClick={handleDownloadRevisionDxf} title="Descargar capa liviana con nubes, marcas, cotas y fotos">
                  🎯 Exportar Marcas (DXF)
                </button>

                <button className="btn btn-ghost btn-sm" onClick={handleDownloadLocalDxf} title="Descargar plano completo con todas las capas originales y marcas">
                  ⬇️ Plano Completo (DXF)
                </button>

                <button className="btn btn-ghost btn-sm" onClick={handleCaptureScreenshot} title="Captura de pantalla">
                  📸 Captura
                </button>
              </>
            )}

            {currentFileId && (
              <button className="btn btn-ghost btn-sm" onClick={handleCopyShareLink} title="Compartir enlace">
                🔗
              </button>
            )}
          </div>

          {/* Mobile Overflow Menu Toggle */}
          <button 
            className="btn btn-ghost btn-icon mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            title="Menú de opciones"
          >
            ☰
          </button>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {isMobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="mobile-drawer glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <h3>Opciones del Plano</h3>
              <button className="btn-icon btn-ghost" onClick={() => setIsMobileMenuOpen(false)}>✕</button>
            </div>
            <div className="mobile-drawer-items">
              <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); localFileInputRef.current?.click(); }}>
                💻 Abrir Archivo Local (.dwg / .dxf)
              </button>
              
              {!authenticated ? (
                <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); handleAuthClick(); }}>
                  🔑 Conectar Google Drive
                </button>
              ) : (
                <button className="drawer-item" onClick={handlePickDriveFile}>
                  📂 Abrir Plano desde Google Drive
                </button>
              )}

              {fileBuffer && (
                <>
                  <div className="drawer-divider"></div>
                  {authenticated && (
                    <button className="drawer-item accent" onClick={handleSaveRevisionDrive}>
                      💾 Guardar Revisión en Google Drive
                    </button>
                  )}
                  <button className="drawer-item accent" onClick={() => { setIsMobileMenuOpen(false); handleToggleOrtho(); }}>
                    📐 Modo Ortogonal (ORTO): {isOrthoEnabled ? 'ACTIVADO' : 'DESACTIVADO'}
                  </button>
                  <button className="drawer-item" onClick={handleDownloadRevisionDxf}>
                    🎯 Descargar Solo Marcas y Fotos (DXF Liviano)
                  </button>
                  <button className="drawer-item" onClick={handleDownloadLocalDxf}>
                    ⬇️ Descargar Plano Completo (DXF)
                  </button>
                  <button className="drawer-item" onClick={handleCaptureScreenshot}>
                    📸 Captura PNG / Compartir por WhatsApp
                  </button>
                  <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); setShowPins(!showPins); }}>
                    {showPins ? '🕶️ Ocultar Fotos y Notas' : '👁️ Mostrar Fotos y Notas'} ({pins.length})
                  </button>

                  <div className="drawer-divider"></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '4px 8px' }}>Color de Fondo:</div>
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
                  🔗 Copiar Enlace Compartible
                </button>
              )}

              {authenticated && (
                <>
                  <div className="drawer-divider"></div>
                  <button className="drawer-item danger" onClick={() => { setIsMobileMenuOpen(false); handleSignoutClick(); }}>
                    🚪 Desconectar Google Drive
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-header File Info Bar */}
      {currentFileName && (
        <div className="file-info-bar">
          <span className="file-label">Plano:</span>
          <span className="file-name" title={currentFileName}>{currentFileName}</span>
          <span className="separator">|</span>
          <span className="user-tag">👷 {userName}</span>
          {pins.length > 0 && (
            <>
              <span className="separator">|</span>
              <span className="photo-tag" onClick={() => setShowPins(!showPins)} style={{ cursor: 'pointer' }}>
                📍 {pins.filter(p => p.type === 'photo').length} fotos • {pins.filter(p => p.type === 'comment').length} notas
              </span>
            </>
          )}
        </div>
      )}

      {/* Main Canvas / Viewer Container */}
      <main 
        ref={viewerContainerRef} 
        className="viewer-container"
        onClick={handleCanvasClickForPin}
        onPointerMove={handlePointerMove}
      >
        {/* Drag & Drop Overlay */}
        {isDraggingFile && (
          <div className="drag-drop-overlay">
            <div className="drag-drop-box">
              <div style={{ fontSize: '3rem' }}>📂</div>
              <h3>Suelta tu archivo DWG o DXF aquí</h3>
              <p>Se abrirá automáticamente en el visor.</p>
            </div>
          </div>
        )}

        {/* Active Tool Helper / Cancel Banner */}
        {fileBuffer && activeTool !== 'pan' && (
          <div className="active-tool-banner">
            <span>
              {activeTool === 'line' && '✏️ Modo Línea: Haz clic o arrastra para trazar marcas.'}
              {activeTool === 'circle' && '⭕ Modo Círculo: Haz clic para trazar círculos de revisión.'}
              {activeTool === 'mtext' && '📝 Modo Texto CAD: Haz clic en el plano para escribir texto.'}
              {activeTool === 'dimension' && '📏 Modo Medición: Haz clic en dos puntos para acotar distancia.'}
              {activeTool === 'revcloud' && '☁️ Modo Nube de Revisión: Dibuja la nube sobre la zona a auditar.'}
              {activeTool === 'photo' && '📷 Modo Foto: Toca el punto exacto del plano para anexar foto de obra.'}
              {activeTool === 'comment' && '💬 Modo Nota: Toca el punto del plano para insertar un comentario.'}
              {activeTool === 'zoom' && '🔍 Modo Zoom: Desliza o pellizca para acercar/alejar.'}
              {activeTool === 'select' && '👆 Modo Selección: Toca elementos para seleccionarlos.'}
            </span>
            <button className="btn-cancel-tool" onClick={handleCancelTool} title="Cancelar comando">
              ✕ Salir (ESC)
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
                  {user.userName}
                </span>
              </div>
            ))}

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
                    {pin.type === 'photo' ? '📷' : '💬'}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📐</div>
            <h2>Visor CAD de Obra</h2>
            <p>
              Abre planos DWG/DXF al instante, mide distancias, traza nubes de revisión, anexa fotos geolocalizadas y exporta tus marcas.
            </p>
            <div className="empty-state-actions">
              <button className="btn btn-accent" onClick={() => localFileInputRef.current?.click()}>
                💻 Abrir Plano Local (DWG / DXF)
              </button>
              {!authenticated ? (
                <button className="btn btn-ghost" onClick={handleAuthClick} disabled={!ready}>
                  🔑 Conectar Google Drive
                </button>
              ) : (
                <button className="btn btn-ghost" onClick={handlePickDriveFile}>
                  📂 Seleccionar de Google Drive
                </button>
              )}
            </div>
            <p className="drag-hint">O arrastra y suelta tu archivo DWG/DXF aquí</p>
          </div>
        )}

        {/* Floating Mobile/Touch Toolbar */}
        {fileBuffer && (
          <div className="toolbar-bottom">
            <button 
              className={`toolbar-btn ${activeTool === 'pan' ? 'active' : ''}`} 
              onClick={() => handleToolChange('pan')}
              title="Mover (Pan)"
            >
              🖐️
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'zoom' ? 'active' : ''}`} 
              onClick={() => handleToolChange('zoom')}
              title="Zoom"
            >
              🔍
            </button>
            <button 
              className="toolbar-btn" 
              onClick={() => cadRef.current?.zoomExtents()}
              title="Centrar Todo (Zoom Extents)"
            >
              📐
            </button>

            <div className="toolbar-divider"></div>

            <button 
              className={`toolbar-btn ${activeTool === 'line' ? 'active' : ''}`} 
              onClick={() => handleToolChange('line')}
              title="Trazar Línea"
            >
              ✏️
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'circle' ? 'active' : ''}`} 
              onClick={() => handleToolChange('circle')}
              title="Trazar Círculo"
            >
              ⭕
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'revcloud' ? 'active' : ''}`} 
              onClick={() => handleToolChange('revcloud')}
              title="Nube de Revisión (REVCLOUD con capa metadata)"
            >
              ☁️
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'dimension' ? 'active' : ''}`} 
              onClick={() => handleToolChange('dimension')}
              title="Medición / Cota Lineal"
            >
              📏
            </button>
            <button 
              className={`toolbar-btn ${isOrthoEnabled ? 'active' : ''}`} 
              onClick={handleToggleOrtho}
              title={`Modo Ortogonal (F8) [${isOrthoEnabled ? 'ON' : 'OFF'}]`}
            >
              📐
            </button>

            <div className="toolbar-divider"></div>

            {/* Comment Pin Tool */}
            <button 
              className={`toolbar-btn ${activeTool === 'comment' ? 'active' : ''}`} 
              onClick={() => handleToolChange('comment')}
              title="Añadir Nota / Comentario en punto"
            >
              💬
            </button>

            {/* Photo Pin Tool */}
            <button 
              className={`toolbar-btn ${activeTool === 'photo' ? 'active' : ''}`} 
              onClick={() => handleToolChange('photo')}
              title="Anexar Foto de Obra con Cámara"
              style={{ position: 'relative' }}
            >
              📷
              {pins.length > 0 && (
                <span className="toolbar-badge">{pins.length}</span>
              )}
            </button>

            <div className="toolbar-divider"></div>

            {/* Layers Panel Toggle */}
            <button 
              className="toolbar-btn" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title="Gestión de Capas"
            >
              🎨
            </button>
          </div>
        )}

        {/* Layers Sidebar */}
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div>
              <h3>Capas del Plano</h3>
              <span className="sidebar-subtitle">{visibleLayersCount} de {rawLayers.length} visibles</span>
            </div>
            <button className="sidebar-close" onClick={() => setIsSidebarOpen(false)}>✕</button>
          </div>

          <div className="sidebar-toolbar">
            <input 
              type="text" 
              className="layer-search-input" 
              placeholder="🔍 Buscar capa..."
              value={layerSearch}
              onChange={(e) => setLayerSearch(e.target.value)}
            />
            <div className="layer-quick-actions">
              <button 
                className="btn-layer-action" 
                onClick={() => cadRef.current?.setAllLayersVisible(true)}
                title="Mostrar todas las capas"
              >
                👁️ Todas
              </button>
              <button 
                className="btn-layer-action" 
                onClick={() => cadRef.current?.setAllLayersVisible(false)}
                title="Ocultar todas las capas"
              >
                🕶️ Ninguna
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
                    {layer.visible ? '👁️' : '🕶️'}
                  </button>
                </div>
              ))
            ) : (
              <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                {rawLayers.length === 0 ? 'No hay capas disponibles.' : 'No se encontraron capas coincidentes.'}
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Modal: New Photo Capture / Note */}
      {newPhotoData && (
        <div className="modal-overlay" onClick={() => { setNewPhotoData(null); setPendingWorldCoord(null); }}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📷 Anexar Foto de Obra</h3>
              <button className="btn-icon btn-ghost" onClick={() => { setNewPhotoData(null); setPendingWorldCoord(null); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="photo-preview-container">
                <img src={newPhotoData} alt="Foto capturada" className="photo-preview-img" />
              </div>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nota / Observación Técnica:</label>
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
              <button className="btn btn-ghost" onClick={() => { setNewPhotoData(null); setPendingWorldCoord(null); }}>
                Cancelar
              </button>
              <button className="btn btn-accent" onClick={handleSavePhotoPin}>
                💾 Guardar en el Plano
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Comment Note */}
      {isCommentModalOpen && (
        <div className="modal-overlay" onClick={() => { setIsCommentModalOpen(false); setPendingWorldCoord(null); }}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💬 Agregar Comentario / Nota de Obra</h3>
              <button className="btn-icon btn-ghost" onClick={() => { setIsCommentModalOpen(false); setPendingWorldCoord(null); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Comentario o Instrucción:</label>
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
              <button className="btn btn-ghost" onClick={() => { setIsCommentModalOpen(false); setPendingWorldCoord(null); }}>
                Cancelar
              </button>
              <button className="btn btn-accent" onClick={handleSaveCommentPin} disabled={!newCommentNote.trim()}>
                💾 Fijar Comentario
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
              <h3>{selectedPin.type === 'photo' ? '📍 Foto de Obra' : '💬 Nota de Revisión'}</h3>
              <button className="btn-icon btn-ghost" onClick={() => setSelectedPin(null)}>✕</button>
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
                🗑️ Eliminar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedPin.type === 'photo' && selectedPin.photoDataUrl && (
                  <a 
                    href={selectedPin.photoDataUrl} 
                    download={`Foto_Obra_${selectedPin.id}.jpg`} 
                    className="btn btn-ghost btn-sm"
                    style={{ textDecoration: 'none' }}
                  >
                    ⬇️ Descargar Foto
                  </a>
                )}
                <button className="btn btn-accent btn-sm" onClick={() => setSelectedPin(null)}>
                  Listo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <div className="loading-text">{loadingMsg}</div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
