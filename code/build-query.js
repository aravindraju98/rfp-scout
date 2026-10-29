// n8n Code node (Run Once for All Items): one SAM.gov search per NAICS code.
// Edit NAICS_CODES / LOOKBACK_DAYS to change what the scout watches.
const NAICS_CODES = [
  '541511', // Custom computer programming services
  '541512', // Computer systems design services
  '541519', // Other computer related services
  '518210', // Data processing, hosting, and related services
];
const LOOKBACK_DAYS = 3; // overlaps the daily schedule so a missed day is still covered

const fmt = (d) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

const to = new Date();
const from = new Date(to.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

return NAICS_CODES.map((ncode) => ({
  json: {
    url: 'https://api.sam.gov/opportunities/v2/search',
    ncode,
    postedFrom: fmt(from),
    postedTo: fmt(to),
  },
}));
