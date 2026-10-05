/**
 * useGoogleDrive.ts
 * Hook para interactuar con Google Drive API y Google Picker.
 * 
 * Utiliza Google Identity Services (GIS) con el CLIENT_ID de Drive (sync-cad-storage),
 * garantizando que OAuth Token, Developer Key y AppId pertenezcan al mismo proyecto
 * para evitar el error 403 de Google Picker.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const PROJECT_ID = import.meta.env.VITE_GOOGLE_PROJECT_ID || '461676360255';

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';

export function useGoogleDrive(userEmail?: string | null) {
  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    return localStorage.getItem('gd_drive_token');
  });

  const tokenClientRef = useRef<any>(null);
  const pendingCallbackRef = useRef<((fileId: string, fileName: string, parentId: string) => void) | null>(null);

  // 1. Inicializar GAPI Client (necesario para Google Picker)
  useEffect(() => {
    const loadGapi = async () => {
      try {
        await new Promise<void>((resolve) => gapi.load('client:picker', () => resolve()));
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        setGapiInited(true);
      } catch (e) {
        console.error('[useGoogleDrive] Error inicializando GAPI:', e);
      }
    };

    if (typeof window !== 'undefined' && window.gapi) {
      loadGapi();
    }
  }, []);

  // 2. Inicializar Google Identity Services (GIS) Token Client
  useEffect(() => {
    const initGis = () => {
      if (window.google?.accounts?.oauth2) {
        try {
          const client = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (response: any) => {
              if (response.error !== undefined) {
                console.error('[useGoogleDrive] Error en token GIS:', response);
                return;
              }
              const token = response.access_token;
              setAccessToken(token);
              localStorage.setItem('gd_drive_token', token);

              // Si había una acción pendiente (ej: abrir picker), ejecutarla
              if (pendingCallbackRef.current) {
                const cb = pendingCallbackRef.current;
                pendingCallbackRef.current = null;
                showPicker(token, cb);
              }
            },
          });
          tokenClientRef.current = client;
          setGisInited(true);
        } catch (e) {
          console.error('[useGoogleDrive] Error inicializando GIS:', e);
        }
      }
    };

    if (typeof window !== 'undefined' && window.google?.accounts?.oauth2) {
      initGis();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(interval);
          initGis();
        }
      }, 300);
      return () => clearInterval(interval);
    }
  }, []);

  const showPicker = (token: string, onFilePicked: (fileId: string, fileName: string, parentId: string) => void) => {
    const allView = new google.picker.DocsView(google.picker.ViewId.DOCS);

    const picker = new google.picker.PickerBuilder()
      .setAppId(PROJECT_ID)
      .addView(allView)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setTitle('Seleccionar archivo DWG/DXF')
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const file = data.docs[0];
          const parentId = file.parentId || '';
          onFilePicked(file.id, file.name, parentId);
        }
      })
      .build();
    picker.setVisible(true);
  };

  const openPicker = useCallback((
    onFilePicked: (fileId: string, fileName: string, parentId: string) => void
  ) => {
    if (accessToken) {
      showPicker(accessToken, onFilePicked);
      return;
    }

    // Solicitar token OAuth a Google
    if (tokenClientRef.current) {
      pendingCallbackRef.current = onFilePicked;
      const opts: any = { prompt: '' };
      if (userEmail) opts.hint = userEmail;
      tokenClientRef.current.requestAccessToken(opts);
    } else {
      console.warn('[useGoogleDrive] GIS tokenClient no está listo todavía.');
    }
  }, [accessToken, userEmail]);

  const connectDrive = useCallback((afterConnect?: () => void) => {
    if (tokenClientRef.current) {
      if (afterConnect) {
        pendingCallbackRef.current = () => afterConnect();
      }
      const opts: any = { prompt: 'consent' };
      if (userEmail) opts.hint = userEmail;
      tokenClientRef.current.requestAccessToken(opts);
    }
  }, [userEmail]);

  const downloadFile = useCallback(async (fileId: string): Promise<ArrayBuffer | null> => {
    try {
      if (!accessToken) {
        console.warn('[useGoogleDrive] No hay token de Drive para descargar.');
        return null;
      }

      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorDetails = await response.text().catch(() => '');
        console.error(`[useGoogleDrive] Error descargando archivo (${response.status}):`, errorDetails);
        if (response.status === 401) {
          // Token expirado, limpiar para forzar reconexión limpia
          setAccessToken(null);
          localStorage.removeItem('gd_drive_token');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      console.error('[useGoogleDrive] Error en downloadFile:', error);
      return null;
    }
  }, [accessToken]);

  const uploadDxf = useCallback(async (
    fileName: string,
    content: ArrayBuffer,
    parentFolderId?: string
  ): Promise<boolean> => {
    if (!accessToken) return false;
    try {
      const metadata: Record<string, any> = {
        name: fileName,
        mimeType: 'application/dxf',
      };
      if (parentFolderId) {
        metadata.parents = [parentFolderId];
      }

      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([content], { type: 'application/dxf' }));

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        }
      );
      return response.ok;
    } catch (error) {
      console.error('[useGoogleDrive] Error en uploadDxf:', error);
      return false;
    }
  }, [accessToken]);

  return {
    ready: gapiInited && gisInited,
    authenticated: !!accessToken,
    openPicker,
    connectDrive,
    downloadFile,
    uploadDxf,
  };
}
