# QuickPrint for iPhone

Native React Native / Expo app with a Swift Share Extension for printing to a Windows-connected USB printer over your local network.

## Download

The **Build QuickPrint IPA** workflow compiles an iPhone-device IPA without Apple distribution credentials. Successful builds appear in **Releases** as `QuickPrint-unsigned.ipa` with a SHA-256 checksum.

This IPA requires personal signing with your Apple ID before installation. It cannot install by opening it in Safari. AltStore Classic on Windows is the intended free signing path; retain the QuickPrint share extension when installing. Free provisioning requires periodic refresh. No Apple account or signing secrets are used by the build workflow.

The main app and extension require a shared App Group. The app recognizes AltStore's `ALTAppGroups` mapping after re-signing. Actual installation, pairing and printing must still be verified on your iPhone.

## Build

Run the workflow manually under **Actions → Build QuickPrint IPA**. It uses a standard macOS GitHub-hosted runner. It generates the native project with Expo prebuild, installs CocoaPods and compiles the Release iPhone app and extension.

The Windows print agent is a separate component and must be running on your PC. Do not put personal documents, pairing tokens, certificates or private keys into this repository.

This project includes Expo template files covered by `mobile/LICENSE`.
