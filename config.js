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

  // Hulp & support (Instellingen)
  supportEmail: 'xicheninfo@gmail.com',
  supportUrl: 'https://chenxi981211-ui.github.io/ritlog/legal/support.html',
  webUrl: 'https://chenxi981211-ui.github.io/ritlog/',
  coffeeUrl: 'https://buymeacoffee.com/xiichen', // Buy Me a Coffee-link (website én app)
  about: {
    nl: 'Mijn vriend rijdt elke dag met zijn leaseauto naar zijn werk en terug, en moet voor de Belastingdienst elke rit netjes bijhouden. Dat was elke keer weer gedoe: adressen opzoeken, kilometers uitrekenen, alles overtypen in een spreadsheet.\n\nOm dat probleem voor hem op te lossen, heb ik Ritlog zelf ontworpen en gebouwd. Nu logt hij een rit in een paar tikken, en hopelijk helpt het jou net zo goed.\n\nVragen, ideeën of iets dat niet goed werkt? Stuur me gerust een mailtje.',
    en: 'My boyfriend drives his company car to work and back every day, and for the Dutch tax office he has to log every single ride. It was a chore every time: looking up addresses, working out kilometres, typing it all into a spreadsheet.\n\nTo solve that for him, I designed and built Tootle myself. Now he logs a ride in a few taps, and I hope it helps you just as much.\n\nQuestions, ideas or something not working? Feel free to send me an email.',
  },
};
