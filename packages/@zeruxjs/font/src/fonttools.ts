import { spawn } from 'node:child_process';
/** Explicit supported binary-container discriminators, not full conformance claims. */
export type FontBinaryFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';
/** Declared/observed variable-axis metadata, validated against actual inspection before build use. */
export interface FontAxis {
  /** Four-character axis tag, independently validated by the build coordinator. */
  tag: string;
  /** Finite minimum supported axis value. */
  min: number;
  /** Native default axis value, within the minimum/maximum range. */
  default: number;
  /** Finite maximum supported axis value. */
  max: number;
}
/** Native tool provenance, axes and cmap observations; not shaping-quality certification. */
export interface FontInspection {
  /** Observed tool version, retained for provenance rather than implied native qualification. */
  toolVersion: string;
  /** Native variable-axis observations; coordinator validates declared bounds against them. */
  axes: FontAxis[];
  /** Observed cmap coverage excluding .notdef/glyph-zero mappings, not complete language shaping. */
  codePoints: number[];
}
/** Explicit borrowed maintained-tool capability; operations own subprocess settlement when using the supplied adapter. */
export interface FontToolsTool {
  /** Explicit maintained tool kind, fixed to fonttools. */
  readonly name: 'fonttools';
  /** Inspect native axes/cmap through the fixed FontTools program without changing the font.
   * @param {Uint8Array} bytes - Borrowed binary font input, capped at 16 MiB; never treated as executable source.
   * @param {FontBinaryFormat} format - Declared container format; this adapter delegates actual binary parsing to FontTools, while the build pipeline checks container signatures.
   * @param {AbortSignal | undefined} signal - Caller-owned cancellation; owned subprocess is killed and settlement waits for its close event.
   * @returns {Promise<FontInspection>} Bounded tool version, axes and non-.notdef code points; complete shaping quality is not certified.
   */
  inspect(
    bytes: Uint8Array,
    format: FontBinaryFormat,
    signal?: AbortSignal
  ): Promise<FontInspection>;
  /** Run fixed FontTools subsetting over an explicit finite glyph list; caller/build must re-inspect emitted coverage.
   * @param {Uint8Array} bytes - Borrowed binary font input, capped at 16 MiB; never treated as executable source.
   * @param {FontBinaryFormat} format - Declared container format; this adapter delegates actual binary parsing to FontTools, while the build pipeline checks container signatures.
   * @param {readonly number[]} codePoints - Explicit Unicode scalar selection, not inferred language coverage.
   * @param {AbortSignal | undefined} signal - Caller-owned cancellation; owned subprocess is killed and settlement waits for its close event.
   * @returns {Promise<Uint8Array>} Owned emitted font bytes; not a guarantee of shaping/layout-feature fidelity.
   */
  subset(
    bytes: Uint8Array,
    format: FontBinaryFormat,
    codePoints: readonly number[],
    signal?: AbortSignal
  ): Promise<Uint8Array>;
}
/** Fixed isolated Python parser program. Keep this byte-sensitive payload separate from caller data; never interpolate font paths, Python source or tool arguments into it. */
const program = String.raw`
import sys,json,base64,io,resource
resource.setrlimit(resource.RLIMIT_AS,(536870912,536870912))
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
resource.setrlimit(resource.RLIMIT_FSIZE,(0,0))
from fontTools.ttLib import TTFont
from fontTools import subset
import fontTools
if int(fontTools.__version__.split('.')[0]) < 4: raise RuntimeError('version')
v=json.load(sys.stdin)
f=TTFont(io.BytesIO(base64.b64decode(v['data'],validate=True)),recalcTimestamp=False)
if v['mode']=='subset':
 o=subset.Options();o.recalc_timestamp=False
 s=subset.Subsetter(options=o);s.populate(unicodes=v['codePoints']);s.subset(f)
 out=io.BytesIO();f.save(out,reorderTables=True)
 print(json.dumps({'data':base64.b64encode(out.getvalue()).decode('ascii')}))
else:
 axes=[{'tag':a.axisTag,'min':a.minValue,'default':a.defaultValue,'max':a.maxValue} for a in f['fvar'].axes] if 'fvar' in f else []
 cmap=f.getBestCmap() or {}
 covered=[cp for cp,name in cmap.items() if name!='.notdef' and f.getGlyphID(name)!=0]
 print(json.dumps({'toolVersion':fontTools.__version__,'axes':axes,'codePoints':sorted(covered)}))
f.close()
`;
/** Select an inert explicit POSIX Python/FontTools adapter. No installation or process runs until inspect/subset is invoked; executable configuration is trusted host code.
 * @param {object} options - Optional operator-selected executable and bounded wall timeout.
 * @param {string} [options.executable] - Trusted Python executable, default python3; never request input.
 * @param {number} [options.timeoutMs] - Wall timeout, default 15000 ms and ceiling 30000 ms.
 * @returns {FontToolsTool} Operation-scoped parser adapter, not an arbitrary shell/codec runner or a persistent close owner.
 */
export function createFontToolsTool(
  options: {
    /** Trusted operator-selected Python executable; default python3, never request-controlled. */
    executable?: string;
    /** Positive wall timeout in milliseconds; default 15000, ceiling 30000. */
    timeoutMs?: number;
  } = {}
): FontToolsTool {
  /** Trusted host Python executable; process creation uses shell:false and fixed arguments. */
  const executable = options.executable ?? 'python3';
  /** Validated wall timeout, independent of the fixed native CPU/address-space limits. */
  const timeout = options.timeoutMs ?? 15000;

  if (
    typeof executable !== 'string' ||
    !executable ||
    executable.length > 2048 ||
    // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in validated font input.
    /[\x00-\x1f\x7f]/.test(executable) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 30000
  ) {
    throw new TypeError('Invalid FontTools configuration');
  }
  /** Spawn only the fixed isolated Python program, send bounded JSON/bytes over stdin and await actual close before releasing listeners/timer.
   * @param {Uint8Array} bytes - Borrowed binary font input, capped at 16 MiB; never treated as executable source.
   * @param {'inspect' | 'subset'} mode - Fixed operation mode, never caller-supplied Python arguments.
   * @param {readonly number[]} codePoints - At most 65536 validated Unicode scalars.
   * @param {AbortSignal | undefined} signal - Caller-owned cancellation; owned subprocess is killed and settlement waits for its close event.
   * @returns {Promise<any>} Parsed bounded native output; fixed errors omit paths, stderr and font contents.
   */
  async function call(
    bytes: Uint8Array,
    mode: 'inspect' | 'subset',
    codePoints: readonly number[],
    signal?: AbortSignal
  ) {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length > 16 * 1024 * 1024 ||
      codePoints.length > 65536 ||
      codePoints.some(
        (cp) =>
          !Number.isSafeInteger(cp) ||
          cp < 0 ||
          cp > 0x10ffff ||
          (cp >= 0xd800 && cp <= 0xdfff)
      )
    ) {
      throw new RangeError('FontTools input limit');
    }
    if (signal?.aborted) {
      throw new Error('FontTools cancelled');
    }
    return new Promise<any>((resolve, reject) => {
      /** Owned bounded parser subprocess; close is the authoritative resource-settlement boundary. */
      const child = spawn(executable, ['-I', '-B', '-c', program], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
      });
      let output = 0,
        failed = false;
      /** Retained stdout chunks under the 40 MiB cumulative output ceiling; stderr is never exposed. */
      const chunks: Buffer[] = [];
      /** Mark this operation failed and terminate only its owned subprocess.
       * @returns {void} Final cleanup/rejection waits for the child close event. */
      const kill = () => {
        failed = true;
        child.kill('SIGKILL');
      };
      /** Owned wall-deadline timer cleared on actual subprocess close. */
      const timer = setTimeout(kill, timeout);
      signal?.addEventListener('abort', kill, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.length;
        if (output > 40 * 1024 * 1024) {
          kill();
        } else {
          chunks.push(chunk);
        }
      });
      child.stderr.on('data', () => {
        /* Never emit font data, paths or tool stderr. */
      });
      child.stdin.on('error', () => {
        failed = true;
      });
      child.once('error', () => {
        failed = true;
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', kill);
        if (failed || code !== 0) {
          reject(
            new Error(
              'FontTools unavailable, cancelled or font processing failed'
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Invalid FontTools output'));
        }
      });
      child.stdin.end(
        JSON.stringify({
          mode,
          data: Buffer.from(bytes).toString('base64'),
          codePoints,
        })
      );
    });
  }
  return Object.freeze({
    name: 'fonttools' as const,
    /** Inspect native axes/cmap through the fixed FontTools program without changing the font.
     * @param {Uint8Array} bytes - Borrowed binary font input, capped at 16 MiB; never treated as executable source.
     * @param {FontBinaryFormat} format - Declared container format; this adapter delegates actual binary parsing to FontTools, while the build pipeline checks container signatures.
     * @param {AbortSignal | undefined} signal - Caller-owned cancellation; owned subprocess is killed and settlement waits for its close event.
     * @returns {Promise<FontInspection>} Bounded tool version, axes and non-.notdef code points; complete shaping quality is not certified.
     */
    async inspect(
      bytes: Uint8Array,
      format: FontBinaryFormat,
      signal?: AbortSignal
    ) {
      void format;
      /** Parsed fixed-program result checked for bounded inspection/subset shape before returning. */
      const result = await call(bytes, 'inspect', [], signal);
      if (
        typeof result.toolVersion !== 'string' ||
        !Array.isArray(result.axes) ||
        result.axes.length > 64 ||
        !Array.isArray(result.codePoints) ||
        result.codePoints.length > 200000
      ) {
        throw new Error('FontTools inspection limit');
      }
      return result as FontInspection;
    },
    /** Run fixed FontTools subsetting over an explicit finite glyph list; caller/build must re-inspect emitted coverage.
     * @param {Uint8Array} bytes - Borrowed binary font input, capped at 16 MiB; never treated as executable source.
     * @param {FontBinaryFormat} format - Declared container format; this adapter delegates actual binary parsing to FontTools, while the build pipeline checks container signatures.
     * @param {readonly number[]} codePoints - Explicit Unicode scalar selection, not inferred language coverage.
     * @param {AbortSignal | undefined} signal - Caller-owned cancellation; owned subprocess is killed and settlement waits for its close event.
     * @returns {Promise<Uint8Array>} Owned emitted font bytes; not a guarantee of shaping/layout-feature fidelity.
     */
    async subset(
      bytes: Uint8Array,
      format: FontBinaryFormat,
      codePoints: readonly number[],
      signal?: AbortSignal
    ) {
      void format;
      /** Parsed fixed-program result checked for bounded inspection/subset shape before returning. */
      const result = await call(bytes, 'subset', codePoints, signal);
      if (
        typeof result.data !== 'string' ||
        result.data.length > 24 * 1024 * 1024
      ) {
        throw new Error('FontTools subset limit');
      }
      return new Uint8Array(Buffer.from(result.data, 'base64'));
    },
  });
}
