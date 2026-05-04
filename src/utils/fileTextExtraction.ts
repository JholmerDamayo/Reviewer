import mammoth from 'mammoth';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

type ExtractedFileText = {
  text: string;
  sourceLabel: string;
};

const PDF_LINE_TOLERANCE = 3;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function getFileExtension(fileName: string) {
  const segments = fileName.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() ?? '' : '';
}

async function extractPdfText(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    useWorkerFetch: false
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = buildPdfPageText(content.items);

    if (pageText) {
      pages.push(pageText);
    }
  }

  return pages.join('\n\n');
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

function shouldInsertSpace(previousItem: TextItem, currentItem: TextItem) {
  const previousText = previousItem.str.trim();
  const currentText = currentItem.str.trim();

  if (!previousText || !currentText) {
    return false;
  }

  if (/\s$/.test(previousItem.str) || /^\s/.test(currentItem.str)) {
    return false;
  }

  const previousRight = Number(previousItem.transform[4]) + previousItem.width;
  const currentLeft = Number(currentItem.transform[4]);
  const gap = currentLeft - previousRight;

  if (gap > 1.5) {
    return true;
  }

  return /[A-Za-z0-9,.;:!?)]$/.test(previousText) && /^[A-Za-z0-9(]/.test(currentText);
}

function buildPdfPageText(items: Array<TextItem | TextMarkedContent>) {
  const lines: string[] = [];
  let currentLine = '';
  let previousItem: TextItem | null = null;
  let previousY: number | null = null;

  items.filter(isTextItem).forEach((item) => {
    const normalizedText = item.str.replace(/\s+/g, ' ').trim();

    if (!normalizedText) {
      if (item.hasEOL && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = '';
        previousItem = null;
        previousY = null;
      }
      return;
    }

    const currentY = Number(item.transform[5]);
    const isNewLine =
      previousY !== null && Math.abs(currentY - previousY) > PDF_LINE_TOLERANCE;

    if (isNewLine && currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = '';
      previousItem = null;
    }

    if (currentLine && previousItem && shouldInsertSpace(previousItem, item)) {
      currentLine += ' ';
    }

    currentLine += normalizedText;
    previousItem = item;
    previousY = currentY;

    if (item.hasEOL && currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = '';
      previousItem = null;
      previousY = null;
    }
  });

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractDocxText(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({
    arrayBuffer
  });

  return result.value.trim();
}

async function extractPlainText(file: File) {
  return (await file.text()).trim();
}

export async function extractTextFromQuestionFile(file: File): Promise<ExtractedFileText> {
  const extension = getFileExtension(file.name);

  if (extension === 'pdf') {
    const text = await extractPdfText(file);
    return {
      text,
      sourceLabel: 'PDF'
    };
  }

  if (extension === 'docx') {
    const text = await extractDocxText(file);
    return {
      text,
      sourceLabel: 'DOCX'
    };
  }

  if (extension === 'doc') {
    const text = await extractPlainText(file);
    if (!text) {
      throw new Error('Legacy .doc extraction is not available from this file.');
    }

    return {
      text,
      sourceLabel: 'DOC'
    };
  }

  const text = await extractPlainText(file);
  return {
    text,
    sourceLabel: extension ? extension.toUpperCase() : 'TEXT'
  };
}
