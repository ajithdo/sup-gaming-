import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Generates the check-in QR code locally (no third-party QR service sees booking data). */
export function useQr(text, size = 240) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    if (!text) { setUrl(''); return undefined; }
    QRCode.toDataURL(text, { margin: 0, width: size, errorCorrectionLevel: 'M' })
      .then(u => live && setUrl(u))
      .catch(() => live && setUrl(''));
    return () => { live = false; };
  }, [text, size]);
  return url;
}
