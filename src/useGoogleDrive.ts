import { useState, useEffect, useCallback } from 'react';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';

export function useGoogleDrive() {
  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const loadGapiClient = async () => {
      await new Promise<void>((resolve) => gapi.load('client:picker', () => resolve()));
      await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
      });
      setGapiInited(true);
    };

    if (window.gapi) {
      loadGapiClient();
    }
  }, []);

  useEffect(() => {
    if (window.google?.accounts?.oauth2) {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.error !== undefined) {
            console.error('Auth error:', response);
            return;
          }
          setAccessToken(response.access_token);
        },
      });
      setTokenClient(client);
      setGisInited(true);
    }
  }, []);

  const handleAuthClick = useCallback(() => {
    if (tokenClient) {
      if (!accessToken) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        tokenClient.requestAccessToken({ prompt: '' });
      }
    }
  }, [tokenClient, accessToken]);

  const handleSignoutClick = useCallback(() => {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken, () => {
        setAccessToken(null);
      });
    }
  }, [accessToken]);

  const openPicker = useCallback((onFilePicked: (fileId: string, fileName: string, parentId: string) => void) => {
    if (!accessToken) return;

    // View for DWG/DXF files
    const cadView = new google.picker.DocsView(google.picker.ViewId.DOCS);
    // Google Drive doesn't have a specific MIME for DWG, so we show all files
    const allView = new google.picker.DocsView(google.picker.ViewId.DOCS);

    const picker = new google.picker.PickerBuilder()
      .setAppId(import.meta.env.VITE_GOOGLE_PROJECT_ID || '461676360255')
      .addView(cadView)
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
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      console.error('Error downloading file:', error);
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
      const metadata: any = {
        name: fileName,
        mimeType: 'application/dxf',
      };
      if (parentFolderId) {
        metadata.parents = [parentFolderId];
      }

      const form = new FormData();
      form.append(
        'metadata',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' })
      );
      form.append('file', new Blob([content], { type: 'application/dxf' }));

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
        }
      );
      return response.ok;
    } catch (error) {
      console.error('Error uploading file:', error);
      return false;
    }
  }, [accessToken]);

  return {
    ready: gapiInited && gisInited,
    authenticated: !!accessToken,
    accessToken,
    handleAuthClick,
    handleSignoutClick,
    openPicker,
    downloadFile,
    uploadDxf
  };
}
