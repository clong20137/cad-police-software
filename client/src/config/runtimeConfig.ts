declare global {
  interface Window {
    CAD_CONFIG?: {
      API_URL?: string;
      SOCKET_URL?: string;
      GOOGLE_API_KEY?: string;
      GOOGLE_MAPS_API_KEY?: string;
    };
  }
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const runtimeConfig = {
  apiUrl:
    process.env.REACT_APP_API_URL ||
    window.CAD_CONFIG?.API_URL ||
    'http://localhost:5001/api',
  socketUrl:
    process.env.REACT_APP_SOCKET_URL ||
    window.CAD_CONFIG?.SOCKET_URL ||
    trimTrailingSlash(
      process.env.REACT_APP_API_URL ||
        window.CAD_CONFIG?.API_URL ||
        'http://localhost:5001/api'
    ).replace(/\/api$/, ''),
  googleMapsApiKey:
    process.env.REACT_APP_GOOGLE_API_KEY ||
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY ||
    window.CAD_CONFIG?.GOOGLE_API_KEY ||
    window.CAD_CONFIG?.GOOGLE_MAPS_API_KEY ||
    ''
};
