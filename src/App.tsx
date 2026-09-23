import { useState, useRef, useEffect } from 'react';
import { useGoogleDrive } from './useGoogleDrive';
import { CadViewer } from './CadViewer';
import type { CadViewerRef } from './CadViewer';
import './App.css';

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
  const [activeTool, setActiveTool] = useState<'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension'>('pan');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const cadRef = useRef<CadViewerRef>(null);

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

  const handlePickFile = () => {
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

  const handleCopyShareLink = () => {
    if (!currentFileId) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?fileId=${currentFileId}&fileName=${encodeURIComponent(currentFileName || 'Plano.dwg')}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('🔗 ¡Enlace de revisión copiado al portapapeles!');
  };

  const handleToolChange = (tool: 'pan' | 'zoom' | 'select' | 'line' | 'circle' | 'mtext' | 'dimension') => {
    setActiveTool(tool);
    if (cadRef.current) {
      cadRef.current.setTool(tool);
    }
  };

  const handleSaveRevision = async () => {
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
        showToast(`¡Revisión guardada como ${revisionFileName} en Google Drive!`);
      } else {
        showToast('Error al subir la revisión a Google Drive. (Se requieren permisos de escritura).');
      }
    } catch (e) {
      console.error(e);
      showToast('Ocurrió un error al guardar la revisión.');
    } finally {
      setIsLoading(false);
    }
  };

  // Screen 1: Name prompt
  if (!isIdentified) {
    return (
      <div className="welcome-screen">
        <div className="welcome-card glass-panel">
          <div className="app-logo-icon" style={{ width: 48, height: 48, margin: '0 auto 16px auto', fontSize: '1.2rem' }}>
            CAD
          </div>
          <h1>Visor CAD Obra</h1>
          <p className="subtitle">
            {currentFileName 
              ? `Te han compartido el plano "${currentFileName}". Ingresa tu nombre para comenzar a revisar.` 
              : 'Acceso a planos y revisiones en tiempo real desde obra. Identifícate con tu nombre para registrar tus marcas.'}
          </p>
          <form onSubmit={handleIdentify} className="welcome-form">
            <input 
              type="text" 
              className="input-field"
              placeholder="Tu Nombre (Ej: Juan Pérez - Obra 1)" 
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-accent" style={{ padding: '14px' }}>
              Comenzar a Revisar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Screen 2: Main Workspace
  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">CAD</div>
          <div>
            <h1 className="app-title">CAD Drive Viewer</h1>
            <p className="app-subtitle">Revisión en Obra</p>
          </div>
        </div>

        <div className="header-actions">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`status-dot ${authenticated ? 'connected' : 'disconnected'}`}></span>
            {userName}
          </span>

          {currentFileId && (
            <button className="btn btn-ghost btn-sm" onClick={handleCopyShareLink} title="Compartir enlace de revisión">
              🔗 Compartir
            </button>
          )}

          {!authenticated ? (
            <button className="btn btn-accent btn-sm" onClick={handleAuthClick} disabled={!ready}>
              🔑 Conectar Drive
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handlePickFile}>
                📂 Abrir Plano
              </button>
              {fileBuffer && (
                <button className="btn btn-accent btn-sm" onClick={handleSaveRevision}>
                  💾 Guardar Revisión DXF
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={handleSignoutClick} title="Desconectar Drive">
                🚪
              </button>
            </>
          )}
        </div>
      </header>

      {/* Sub-header File Info */}
      {currentFileName && (
        <div className="file-info-bar">
          <span>Plano Actual:</span>
          <span className="file-name">{currentFileName}</span>
          <span className="separator">|</span>
          <span>Participante: {userName}</span>
        </div>
      )}

      {/* Main Canvas Area */}
      <main className="viewer-container">
        {fileBuffer ? (
          <CadViewer 
            ref={cadRef}
            fileData={fileBuffer}
            fileName={currentFileName}
            onLoaded={() => {
              setIsLoading(false);
              showToast('Plano renderizado correctamente.');
            }}
            onError={(err) => {
              setIsLoading(false);
              showToast(typeof err === 'string' ? err : 'Error al cargar visor.');
            }}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📐</div>
            <h2>Ningún plano seleccionado</h2>
            <p>
              {!authenticated 
                ? 'Conecta tu cuenta de Google Drive para seleccionar tus planos DWG/DXF o usa un enlace compartido.'
                : 'Haz clic en "Abrir Plano" para seleccionar un plano DWG o DXF desde tu Google Drive.'}
            </p>
            {!authenticated ? (
              <button className="btn btn-accent" onClick={handleAuthClick} disabled={!ready}>
                🔑 Conectar Google Drive
              </button>
            ) : (
              <button className="btn btn-accent" onClick={handlePickFile}>
                📂 Seleccionar Plano de Drive
              </button>
            )}
          </div>
        )}

        {/* Floating Mobile Toolbar */}
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
              title="Ver Todo (Zoom Extents)"
            >
              📐
            </button>

            <div className="toolbar-divider"></div>

            <button 
              className={`toolbar-btn ${activeTool === 'line' ? 'active' : ''}`} 
              onClick={() => handleToolChange('line')}
              title="Línea / Marca"
            >
              ✏️
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'circle' ? 'active' : ''}`} 
              onClick={() => handleToolChange('circle')}
              title="Círculo"
            >
              ⭕
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'mtext' ? 'active' : ''}`} 
              onClick={() => handleToolChange('mtext')}
              title="Texto / Anotación"
            >
              📝
            </button>
            <button 
              className={`toolbar-btn ${activeTool === 'dimension' ? 'active' : ''}`} 
              onClick={() => handleToolChange('dimension')}
              title="Medición / Cota"
            >
              📏
            </button>

            <div className="toolbar-divider"></div>

            <button 
              className="toolbar-btn" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title="Capas (Layers)"
            >
              🎨
            </button>
          </div>
        )}

        {/* Sidebar Layers */}
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <h3>Capas del Plano</h3>
            <button className="sidebar-close" onClick={() => setIsSidebarOpen(false)}>✕</button>
          </div>
          <div className="sidebar-content">
            {cadRef.current?.getLayers().map((layer) => (
              <div key={layer.name} className="layer-item">
                <div 
                  className="layer-color-swatch" 
                  style={{ backgroundColor: `#${layer.color.toString(16).padStart(6, '0')}` }} 
                />
                <span className="layer-name">{layer.name}</span>
                <button 
                  className={`layer-toggle ${layer.visible ? 'on' : ''}`}
                  onClick={() => cadRef.current?.toggleLayer(layer.name)}
                >
                  {layer.visible ? '👁️' : '🕶️'}
                </button>
              </div>
            )) || <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No hay capas disponibles.</div>}
          </div>
        </aside>
      </main>

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
