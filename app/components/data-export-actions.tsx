import { Download, FileJson, Sheet } from "lucide-react";

export default function DataExportActions() {
  return (
    <section className="data-export" aria-labelledby="data-export-title">
      <div className="data-export__copy">
        <span className="data-export__icon"><Download size={18} /></span>
        <div>
          <h3 id="data-export-title">Back up your library</h3>
          <p>Download your personal tracker data at any time. Nothing is sent to another service.</p>
        </div>
      </div>
      <div className="data-export__actions">
        <a href="/api/export?format=json" download>
          <FileJson size={16} />
          <span><strong>Full backup</strong><small>JSON · includes collections and metadata</small></span>
          <Download size={14} />
        </a>
        <a href="/api/export?format=csv" download>
          <Sheet size={16} />
          <span><strong>Spreadsheet</strong><small>CSV · easy to read and move elsewhere</small></span>
          <Download size={14} />
        </a>
      </div>
    </section>
  );
}
