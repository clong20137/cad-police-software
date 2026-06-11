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

const firstConfiguredValue = (...values: Array<string | undefined>): string | undefined =>
  values.find((value) => value?.trim());

const apiUrl =
  firstConfiguredValue(
    window.CAD_CONFIG?.API_URL,
    process.env.REACT_APP_API_URL
  ) || 'http://localhost:5001/api';

export const runtimeConfig = {
  apiUrl,
  socketUrl:
    firstConfiguredValue(
      window.CAD_CONFIG?.SOCKET_URL,
      process.env.REACT_APP_SOCKET_URL
    ) || trimTrailingSlash(apiUrl).replace(/\/api$/, ''),
  googleMapsApiKey:
    firstConfiguredValue(
      window.CAD_CONFIG?.GOOGLE_API_KEY,
      window.CAD_CONFIG?.GOOGLE_MAPS_API_KEY,
      process.env.REACT_APP_GOOGLE_API_KEY,
      process.env.REACT_APP_GOOGLE_MAPS_API_KEY
    ) || ''
};
