/**
 * App logo asset — imported so Vite resolves the correct path
 * in both dev and production Electron builds.
 *
 * In Electron production builds, absolute paths like "/logo-new.png"
 * resolve to the filesystem root under file:// protocol, not the app
 * directory. Importing from src/assets/ makes Vite emit the file with
 * a content hash and a relative URL that works under file://.
 */
import lumenLogo from './logo-new.png'

export { lumenLogo }
