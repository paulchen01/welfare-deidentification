import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfHandle, PdfPage } from '../../src/formats/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OcrOptions } from '../../src/formats/ocr';
import { assemblePdf, parsePdf } from '../../src/formats/pdf';
import { generateSafeDocument, inspectDocument, parseSafeDocument } from '../../src/welfare/document-safety';

const recognize = vi.hoisted(() => vi.fn());
const createWorker = vi.hoisted(() => vi.fn());
vi.mock('tesseract.js', () => ({ default: { createWorker, OEM: { LSTM_ONLY: 1 }, PSM: {} } }));
vi.mock('../../src/formats/ocr', async (original) => ({ ...await original<object>(), recognizePdf: recognize }));
beforeAll(() => {
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs').href;
  vi.stubGlobal('fetch', async () => new Response(readFileSync('public/fonts/NotoSansTC-Regular.ttf')));
});
beforeEach(() => recognize.mockReset());
const page = (text: string): PdfPage => ({ width: 400, height: 600, items: text ? [{ text, x: 30, y: 500, fontSize: 12, width: 120 }] : [] });
async function mixedFile() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([400, 600]).drawText('PAGE ONE', { font });
  pdf.addPage([400, 600]);
  pdf.addPage([400, 600]).drawText('PAGE THREE', { font });
  pdf.addPage([400, 600]);
  return new File([await pdf.save() as BlobPart], 'private.pdf');
}
describe('mixed PDF safety', () => {
  it('actual OCR helper honors the selected source page and cancels without advancing', async () => {
    const actual = await vi.importActual<{ recognizePdf(pdf: PDFDocumentProxy, options: OcrOptions): Promise<PdfPage[]> }>('../../src/formats/ocr');
    const controller = new AbortController();
    const terminate = vi.fn();
    createWorker.mockResolvedValue({ terminate });
    const getPage = vi.fn(async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); });
    await expect(actual.recognizePdf({ numPages: 5, getPage } as unknown as PDFDocumentProxy, { pageNumbers: [4, 2], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(getPage).toHaveBeenCalledExactlyOnceWith(4);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('actual OCR helper rejects invalid selections before starting a worker', async () => {
    const actual = await vi.importActual<{ recognizePdf(pdf: PDFDocumentProxy, options: OcrOptions): Promise<PdfPage[]> }>('../../src/formats/ocr');
    createWorker.mockClear();
    for (const pageNumbers of [[0], [6], [1, 1], [1.2]]) await expect(actual.recognizePdf({ numPages: 5 } as PDFDocumentProxy, { pageNumbers })).rejects.toThrow(/頁面/);
    expect(await actual.recognizePdf({ numPages: 5 } as PDFDocumentProxy, { pageNumbers: [] })).toEqual([]);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('OCRs only textless pages, preserves order and offsets, and defaults images off', async () => {
    const picture = { x: 0, y: 0, width: 10, height: 10, jpeg: new Uint8Array(), keep: true };
    recognize.mockResolvedValue([{ ...page('OCR TWO'), pictures: [picture] }, page('OCR FOUR')]);
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    const { document: doc, report } = await parseSafeDocument(await mixedFile(), { ocr: { onProgress, signal } });
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][1]).toMatchObject({ pageNumbers: [2, 4], onProgress, signal });
    expect(doc.text).toMatch(/PAGE ONE\s+OCR TWO\s+PAGE THREE\s+OCR FOUR/);
    expect((doc.handle as PdfHandle).pages).toHaveLength(4);
    expect(doc.layout?.kind).toBe('pdf');
    if (doc.layout?.kind === 'pdf') for (const pg of doc.layout.pages) for (const item of pg.items) expect(doc.text.slice(item.start, item.end)).toBeTruthy();
    expect(picture.keep).toBe(false);
    expect(report).toMatchObject({ nativeAllowed: true, pages: 4 });
    expect(report.issues.some((i) => i.code === 'ocr-review')).toBe(true);
  });

  it('keeps unreadable pages in layout and blocks incomplete output even with a forged report', async () => {
    recognize.mockResolvedValue([page(''), page('OCR FOUR')]);
    const { document: doc, report } = await parseSafeDocument(await mixedFile());
    expect((doc.handle as PdfHandle).pages).toHaveLength(4);
    expect(report.nativeAllowed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'incomplete-pages')).toBe(true);
    await expect(generateSafeDocument(doc, [], { nativeAllowed: true, issues: [] })).rejects.toThrow(/原格式/);
  });

  it('does not silently accept missing OCR page results', async () => {
    recognize.mockResolvedValue([page('OCR TWO')]);
    await expect(parseSafeDocument(await mixedFile())).rejects.toThrow(/完整/);
  });

  it('retains upstream text-layer parsing without invoking OCR unless per-page safety is requested', async () => {
    const doc = await parsePdf(await mixedFile(), { ocr: {} });
    expect(doc.text).toContain('PAGE THREE');
    expect(recognize).not.toHaveBeenCalled();
  });

  it('safe generation removes every original picture regardless of later keep toggles', async () => {
    const jpeg = new Uint8Array(readFileSync('scripts/assets/scan/ssd-product.jpg'));
    const picture = { x: 0, y: 0, width: 50, height: 50, jpeg, keep: true };
    const doc = assemblePdf('sample.pdf', [{ ...page('Secret'), pictures: [picture] }], true);
    const blob = await generateSafeDocument(doc, [{ start: 0, end: 6, replacement: '[Name1]' }], await inspectDocument(doc));
    expect(Buffer.from(await blob.arrayBuffer()).toString('latin1')).not.toContain('/Subtype /Image');
    const output = await parsePdf(new File([blob], 'output.pdf'));
    expect(output.text).toContain('[Name1]');
    expect(output.text).not.toContain('Secret');
    expect(picture.keep).toBe(true);
  });
});
