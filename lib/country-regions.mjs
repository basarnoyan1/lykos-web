// The continent of each ISO 3166-1 alpha-2 code, for summarising a country field by region where no map geometry is vendored (the app has
// no npm dependencies and ships no world outline). Continents as geography draws them: Central America and the Caribbean belong to North
// America, Turkey, Cyprus, Georgia, Armenia and Azerbaijan to Asia, Russia to Europe. A code in none of the lists has no region.
const LISTS = {
  Africa: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  Asia: 'AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  Europe: 'AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  'North America': 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  'South America': 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  Oceania: 'AS AU CC CX CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS UM',
  Antarctica: 'AQ BV GS HM TF',
};
export const REGION_ORDER = Object.freeze(Object.keys(LISTS));
const BY = new Map();
for (const [region, codes] of Object.entries(LISTS)) for (const c of codes.split(' ')) BY.set(c, region);
/** The continent of a country code, or '' when the code has none. */
export const regionOf = code => BY.get(code) || '';
