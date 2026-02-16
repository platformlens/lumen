# macOS Code Signing and Notarization Guide

Complete guide for building, signing, and notarizing the Lumen Electron app for macOS distribution.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Configuration Files](#configuration-files)
- [Build Process](#build-process)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts and Certificates

1. **Apple Developer Account**
   - Active Apple Developer Program membership ($99/year)
   - Access to [developer.apple.com](https://developer.apple.com)

2. **Developer ID Certificate**
   - "Developer ID Application" certificate installed in Keychain
   - Certificate: `Developer ID Application: Your Company Name (YOUR_TEAM_ID)`
   - Identity: `YOUR_CERTIFICATE_HASH`

3. **Apple Credentials**
   - Apple ID: `your-email@example.com`
   - Team ID: `YOUR_TEAM_ID`
   - App-Specific Password (generated at [appleid.apple.com](https://appleid.apple.com))

### Verify Your Certificate

Check that your Developer ID certificate is installed:

```bash
security find-identity -v -p codesigning
```

Expected output:
```
1) YOUR_DEV_CERTIFICATE_HASH "Apple Development: Your Name (YOUR_PERSONAL_TEAM_ID)"
2) YOUR_CERTIFICATE_HASH "Developer ID Application: Your Company Name (YOUR_TEAM_ID)"
   2 valid identities found
```

---

## Initial Setup

### Step 1: Store Apple Credentials in Keychain

This is a **one-time setup**. Store your Apple Developer credentials securely in the macOS Keychain:

```bash
xcrun notarytool store-credentials "lumen-test" \
  --apple-id "your-email@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "your-app-specific-password"
```

**Expected output:**
```
This process stores your credentials securely in the Keychain.
You reference these credentials later using a profile name.

Validating your credentials...
Success. Credentials validated.
Credentials saved to Keychain.
To use them, specify `--keychain-profile "lumen-test"`
```

> **Note:** Replace `your-app-specific-password` with your actual app-specific password from appleid.apple.com

### Step 2: Generate App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in with your Apple ID
3. Navigate to **Sign-In and Security** → **App-Specific Passwords**
4. Click **+** to generate a new password
5. Name it "Lumen Notarization"
6. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)

---

## Configuration Files

### electron-builder.json5

Located at: `electron-builder.json5`

```json5
{
  "$schema": "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",
  "appId": "com.sdsclick.lumen",
  "asar": true,
  "productName": "Lumen",
  "directories": {
    "output": "release/${version}"
  },
  "files": [
    "dist",
    "dist-electron"
  ],
  "mac": {
    "icon": "build/icons/icon.icns",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "target": [
      "dmg"
    ],
    "artifactName": "${productName}-Mac-${version}-Installer.${ext}",
    "notarize": false  // Disabled - we notarize manually
  }
}
```

**Key settings:**
- `hardenedRuntime: true` - Required for notarization
- `entitlements` - Specifies entitlements file for hardened runtime
- `notarize: false` - Disables automatic notarization (we do it manually)

### build/entitlements.mac.plist

Located at: `build/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

**Entitlements explained:**
- `allow-unsigned-executable-memory` - Required for Electron's V8 engine
- `allow-jit` - Required for JavaScript JIT compilation
- `disable-library-validation` - Required for Electron's dynamic libraries

---

## Build Process

### Step 1: Build the Application

Run the standard build command:

```bash
npm run build
```

**What happens:**
1. TypeScript compilation (`tsc`)
2. Vite bundles the application
3. electron-builder packages the app
4. **Code signing** with Developer ID certificate
5. **Hardened runtime** is enabled
6. **Entitlements** are applied
7. DMG installer is created

**Expected output:**
```
> k8ptain@0.0.4 build
> tsc && vite build && electron-builder

vite v5.4.21 building for production...
✓ 3095 modules transformed.
dist/index.html                     0.47 kB │ gzip:   0.30 kB
dist/assets/index-DEn-KQtU.css     71.95 kB │ gzip:  11.56 kB
dist/assets/index-CS3Fcn1f.js   1,099.90 kB │ gzip: 319.09 kB
✓ built in 1.83s

vite v5.4.21 building for production...
✓ 1839 modules transformed.
[... electron build output ...]
✓ built in 2.42s

  • electron-builder  version=24.13.3 os=25.2.0
  • packaging       platform=darwin arch=arm64 electron=30.5.1
  • signing         file=release/0.0.4/mac-arm64/Lumen.app
                    identity=YOUR_CERTIFICATE_HASH
  • skipped macOS notarization  reason=`notarize` options were set explicitly `false`
  • building        target=DMG arch=arm64
                    file=release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg
  • building block map
```

**Result:**
- ✅ Signed DMG created at: `release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg`
- ✅ Signed .app bundle at: `release/0.0.4/mac-arm64/Lumen.app`

### Step 2: Submit for Notarization

Submit the DMG to Apple's notarization service:

```bash
xcrun notarytool submit \
  "release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg" \
  --keychain-profile "lumen-test" \
  --wait
```

**What happens:**
1. Pre-submission checks
2. Upload to Apple (165 MB)
3. Apple processes the submission (2-5 minutes)
4. Notarization result returned

**Expected output:**
```
Conducting pre-submission checks for Lumen-Mac-0.0.4-Installer.dmg...
Submission ID received
  id: submission-id-placeholder
Upload progress: 100.00% (165 MB of 165 MB)
Successfully uploaded file
  id: submission-id-placeholder
  path: /path/to/project/release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg
Waiting for processing to complete.
Current status: In Progress.......................
Current status: Accepted
Processing complete
  id: submission-id-placeholder
  status: Accepted
```

> **Note:** If notarization fails, check the log with:
> ```bash
> xcrun notarytool log <submission-id> --keychain-profile "lumen-test"
> ```

### Step 3: Staple Notarization Ticket

Attach the notarization ticket to the DMG:

```bash
xcrun stapler staple \
  "release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg"
```

**Expected output:**
```
Processing: /path/to/project/release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg
Processing: /path/to/project/release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg
The staple and validate action worked!
```

**Why stapling is important:**
- Embeds the notarization ticket in the DMG
- Allows offline verification
- Users can install without internet connection

---

## Verification

### Verify Code Signature

Check that the app is properly signed:

```bash
codesign --verify --deep --strict --verbose=2 \
  "release/0.0.4/mac-arm64/Lumen.app"
```

**Expected output:**
```
--prepared:/path/to/project/release/0.0.4/mac-arm64/Lumen.app/Contents/Frameworks/Lumen Helper (GPU).app
[... more framework validations ...]
release/0.0.4/mac-arm64/Lumen.app: valid on disk
release/0.0.4/mac-arm64/Lumen.app: satisfies its Designated Requirement
```

### Verify Notarization

Check that the app is notarized:

```bash
spctl -a -vvv -t execute \
  "release/0.0.4/mac-arm64/Lumen.app"
```

**Expected output:**
```
release/0.0.4/mac-arm64/Lumen.app: accepted
source=Notarized Developer ID
origin=Developer ID Application: Your Company Name (YOUR_TEAM_ID)
```

**Success indicators:**
- ✅ `accepted` - App passes Gatekeeper
- ✅ `source=Notarized Developer ID` - App is notarized
- ✅ Shows correct Developer ID

---

## Troubleshooting

### Common Issues

#### 1. "Cannot destructure property 'appBundleId' of 'options' as it is undefined"

**Cause:** electron-builder tries to auto-notarize when `hardenedRuntime: true` is set.

**Solution:** Set `"notarize": false` in `electron-builder.json5` and notarize manually.

#### 2. "Unexpected token 'E', 'Error: HTT'... is not valid JSON"

**Cause:** Bug in `@electron/notarize` package when called by electron-builder.

**Solution:** Use manual notarization with `xcrun notarytool` instead of electron-builder's automatic notarization.

#### 3. Notarization Status: Invalid

**Cause:** Missing entitlements or unsigned nested frameworks.

**Solution:** 
- Ensure `hardenedRuntime: true` is set
- Verify `entitlements.mac.plist` is configured
- Let electron-builder handle signing (don't manually sign)

#### 4. "Credentials not found in keychain"

**Cause:** Keychain profile not created or incorrect profile name.

**Solution:** Run the `xcrun notarytool store-credentials` command again.

### Checking Notarization Logs

If notarization fails, retrieve the detailed log:

```bash
xcrun notarytool log <submission-id> --keychain-profile "lumen-test"
```

Common issues in logs:
- Missing hardened runtime
- Unsigned nested binaries
- Invalid entitlements
- Missing secure timestamp

---

## Quick Reference

### Complete Build and Notarization (One-Liner)

```bash
npm run build && \
xcrun notarytool submit "release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg" --keychain-profile "lumen-test" --wait && \
xcrun stapler staple "release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg"
```

### File Locations

| File | Path |
|------|------|
| **DMG Installer** | `release/0.0.4/Lumen-Mac-0.0.4-Installer.dmg` |
| **.app Bundle** | `release/0.0.4/mac-arm64/Lumen.app` |
| **electron-builder config** | `electron-builder.json5` |
| **Entitlements** | `build/entitlements.mac.plist` |

### App Information

| Property | Value |
|----------|-------|
| **App Name** | Lumen |
| **Bundle ID** | com.sdsclick.lumen |
| **Version** | 0.0.4 |
| **Certificate** | Developer ID Application: Your Company Name |
| **Team ID** | YOUR_TEAM_ID |
| **Identity** | YOUR_CERTIFICATE_HASH |

---

## Additional Resources

- [Apple Notarization Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [Resolving Common Notarization Issues](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution/resolving_common_notarization_issues)

---

## Notes

- The keychain profile `lumen-test` is stored permanently and will work for all future builds
- App-specific passwords don't expire but can be revoked at appleid.apple.com
- Notarization typically takes 2-5 minutes
- The DMG is ready for distribution once stapling is complete
- Users will not see "unidentified developer" warnings
