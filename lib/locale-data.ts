/**
 * Locale data for the location fields (country / region / timezone).
 *
 * Storage convention: we store the *display name* in the DB (e.g. "United States",
 * "Illinois", "America/Chicago"), never the ISO code. Existing rows have free-text
 * values that already follow this convention, so the dropdowns are drop-in compatible
 * for the 15 countries we curate. Other countries fall through to a free-text input
 * for the region; the country itself is always a dropdown.
 *
 * Why no npm dep: the curated subdivision data for our 15 expected studio countries
 * is ~5 KB. A package like `country-state-city` is ~1.6 MB and ships data we don't
 * need (full ISO 3166-2 + cities). When/if studios outside the top 15 want a real
 * region dropdown, add subdivisions here rather than pulling in a dep.
 */

export interface SelectOption {
  value: string
  label: string
}

// ── Countries (all ISO 3166-1 alpha-2, names via Intl.DisplayNames) ───────────

const COUNTRY_NAMER = new Intl.DisplayNames(['en'], { type: 'region' })

/**
 * All ISO 3166-1 alpha-2 country codes (plus XK for Kosovo, commonly used despite
 * not being officially assigned). Hardcoded because `Intl.supportedValuesOf('region')`
 * is *not* in ECMA-402 — the spec only allows 'calendar' | 'collation' | 'currency'
 * | 'numberingSystem' | 'timeZone' | 'unit'. Country codes change rarely (last
 * update was XS for South Sudan in 2011), so static maintenance is cheap.
 */
const COUNTRY_CODES: string[] = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ',
  'VA','VC','VE','VG','VI','VN','VU',
  'WF','WS',
  'XK',
  'YE','YT',
  'ZA','ZM','ZW',
]

const COUNTRY_OPTIONS: SelectOption[] = COUNTRY_CODES
  .map(code => ({ value: COUNTRY_NAMER.of(code) ?? code, label: COUNTRY_NAMER.of(code) ?? code }))
  // De-dup in case Intl maps two codes to the same display name (rare).
  .filter((opt, idx, arr) => arr.findIndex(o => o.value === opt.value) === idx)
  .sort((a, b) => a.label.localeCompare(b.label))

const NAME_TO_CODE: Map<string, string> = new Map(
  COUNTRY_CODES.map(code => [COUNTRY_NAMER.of(code) ?? code, code]),
)

export function getCountryOptions(): SelectOption[] {
  return COUNTRY_OPTIONS
}

/** Reverse-lookup the ISO 3166-1 alpha-2 code for a stored display name. */
export function isoCodeForCountry(countryName: string | null | undefined): string | undefined {
  if (!countryName) return undefined
  return NAME_TO_CODE.get(countryName)
}

// ── Region subdivisions for the top 15 expected studio countries ─────────────

interface SubdivisionConfig {
  /** Label shown above the dropdown — e.g. "State", "Province", "Prefecture". */
  label: string
  /** Display names, alphabetised. These are what we store in `studios.state`. */
  options: string[]
}

const SUBDIVISIONS: Record<string, SubdivisionConfig> = {
  US: {
    label: 'State',
    options: [
      'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
      'District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
      'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota',
      'Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
      'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon',
      'Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah',
      'Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming',
    ],
  },
  CA: {
    label: 'Province / Territory',
    options: [
      'Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador',
      'Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island',
      'Quebec','Saskatchewan','Yukon',
    ],
  },
  GB: {
    label: 'Country',
    options: ['England','Northern Ireland','Scotland','Wales'],
  },
  AU: {
    label: 'State / Territory',
    options: [
      'Australian Capital Territory','New South Wales','Northern Territory','Queensland',
      'South Australia','Tasmania','Victoria','Western Australia',
    ],
  },
  NZ: {
    label: 'Region',
    options: [
      'Auckland','Bay of Plenty','Canterbury','Gisborne',"Hawke's Bay",'Manawatū-Whanganui',
      'Marlborough','Nelson','Northland','Otago','Southland','Taranaki','Tasman','Waikato',
      'Wellington','West Coast',
    ],
  },
  IE: {
    label: 'County',
    options: [
      'Carlow','Cavan','Clare','Cork','Donegal','Dublin','Galway','Kerry','Kildare','Kilkenny',
      'Laois','Leitrim','Limerick','Longford','Louth','Mayo','Meath','Monaghan','Offaly',
      'Roscommon','Sligo','Tipperary','Waterford','Westmeath','Wexford','Wicklow',
    ],
  },
  PH: {
    label: 'Region',
    options: [
      'Bangsamoro','Bicol Region','Cagayan Valley','Calabarzon','Caraga','Central Luzon',
      'Central Visayas','Cordillera Administrative Region','Davao Region','Eastern Visayas',
      'Ilocos Region','Mimaropa','National Capital Region','Northern Mindanao','Soccsksargen',
      'Western Visayas','Zamboanga Peninsula',
    ],
  },
  IN: {
    label: 'State / Union Territory',
    options: [
      'Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar',
      'Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa',
      'Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka',
      'Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya',
      'Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu',
      'Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
    ],
  },
  MX: {
    label: 'State',
    options: [
      'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua',
      'Coahuila','Colima','Durango','Guanajuato','Guerrero','Hidalgo','Jalisco','Mexico City',
      'México','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro',
      'Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala',
      'Veracruz','Yucatán','Zacatecas',
    ],
  },
  AE: {
    label: 'Emirate',
    options: ['Abu Dhabi','Ajman','Dubai','Fujairah','Ras Al Khaimah','Sharjah','Umm Al Quwain'],
  },
  JP: {
    label: 'Prefecture',
    options: [
      'Aichi','Akita','Aomori','Chiba','Ehime','Fukui','Fukuoka','Fukushima','Gifu','Gunma',
      'Hiroshima','Hokkaido','Hyogo','Ibaraki','Ishikawa','Iwate','Kagawa','Kagoshima',
      'Kanagawa','Kochi','Kumamoto','Kyoto','Mie','Miyagi','Miyazaki','Nagano','Nagasaki',
      'Nara','Niigata','Oita','Okayama','Okinawa','Osaka','Saga','Saitama','Shiga','Shimane',
      'Shizuoka','Tochigi','Tokushima','Tokyo','Tottori','Toyama','Wakayama','Yamagata',
      'Yamaguchi','Yamanashi',
    ],
  },
  DE: {
    label: 'State',
    options: [
      'Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse',
      'Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate',
      'Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia',
    ],
  },
  FR: {
    label: 'Region',
    options: [
      'Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté','Brittany','Centre-Val de Loire',
      'Corsica','Grand Est','Hauts-de-France','Île-de-France','Normandy','Nouvelle-Aquitaine',
      'Occitanie','Pays de la Loire',"Provence-Alpes-Côte d'Azur",
    ],
  },
  ES: {
    label: 'Autonomous Community',
    options: [
      'Andalusia','Aragon','Asturias','Balearic Islands','Basque Country','Canary Islands',
      'Cantabria','Castile and León','Castile-La Mancha','Catalonia','Ceuta',
      'Community of Madrid','Extremadura','Galicia','La Rioja','Melilla','Murcia','Navarre',
      'Valencian Community',
    ],
  },
}

/**
 * Returns subdivision config for the given country *display name*, or null if
 * the country has no curated dropdown (caller should fall back to free-text).
 */
export function getSubdivisionsFor(countryName: string | null | undefined): SubdivisionConfig | null {
  const code = isoCodeForCountry(countryName)
  if (!code) return null
  return SUBDIVISIONS[code] ?? null
}

/** Label used above the region input — "State", "Province", "Region", etc. */
export function getRegionLabelFor(countryName: string | null | undefined): string {
  const config = getSubdivisionsFor(countryName)
  return config?.label ?? 'State / Region / Province'
}

// ── Timezones (full IANA list + country-filtered) ─────────────────────────────

/**
 * Country → IANA timezones map for our top 15 countries plus a few others where
 * the answer is obvious (e.g. Brazil, China, South Africa). Anything not listed
 * falls back to the full IANA list.
 */
const COUNTRY_TIMEZONES: Record<string, string[]> = {
  US: [
    'America/New_York','America/Chicago','America/Denver','America/Phoenix',
    'America/Los_Angeles','America/Anchorage','Pacific/Honolulu','America/Adak',
  ],
  CA: [
    'America/St_Johns','America/Halifax','America/Toronto','America/Winnipeg',
    'America/Regina','America/Edmonton','America/Vancouver','America/Whitehorse',
    'America/Yellowknife','America/Iqaluit',
  ],
  GB: ['Europe/London'],
  AU: [
    'Australia/Sydney','Australia/Melbourne','Australia/Brisbane','Australia/Adelaide',
    'Australia/Perth','Australia/Hobart','Australia/Darwin','Australia/Lord_Howe',
  ],
  NZ: ['Pacific/Auckland','Pacific/Chatham'],
  IE: ['Europe/Dublin'],
  PH: ['Asia/Manila'],
  IN: ['Asia/Kolkata'],
  MX: [
    'America/Mexico_City','America/Cancun','America/Chihuahua','America/Tijuana',
    'America/Hermosillo','America/Mazatlan','America/Matamoros','America/Monterrey',
  ],
  SG: ['Asia/Singapore'],
  AE: ['Asia/Dubai'],
  JP: ['Asia/Tokyo'],
  DE: ['Europe/Berlin'],
  FR: ['Europe/Paris'],
  ES: ['Europe/Madrid','Atlantic/Canary'],
}

let ALL_IANA: string[] | null = null
function allTimezones(): string[] {
  if (ALL_IANA) return ALL_IANA
  try {
    ALL_IANA = [...Intl.supportedValuesOf('timeZone')].sort()
  } catch {
    ALL_IANA = []
  }
  return ALL_IANA
}

function toOption(tz: string): SelectOption {
  // Label format: "America/Chicago (CDT/CST)" would be nice but tz-name lookup
  // is heavy; keep it as the raw IANA value for now — searchable.
  return { value: tz, label: tz.replace(/_/g, ' ') }
}

/**
 * Returns timezone options. If a country is selected and we have a curated list
 * for it, returns just that country's zones. Otherwise returns the full IANA list.
 */
export function getTimezoneOptionsFor(countryName: string | null | undefined): SelectOption[] {
  const code = isoCodeForCountry(countryName)
  const list = code ? COUNTRY_TIMEZONES[code] : undefined
  return (list ?? allTimezones()).map(toOption)
}

/**
 * Picks a sensible default timezone for the given country + region, or null if
 * the answer is ambiguous (e.g. multi-tz countries without a region match).
 * Conservative: returns null rather than guessing wrong (see Phase 5 premortem).
 */
export function defaultTimezoneForCountryRegion(
  countryName: string | null | undefined,
  _region?: string | null,
): string | null {
  const code = isoCodeForCountry(countryName)
  if (!code) return null
  const list = COUNTRY_TIMEZONES[code]
  if (!list) return null
  // Single-tz country: safe to auto-fill.
  if (list.length === 1) return list[0]
  // Multi-tz country: don't guess. Owner picks from the country-filtered dropdown.
  // (Future: add region → tz refinement when we onboard a studio that needs it.)
  return null
}
