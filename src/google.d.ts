/* Google API and Picker type declarations */

declare namespace google {
  namespace accounts {
    namespace oauth2 {
      function initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: any) => void;
      }): any;
      function revoke(token: string, callback: () => void): void;
    }
  }
  namespace picker {
    enum ViewId {
      DOCS = 'DOCS',
      FOLDERS = 'FOLDERS',
    }
    enum Action {
      PICKED = 'picked',
      CANCEL = 'cancel',
    }
    class DocsView {
      constructor(viewId: ViewId);
      setMimeTypes(mimeTypes: string): DocsView;
      setIncludeFolders(include: boolean): DocsView;
      setSelectFolderEnabled(enabled: boolean): DocsView;
    }
    class PickerBuilder {
      setAppId(appId: string): PickerBuilder;
      addView(view: DocsView): PickerBuilder;
      setOAuthToken(token: string): PickerBuilder;
      setDeveloperKey(key: string): PickerBuilder;
      setCallback(callback: (data: any) => void): PickerBuilder;
      setTitle(title: string): PickerBuilder;
      build(): Picker;
    }
    class Picker {
      setVisible(visible: boolean): void;
    }
  }
}

declare var gapi: {
  load(api: string, callback: () => void): void;
  client: {
    init(config: {
      apiKey: string;
      discoveryDocs?: string[];
    }): Promise<void>;
    drive: {
      files: {
        get(params: { fileId: string; alt?: string }): Promise<any>;
        list(params: any): Promise<any>;
      };
    };
  };
};

interface Window {
  gapi: typeof gapi;
  google: typeof google;
}
