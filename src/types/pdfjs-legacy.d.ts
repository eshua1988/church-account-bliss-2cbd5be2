declare module 'pdfjs-dist/legacy/build/pdf' {
  export function getDocument(src: any): any;
  export const GlobalWorkerOptions: { workerSrc?: string };
  export default { getDocument, GlobalWorkerOptions } as any;
}
