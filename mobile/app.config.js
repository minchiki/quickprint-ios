const bundle = process.env.QUICKPRINT_BUNDLE_ID || "local.quickprint.app";
module.exports = {
  expo: {
    name: "QuickPrint",
    slug: "quickprint",
    version: "1.1.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    scheme: "quickprint",
    ios: {
      supportsTablet: true,
      buildNumber: "2",
      bundleIdentifier: bundle,
      infoPlist: { ITSAppUsesNonExemptEncryption: false },
    },
    plugins: [
      "expo-font",
      [
        "expo-camera",
        {
          cameraPermission:
            "Камера нужна для сканирования QR-кода на компьютере.",
          recordAudioAndroid: false,
        },
      ],
      "./plugins/withQuickPrint",
    ],
    extra: {
      eas: {
        ...(process.env.EAS_PROJECT_ID
          ? { projectId: process.env.EAS_PROJECT_ID }
          : {}),
        build: {
          experimental: {
            ios: {
              appExtensions: [
                {
                  targetName: "QuickPrintShare",
                  bundleIdentifier: `${bundle}.share`,
                  entitlements: {
                    "com.apple.security.application-groups": [
                      `group.${bundle}`,
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
};
