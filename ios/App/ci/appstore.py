"""Fill in the App Store listing via the App Store Connect API (runs in GitHub Actions).

  listing – name, subtitle, texts, URLs, category, age rating, screenshots, build,
            review notes, free price and EU availability. Does NOT submit.
  submit  – sends the prepared version to Apple for review.

Data: store/listing.json and store/screenshots/{nl,en}-*.png.
Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID.
Things the API cannot do (do these by hand in App Store Connect):
  App Privacy answers, EU trader status (DSA), review contact name + phone.
"""
import glob, hashlib, json, os, re, sys, time, urllib.error, urllib.request
import jwt

API = 'https://api.appstoreconnect.apple.com'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CFG = json.load(open(os.path.join(ROOT, 'store', 'listing.json'), encoding='utf-8'))
problems = []


def token():
    now = int(time.time())
    return jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      open(os.environ['ASC_KEY_PATH']).read(), algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})


def call(method, path, body=None, ok_fail=False):
    url = path if path.startswith('http') else API + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = ' '.join(e.read().decode(errors='replace').split())[:1500]
        if ok_fail:
            return {'_error': e.code, '_detail': detail}
        raise SystemExit(f'{method} {path} -> {e.code}: {detail}')


def step(name, fn):
    try:
        fn()
        print(f'✓ {name}')
    except SystemExit as e:
        problems.append(f'{name}: {e}')
        print(f'✗ {name}: {e}')


def rel(type_, id_):
    return {'data': {'type': type_, 'id': id_}}


app = call('GET', f"/v1/apps?filter[bundleId]={os.environ['BUNDLE_ID']}")['data'][0]
APP = app['id']
print('App:', app['attributes']['name'], '· primary language', app['attributes'].get('primaryLocale'))


def editable(items, key_names=('appStoreState', 'state', 'appVersionState')):
    ok = {'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'WAITING_FOR_REVIEW', 'READY_FOR_REVIEW'}
    for it in items:
        if any(it['attributes'].get(k) in ok for k in key_names):
            return it
    return None


def version():
    vs = call('GET', f'/v1/apps/{APP}/appStoreVersions?filter[platform]=IOS&limit=20')['data']
    v = editable(vs)
    if not v:
        v = call('POST', '/v1/appStoreVersions', {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'IOS', 'versionString': '1.0'},
                                                            'relationships': {'app': rel('apps', APP)}}})['data']
    return v


def listing():
    info = editable(call('GET', f'/v1/apps/{APP}/appInfos')['data']) or call('GET', f'/v1/apps/{APP}/appInfos')['data'][0]
    INFO = info['id']
    ver = version()
    VER = ver['id']
    print('Version', ver['attributes'].get('versionString'), ver['attributes'].get('appStoreState') or ver['attributes'].get('appVersionState'))

    def app_info_texts():
        have = {l['attributes']['locale']: l['id'] for l in call('GET', f'/v1/appInfos/{INFO}/appInfoLocalizations')['data']}
        for loc, t in CFG['locales'].items():
            attrs = {'subtitle': t['subtitle'], 'privacyPolicyUrl': CFG['privacyPolicyUrl']}
            if loc in have:
                # Try the wished-for names in order (App Store names must be unique across all apps)
                names = t.get('name') or []
                names = [names] if isinstance(names, str) else names
                done = False
                for nm in names:
                    r = call('PATCH', f'/v1/appInfoLocalizations/{have[loc]}', {'data': {'type': 'appInfoLocalizations', 'id': have[loc], 'attributes': {**attrs, 'name': nm}}}, ok_fail=True)
                    if '_error' not in r:
                        print(f'   {loc} name: {nm}'); done = True; break
                    print(f"   {loc} name '{nm}' not accepted: {r['_detail'][:160]}")
                if done:
                    continue
                call('PATCH', f'/v1/appInfoLocalizations/{have[loc]}', {'data': {'type': 'appInfoLocalizations', 'id': have[loc], 'attributes': attrs}})
            else:
                call('POST', '/v1/appInfoLocalizations', {'data': {'type': 'appInfoLocalizations', 'attributes': {'locale': loc, 'name': (t['name'][0] if isinstance(t.get('name'), list) else t.get('name')) or app['attributes']['name'], **attrs},
                                                                    'relationships': {'appInfo': rel('appInfos', INFO)}}})
    step('Name, subtitle, privacy policy (NL + EN)', app_info_texts)

    step('Category: Productivity / Business', lambda: call('PATCH', f'/v1/appInfos/{INFO}', {'data': {'type': 'appInfos', 'id': INFO, 'relationships': {
        'primaryCategory': rel('appCategories', CFG['primaryCategory']), 'secondaryCategory': rel('appCategories', CFG['secondaryCategory'])}}}))

    def age():
        decl = call('GET', f'/v1/appInfos/{INFO}/ageRatingDeclaration')['data']
        attrs = {}
        for k, v in decl['attributes'].items():
            if k == 'kidsAgeBand' or 'korea' in k.lower() or 'grac' in k.lower() or 'Override' in k or k.endswith('Url'):
                continue
            if isinstance(v, bool) or k in ('gambling', 'unrestrictedWebAccess', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance',
                                            'userGeneratedContent', 'advertising', 'healthOrWellnessTopics', 'seventeenPlus', 'datingAndRelationships'):
                attrs[k] = False
            else:
                attrs[k] = 'NONE'
        # Apple adds new yes/no questions now and then: switch any field it says must be a boolean, and retry
        for _ in range(25):
            r = call('PATCH', f"/v1/ageRatingDeclarations/{decl['id']}", {'data': {'type': 'ageRatingDeclarations', 'id': decl['id'], 'attributes': attrs}}, ok_fail=True)
            if '_error' not in r:
                return
            m = re.search(r"attribute '(\w+)'\. Expected a (\w+)", r['_detail'])
            if not m:
                raise SystemExit(f"{r['_error']} {r['_detail'][:400]}")
            attrs[m.group(1)] = False if m.group(2) == 'BOOLEAN' else 'NONE'
        raise SystemExit('age rating: too many retries')
    step('Age rating: 4+ (nothing objectionable)', age)

    step('Copyright', lambda: call('PATCH', f'/v1/appStoreVersions/{VER}', {'data': {'type': 'appStoreVersions', 'id': VER, 'attributes': {'copyright': CFG['copyright']}}}))

    vlocs = {}

    def version_texts():
        have = {l['attributes']['locale']: l['id'] for l in call('GET', f'/v1/appStoreVersions/{VER}/appStoreVersionLocalizations')['data']}
        for loc, t in CFG['locales'].items():
            attrs = {'description': t['description'], 'keywords': t['keywords'], 'promotionalText': t['promotionalText'], 'supportUrl': CFG['supportUrl']}
            if loc in have:
                call('PATCH', f'/v1/appStoreVersionLocalizations/{have[loc]}', {'data': {'type': 'appStoreVersionLocalizations', 'id': have[loc], 'attributes': attrs}})
                vlocs[loc] = have[loc]
            else:
                vlocs[loc] = call('POST', '/v1/appStoreVersionLocalizations', {'data': {'type': 'appStoreVersionLocalizations', 'attributes': {'locale': loc, **attrs},
                                                                                         'relationships': {'appStoreVersion': rel('appStoreVersions', VER)}}})['data']['id']
    step('Description, keywords, promo text, support URL (NL + EN)', version_texts)

    def screenshots():
        for loc, t in CFG['locales'].items():
            if loc not in vlocs:
                continue
            sets = call('GET', f'/v1/appStoreVersionLocalizations/{vlocs[loc]}/appScreenshotSets')['data']
            print(f"   {loc} existing sets: {', '.join(x['attributes']['screenshotDisplayType'] for x in sets) or '-'}")
            # 6.9" (large display) + 6.3" (medium display, required by Apple)
            for dtype, sub in (('APP_IPHONE_67', ''), ('APP_IPHONE_61', 'medium')):
                files = sorted(glob.glob(os.path.join(ROOT, 'store', 'screenshots', sub, f"{t['screenshots']}-*.png")))
                st = next((x for x in sets if x['attributes']['screenshotDisplayType'] == dtype), None)
                if st:
                    existing = call('GET', f"/v1/appScreenshotSets/{st['id']}/appScreenshots")['data']
                    if len(existing) == len(files) and os.environ.get('REUPLOAD') != '1':
                        print(f'   {loc} {dtype}: already there')
                        continue
                    for old in existing:
                        call('DELETE', f"/v1/appScreenshots/{old['id']}")
                else:
                    st = call('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': dtype},
                                                                          'relationships': {'appStoreVersionLocalization': rel('appStoreVersionLocalizations', vlocs[loc])}}})['data']
                for f in files:
                    data = open(f, 'rb').read()
                    shot = call('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': os.path.basename(f), 'fileSize': len(data)},
                                                                         'relationships': {'appScreenshotSet': rel('appScreenshotSets', st['id'])}}})['data']
                    for op in shot['attributes']['uploadOperations']:
                        chunk = data[op['offset']:op['offset'] + op['length']]
                        req = urllib.request.Request(op['url'], method=op['method'], data=chunk, headers={h['name']: h['value'] for h in op['requestHeaders']})
                        urllib.request.urlopen(req).read()
                    call('PATCH', f"/v1/appScreenshots/{shot['id']}", {'data': {'type': 'appScreenshots', 'id': shot['id'],
                                                                                'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
                print(f'   {loc} {dtype}: {len(files)} screenshots uploaded')
    step('Screenshots (6.9-inch iPhone, NL + EN)', screenshots)

    def build():
        b = call('GET', f'/v1/builds?filter[app]={APP}&filter[processingState]=VALID&sort=-uploadedDate&limit=1')['data']
        if not b:
            raise SystemExit('no processed build found yet')
        b = b[0]
        if b['attributes'].get('usesNonExemptEncryption') is None:
            call('PATCH', f"/v1/builds/{b['id']}", {'data': {'type': 'builds', 'id': b['id'], 'attributes': {'usesNonExemptEncryption': False}}})
        call('PATCH', f'/v1/appStoreVersions/{VER}/relationships/build', rel('builds', b['id']))
        print('   build', b['attributes']['version'])
    step('Newest build attached (export compliance: no special encryption)', build)

    def review():
        r = call('GET', f'/v1/appStoreVersions/{VER}/appStoreReviewDetail', ok_fail=True)
        if r.get('data') and r['data']['attributes'].get('contactFirstName'):
            call('PATCH', f"/v1/appStoreReviewDetails/{r['data']['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': r['data']['id'], 'attributes': {'notes': CFG['reviewNotes'], 'demoAccountRequired': False}}})
            return
        if not CFG.get('contactFirstName'):
            raise SystemExit('needs your name + phone as review contact: fill these in by hand (notes are in store/listing.md)')
        attrs = {'notes': CFG['reviewNotes'], 'demoAccountRequired': False, 'contactEmail': CFG['contactEmail'],
                 'contactFirstName': CFG['contactFirstName'], 'contactLastName': CFG['contactLastName'], 'contactPhone': CFG['contactPhone']}
        if r.get('data'):
            call('PATCH', f"/v1/appStoreReviewDetails/{r['data']['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': r['data']['id'], 'attributes': attrs}})
        else:
            call('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': attrs,
                                                                 'relationships': {'appStoreVersion': rel('appStoreVersions', VER)}}})
    step('Notes for the reviewer', review)

    def price():
        pts = call('GET', f'/v1/apps/{APP}/appPricePoints?filter[territory]=NLD&limit=200')['data']
        free = next(p for p in pts if float(p['attributes']['customerPrice']) == 0)
        r = call('POST', '/v1/appPriceSchedules', {
            'data': {'type': 'appPriceSchedules', 'relationships': {'app': rel('apps', APP), 'baseTerritory': rel('territories', 'NLD'),
                                                                    'manualPrices': {'data': [{'type': 'appPrices', 'id': '${free}'}]}}},
            'included': [{'type': 'appPrices', 'id': '${free}', 'attributes': {'startDate': None},
                          'relationships': {'appPricePoint': rel('appPricePoints', free['id'])}}]}, ok_fail=True)
        if '_error' in r:
            raise SystemExit(f"{r['_error']} {r['_detail'][:300]}")
    step('Price: free', price)

    def availability():
        want = set(CFG['territories'])
        cur = call('GET', f'/v1/apps/{APP}/appAvailabilityV2', ok_fail=True)
        if cur.get('data'):
            # Already exists (all countries on by default): switch each country on/off
            url = f"/v2/appAvailabilities/{cur['data']['id']}/territoryAvailabilities?include=territory&limit=200"
            changed = 0
            while url:
                page = call('GET', url)
                for ta in page['data']:
                    t = ta['relationships']['territory']['data']['id']
                    on = t in want
                    if ta['attributes'].get('available') != on:
                        call('PATCH', f"/v1/territoryAvailabilities/{ta['id']}", {'data': {'type': 'territoryAvailabilities', 'id': ta['id'], 'attributes': {'available': on}}})
                        changed += 1
                url = page.get('links', {}).get('next')
            print(f'   {changed} countries changed')
            return
        # Apple wants every country listed, each switched on or off
        terr = [t['id'] for t in call('GET', '/v1/territories?limit=200')['data']]
        body = {'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': False},
                         'relationships': {'app': rel('apps', APP), 'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}'} for t in terr]}}},
                'included': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}', 'attributes': {'available': t in want},
                              'relationships': {'territory': rel('territories', t)}} for t in terr]}
        r = call('POST', '/v2/appAvailabilities', body, ok_fail=True)
        if '_error' in r:
            raise SystemExit(f"{r['_error']} {r['_detail'][:500]}")
    step(f"Available in {len(CFG['territories'])} EU/EEA countries", availability)


def submit():
    ver = version()
    sub = call('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
                                                          'relationships': {'app': rel('apps', APP)}}})['data']
    call('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems', 'relationships': {
        'reviewSubmission': rel('reviewSubmissions', sub['id']), 'appStoreVersion': rel('appStoreVersions', ver['id'])}}})
    call('PATCH', f"/v1/reviewSubmissions/{sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': sub['id'], 'attributes': {'submitted': True}}})
    print('✓ Submitted for review')


if __name__ == '__main__':
    {'listing': listing, 'submit': submit}[sys.argv[1]]()
    if problems:
        print('\nStill to do by hand (or fix):')
        for p in problems:
            print(' -', p)
    print('\nAlways by hand in App Store Connect: App Privacy answers, EU trader status, review contact name + phone.')
