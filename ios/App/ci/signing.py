"""Tijdelijke App Store-ondertekening voor de cloud-build (App Store Connect API).

  setup   – maakt een distributiecertificaat + App Store-profiel voor deze bundle ID,
            zet ze in een tijdelijke keychain en schrijft de namen naar $GITHUB_ENV
  cleanup – trekt het certificaat in en verwijdert het profiel (ook als de build faalde)

Raakt alleen resources aan die deze run zelf heeft gemaakt; andere apps (zoals Sleep Paw)
blijven ongemoeid. Gegevens: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, RUNNER_TEMP.
"""
import base64, json, os, secrets, subprocess, sys, time, urllib.request, urllib.error
import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

API = 'https://api.appstoreconnect.apple.com/v1'
TMP = os.environ['RUNNER_TEMP']
STATE = os.path.join(TMP, 'signing-state.json')


def token():
    key = open(os.environ['ASC_KEY_PATH']).read()
    now = int(time.time())
    return jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': now, 'exp': now + 900, 'aud': 'appstoreconnect-v1'},
                      key, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')[:600]
        raise SystemExit(f'API {method} {path} gaf {e.code}: {detail}')


def run(*cmd):
    # Bij een fout alleen het commando noemen, niet de argumenten (daar zit een wachtwoord tussen)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'{cmd[0]} {cmd[1]} mislukt ({r.returncode}): {r.stderr.strip()[:300]}')


def setup():
    bundle = os.environ['BUNDLE_ID']
    run_id = os.environ.get('GITHUB_RUN_ID', str(int(time.time())))
    # 1. Sleutel + certificaataanvraag, distributiecertificaat aanmaken
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = x509.CertificateSigningRequestBuilder().subject_name(x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, f'Ritlog CI {run_id}'),
        x509.NameAttribute(NameOID.COUNTRY_NAME, 'NL'),
    ])).sign(key, hashes.SHA256())
    csr_pem = csr.public_bytes(serialization.Encoding.PEM).decode()
    cert = call('POST', '/certificates', {'data': {'type': 'certificates', 'attributes': {'certificateType': 'DISTRIBUTION', 'csrContent': csr_pem}}})['data']
    state = {'certificate': cert['id']}
    json.dump(state, open(STATE, 'w'))
    der = base64.b64decode(cert['attributes']['certificateContent'])
    certificate = x509.load_der_x509_certificate(der)

    # 2. In een tijdelijke keychain zetten
    p12_pass = secrets.token_hex(16)
    kc_pass = secrets.token_hex(16)
    # macOS 'security import' leest alleen de oudere PKCS#12-versleuteling (3DES/SHA1)
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(p12_pass.encode()))
    p12 = pkcs12.serialize_key_and_certificates(b'ritlog', key, certificate, None, enc)
    p12_path = os.path.join(TMP, 'dist.p12')
    open(p12_path, 'wb').write(p12)
    kc = os.path.join(TMP, 'ritlog-ci.keychain-db')
    run('security', 'create-keychain', '-p', kc_pass, kc)
    run('security', 'set-keychain-settings', '-lut', '21600', kc)
    run('security', 'unlock-keychain', '-p', kc_pass, kc)
    existing = subprocess.run(['security', 'list-keychains', '-d', 'user'], capture_output=True, text=True).stdout.split()
    run('security', 'list-keychains', '-d', 'user', '-s', kc, *[k.strip('"') for k in existing])
    run('security', 'import', p12_path, '-k', kc, '-P', p12_pass, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')
    run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', kc_pass, kc)
    os.remove(p12_path)
    # Apple-tussencertificaat (WWDR G3) voor de zekerheid
    wwdr = os.path.join(TMP, 'wwdr.cer')
    urllib.request.urlretrieve('https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer', wwdr)
    subprocess.run(['security', 'import', wwdr, '-k', kc], check=False)

    # 3. App Store-profiel voor deze bundle ID
    ids = call('GET', f'/bundleIds?filter[identifier]={bundle}&filter[platform]=IOS')['data']
    bid = next((b['id'] for b in ids if b['attributes']['identifier'] == bundle), None)
    if not bid:
        raise SystemExit(f'Bundle ID {bundle} niet gevonden in je ontwikkelaarsaccount')
    caps = call('GET', f'/bundleIds/{bid}/bundleIdCapabilities')['data']
    print('Mogelijkheden van de App ID:', ', '.join(sorted(c['attributes']['capabilityType'] for c in caps)) or '(geen)')
    name = f'Ritlog CI {run_id}'
    prof = call('POST', '/profiles', {'data': {'type': 'profiles', 'attributes': {'name': name, 'profileType': 'IOS_APP_STORE'},
                                                'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': bid}},
                                                                  'certificates': {'data': [{'type': 'certificates', 'id': cert['id']}]}}}})['data']
    state['profile'] = prof['id']
    json.dump(state, open(STATE, 'w'))
    pdir = os.path.expanduser('~/Library/MobileDevice/Provisioning Profiles')
    os.makedirs(pdir, exist_ok=True)
    open(os.path.join(pdir, prof['attributes']['uuid'] + '.mobileprovision'), 'wb').write(base64.b64decode(prof['attributes']['profileContent']))
    with open(os.environ['GITHUB_ENV'], 'a') as env:
        env.write(f'PROFILE_NAME={name}\nSIGN_KEYCHAIN={kc}\n')
    print('Ondertekening klaar: tijdelijk distributiecertificaat en App Store-profiel aangemaakt.')


def cleanup():
    if not os.path.exists(STATE):
        print('Niets op te ruimen.')
        return
    state = json.load(open(STATE))
    if state.get('profile'):
        try: call('DELETE', f"/profiles/{state['profile']}"); print('Tijdelijk profiel verwijderd.')
        except SystemExit as e: print(e)
    if state.get('certificate'):
        try: call('DELETE', f"/certificates/{state['certificate']}"); print('Tijdelijk certificaat ingetrokken.')
        except SystemExit as e: print(e)
    kc = os.path.join(TMP, 'ritlog-ci.keychain-db')
    subprocess.run(['security', 'delete-keychain', kc], check=False)


if __name__ == '__main__':
    {'setup': setup, 'cleanup': cleanup}[sys.argv[1]]()
