import PDFDocument from 'pdfkit';

const VISION_TYPES = ['gold_sa', 'silver_sa', 'bronze_sa', 'gold_eg', 'silver_eg', 'bronze_eg'] as const;
const HEADERS_EN = ['Interpreter', 'Gold SA', 'Silver SA', 'Bronze SA', 'Gold EG', 'Silver EG', 'Bronze EG', 'Total'];

export interface ProfileStatsRow {
  fullName: string;
  email: string;
  counts: Record<string, number>;
  total: number;
}

/** Build PDF buffer for a single interpreter's vision stats (profile export). */
export function buildProfileVisionStatsPdf(options: {
  interpreterName: string;
  monthLabel: string;
  dateRange: string;
  counts: Record<string, number>;
  total: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Vision stats by type', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Interpreter: ${options.interpreterName}`, { align: 'left' });
    doc.text(`Period: ${options.dateRange} (${options.monthLabel})`, { align: 'left' });
    doc.moveDown(1);

    const colWidth = 90;
    const startX = 50;
    let y = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Type', startX, y);
    doc.text('Count', startX + colWidth, y);
    doc.moveDown(0.5);
    y = doc.y;
    doc.font('Helvetica');
    for (const key of VISION_TYPES) {
      const label = key.replace('_', ' ');
      doc.text(label, startX, y);
      doc.text(String(options.counts[key] ?? 0), startX + colWidth, y);
      y += 18;
    }
    doc.font('Helvetica-Bold');
    doc.text('Total', startX, y);
    doc.text(String(options.total), startX + colWidth, y);
    doc.end();
  });
}

/** Build PDF buffer for admin: table of all interpreters and their vision-type counts. */
export function buildAdminVisionStatsPdf(options: {
  dateRange: string;
  monthLabel: string;
  rows: ProfileStatsRow[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Vision stats by type (all interpreters)', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Period: ${options.dateRange} (${options.monthLabel})`, { align: 'left' });
    doc.moveDown(1);

    const colWidths = [100, 50, 50, 55, 50, 50, 55, 45];
    const startX = 40;
    let y = doc.y;
    const rowHeight = 22;
    const headerY = y;

    doc.fontSize(9).font('Helvetica-Bold');
    HEADERS_EN.forEach((h, i) => {
      const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.text(h, x, headerY, { width: colWidths[i], continued: false });
    });
    y = headerY + rowHeight;
    doc.font('Helvetica');

    for (const row of options.rows) {
      const name = (row.fullName || row.email || '').slice(0, 25);
      const cells = [
        name,
        String(row.counts['gold_sa'] ?? 0),
        String(row.counts['silver_sa'] ?? 0),
        String(row.counts['bronze_sa'] ?? 0),
        String(row.counts['gold_eg'] ?? 0),
        String(row.counts['silver_eg'] ?? 0),
        String(row.counts['bronze_eg'] ?? 0),
        String(row.total),
      ];
      cells.forEach((cell, i) => {
        const x = startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(cell, x, y, { width: colWidths[i], continued: false });
      });
      y += rowHeight;
    }
    doc.end();
  });
}
