/**
 * The four Azzurro Hotels properties tracked by the dashboard.
 *
 * `pageName` is Booking.com's URL slug and is the stable identifier we use to
 * find a property's page; `id` is our own short key used in the database and
 * in dashboard URLs, so renaming a property never breaks history.
 */
export interface PropertyConfig {
  id: string;
  /** Name operations staff use day to day. */
  name: string;
  /** Booking.com URL slug, e.g. hotel/au/<pageName>.html */
  pageName: string;
  countryCode: string;
}

export const PROPERTIES: readonly PropertyConfig[] = [
  { id: 'olympic-paddington', name: 'Olympic Hotel Paddington', pageName: 'olympic-paddington', countryCode: 'au' },
  { id: 'potts-point', name: 'Potts Point', pageName: 'venus-potts-point-sydney', countryCode: 'au' },
  { id: 'central-sydney', name: 'Central Sydney', pageName: 'venus-surry-hills', countryCode: 'au' },
  { id: 'darling-harbour', name: 'Darling Harbour', pageName: 'chateau-de-venus', countryCode: 'au' },
] as const;

export function bookingUrl(p: PropertyConfig, lang = 'en-gb'): string {
  return `https://www.booking.com/hotel/${p.countryCode}/${p.pageName}.${lang}.html`;
}

export function getProperty(id: string): PropertyConfig | undefined {
  return PROPERTIES.find((p) => p.id === id);
}
