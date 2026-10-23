// Preview build only: environment for the server modules running in-browser.
globalThis.process = { env: { MASSIVE_API_KEY: 'preview' } };
globalThis.WHEEL_PREVIEW = true;
