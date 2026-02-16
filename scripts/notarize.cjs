const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;

    // Only notarize on macOS
    if (electronPlatformName !== 'darwin') {
        console.log('Skipping notarization - not building for macOS');
        return;
    }

    // Check if required environment variables are set
    if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
        console.warn('⚠️  Skipping notarization - missing environment variables');
        console.warn('   Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to enable notarization');
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appPath = `${appOutDir}/${appName}.app`;

    console.log(`🔐 Notarizing ${appName}...`);
    console.log(`   App path: ${appPath}`);
    console.log(`   Apple ID: ${process.env.APPLE_ID}`);
    console.log(`   Team ID: ${process.env.APPLE_TEAM_ID}`);

    try {
        await notarize({
            appPath: appPath,
            keychainProfile: 'lumen-test',
        });
        console.log('✅ Notarization complete!');
    } catch (error) {
        console.error('❌ Notarization failed:', error);
        throw error;
    }
};
