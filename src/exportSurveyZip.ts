import JSZip from 'jszip';
import type { CadPin } from './App';

export async function exportSurveyPackage(
  pins: CadPin[],
  dxfBuffer: ArrayBuffer,
  currentFileName: string,
  userName: string
): Promise<void> {
  const zip = new JSZip();
  const dateStr = new Date().toISOString().slice(0, 10);
  const timeStr = new Date().toLocaleTimeString().replace(/:/g, '-');
  const baseName = currentFileName.substring(0, currentFileName.lastIndexOf('.')) || currentFileName;
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');

  // 1. Agregar DXF de Revisión
  const dxfFileName = `${safeBaseName}_REVISION_MARCAS_${dateStr}.dxf`;
  zip.file(dxfFileName, dxfBuffer);

  // 2. Carpeta de Fotos
  const photoPins = pins.filter(p => p.type === 'photo' && p.photoDataUrl);
  const photosFolder = zip.folder('FOTOS');

  photoPins.forEach((pin, index) => {
    if (photosFolder && pin.photoDataUrl) {
      // Extraer Base64
      const matches = pin.photoDataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
      if (matches && matches[2]) {
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const num = String(index + 1).padStart(2, '0');
        const photoName = `FOTO_${num}_WCS_${Math.round(pin.worldX)}_${Math.round(pin.worldY)}.${ext}`;
        photosFolder.file(photoName, matches[2], { base64: true });
      }
    }
  });

  // 3. Informe HTML de Relevamiento
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Relevamiento de Obra - ${escapeHtml(baseName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; font-size: 1.5rem; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; padding: 12px; background: #0f172a; border-radius: 8px; }
    .meta-item { font-size: 0.85rem; color: #94a3b8; }
    .meta-item strong { color: #f1f5f9; display: block; font-size: 0.95rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 0.85rem; }
    th { text-align: left; padding: 10px; background: #334155; color: #38bdf8; font-weight: 600; }
    td { padding: 10px; border-bottom: 1px solid #334155; vertical-align: top; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
    .badge-photo { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .badge-note { background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4); }
    .thumb { max-width: 140px; border-radius: 6px; border: 1px solid #475569; display: block; margin-top: 6px; }
    .footer { text-align: center; margin-top: 32px; font-size: 0.8rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 Informe de Relevamiento de Obra</h1>
    <div class="meta">
      <div class="meta-item">Plano Base:<strong>${escapeHtml(currentFileName)}</strong></div>
      <div class="meta-item">Auditor de Obra:<strong>${escapeHtml(userName || 'Inspector')}</strong></div>
      <div class="meta-item">Fecha de Relevamiento:<strong>${dateStr}</strong></div>
      <div class="meta-item">Total Marcas:<strong>${pins.length} (${photoPins.length} fotos, ${pins.length - photoPins.length} notas)</strong></div>
    </div>

    <h2>Listado de Hallazgos y Observaciones</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 40px">#</th>
          <th style="width: 90px">Tipo</th>
          <th style="width: 130px">Coordenadas WCS</th>
          <th>Observación Técnica</th>
          <th style="width: 160px">Adjunto</th>
        </tr>
      </thead>
      <tbody>
        ${pins.map((pin, i) => `
          <tr>
            <td><strong>${i + 1}</strong></td>
            <td><span class="badge ${pin.type === 'photo' ? 'badge-photo' : 'badge-note'}">${pin.type === 'photo' ? '📷 Foto' : '💬 Nota'}</span></td>
            <td><code>(${pin.worldX.toFixed(2)}, ${pin.worldY.toFixed(2)})</code></td>
            <td>${escapeHtml(pin.note)}<br><small style="color: #94a3b8">Hora: ${escapeHtml(pin.timestamp)}</small></td>
            <td>
              ${pin.type === 'photo' && pin.photoDataUrl ? `
                <a href="${pin.photoDataUrl}" target="_blank">
                  <img src="${pin.photoDataUrl}" class="thumb" alt="Foto ${i + 1}" />
                </a>
              ` : '<span style="color: #64748b">-</span>'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="footer">
      Generado automáticamente por CAD Drive Obra & Relevamiento.
    </div>
  </div>
</body>
</html>`;

  zip.file('INFORME_RELEVAMIENTO.html', htmlContent);

  // 4. Archivo de Instrucciones para AutoCAD
  const readmeContent = `====================================================================
CAD DRIVE - PAQUETE DE RELEVAMIENTO DE OBRA
====================================================================
Plano base: ${currentFileName}
Auditor: ${userName}
Fecha: ${dateStr} ${timeStr}

CONTENIDO DEL PAQUETE:
1. "${dxfFileName}"
   Archivo DXF que contiene todas las marcas, nubes de revisión, 
   cotas y llamadas de texto geolocalizadas exactamente en sus coordenadas WCS.
   Compatible con AutoCAD 2000 o superior, BricsCAD, ZWCAD, etc.

2. Carpeta "FOTOS/"
   Contiene todas las fotografías tomadas en obra, numeradas y con las 
   coordenadas de inspección en su nombre de archivo.

3. "INFORME_RELEVAMIENTO.html"
   Informe visual interactivo con tabla detallada y fotos en alta resolución.
====================================================================`;

  zip.file('LEAME_AUTOCAD.txt', readmeContent);

  // 5. Generar y descargar ZIP
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `${safeBaseName}_Relevamiento_${dateStr}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
