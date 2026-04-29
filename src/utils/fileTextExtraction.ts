import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

type ExtractedFileText = {
  text: string;
  sourceLabel: string;
};

function getFileExtension(fileName: string) {
  const segments = fileName.toLowerCase().split('.');
  return segments.length > 1 ? segments.pop() ?? '' : '';
}

async function extractPdfText(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();

    if (pageText) {
      pages.push(pageText);
    }
  }

  return pages.join('\n\n');
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
