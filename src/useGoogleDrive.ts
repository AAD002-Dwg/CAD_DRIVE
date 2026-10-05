/**
 * useGoogleDrive.ts
 * Hook para interactuar con Google Drive API.
 *
 * Con Firebase Auth: el Access Token de Google viene del resultado del signInWithPopup.
 * Lo recibe como prop desde el hook useAuth, eliminando la duplicación de flujo OAuth.
 *
 * Scopes requeridos (declarados en useAuth.ts):
 * - drive.file: crear/editar archivos creados por la app
 * - drive.readonly: leer cualquier archivo que el usuario comparta
 */
import { useState, useEffect, useCallback } from 'react';

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

export function useGoogleDrive(accessToken: string | null) {
  const [gapiInited, setGapiInited] = useState(false);
  const [pickerInited, setPickerInited] = useState(false);

  // Inicializar GAPI Client (para Picker API y Drive v3 REST)
  useEffect(() => {
    const loadGapiClient = async () => {
      try {
        await new Promise<void>((resolve) => gapi.load('client:picker', () => resolve()));
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
        });
        setGapiInited(true);
        setPickerInited(true);
      } catch (e) {
        console.error('[useGoogleDrive] Error al inicializar GAPI:', e);
      }
    };

    if (window.gapi) {
      loadGapiClient();
    }
  }, []);

  const openPicker = useCallback((
    onFilePicked: (fileId: string, fileName: string, parentId: string) => void
  ) => {
    if (!accessToken) {
      console.warn('[useGoogleDrive] Sin access token para Drive Picker');
      return;
    }

    const allView = new google.picker.DocsView(google.picker.ViewId.DOCS);

    const picker = new google.picker.PickerBuilder()
      .setAppId(import.meta.env.VITE_GOOGLE_PROJECT_ID || '')
      .addView(allView)
      .setOAuthToken(accessToken)
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
  }, [accessToken]);

  const downloadFile = useCallback(async (fileId: string): Promise<ArrayBuffer | null> => {
    try {
      const url = accessToken
        ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;

      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Error al descargar archivo: ${response.status} ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      console.error('[useGoogleDrive] Error descargando archivo:', error);
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

      if (!response.ok) {
        const errBody = await response.text();
        console.error('[useGoogleDrive] Error subiendo archivo:', errBody);
      }
      return response.ok;
    } catch (error) {
      console.error('[useGoogleDrive] Error en uploadDxf:', error);
      return false;
    }
  }, [accessToken]);

  return {
    ready: gapiInited && pickerInited,
    openPicker,
    downloadFile,
    uploadDxf,
  };
}
