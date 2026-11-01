const fs = require('node:fs');
// Isolate PDF.js worker lifecycle from Jest's per-suite VM teardown.
(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(0)),
    verbosity: 0,
  });
  const pdf = await loading.promise;
  try {
    const texts = [],
      pageSizes = [],
      positions = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i),
        viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      texts.push(content.items.map((item) => item.str).join(' '));
      positions.push(
        ...content.items
          .filter((item) => item.str.trim())
          .map((item) => ({
            text: item.str,
            page: i,
            x: item.transform[4],
            y: viewport.height - item.transform[5],
            size: item.height,
          })),
      );
      pageSizes.push({ width: viewport.width, height: viewport.height });
    }
    let coloredPixels;
    if (process.argv.includes('--raster')) {
      const { createCanvas } = require('@napi-rs/canvas');
      const page = await pdf.getPage(1),
        viewport = page.getViewport({ scale: 1 }),
        canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
      await page.render({
        canvas,
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;
      const pixels = canvas
        .getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height).data;
      coloredPixels = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2])
          coloredPixels++;
    }
    process.stdout.write(
      JSON.stringify({
        text: texts.join(' '),
        texts,
        pageSizes,
        positions,
        pageCount: pdf.numPages,
        coloredPixels,
      }),
    );
  } finally {
    await loading.destroy();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
