/**
 * iOS-compatible PDF download utility.
 * On Safari/iOS, <a download> is not supported — we open the PDF in a new tab instead.
 */

const isIOS = (): boolean => {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

const isSafari = (): boolean => {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
};

/**
 * Download or open a PDF from a Blob / base64 data URI.
 * On iOS/Safari it opens in a new tab (the browser shows a native share/save sheet).
 */
export const downloadPdfBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);

  if (isIOS() || isSafari()) {
    // On iOS Safari <a download> is ignored — open in new tab so user can use Share → Save to Files
    const win = window.open(url, '_blank');
    if (!win) {
      // Popup was blocked — fallback: navigate current tab
      window.location.href = url;
    }
    // Clean up object URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
};

/**
 * Download or open a PDF from a base64 string (without data URI prefix).
 */
export const downloadPdfBase64 = (base64: string, fileName: string): void => {
  const byteChars = atob(base64);
  const byteNumbers = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([byteNumbers], { type: 'application/pdf' });
  downloadPdfBlob(blob, fileName);
};

/**
 * Open a signed URL to a PDF.
 * On iOS we navigate directly; on other platforms we open a new tab.
 */
export const openPdfUrl = (url: string): void => {
  if (isIOS() || isSafari()) {
    // On iOS, window.open in async context can be blocked — use location assign
    window.location.href = url;
  } else {
    const win = window.open(url, '_blank');
    if (!win) {
      window.location.href = url;
    }
  }
};
