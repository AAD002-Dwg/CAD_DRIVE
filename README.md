# 📐 CAD Drive Viewer

> **Visor y editor web de planos CAD (DWG / DXF) integrado nativamente con Google Drive, renderizado en el navegador mediante WebAssembly y WebWorkers.**

---

## 📋 Índice
1. [Descripción General](#-descripción-general)
2. [Características Principales](#-características-principales)
3. [Arquitectura y Estructura del Proyecto](#-arquitectura-y-estructura-del-proyecto)
4. [Requisitos Previos](#-requisitos-previos)
5. [Configuración de Credenciales de Google Cloud](#-configuración-de-credenciales-de-google-cloud)
6. [Instalación y Puesta en Marcha Local](#-instalación-y-puesta-en-marcha-local)
7. [Guía para Subir a GitHub](#-guía-para-subir-a-github)
8. [Roadmap y Mejoras Futuras](#-roadmap-y-mejoras-futuras)

---

## 🌟 Descripción General

**CAD Drive Viewer** es una aplicación web moderna (SPA) diseñada para equipos de arquitectura, ingeniería y obra que necesitan visualizar, inspeccionar, acotar y anotar planos en formatos `.dwg` y `.dxf` directamente desde Google Drive o almacenamiento local, sin necesidad de instalar pesados programas de escritorio como AutoCAD ni depender de servidores externos de conversión.

El parseo y renderizado de los archivos se realiza **100% en el cliente** mediante Web Workers y WebAssembly (`LibreDWG` + `mLightCAD`), garantizando privacidad, velocidad y bajo consumo de recursos.

---

## ⚡ Características Principales

- 📁 **Integración con Google Drive**: Selector de archivos visual mediante **Google Picker API** y descarga/subida directa con **Google Drive REST API v3**.
- 🚀 **Renderizado DWG/DXF en el Navegador**: Visualización fluida con WebGL/Canvas gracias a `@mlightcad/cad-simple-viewer` y compilaciones WebAssembly de `LibreDWG`.
- 🗂️ **Gestión de Capas (Layers)**: Panel lateral interactivo para encender/apagar capas en tiempo real y visualizar sus colores de trazado.
- 📑 **Espacios de Trabajo (Model y Layouts)**: Pestañas para alternar entre el espacio modelo (`Model`) y las distintas presentaciones (`Layouts / Paper Space`).
- ✏️ **Herramientas de Anotación y Dibujo**:
  - Pan / Desplazamiento.
  - Zoom Extents (Centrar y encuadrar plano).
  - Selección de entidades.
  - Trazado de líneas y círculos.
  - Inserción de textos multilínea (`MText`).
  - Cotas y dimensiones lineales automáticas.
- 💾 **Exportación y Sincronización**: Guardado de modificaciones directamente en la carpeta de origen de Google Drive como archivo DXF, o descarga al almacenamiento local.
- 🔗 **Enlaces Compartibles**: Soporte de parámetros en la URL (`?fileId=...&fileName=...`) para compartir planos directamente entre colegas en obra.
- 📶 **Acceso en Red Local / Obra**: Scripts automatizados para exponer la aplicación en la red Wi-Fi local y acceder desde tablets o celulares.

---

## 📂 Arquitectura y Estructura del Proyecto

```text
CAD_DRIVE/
├── .env.example               # Plantilla de variables de entorno (Credenciales)
├── .gitignore                 # Exclusiones de Git (protección de credenciales y builds)
├── iniciar_servidor.bat       # Script para arrancar servidor de desarrollo en red local
├── compilar_y_ejecutar.bat    # Script para compilar y probar servidor de producción
├── index.html                 # Punto de entrada HTML (Carga SDKs de Google API y GIS)
├── package.json               # Dependencias y scripts de ejecución
├── tsconfig.json              # Configuración base de TypeScript
├── vite.config.ts             # Configuración de Vite y copia de Workers / WASM
├── public/                    # Archivos estáticos públicos
│   ├── favicon.svg
│   ├── icons.svg
│   └── assets/                # Workers y binarios WASM copiados
│       ├── libredwg-parser-worker.js
│       ├── libredwg-web.wasm
│       └── mtext-renderer-worker.js
└── src/                       # Código fuente de la aplicación
    ├── main.tsx               # Montaje de React
    ├── App.tsx                # Interfaz principal, estado, barra de herramientas y modales
    ├── App.css                # Estilos y animaciones del dashboard
    ├── index.css              # Variables de diseño, temas y utilidades
    ├── google.d.ts            # Declaraciones de tipos para gapi y google.accounts
    ├── useGoogleDrive.ts      # Custom hook para OAuth2, Google Picker y Drive API
    └── CadViewer.tsx          # Componente encapsulador del motor CAD y canvas WebGL
```

---

## 🔧 Requisitos Previos

- **Node.js**: Versión 18.0.0 o superior ([Descargar Node.js](https://nodejs.org/)).
- **NPM**: Incluido con Node.js (versión 9+).
- **Navegador Moderno**: Chrome, Edge, Firefox, Safari o Brave con soporte para WebAssembly y Web Workers.
- **Cuenta de Google Cloud Platform** (para habilitar Drive y Picker API).

---

## 🔐 Configuración de Credenciales de Google Cloud

Para conectar la aplicación con Google Drive, sigue estos pasos en [Google Cloud Console](https://console.cloud.google.com/):

### 1. Crear un Proyecto
1. Ingresa a [Google Cloud Console](https://console.cloud.google.com/).
2. Haz clic en el selector de proyectos en la parte superior y selecciona **"Nuevo Proyecto"**.
3. asígnale un nombre (por ejemplo: `cad-drive-viewer`) y haz clic en **Crear**.

### 2. Habilitar las APIs Requeridas
1. Ve al menú lateral `APIs y Servicios` > `Biblioteca`.
2. Busca y **Habilita** las siguientes dos APIs:
   - **Google Drive API**
   - **Google Picker API**

### 3. Configurar la Pantalla de Consentimiento OAuth
1. Ve a `APIs y Servicios` > `Pantalla de consentimiento de OAuth`.
2. Elige el tipo de usuario: **Externo** (o Interno si tienes Google Workspace).
3. Completa los campos básicos:
   - *Nombre de la aplicación*: `CAD Drive Viewer`
   - *Correo electrónico de soporte*: Tu correo.
4. En el paso de **Permisos (Scopes)**, haz clic en **"Agregar o quitar permisos"** y añade:
   - `https://www.googleapis.com/auth/drive.file` (Para crear/subir archivos generados por la app)
   - `https://www.googleapis.com/auth/drive.readonly` (Para leer y descargar planos de Drive)
5. En la sección **Usuarios de prueba (Test Users)**, añade las direcciones de correo de Gmail con las que probarás la aplicación.
6. Guarda y finaliza.

### 4. Crear Credenciales

#### A. ID de Cliente de OAuth 2.0
1. Ve a `APIs y Servicios` > `Credenciales` > `Crear credenciales` > **ID de cliente de OAuth**.
2. **Tipo de aplicación**: `Aplicación web`.
3. **Nombre**: `CAD Drive Web Client`.
4. En **Orígenes autorizados de JavaScript**, añade:
   - `http://localhost:5173`
   - `http://localhost:4173`
   - `http://127.0.0.1:5173`
   - Tu IP local de red (ej. `http://192.168.1.50:5173`) si planeas usarlo desde celulares/tablets en la misma red.
5. Haz clic en **Crear** y copia el **ID de cliente** generado (`xxx.apps.googleusercontent.com`).

#### B. Clave de API (API Key)
1. En `Credenciales`, haz clic en `Crear credenciales` > **Clave de API**.
2. Opcional (Recomendado): Edita la clave creada para restringir su uso a las APIs de *Google Drive API* y *Google Picker API*.
3. Copia el valor de la clave de API (`AIzaSy...`).

### 5. Configurar el archivo `.env`
Copia el archivo `.env.example` y renómbralo como `.env`:

```bash
cp .env.example .env
```

Edita `.env` con tus claves reales:

```env
VITE_GOOGLE_API_KEY=AIzaSy...tu_clave_aqui...
VITE_GOOGLE_CLIENT_ID=461676360255-...tu_cliente_id.apps.googleusercontent.com
VITE_GOOGLE_PROJECT_ID=tu_project_id
```

> ⚠️ **IMPORTANTE**: El archivo `.env` está añadido a `.gitignore` para proteger tus claves y que nunca se suban a repositorios públicos.

---

## 🚀 Instalación y Puesta en Marcha Local

### Opción 1: Ejecución Rápida con Scripts (.bat)

- **Para Desarrollo / Red Local**: Haz doble clic en [`iniciar_servidor.bat`](file:///g:/PROYECTOS%20AD/CAD_DRIVE/iniciar_servidor.bat).
  - Instalará dependencias automáticamente si faltan.
  - Copiará los workers de CAD a `public/assets`.
  - Iniciará el servidor Vite expuesto a la red local (`--host`).

- **Para Probar la Versión Compilada de Producción**: Haz doble clic en [`compilar_y_ejecutar.bat`](file:///g:/PROYECTOS%20AD/CAD_DRIVE/compilar_y_ejecutar.bat).

### Opción 2: Mediante Comandos de Terminal

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Iniciar servidor en modo desarrollo**:
   ```bash
   npm run dev
   ```
   O para exponerlo a otros dispositivos en tu red local:
   ```bash
   npm run dev:host
   ```

3. **Compilar para producción**:
   ```bash
   npm run build
   npm run preview:host
   ```

---

## 🐙 Guía para Subir a GitHub

Sigue estos pasos para subir tu proyecto a un repositorio limpio en GitHub:

### 1. Crear un repositorio en GitHub
1. Ve a [GitHub](https://github.com/new).
2. Crea un repositorio nuevo (ejemplo: `cad-drive-viewer`).
3. **No** marques las opciones de inicializar con README o .gitignore (ya los tenemos listos).

### 2. Inicializar Git y realizar el primer commit

Abre una terminal en la carpeta raíz del proyecto (`g:\PROYECTOS AD\CAD_DRIVE`) y ejecuta:

```bash
# 1. Inicializar el repositorio Git local
git init

# 2. Agregar todos los archivos (respetando las exclusiones de .gitignore)
git add .

# 3. Crear el commit inicial
git commit -m "feat: Initial commit - CAD Drive Viewer with WebAssembly DWG/DXF rendering and Google Drive integration"

# 4. Renombrar la rama principal a main
git branch -M main

# 5. Vincular tu repositorio remoto de GitHub (reemplaza con tu URL)
git remote add origin https://github.com/TU_USUARIO/cad-drive-viewer.git

# 6. Subir el código a GitHub
git push -u origin main
```

---

## 🗺️ Roadmap y Mejoras Futuras

- [ ] **Medición Avanzada de Áreas y Perímetros**: Cálculo interactivo de polígonos cerrados y longitudes acumuladas.
- [ ] **Soporte de Referencias Externas (XREFs)**: Carga y resolución automática de referencias DWG enlazadas dentro de Google Drive.
- [ ] **Fuentes Tipográficas Personalizadas (SHX / TrueType)**: Soporte para añadir librerías de fuentes estándar de ingeniería y arquitectura.
- [ ] **Exportación a PDF Vectorial de Alta Resolución**: Generador de láminas PDF a escala imprimible (A1, A2, A3, A4).
- [ ] **Colaboración y Comentarios en Tiempo Real**: Marcado de planos con notas compartidas entre usuarios de obra mediante WebSockets o Firebase.
- [ ] **Modo Offline PWA & Caché Local**: Almacenamiento local mediante IndexedDB para consultar planos descargados sin conexión a internet.
- [ ] **Comparador de Revisiones (Diff Visual)**: Superposición de dos versiones de un plano con resaltado en color de cambios estructurales.

---

<div align="center">
Desarrollado para optimizar el flujo de trabajo con planos CAD en obra y oficina técnica.
</div>
