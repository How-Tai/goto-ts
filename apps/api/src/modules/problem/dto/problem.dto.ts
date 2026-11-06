export interface File extends Blob {
  readonly lastModified: number
  readonly name: string
}

export class UploadedFilesObject {
  readonly pdf?: Express.Multer.File[]

  readonly pdfTh?: Express.Multer.File[]

  readonly pdfEn?: Express.Multer.File[]

  readonly zip?: Express.Multer.File[]
}
