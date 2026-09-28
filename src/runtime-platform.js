// Android injects this bridge only into the bundled, exact-origin main frame.
export const nativeAndroid = typeof globalThis.TomkoNative?.postMessage === 'function';
export const tomkoRendering = Object.freeze({ pixelRatio: .5, drawHz: 15, antialias: false, shadows: false });
