import { PDFDocument } from 'pdf-lib'

export async function setProblemPdfTitle(
  bytes: Uint8Array,
  problemId: string
): Promise<Uint8Array> {
  if (!/^[1-9]\d*$/.test(problemId)) {
    throw new Error('Invalid problem ID for PDF title')
  }
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  document.setTitle(problemId, { showInWindowTitleBar: true })
  return document.save({ updateFieldAppearances: false })
}
