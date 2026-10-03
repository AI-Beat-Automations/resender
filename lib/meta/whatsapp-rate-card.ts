// Tarifas por mensaje de WhatsApp Business Platform, en USD, que alimentan el
// estimador público (/whatsapp-cost-calculator). Es una copia a mano del rate
// card oficial de Meta: los enlaces de descarga caducan y el archivo cambia de
// formato (el «.csv» de octubre de 2026 es un .xlsx), así que no se baja en el
// build. Cuando Meta publique otro rate card se reemplaza la tabla y la fecha.
//
// Solo informa: Meta le factura estos cargos directo al cliente (ADR 0023).

/** Vigencia del rate card copiado abajo (ISO, zona horaria de la WABA). */
export const META_RATE_CARD_EFFECTIVE_DATE = "2026-10-01"

/** Página oficial donde Meta publica los rate cards por moneda. */
export { META_WHATSAPP_PRICING_URL } from "@/lib/meta/whatsapp-billing-links"

export type MetaMessageCategory = "marketing" | "utility" | "service"

export type MetaMarketRate = {
  id: string
  /** Bandera del país; las regiones «Resto de …» usan un globo. */
  flag: string
  name: { es: string; en: string }
} & Record<MetaMessageCategory, number>

/**
 * Las 47 filas del rate card, en su orden: países y después las regiones
 * «Resto de …» a las que Meta asigna el resto de prefijos. Servicio cuesta lo
 * mismo que utilidad en todos los mercados, pero se copia su columna tal cual
 * para no depender de esa regla.
 */
export const META_MARKET_RATES: readonly MetaMarketRate[] = [
  {
    id: "argentina",
    flag: "🇦🇷",
    name: { es: "Argentina", en: "Argentina" },
    marketing: 0.0618,
    utility: 0.026,
    service: 0.026,
  },
  {
    id: "bangladesh",
    flag: "🇧🇩",
    name: { es: "Bangladés", en: "Bangladesh" },
    marketing: 0.0732,
    utility: 0.0037,
    service: 0.0037,
  },
  {
    id: "brazil",
    flag: "🇧🇷",
    name: { es: "Brasil", en: "Brazil" },
    marketing: 0.0625,
    utility: 0.0068,
    service: 0.0068,
  },
  {
    id: "chile",
    flag: "🇨🇱",
    name: { es: "Chile", en: "Chile" },
    marketing: 0.0889,
    utility: 0.02,
    service: 0.02,
  },
  {
    id: "colombia",
    flag: "🇨🇴",
    name: { es: "Colombia", en: "Colombia" },
    marketing: 0.0125,
    utility: 0.0008,
    service: 0.0008,
  },
  {
    id: "egypt",
    flag: "🇪🇬",
    name: { es: "Egipto", en: "Egypt" },
    marketing: 0.0644,
    utility: 0.0036,
    service: 0.0036,
  },
  {
    id: "france",
    flag: "🇫🇷",
    name: { es: "Francia", en: "France" },
    marketing: 0.0859,
    utility: 0.03,
    service: 0.03,
  },
  {
    id: "germany",
    flag: "🇩🇪",
    name: { es: "Alemania", en: "Germany" },
    marketing: 0.1365,
    utility: 0.055,
    service: 0.055,
  },
  {
    id: "hong-kong",
    flag: "🇭🇰",
    name: { es: "Hong Kong", en: "Hong Kong" },
    marketing: 0.0732,
    utility: 0.026,
    service: 0.026,
  },
  {
    id: "hungary",
    flag: "🇭🇺",
    name: { es: "Hungría", en: "Hungary" },
    marketing: 0.086,
    utility: 0.035,
    service: 0.035,
  },
  {
    id: "india",
    flag: "🇮🇳",
    name: { es: "India", en: "India" },
    marketing: 0.0118,
    utility: 0.0014,
    service: 0.0014,
  },
  {
    id: "indonesia",
    flag: "🇮🇩",
    name: { es: "Indonesia", en: "Indonesia" },
    marketing: 0.0411,
    utility: 0.025,
    service: 0.025,
  },
  {
    id: "iraq",
    flag: "🇮🇶",
    name: { es: "Irak", en: "Iraq" },
    marketing: 0.0341,
    utility: 0.0079,
    service: 0.0079,
  },
  {
    id: "israel",
    flag: "🇮🇱",
    name: { es: "Israel", en: "Israel" },
    marketing: 0.0353,
    utility: 0.0053,
    service: 0.0053,
  },
  {
    id: "italy",
    flag: "🇮🇹",
    name: { es: "Italia", en: "Italy" },
    marketing: 0.0795,
    utility: 0.03,
    service: 0.03,
  },
  {
    id: "kazakhstan",
    flag: "🇰🇿",
    name: { es: "Kazajistán", en: "Kazakhstan" },
    marketing: 0.0604,
    utility: 0.018,
    service: 0.018,
  },
  {
    id: "kuwait",
    flag: "🇰🇼",
    name: { es: "Kuwait", en: "Kuwait" },
    marketing: 0.0792,
    utility: 0.044,
    service: 0.044,
  },
  {
    id: "malaysia",
    flag: "🇲🇾",
    name: { es: "Malasia", en: "Malaysia" },
    marketing: 0.086,
    utility: 0.014,
    service: 0.014,
  },
  {
    id: "mexico",
    flag: "🇲🇽",
    name: { es: "México", en: "Mexico" },
    marketing: 0.0397,
    utility: 0.0085,
    service: 0.0085,
  },
  {
    id: "morocco",
    flag: "🇲🇦",
    name: { es: "Marruecos", en: "Morocco" },
    marketing: 0.0414,
    utility: 0.023,
    service: 0.023,
  },
  {
    id: "netherlands",
    flag: "🇳🇱",
    name: { es: "Países Bajos", en: "Netherlands" },
    marketing: 0.1597,
    utility: 0.05,
    service: 0.05,
  },
  {
    id: "nepal",
    flag: "🇳🇵",
    name: { es: "Nepal", en: "Nepal" },
    marketing: 0.0732,
    utility: 0.0034,
    service: 0.0034,
  },
  {
    id: "nigeria",
    flag: "🇳🇬",
    name: { es: "Nigeria", en: "Nigeria" },
    marketing: 0.0516,
    utility: 0.0067,
    service: 0.0067,
  },
  {
    id: "oman",
    flag: "🇴🇲",
    name: { es: "Omán", en: "Oman" },
    marketing: 0.0341,
    utility: 0.0247,
    service: 0.0247,
  },
  {
    id: "pakistan",
    flag: "🇵🇰",
    name: { es: "Pakistán", en: "Pakistan" },
    marketing: 0.0473,
    utility: 0.015,
    service: 0.015,
  },
  {
    id: "peru",
    flag: "🇵🇪",
    name: { es: "Perú", en: "Peru" },
    marketing: 0.0703,
    utility: 0.03,
    service: 0.03,
  },
  {
    id: "poland",
    flag: "🇵🇱",
    name: { es: "Polonia", en: "Poland" },
    marketing: 0.0366,
    utility: 0.0122,
    service: 0.0122,
  },
  {
    id: "qatar",
    flag: "🇶🇦",
    name: { es: "Catar", en: "Qatar" },
    marketing: 0.0341,
    utility: 0.012,
    service: 0.012,
  },
  {
    id: "romania",
    flag: "🇷🇴",
    name: { es: "Rumania", en: "Romania" },
    marketing: 0.086,
    utility: 0.029,
    service: 0.029,
  },
  {
    id: "russia",
    flag: "🇷🇺",
    name: { es: "Rusia", en: "Russia" },
    marketing: 0.0802,
    utility: 0.04,
    service: 0.04,
  },
  {
    id: "saudi-arabia",
    flag: "🇸🇦",
    name: { es: "Arabia Saudita", en: "Saudi Arabia" },
    marketing: 0.0576,
    utility: 0.0107,
    service: 0.0107,
  },
  {
    id: "singapore",
    flag: "🇸🇬",
    name: { es: "Singapur", en: "Singapore" },
    marketing: 0.0732,
    utility: 0.016,
    service: 0.016,
  },
  {
    id: "south-africa",
    flag: "🇿🇦",
    name: { es: "Sudáfrica", en: "South Africa" },
    marketing: 0.0379,
    utility: 0.0095,
    service: 0.0095,
  },
  {
    id: "spain",
    flag: "🇪🇸",
    name: { es: "España", en: "Spain" },
    marketing: 0.0707,
    utility: 0.02,
    service: 0.02,
  },
  {
    id: "sri-lanka",
    flag: "🇱🇰",
    name: { es: "Sri Lanka", en: "Sri Lanka" },
    marketing: 0.0732,
    utility: 0.002,
    service: 0.002,
  },
  {
    id: "turkey",
    flag: "🇹🇷",
    name: { es: "Turquía", en: "Turkey" },
    marketing: 0.0109,
    utility: 0.0009,
    service: 0.0009,
  },
  {
    id: "ukraine",
    flag: "🇺🇦",
    name: { es: "Ucrania", en: "Ukraine" },
    marketing: 0.086,
    utility: 0.0298,
    service: 0.0298,
  },
  {
    id: "united-arab-emirates",
    flag: "🇦🇪",
    name: { es: "Emiratos Árabes Unidos", en: "United Arab Emirates" },
    marketing: 0.0576,
    utility: 0.0157,
    service: 0.0157,
  },
  {
    id: "united-kingdom",
    flag: "🇬🇧",
    name: { es: "Reino Unido", en: "United Kingdom" },
    marketing: 0.0635,
    utility: 0.022,
    service: 0.022,
  },
  {
    id: "north-america",
    flag: "🌎",
    name: { es: "Norteamérica (EE. UU. y Canadá)", en: "North America (US & Canada)" },
    marketing: 0.025,
    utility: 0.0034,
    service: 0.0034,
  },
  {
    id: "rest-of-africa",
    flag: "🌍",
    name: { es: "Resto de África", en: "Rest of Africa" },
    marketing: 0.0225,
    utility: 0.004,
    service: 0.004,
  },
  {
    id: "rest-of-asia-pacific",
    flag: "🌏",
    name: { es: "Resto de Asia-Pacífico", en: "Rest of Asia Pacific" },
    marketing: 0.0842,
    utility: 0.0113,
    service: 0.0113,
  },
  {
    id: "rest-of-central-eastern-europe",
    flag: "🌍",
    name: { es: "Resto de Europa Central y del Este", en: "Rest of Central & Eastern Europe" },
    marketing: 0.086,
    utility: 0.0212,
    service: 0.0212,
  },
  {
    id: "rest-of-latin-america",
    flag: "🌎",
    name: { es: "Resto de Latinoamérica", en: "Rest of Latin America" },
    marketing: 0.074,
    utility: 0.0113,
    service: 0.0113,
  },
  {
    id: "rest-of-middle-east",
    flag: "🌍",
    name: { es: "Resto de Medio Oriente", en: "Rest of Middle East" },
    marketing: 0.0392,
    utility: 0.0091,
    service: 0.0091,
  },
  {
    id: "rest-of-western-europe",
    flag: "🌍",
    name: { es: "Resto de Europa Occidental", en: "Rest of Western Europe" },
    marketing: 0.0592,
    utility: 0.0171,
    service: 0.0171,
  },
  {
    id: "other",
    flag: "🌐",
    name: { es: "Otros", en: "Other" },
    marketing: 0.0604,
    utility: 0.0077,
    service: 0.0077,
  },
]

export const DEFAULT_MARKET_ID = "argentina"

export function findMarket(id: string): MetaMarketRate {
  return (
    META_MARKET_RATES.find((market) => market.id === id) ??
    META_MARKET_RATES.find((market) => market.id === DEFAULT_MARKET_ID)!
  )
}
