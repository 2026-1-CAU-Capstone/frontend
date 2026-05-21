/* Vite emits the imported asset and returns its URL string. Used for the
 * pdf.js worker (pdfjs-dist/build/pdf.worker.min.mjs?url). */
declare module '*?url' {
  const url: string;
  export default url;
}
