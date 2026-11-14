// Algemene startwaarden. Persoonlijke gegevens (adressen, auto, kenteken,
// Sheet-koppeling) staan NIET in deze openbare code: die komen binnen via een
// persoonlijke instellingen-link (…/#setup=…) of worden in de app ingevuld.
window.RITLOG_CONFIG = {
  scriptUrl: '',
  token: '',
  rate: 0.25,               // € per km
  car: '',
  plate: '',
  driver: '',
  defaultType: 'Zakelijk',
  voiceLang: 'nl-NL',
  lastOdo: null,
  places: [],
  knownRoutes: [],

  // Accounts en synchronisatie (Supabase). De publishable key is bedoeld om openbaar te zijn:
  // de database laat iedereen alleen zijn eigen gegevens zien (row level security).
  supabaseUrl: 'https://eziidgowmhggffqcdncj.supabase.co',
  supabaseKey: 'sb_publishable_QaZwUKZFjUoBLpZb9T3n-Q_eJAulC_0',
  appleClientId: 'io.github.chenxi981211.ritlog',
};
