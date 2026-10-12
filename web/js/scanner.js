/**
 * iPhone Safari Camera QR Code Scanner
 * Handles Secure Context constraints (HTTPS), BarcodeDetector, and graceful manual fallback.
 */

class QRScanner {
  constructor() {
    this.stream = null;
    this.videoElem = null;
    this.scanInterval = null;
    this.isScanning = false;
  }

  isSecureContext() {
    return window.isSecureContext === true || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  isSupported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  hasBarcodeDetector() {
    return 'BarcodeDetector' in window;
  }

  async startScan(videoElement, onDetected, onError) {
    // 1. Check Secure Context requirement (iOS Safari blocks getUserMedia on plain HTTP IPs)
    if (!this.isSecureContext()) {
      onError(new Error(
        'Camera scanning on iPhone Safari requires a secure connection (HTTPS). ' +
        'Please enter the 6-character code below manually.'
      ));
      return;
    }

    if (!this.isSupported()) {
      onError(new Error('Camera access is not supported by this browser. Please use the pairing code below.'));
      return;
    }

    this.videoElem = videoElement;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      this.videoElem.srcObject = this.stream;
      this.videoElem.setAttribute('playsinline', 'true'); // Required for iOS Safari inline video
      await this.videoElem.play();
      this.isScanning = true;

      // Check native BarcodeDetector (iOS 17+ Safari)
      if (this.hasBarcodeDetector()) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        this.scanInterval = setInterval(async () => {
          if (!this.isScanning || !this.videoElem) return;
          try {
            const barcodes = await detector.detect(this.videoElem);
            if (barcodes && barcodes.length > 0) {
              const rawVal = barcodes[0].rawValue;
              if (rawVal && rawVal.trim().length > 0) {
                this.stopScan();
                onDetected(rawVal.trim());
              }
            }
          } catch (e) {}
        }, 200);
      } else {
        // Fallback message for older Safari versions lacking BarcodeDetector
        onError(new Error(
          'Your browser does not have a native QR scanner enabled. ' +
          'Please enter the 6-character code manually below.'
        ));
      }

    } catch (err) {
      this.stopScan();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        onError(new Error('Camera permission was denied. You can enter the pairing code manually below.'));
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        onError(new Error('No camera found on this device. Please enter the pairing code manually below.'));
      } else {
        onError(new Error('Camera error: ' + (err.message || 'Unable to open camera')));
      }
    }
  }

  stopScan() {
    this.isScanning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.stream) {
      try {
        this.stream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      this.stream = null;
    }
    if (this.videoElem) {
      this.videoElem.srcObject = null;
    }
  }
}

window.qrScanner = new QRScanner();
