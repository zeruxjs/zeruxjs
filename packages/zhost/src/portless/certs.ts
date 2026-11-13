import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as tls from 'node:tls';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fixOwnership } from './utils.js';

/** How long the CA certificate is valid (10 years, in days). */
const CA_VALIDITY_DAYS = 3650;

/** How long server certificates are valid (1 year, in days). */
const SERVER_VALIDITY_DAYS = 365;

/** Buffer (in ms) subtracted from expiry to trigger early regeneration. */
const EXPIRY_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Common Name used for the portless local CA. */
const CA_COMMON_NAME = 'portless Local CA';

/** openssl command timeout (ms). */
const OPENSSL_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// File names
// ---------------------------------------------------------------------------

/** Fixed private CA-key leaf beneath the trusted state directory. */
const CA_KEY_FILE = 'ca-key.pem';
/** Fixed local CA certificate leaf; not an automatically installed system trust root. */
const CA_CERT_FILE = 'ca.pem';
/** Fixed private default server-key leaf. */
const SERVER_KEY_FILE = 'server-key.pem';
/** Fixed default server certificate leaf. */
const SERVER_CERT_FILE = 'server.pem';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check local read access without creating or trusting a certificate.
 * @param {string} filePath - Host-controlled private-state path.
 * @returns {boolean} Whether the path is currently readable; not an inode/ownership or validity guarantee.
 */
function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Check only whether a readable X509 certificate remains outside the existing early-expiry window.
 * @param {string} certPath - Host-owned local certificate path.
 * @returns {boolean} False on parse/read/expiry failure; this is not full chain or system-trust validation.
 */
function isCertValid(certPath: string): boolean {
  try {
    /** Readable local certificate text parsed only by the native X509 implementation. */
    const pem = fs.readFileSync(certPath, 'utf-8');
    /** Parsed certificate or generated certificate bytes, never exposed as executable content. */
    const cert = new crypto.X509Certificate(pem);
    /** Native certificate not-after timestamp compared with the early-renewal window. */
    const expiry = new Date(cert.validTo).getTime();
    return Date.now() + EXPIRY_BUFFER_MS < expiry;
  } catch {
    return false;
  }
}

/** Retain the legacy OpenSSL compatibility check rejecting reported SHA-1 algorithms; passing is not a complete signature-strength certification.
 * @param {string} certPath - Trusted local certificate path inspected with fixed OpenSSL arguments.
 * @returns {boolean} False for missing/failed inspection or a SHA-1 algorithm label.
 */
function isCertSignatureStrong(certPath: string): boolean {
  try {
    /** Native certificate inspection output, used only for its reported algorithm label. */
    const text = openssl(['x509', '-in', certPath, '-noout', '-text']);
    /** Required native-output capture, accessed only after an anchored/presence match check. */
    const match = text.match(/Signature Algorithm:\s*(\S+)/i);
    if (!match) {
      return false;
    }
    /** Reported signature algorithm label checked by the existing SHA-1 rejection policy. */
    const algo = match[1]!.toLowerCase();
    // SHA-1 variants: sha1WithRSAEncryption, ecdsa-with-SHA1, etc.
    // SHA-256+ variants do not contain "sha1" as a substring.
    return !algo.includes('sha1');
  } catch {
    return false;
  }
}

/** Execute trusted fixed OpenSSL argument arrays directly with the existing finite timeout, never through a shell.
 * @param {string[]} args - Implementation-owned argument tokens; never arbitrary request/model command arguments.
 * @param {{ input?: string }} options - Optional trusted stdin content for the native command.
 * @param {string | undefined} options.input - Optional trusted stdin content for the fixed native invocation.
 * @returns {string} Native stdout; failure throws an internal diagnostic that may contain local paths.
 */
function openssl(args: string[], options?: { input?: string }): string {
  try {
    return execFileSync('openssl', args, {
      encoding: 'utf-8',
      timeout: OPENSSL_TIMEOUT_MS,
      input: options?.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    /** Private native failure summary; may include host paths and must not become public telemetry. */
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `openssl failed: ${message}\n\nMake sure openssl is installed (ships with macOS and most Linux distributions).`
    );
  }
}

/** Promisified trusted direct-exec helper; it never evaluates a shell command string. */
const execFileAsync = promisify(execFileCb);

/** Await direct trusted OpenSSL execution without blocking the event loop, retaining the existing native timeout.
 * @param {string[]} args - Implementation-owned command tokens using validated names and host-owned paths.
 * @returns {Promise<string>} Native stdout; private native failure details remain host-side.
 */
async function opensslAsync(args: string[]): Promise<string> {
  try {
    /** Native stdout from the fixed asynchronous OpenSSL invocation. */
    const { stdout } = await execFileAsync('openssl', args, {
      encoding: 'utf-8',
      timeout: OPENSSL_TIMEOUT_MS,
    });
    return stdout;
  } catch (err: unknown) {
    /** Private native failure summary; may include host paths and must not become public telemetry. */
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `openssl failed: ${message}\n\nMake sure openssl is installed (ships with macOS and most Linux distributions).`
    );
  }
}

// ---------------------------------------------------------------------------
// CA generation
// ---------------------------------------------------------------------------

/** Generate an explicit local EC CA/key inside an existing trusted state directory; does not install system trust.
 * @param {string} stateDir - Existing host-owned private directory with no untrusted concurrent filesystem writers.
 * @returns {{certPath: string; keyPath: string}} Created CA certificate/private-key paths after applying their existing permissions.
 */
function generateCA(stateDir: string): { certPath: string; keyPath: string } {
  /** Private local key path under the trusted state/cache root. */
  const keyPath = path.join(stateDir, CA_KEY_FILE);
  /** Local certificate path under the trusted state/cache root. */
  const certPath = path.join(stateDir, CA_CERT_FILE);

  // Generate EC private key
  openssl([
    'ecparam',
    '-genkey',
    '-name',
    'prime256v1',
    '-noout',
    '-out',
    keyPath,
  ]);

  // Generate self-signed CA certificate
  openssl([
    'req',
    '-new',
    '-x509',
    '-sha256',
    '-key',
    keyPath,
    '-out',
    certPath,
    '-days',
    CA_VALIDITY_DAYS.toString(),
    '-subj',
    `/CN=${CA_COMMON_NAME}`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  ]);

  fs.chmodSync(keyPath, 0o600);
  fs.chmodSync(certPath, 0o644);
  fixOwnership(keyPath, certPath);

  return { certPath, keyPath };
}

/** Write a certificate extension file through one no-follow regular, singly linked inode and close its descriptor on failure or success.
 * @param {string} file - Host-owned fixed extension-config path.
 * @param {string} text - Trusted generated OpenSSL configuration, never arbitrary user code.
 * @returns {void} Replaces/truncates this inode’s bytes under the existing private-state policy.
 */
function writeCertificateConfig(file: string, text: string): void {
  /** Owned native file descriptor, closed in finally after inode validation/write. */
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_NOFOLLOW |
      fs.constants.O_NONBLOCK,
    0o600
  );
  try {
    /** Metadata from the opened config inode, required to be regular and singly linked. */
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error('Unsafe certificate configuration');
    }
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, text);
    fs.ftruncateSync(fd, Buffer.byteLength(text));
  } finally {
    fs.closeSync(fd);
  }
}
/** Asynchronously write/truncate one guarded extension-config inode, retaining ownership until native handle close.
 * @param {string} file - Host-owned fixed extension-config path.
 * @param {string} text - Trusted generated OpenSSL configuration.
 * @returns {Promise<void>} Settles after the owned native file handle closes.
 */
async function writeCertificateConfigAsync(
  file: string,
  text: string
): Promise<void> {
  /** Owned async config-file handle, closed after all stat/write/truncate operations. */
  const handle = await fs.promises.open(
    file,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_NOFOLLOW |
      fs.constants.O_NONBLOCK,
    0o600
  );
  try {
    /** Metadata from the opened config inode, required to be regular and singly linked. */
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error('Unsafe certificate configuration');
    }
    await handle.chmod(0o600);
    await handle.writeFile(text);
    await handle.truncate(Buffer.byteLength(text));
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Server certificate generation
// ---------------------------------------------------------------------------

/** Generate the default local server certificate with explicit SAN settings; successful issuance removes temporary CSR/config files.
 * @param {string} stateDir - Existing private host-owned state directory.
 * @param {string} tld - Validated host-controlled namespace, defaulting to localhost.
 * @returns {{certPath: string; keyPath: string}} Default server certificate and private-key paths; issuance failure may leave files for host inspection/cleanup.
 */
function generateServerCert(
  stateDir: string,
  tld = 'localhost'
): { certPath: string; keyPath: string } {
  /** Host-owned private local CA key used only by fixed signing commands. */
  const caKeyPath = path.join(stateDir, CA_KEY_FILE);
  /** Host-owned local CA certificate, distinct from an installed platform copy. */
  const caCertPath = path.join(stateDir, CA_CERT_FILE);
  /** Private default server-key destination beneath the trusted state root. */
  const serverKeyPath = path.join(stateDir, SERVER_KEY_FILE);
  /** Default server certificate destination beneath the trusted state root. */
  const serverCertPath = path.join(stateDir, SERVER_CERT_FILE);
  /** Fixed private signing-request intermediate, removed after successful issuance. */
  const csrPath = path.join(stateDir, 'server.csr');
  /** Guarded generated extension configuration, removed after successful issuance. */
  const extPath = path.join(stateDir, 'server-ext.cnf');

  validateSNIServername(tld, tld);
  // Generate server private key
  openssl([
    'ecparam',
    '-genkey',
    '-name',
    'prime256v1',
    '-noout',
    '-out',
    serverKeyPath,
  ]);

  // Generate CSR
  openssl([
    'req',
    '-new',
    '-key',
    serverKeyPath,
    '-out',
    csrPath,
    '-subj',
    `/CN=${tld}`,
  ]);

  // Write extension config for SANs
  writeCertificateConfig(
    extPath,
    [
      'authorityKeyIdentifier=keyid,issuer',
      'basicConstraints=CA:FALSE',
      'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=DNS:${tld},DNS:*.${tld}`,
    ].join('\n') + '\n'
  );

  // Sign with CA
  openssl([
    'x509',
    '-req',
    '-sha256',
    '-in',
    csrPath,
    '-CA',
    caCertPath,
    '-CAkey',
    caKeyPath,
    '-CAcreateserial',
    '-out',
    serverCertPath,
    '-days',
    SERVER_VALIDITY_DAYS.toString(),
    '-extfile',
    extPath,
  ]);

  // Clean up temporary files (keep ca.srl for serial number tracking)
  for (const tmp of [csrPath, extPath]) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Non-fatal
    }
  }

  fs.chmodSync(serverKeyPath, 0o600);
  fs.chmodSync(serverCertPath, 0o644);
  fixOwnership(serverKeyPath, serverCertPath);

  return { certPath: serverCertPath, keyPath: serverKeyPath };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ensure local CA/default certificate files meet the implemented readability, expiry, SHA-1 rejection and hostname checks; never installs trust.
 * @param {string} stateDir - Existing trusted private state directory.
 * @param {string} tld - Explicit host-controlled TLS namespace, defaulting to localhost.
 * @returns {{certPath: string; keyPath: string; caPath: string; caGenerated: boolean}} Local paths and CA-generation receipt, not browser/system-trust or complete PKI qualification.
 */
export function ensureCerts(
  stateDir: string,
  tld = 'localhost'
): {
  certPath: string;
  keyPath: string;
  caPath: string;
  caGenerated: boolean;
} {
  /** Host-owned local CA certificate, distinct from an installed platform copy. */
  const caCertPath = path.join(stateDir, CA_CERT_FILE);
  /** Host-owned private local CA key used only by fixed signing commands. */
  const caKeyPath = path.join(stateDir, CA_KEY_FILE);
  /** Default server certificate destination beneath the trusted state root. */
  const serverCertPath = path.join(stateDir, SERVER_CERT_FILE);
  /** Private default server-key destination beneath the trusted state root. */
  const serverKeyPath = path.join(stateDir, SERVER_KEY_FILE);

  let caGenerated = false;

  // Ensure CA exists
  if (
    !fileExists(caCertPath) ||
    !fileExists(caKeyPath) ||
    !isCertValid(caCertPath) ||
    !isCertSignatureStrong(caCertPath)
  ) {
    generateCA(stateDir);
    caGenerated = true;
  }

  // Ensure server cert exists and is valid
  if (
    caGenerated ||
    !fileExists(serverCertPath) ||
    !fileExists(serverKeyPath) ||
    !isCertValid(serverCertPath) ||
    !isCertSignatureStrong(serverCertPath) ||
    !new crypto.X509Certificate(fs.readFileSync(serverCertPath)).checkHost(tld)
  ) {
    generateServerCert(stateDir, tld);
  }

  return {
    certPath: serverCertPath,
    keyPath: path.join(stateDir, SERVER_KEY_FILE),
    caPath: caCertPath,
    caGenerated,
  };
}

/** Inspect the platform’s existing trust evidence through its dedicated read-only check; do not confuse a positive receipt with all-browser acceptance.
 * @param {string} stateDir - Trusted local CA state directory.
 * @returns {boolean} Platform-specific observed trust receipt, false on unavailable/failed inspection.
 */
export function isCATrusted(stateDir: string): boolean {
  /** Host-owned local CA certificate, distinct from an installed platform copy. */
  const caCertPath = path.join(stateDir, CA_CERT_FILE);
  if (!fileExists(caCertPath)) {
    return false;
  }

  if (process.platform === 'darwin') {
    return isCATrustedMacOS(caCertPath);
  } else if (process.platform === 'linux') {
    return isCATrustedLinux(stateDir);
  } else if (process.platform === 'win32') {
    return isCATrustedWindows(caCertPath);
  }
  return false;
}

/** Compare the local CA fingerprint with a read-only current-user Windows Root-store listing.
 * @param {string} caCertPath - Host-owned local CA certificate.
 * @returns {boolean} Whether the existing platform inspection finds the fingerprint; no store is changed.
 */
function isCATrustedWindows(caCertPath: string): boolean {
  try {
    /** Existing platform certificate lookup digest; not a signature algorithm or password hash. */
    const fingerprint = openssl([
      'x509',
      '-in',
      caCertPath,
      '-noout',
      '-fingerprint',
      '-sha1',
    ])
      .trim()
      .replace(/^.*=/, '')
      .replace(/:/g, '')
      .toLowerCase();
    /** Read-only native platform inspection output, parsed only for the expected host-local metadata. */
    const result = execFileSync('certutil', ['-store', '-user', 'Root'], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.replace(/\s/g, '').toLowerCase().includes(fingerprint);
  } catch {
    return false;
  }
}

/** Run the existing read-only platform certificate check, optionally under the explicit sudo caller identity.
 * @param {string} caCertPath - Trusted local CA certificate path.
 * @returns {boolean} Native verification success, or false when inspection fails.
 */
function isCATrustedMacOS(caCertPath: string): boolean {
  try {
    /** Observed effective privilege, used only to choose the existing explicit platform operation. */
    const isRoot = (process.getuid?.() ?? -1) === 0;
    /** Explicit local sudo caller identity; never derived from request headers or app roles. */
    const sudoUser = process.env.SUDO_USER;

    if (isRoot && sudoUser) {
      // When running as root via sudo, check trust from the *browser user's*
      // perspective. Root may have the CA in its own trust settings, but
      // Chrome runs as the real user and won't see those.
      execFileSync(
        'sudo',
        [
          '-u',
          sudoUser,
          'security',
          'verify-cert',
          '-c',
          caCertPath,
          '-L',
          '-p',
          'ssl',
        ],
        {
          stdio: 'pipe',
          timeout: 5000,
        }
      );
    } else {
      execFileSync(
        'security',
        ['verify-cert', '-c', caCertPath, '-L', '-p', 'ssl'],
        {
          stdio: 'pipe',
          timeout: 5000,
        }
      );
    }
    return true;
  } catch {
    return false;
  }
}

/** Read the platform default keychain location, falling back to its existing conventional host-user path.
 * @returns {string} Host-local keychain path; no certificate is installed by this helper.
 */
function loginKeychainPath(): string {
  try {
    /** Read-only native platform inspection output, parsed only for the expected host-local metadata. */
    const result = execFileSync('security', ['default-keychain'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    // Output is like:    "/Users/foo/Library/Keychains/login.keychain-db"
    /** Required native-output capture, accessed only after an anchored/presence match check. */
    const match = result.match(/"(.+)"/);
    if (match) {
      return match[1]!;
    }
  } catch {
    // Fall back to conventional path
  }
  /** Existing host user-home fallback, not a caller-supplied public filesystem root. */
  const home = process.env.HOME || `/Users/${process.env.USER || 'unknown'}`;
  return path.join(home, 'Library', 'Keychains', 'login.keychain-db');
}

/**
 * Linux distro CA trust configuration.
 * Each entry maps a distro family to its CA certificate directory and update command.
 */
interface LinuxCATrustConfig {
  /** Fixed distro-specific certificate installation directory; writes require an explicit operator trust operation. */
  certDir: string;
  /** Fixed native update binary selected only from the maintained platform table. */
  updateCommand: string;
}

/** Fixed installation layouts and native update binaries; no arbitrary executable discovery is allowed. */
const LINUX_CA_TRUST_CONFIGS: Record<string, LinuxCATrustConfig> = {
  debian: {
    certDir: '/usr/local/share/ca-certificates',
    updateCommand: 'update-ca-certificates',
  },
  arch: {
    certDir: '/etc/ca-certificates/trust-source/anchors',
    updateCommand: 'update-ca-trust',
  },
  fedora: {
    certDir: '/etc/pki/ca-trust/source/anchors',
    updateCommand: 'update-ca-trust',
  },
  suse: {
    certDir: '/etc/pki/trust/anchors',
    updateCommand: 'update-ca-certificates',
  },
};

/** Inspect local os-release or fixed update-command availability to select the existing trust-store layout.
 * @returns {string | undefined} One of the fixed configuration keys, or undefined when unavailable.
 */
function detectLinuxDistro(): string | undefined {
  try {
    /** Local operating-system release metadata used only for fixed-layout selection. */
    const osRelease = fs.readFileSync('/etc/os-release', 'utf-8').toLowerCase();
    // ID_LIKE often lists parent distros (e.g., "ID_LIKE=arch" or "ID_LIKE=debian")
    if (osRelease.includes('arch')) {
      return 'arch';
    }
    if (
      osRelease.includes('fedora') ||
      osRelease.includes('rhel') ||
      osRelease.includes('centos')
    ) {
      return 'fedora';
    }
    if (osRelease.includes('suse')) {
      return 'suse';
    }
    if (osRelease.includes('debian') || osRelease.includes('ubuntu')) {
      return 'debian';
    }
  } catch {
    // /etc/os-release missing
  }

  // Fallback: probe for known update commands
  for (const [distro, config] of Object.entries(LINUX_CA_TRUST_CONFIGS)) {
    try {
      execFileSync('which', [config.updateCommand], {
        stdio: 'pipe',
        timeout: 5000,
      });
      if (fs.existsSync(path.dirname(config.certDir))) {
        return distro;
      }
    } catch {
      // Not found, try next
    }
  }

  return undefined;
}

/** Select only a fixed detected layout, retaining the existing Debian fallback for unknown environments.
 * @returns {LinuxCATrustConfig} Existing local trust directory/update-command pair; selection alone changes no store.
 */
function getLinuxCATrustConfig(): LinuxCATrustConfig {
  /** Detected fixed configuration key or undefined, with the existing fallback applied by its caller. */
  const distro = detectLinuxDistro();
  return LINUX_CA_TRUST_CONFIGS[distro ?? 'debian']!;
}

/** Compare local CA bytes against the fixed distro trust-file location without updating the system store.
 * @param {string} stateDir - Trusted local CA state directory.
 * @returns {boolean} Whether the readable local/system PEM text matches under the existing inspection policy.
 */
function isCATrustedLinux(stateDir: string): boolean {
  /** Selected fixed platform trust configuration; choosing it does not install anything. */
  const config = getLinuxCATrustConfig();
  /** Fixed platform CA-copy path used for read-only trust comparison. */
  const systemCertPath = path.join(config.certDir, 'portless-ca.crt');
  if (!fileExists(systemCertPath)) {
    return false;
  }

  // Compare our CA with the installed one
  try {
    /** Trimmed local CA PEM text retained only for local equality comparison. */
    const ours = fs
      .readFileSync(path.join(stateDir, CA_CERT_FILE), 'utf-8')
      .trim();
    /** Trimmed installed PEM text; no system store mutation occurs in this read path. */
    const installed = fs.readFileSync(systemCertPath, 'utf-8').trim();
    return ours === installed;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-hostname certificate generation (SNI)
// ---------------------------------------------------------------------------

/** Directory within state dir where per-hostname certs are cached. */
const HOST_CERTS_DIR = 'host-certs';

/** Digest an already validated hostname into a fixed hex filename stem, avoiding punctuation/path ambiguities.
 * @param {string} hostname - Validated configured-namespace hostname.
 * @returns {string} SHA-256 filename identity, never an authentication or anonymization guarantee.
 */
function sanitizeHostForFilename(hostname: string): string {
  // A digest avoids ambiguities such as a.b vs a_b and filename collisions.
  return crypto.createHash('sha256').update(hostname).digest('hex');
}

/** Normalize and validate DNS labels, then restrict the requested name to the host-configured namespace.
 * @param {string} servername - Untrusted TLS SNI hostname, never a file path or OpenSSL argument string.
 * @param {string} tld - Trusted configured namespace; issuance authority remains a host decision.
 * @returns {string} Lowercase bounded hostname with one trailing dot removed; outside names reject.
 */
export function validateSNIServername(servername: string, tld: string): string {
  /** Normalized requested TLS hostname, checked before any issuance/cache path use. */
  const name = servername.toLowerCase().replace(/\.$/, '');
  /** Normalized trusted namespace boundary, compared by exact hostname or dot suffix. */
  const suffix = tld.toLowerCase().replace(/\.$/, '');
  /** Validate bounded DNS hostname labels without issuing or resolving anything.
   * @param {string} host - Hostname candidate.
   * @returns {boolean} Whether the implemented total/label grammar passes.
   */
  const validLabels = (host: string) =>
    host.length > 0 &&
    host.length <= 253 &&
    host
      .split('.')
      .every(
        (label) =>
          label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      );
  if (
    !validLabels(name) ||
    !validLabels(suffix) ||
    (name !== suffix && !name.endsWith(`.${suffix}`))
  ) {
    throw new TypeError(
      'TLS server name is outside the configured local namespace'
    );
  }
  return name;
}

/** Issue one exact-host SAN certificate through fixed asynchronous commands in the private cache, without shell interpolation.
 * @param {string} stateDir - Trusted private CA state directory with no untrusted concurrent writers.
 * @param {string} hostname - Already validated configured-namespace hostname.
 * @returns {Promise<{certPath: string; keyPath: string}>} Created host certificate/key paths; successful issuance removes CSR/config intermediates.
 */
async function generateHostCertAsync(
  stateDir: string,
  hostname: string
): Promise<{ certPath: string; keyPath: string }> {
  /** Host-owned private local CA key used only by fixed signing commands. */
  const caKeyPath = path.join(stateDir, CA_KEY_FILE);
  /** Host-owned local CA certificate, distinct from an installed platform copy. */
  const caCertPath = path.join(stateDir, CA_CERT_FILE);
  /** Private per-host certificate cache directory, checked before issuance. */
  const hostDir = path.join(stateDir, HOST_CERTS_DIR);

  if (!fs.existsSync(hostDir)) {
    await fs.promises.mkdir(hostDir, { recursive: true, mode: 0o700 });
    fixOwnership(hostDir);
  }
  /** Native cache-directory metadata rejecting symlink/non-directory targets. */
  const hostDirStat = await fs.promises.lstat(hostDir);
  if (!hostDirStat.isDirectory() || hostDirStat.isSymbolicLink()) {
    throw new Error('Unsafe host-certificate directory');
  }

  /** Digest-only filename stem derived after namespace validation. */
  const safeName = sanitizeHostForFilename(hostname);
  /** Private local key path under the trusted state/cache root. */
  const keyPath = path.join(hostDir, `${safeName}-key.pem`);
  /** Local certificate path under the trusted state/cache root. */
  const certPath = path.join(hostDir, `${safeName}.pem`);
  /** Fixed private signing-request intermediate, removed after successful issuance. */
  const csrPath = path.join(hostDir, `${safeName}.csr`);
  /** Guarded generated extension configuration, removed after successful issuance. */
  const extPath = path.join(hostDir, `${safeName}-ext.cnf`);

  // Do not allow pre-existing symlinks to redirect certificate/key writes.
  for (const candidate of [keyPath, certPath, csrPath, extPath]) {
    try {
      if ((await fs.promises.lstat(candidate)).isSymbolicLink()) {
        throw new Error('Unsafe certificate file symlink');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  // Generate key
  await opensslAsync([
    'ecparam',
    '-genkey',
    '-name',
    'prime256v1',
    '-noout',
    '-out',
    keyPath,
  ]);

  // Generate CSR
  await opensslAsync([
    'req',
    '-new',
    '-key',
    keyPath,
    '-out',
    csrPath,
    '-subj',
    `/CN=${hostname}`,
  ]);

  // Scope every dynamically issued certificate to exactly one hostname.
  /** Exact requested host SAN, avoiding implicit wildcard or unrelated-name issuance. */
  const sans = [`DNS:${hostname}`];

  await writeCertificateConfigAsync(
    extPath,
    [
      'authorityKeyIdentifier=keyid,issuer',
      'basicConstraints=CA:FALSE',
      'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=${sans.join(',')}`,
    ].join('\n') + '\n'
  );

  await opensslAsync([
    'x509',
    '-req',
    '-sha256',
    '-in',
    csrPath,
    '-CA',
    caCertPath,
    '-CAkey',
    caKeyPath,
    '-CAcreateserial',
    '-out',
    certPath,
    '-days',
    SERVER_VALIDITY_DAYS.toString(),
    '-extfile',
    extPath,
  ]);

  // Clean up temporary files (keep ca.srl for serial number tracking)
  for (const tmp of [csrPath, extPath]) {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      // Non-fatal
    }
  }

  await fs.promises.chmod(keyPath, 0o600);
  await fs.promises.chmod(certPath, 0o644);
  fixOwnership(keyPath, certPath);

  return { certPath, keyPath };
}

/** Create callback-local bounded context/pending caches; exact-host SAN issuance avoids relying on wildcard handling for subdomains.
 * @param {string} stateDir - Trusted private local CA directory.
 * @param {Buffer} defaultCert - Host-provided default certificate bytes for the bare namespace.
 * @param {Buffer} defaultKey - Private default key bytes; never logged or serialized into diagnostics.
 * @param {string} tld - Trusted configured namespace, defaulting to localhost.
 * @returns {(servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => void} TLS callback; native issuance has finite timeouts but no cancellation/disposal API. Cached contexts live with this callback.
 */
export function createSNICallback(
  stateDir: string,
  defaultCert: Buffer,
  defaultKey: Buffer,
  tld = 'localhost'
): (
  servername: string,
  cb: (err: Error | null, ctx?: tls.SecureContext) => void
) => void {
  /** Callback-local bounded secure-context cache; contexts are not periodically refreshed after insertion. */
  const cache = new Map<string, tls.SecureContext>();
  /** Callback-local in-flight issuance promises, deduplicated per hostname and limited to eight. */
  const pending = new Map<string, Promise<tls.SecureContext>>();
  /** Maximum retained secure contexts in one callback instance. */
  const CACHE_LIMIT = 128;
  /** Maximum distinct simultaneous native issuance jobs for one callback instance. */
  const MAX_IN_FLIGHT = 8;
  /** Retain one context under the existing bounded least-recent-insertion policy.
   * @param {string} name - Validated configured-namespace hostname.
   * @param {tls.SecureContext} context - Native secure context.
   * @returns {void} Evicts the oldest retained entry at capacity.
   */
  const saveCache = (name: string, context: tls.SecureContext) => {
    cache.delete(name);
    cache.set(name, context);
    if (cache.size > CACHE_LIMIT) {
      cache.delete(cache.keys().next().value!);
    }
  };

  // Pre-cache the default context for the bare TLD itself
  /** Native bare-namespace context captured for this callback lifetime. */
  const defaultCtx = tls.createSecureContext({
    cert: defaultCert,
    key: defaultKey,
  });

  return (
    servername: string,
    cb: (err: Error | null, ctx?: tls.SecureContext) => void
  ) => {
    try {
      servername = validateSNIServername(servername, tld);
    } catch (error) {
      cb(error as Error);
      return;
    }
    // The bare TLD (e.g. "localhost" or "test") uses the default cert.
    // All subdomains need a cert with an exact SAN entry.
    // Issue exact SANs for subdomains rather than relying on platform-specific
    // wildcard handling at the configured namespace boundary.
    if (servername === tld) {
      cb(null, defaultCtx);
      return;
    }

    // Check memory cache
    if (cache.has(servername)) {
      cb(null, cache.get(servername));
      return;
    }

    // Check if a cert already exists on disk
    /** Digest-only filename stem derived after namespace validation. */
    const safeName = sanitizeHostForFilename(servername);
    /** Private per-host certificate cache directory, checked before issuance. */
    const hostDir = path.join(stateDir, HOST_CERTS_DIR);
    /** Local certificate path under the trusted state/cache root. */
    const certPath = path.join(hostDir, `${safeName}.pem`);
    /** Private local key path under the trusted state/cache root. */
    const keyPath = path.join(hostDir, `${safeName}-key.pem`);

    // Try reading existing cert from disk (may fail if files are root-owned)
    if (
      fileExists(certPath) &&
      fileExists(keyPath) &&
      isCertValid(certPath) &&
      isCertSignatureStrong(certPath)
    ) {
      try {
        /** Existing cached certificate parsed before checking its exact requested-host SAN. */
        const certificate = new crypto.X509Certificate(
          fs.readFileSync(certPath)
        );
        if (!certificate.checkHost(servername)) {
          throw new Error('Certificate SAN does not match request');
        }
        /** Native context admitted after the existing certificate/key checks. */
        const ctx = tls.createSecureContext({
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        });
        saveCache(servername, ctx);
        cb(null, ctx);
        return;
      } catch {
        // Permission error reading cached cert -- regenerate below
      }
    }

    // If a generation is already in flight for this hostname, wait for it
    if (pending.has(servername)) {
      pending
        .get(servername)!
        .then((ctx) => cb(null, ctx))
        .catch((err) =>
          cb(err instanceof Error ? err : new Error(String(err)))
        );
      return;
    }

    // A handshake storm must not spawn an unbounded number of openssl jobs.
    if (pending.size >= MAX_IN_FLIGHT) {
      cb(new Error('Certificate generation concurrency limit reached'));
      return;
    }
    // Generate a new cert for this hostname asynchronously
    /** One deduplicated native issuance/handle-read operation; its settlement owns pending capacity. */
    const promise = generateHostCertAsync(stateDir, servername).then(
      async (generated) => {
        /** Generated certificate/private-key bytes read locally for native TLS context creation. */
        const [cert, key] = await Promise.all([
          fs.promises.readFile(generated.certPath),
          fs.promises.readFile(generated.keyPath),
        ]);
        return tls.createSecureContext({ cert, key });
      }
    );

    pending.set(servername, promise);

    promise
      .then((ctx) => {
        saveCache(servername, ctx);
        pending.delete(servername);
        cb(null, ctx);
      })
      .catch((err) => {
        pending.delete(servername);
        cb(err instanceof Error ? err : new Error(String(err)));
      });
  };
}

/** Explicit operator operation that changes the platform trust store using fixed native commands; never run automatically during import or qualification.
 * @param {string} stateDir - Trusted CA directory selected by an authorized local operator.
 * @returns {{trusted: boolean; error?: string}} Platform installation receipt or internal diagnostic; does not certify every browser and may require OS privileges.
 */
export function trustCA(stateDir: string): {
  trusted: boolean;
  error?: string;
} {
  /** Host-owned local CA certificate, distinct from an installed platform copy. */
  const caCertPath = path.join(stateDir, CA_CERT_FILE);
  if (!fileExists(caCertPath)) {
    return {
      trusted: false,
      error: 'CA certificate not found. Run with --https first.',
    };
  }

  try {
    if (process.platform === 'darwin') {
      /** Observed effective privilege, used only to choose the existing explicit platform operation. */
      const isRoot = (process.getuid?.() ?? -1) === 0;
      if (isRoot) {
        execFileSync(
          'security',
          [
            'add-trusted-cert',
            '-d',
            '-r',
            'trustRoot',
            '-k',
            '/Library/Keychains/System.keychain',
            caCertPath,
          ],
          { stdio: 'pipe', timeout: 30_000 }
        );
      } else {
        /** Host-selected local platform keychain used only by the explicit trust operation. */
        const keychain = loginKeychainPath();
        execFileSync(
          'security',
          ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, caCertPath],
          { stdio: 'pipe', timeout: 30_000 }
        );
      }
      return { trusted: true };
    } else if (process.platform === 'linux') {
      /** Selected fixed platform trust configuration; choosing it does not install anything. */
      const config = getLinuxCATrustConfig();
      if (!fs.existsSync(config.certDir)) {
        fs.mkdirSync(config.certDir, { recursive: true });
      }
      /** Fixed system trust-copy destination selected from the maintained layout, never request input. */
      const dest = path.join(config.certDir, 'portless-ca.crt');
      fs.copyFileSync(caCertPath, dest);
      execFileSync(config.updateCommand, [], {
        stdio: 'pipe',
        timeout: 30_000,
      });
      return { trusted: true };
    } else if (process.platform === 'win32') {
      execFileSync('certutil', ['-addstore', '-user', 'Root', caCertPath], {
        stdio: 'pipe',
        timeout: 30_000,
      });
      return { trusted: true };
    }
    return {
      trusted: false,
      error: `Unsupported platform: ${process.platform}`,
    };
  } catch (err: unknown) {
    /** Private native failure summary; may include host paths and must not become public telemetry. */
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('authorization') ||
      message.includes('permission') ||
      message.includes('EACCES')
    ) {
      return {
        trusted: false,
        error: 'Permission denied. Try: sudo portless trust',
      };
    }
    return { trusted: false, error: message };
  }
}
