import { BadRequestException } from '@nestjs/common';
import { jsPDF } from 'jspdf';
export function validateLogo(dataUrl: string): string {
 const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
 if (!match) throw new BadRequestException('Choose a PNG or JPG/JPEG image.');
 const bytes = Buffer.from(match[2], 'base64');
 if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new BadRequestException('Logo must be 2 MB or smaller.');
 if (bytes.toString('base64') !== match[2]) throw new BadRequestException('Invalid image.');
 try {
  const image = new jsPDF().getImageProperties(new Uint8Array(bytes));
  if (image.fileType !== (match[1] === 'png' ? 'PNG' : 'JPEG') || !image.width || !image.height || image.width * image.height > 16000000) throw new Error();
 } catch { throw new BadRequestException('Choose a valid PNG or JPEG image up to 16 megapixels.'); }
 return dataUrl;
}
