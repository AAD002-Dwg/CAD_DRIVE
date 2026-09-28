import { useState, useRef, useEffect, useCallback } from 'react';
import { useGoogleDrive } from './useGoogleDrive';
import { CadViewer } from './CadViewer';
import type { CadViewerRef } from './CadViewer';
import './App.css';

export interface PhotoPin {
  id: string;
  xPercent: number;
  yPercent: number;
  photoDataUrl: string;
  note: string;
  author: string;
  timestamp: string;
}

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
  const [activeTool, setActiveTool] = useState<'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'photo'>('pan');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [cadBgColor, setCadBgColor] = useState('#0a0e1a');
  const [layerSearch, setLayerSearch] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Photo Pinning State
  const [photoPins, setPhotoPins] = useState<PhotoPin[]>([]);
  const [showPins, setShowPins] = useState(true);
  const [pendingPinCoord, setPendingPinCoord] = useState<{ x: number; y: number } | null>(null);
  const [newPhotoData, setNewPhotoData] = useState<string | null>(null);
  const [newPhotoNote, setNewPhotoNote] = useState('');
  const [selectedPin, setSelectedPin] = useState<PhotoPin | null>(null);

  const cadRef = useRef<CadViewerRef>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

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

  // Load photo pins from localStorage whenever currentFileName changes
  useEffect(() => {
    if (currentFileName) {
      const key = `cad_photos_${currentFileName}`;
      const savedPins = localStorage.getItem(key);
      if (savedPins) {
        try {
          setPhotoPins(JSON.parse(savedPins));
        } catch (e) {
          console.error('Error parsing stored photo pins:', e);
        }
      } else {
        setPhotoPins([]);
      }
    }
  }, [currentFileName]);

  // Save photo pins to localStorage
  const savePinsToStorage = useCallback((pins: PhotoPin[]) => {
    if (!currentFileName) return;
    const key = `cad_photos_${currentFileName}`;
    localStorage.setItem(key, JSON.stringify(pins));
  }, [currentFileName]);

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
          showToast('No se pudo descargar el plano. Asegúrate de tener permisos en Drive.');
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
      
      // Update URL search params so the link is shareable immediately
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

  // Local file picker handler
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

  // Drag & Drop handlers
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
      showToast('Este plano es local. Para compartirlo mediante enlace, ábrelo desde Google Drive.');
      return;
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}?fileId=${currentFileId}&fileName=${encodeURIComponent(currentFileName || 'Plano.dwg')}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('🔗 ¡Enlace de revisión copiado al portapapeles!');
  };

  const handleToolChange = (tool: 'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension' | 'photo') => {
    setActiveTool(tool);
    if (tool !== 'photo') {
      cadRef.current?.setTool(tool);
    }
  };

  const handleCancelTool = () => {
    cadRef.current?.cancelCommand();
    setActiveTool('pan');
    setPendingPinCoord(null);
    showToast('Comando cancelado');
  };

  // Google Drive DXF Save
  const handleSaveRevisionDrive = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Exportando marcas de revisión en formato DXF...');

    try {
      const dxfBuffer = await cadRef.current.exportDxfBuffer();
      if (!dxfBuffer) {
        showToast('No se pudo generar el archivo DXF de revisiones.');
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
        showToast('Error al subir a Drive. Asegúrate de tener permisos o usa "Descargar DXF".');
      }
    } catch (e) {
      console.error(e);
      showToast('Ocurrió un error al guardar la revisión.');
    } finally {
      setIsLoading(false);
    }
  };

  // Direct Local DXF Download
  const handleDownloadLocalDxf = async () => {
    setIsMobileMenuOpen(false);
    if (!cadRef.current || !currentFileName) return;

    setIsLoading(true);
    setLoadingMsg('Generando archivo DXF para descarga...');

    try {
      const dxfBuffer = await cadRef.current.exportDxfBuffer();
      if (!dxfBuffer) {
        showToast('No se pudo generar el archivo DXF.');
        setIsLoading(false);
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const baseName = currentFileName.substring(0, currentFileName.lastIndexOf('.')) || currentFileName;
      const downloadFileName = `${baseName}_Anotado_${dateStr}.dxf`;

      const blob = new Blob([dxfBuffer], { type: 'application/dxf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`💾 Archivo "${downloadFileName}" descargado.`);
    } catch (e) {
      console.error(e);
      showToast('Error al descargar el archivo DXF.');
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

      // Check if mobile Web Share API is available with image
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

      // Fallback: Direct download
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

  // Photo Pinning Handlers
  const handleCanvasClickForPhoto = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'photo') return;
    if (!viewerContainerRef.current) return;

    const rect = viewerContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setPendingPinCoord({ x, y });
    // Trigger mobile camera or file input
    cameraInputRef.current?.click();
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingPinCoord) return;

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

  const handleSavePhotoPin = () => {
    if (!newPhotoData || !pendingPinCoord) return;

    const newPin: PhotoPin = {
      id: 'pin_' + Date.now(),
      xPercent: pendingPinCoord.x,
      yPercent: pendingPinCoord.y,
      photoDataUrl: newPhotoData,
      note: newPhotoNote.trim() || 'Foto de obra sin comentarios',
      author: userName,
      timestamp: new Date().toLocaleString()
    };

    const updated = [...photoPins, newPin];
    setPhotoPins(updated);
    savePinsToStorage(updated);

    setNewPhotoData(null);
    setPendingPinCoord(null);
    setActiveTool('pan');
    showToast('📍 ¡Foto de obra anclada al plano con éxito!');
  };

  const handleDeletePhotoPin = (pinId: string) => {
    const updated = photoPins.filter(p => p.id !== pinId);
    setPhotoPins(updated);
    savePinsToStorage(updated);
    setSelectedPin(null);
    showToast('Foto eliminada del plano.');
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
              : 'Visor y marcado de planos en obra compatible con celulares y tablets. Identifícate para registrar tus firmas y fotos.'}
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
                {authenticated && (
                  <button className="btn btn-accent btn-sm" onClick={handleSaveRevisionDrive} title="Guardar revisión en Google Drive">
                    💾 Guardar en Drive
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={handleDownloadLocalDxf} title="Descargar archivo DXF">
                  ⬇️ Descargar DXF
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
                  <button className="drawer-item" onClick={handleDownloadLocalDxf}>
                    ⬇️ Descargar Copia DXF al Celular
                  </button>
                  <button className="drawer-item" onClick={handleCaptureScreenshot}>
                    📸 Captura PNG / Compartir por WhatsApp
                  </button>
                  <button className="drawer-item" onClick={() => { setIsMobileMenuOpen(false); setShowPins(!showPins); }}>
                    {showPins ? '🕶️ Ocultar Fotos de Obra' : '👁️ Mostrar Fotos de Obra'} ({photoPins.length})
                  </button>
                  <button className="drawer-item" onClick={() => {
                    const themes = ['#0a0e1a', '#000000', '#f8fafc', '#1e293b'];
                    const nextIdx = (themes.indexOf(cadBgColor) + 1) % themes.length;
                    setCadBgColor(themes[nextIdx]);
                    setIsMobileMenuOpen(false);
                  }}>
                    🎨 Cambiar Fondo (Negro/Oscuro/Blanco)
                  </button>
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
          {photoPins.length > 0 && (
            <>
              <span className="separator">|</span>
              <span className="photo-tag" onClick={() => setShowPins(!showPins)} style={{ cursor: 'pointer' }}>
                📷 {photoPins.length} fotos
              </span>
            </>
          )}
        </div>
      )}

      {/* Main Canvas / Viewer Container */}
      <main 
        ref={viewerContainerRef} 
        className="viewer-container"
        onClick={handleCanvasClickForPhoto}
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
              {activeTool === 'mtext' && '📝 Modo Texto: Haz clic en el plano para escribir anotaciones.'}
              {activeTool === 'dimension' && '📏 Modo Medición: Haz clic en dos puntos para acotar distancia.'}
              {activeTool === 'photo' && '📷 Modo Foto: Toca el punto exacto del plano para tomar una foto.'}
              {activeTool === 'zoom' && '🔍 Modo Zoom: Desliza o pellizca para acercar/alejar.'}
              {activeTool === 'select' && '👆 Modo Selección: Toca elementos para seleccionarlos.'}
            </span>
            <button className="btn-cancel-tool" onClick={handleCancelTool} title="Cancelar comando">
              ✕ Cancelar (ESC)
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

            {/* Photo Pins Overlay Markers */}
            {showPins && photoPins.map((pin) => (
              <div 
                key={pin.id}
                className="photo-pin-marker"
                style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPin(pin);
                }}
                title={`Foto de ${pin.author}: ${pin.note}`}
              >
                <div className="pin-pulse"></div>
                <div className="pin-icon">📷</div>
              </div>
            ))}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📐</div>
            <h2>Visor CAD de Obra</h2>
            <p>
              Abre tus planos DWG/DXF en segundos, mide distancias, agrega fotos geolocalizadas y exporta revisiones.
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
              title="Trazar Línea / Marca"
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
              className={`toolbar-btn ${activeTool === 'mtext' ? 'active' : ''}`} 
              onClick={() => handleToolChange('mtext')}
              title="Añadir Texto"
            >
              📝
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'dimension' ? 'active' : ''}`} 
              onClick={() => handleToolChange('dimension')}
              title="Medición / Cota Lineal"
            >
              📏
            </button>

            <div className="toolbar-divider"></div>

            {/* Photo Pin Tool */}
            <button 
              className={`toolbar-btn ${activeTool === 'photo' ? 'active' : ''}`} 
              onClick={() => handleToolChange('photo')}
              title="Anexar Foto de Obra en Punto"
              style={{ position: 'relative' }}
            >
              📷
              {photoPins.length > 0 && (
                <span className="toolbar-badge">{photoPins.length}</span>
              )}
            </button>

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
                  <span className="layer-name" title={layer.name}>{layer.name}</span>
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
        <div className="modal-overlay" onClick={() => { setNewPhotoData(null); setPendingPinCoord(null); }}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📷 Anexar Foto de Obra</h3>
              <button className="btn-icon btn-ghost" onClick={() => { setNewPhotoData(null); setPendingPinCoord(null); }}>✕</button>
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
                Registrado por: <strong>{userName}</strong> • {new Date().toLocaleTimeString()}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setNewPhotoData(null); setPendingPinCoord(null); }}>
                Cancelar
              </button>
              <button className="btn btn-accent" onClick={handleSavePhotoPin}>
                💾 Guardar en el Plano
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Photo Pin Details */}
      {selectedPin && (
        <div className="modal-overlay" onClick={() => setSelectedPin(null)}>
          <div className="modal-card glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📍 Foto de Obra</h3>
              <button className="btn-icon btn-ghost" onClick={() => setSelectedPin(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="photo-preview-container full">
                <img src={selectedPin.photoDataUrl} alt="Foto de obra ampliada" className="photo-full-img" />
              </div>
              <div className="photo-detail-info">
                <p className="photo-note-text">{selectedPin.note}</p>
                <div className="photo-meta">
                  <span>👷 <strong>{selectedPin.author}</strong></span>
                  <span>📅 {selectedPin.timestamp}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-danger btn-sm" onClick={() => handleDeletePhotoPin(selectedPin.id)}>
                🗑️ Eliminar
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <a 
                  href={selectedPin.photoDataUrl} 
                  download={`Foto_Obra_${selectedPin.id}.jpg`} 
                  className="btn btn-ghost btn-sm"
                  style={{ textDecoration: 'none' }}
                >
                  ⬇️ Descargar
                </a>
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
