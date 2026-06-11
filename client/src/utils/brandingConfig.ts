import { AdminConfigurationItem, PublicBrandingSettings } from '../types/auth';

export const defaultBrandingConfig: PublicBrandingSettings = {
  logoUrl: '',
  logoAlt: 'CAD logo'
};

export const brandingFromConfig = (items: AdminConfigurationItem[]): PublicBrandingSettings => {
  const item = items.find((entry) => entry.section === 'branding' && entry.code === 'APP_LOGO' && entry.active);
  if (!item) return defaultBrandingConfig;

  return {
    logoUrl: typeof item.metadata.logoUrl === 'string' ? item.metadata.logoUrl : '',
    logoAlt: typeof item.metadata.logoAlt === 'string' ? item.metadata.logoAlt : defaultBrandingConfig.logoAlt
  };
};
