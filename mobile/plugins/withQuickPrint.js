const {
  withXcodeProject,
  withInfoPlist,
  withEntitlementsPlist,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const plist = require("@expo/plist");

module.exports = function withQuickPrint(config) {
  const bundle = config.ios.bundleIdentifier;
  const group = `group.${bundle}`;
  const target = "QuickPrintShare";
  config = withInfoPlist(config, (c) => {
    c.modResults.QuickPrintAppGroup = group;
    c.modResults.NSLocalNetworkUsageDescription =
      "QuickPrint находит ваш компьютер и отправляет документы на USB-принтер.";
    c.modResults.NSBonjourServices = ["_quickprint._tcp"];
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    c.modResults["com.apple.security.application-groups"] = [group];
    return c;
  });
  config = withDangerousMod(config, [
    "ios",
    async (c) => {
      const directory = path.join(c.modRequest.platformProjectRoot, target);
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(
        path.join(c.modRequest.projectRoot, "share/ShareViewController.swift"),
        path.join(directory, "ShareViewController.swift"),
      );
      fs.copyFileSync(
        path.join(
          c.modRequest.projectRoot,
          "modules/quick-print/ios/PrintClient.swift",
        ),
        path.join(directory, "PrintClient.swift"),
      );
      fs.writeFileSync(
        path.join(directory, "Info.plist"),
        plist.default.build({
          CFBundleDisplayName: "QuickPrint",
          CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
          CFBundleExecutable: "$(EXECUTABLE_NAME)",
          CFBundleName: "$(PRODUCT_NAME)",
          CFBundlePackageType: "XPC!",
          CFBundleShortVersionString: "1.0.0",
          CFBundleVersion: "1",
          QuickPrintAppGroup: group,
          NSLocalNetworkUsageDescription:
            "Передача документа на ваш компьютер в локальной сети.",
          NSExtension: {
            NSExtensionPointIdentifier: "com.apple.share-services",
            NSExtensionPrincipalClass:
              "$(PRODUCT_MODULE_NAME).ShareViewController",
            NSExtensionAttributes: {
              NSExtensionActivationRule: {
                NSExtensionActivationSupportsFileWithMaxCount: 1,
                NSExtensionActivationSupportsImageWithMaxCount: 1,
                NSExtensionActivationSupportsText: false,
              },
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(directory, `${target}.entitlements`),
        plist.default.build({
          "com.apple.security.application-groups": [group],
        }),
      );
      return c;
    },
  ]);
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    if (
      Object.values(project.pbxNativeTargetSection()).some(
        (item) =>
          typeof item === "object" &&
          String(item.name).replaceAll('"', "") === target,
      )
    )
      return c;
    const extension = project.addTarget(
      target,
      "app_extension",
      target,
      `${bundle}.share`,
    );
    const groupNode = project.addPbxGroup(
      [
        "ShareViewController.swift",
        "PrintClient.swift",
        "Info.plist",
        `${target}.entitlements`,
      ],
      target,
      target,
    );
    project.addToPbxGroup(
      groupNode.uuid,
      project.getFirstProject().firstProject.mainGroup,
    );
    project.addBuildPhase(
      ["ShareViewController.swift", "PrintClient.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      extension.uuid,
      undefined,
      target,
    );
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      extension.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      extension.uuid,
    );
    const configs = project.pbxXCBuildConfigurationSection();
    for (const item of Object.values(configs)) {
      if (typeof item !== "object" || !item.buildSettings) continue;
      if (
        String(item.buildSettings.PRODUCT_NAME).replaceAll('"', "") !== target
      )
        continue;
      Object.assign(item.buildSettings, {
        INFOPLIST_FILE: `${target}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${target}/${target}.entitlements`,
        SWIFT_VERSION: "5.9",
        IPHONEOS_DEPLOYMENT_TARGET: "16.0",
        TARGETED_DEVICE_FAMILY: '"1,2"',
        GENERATE_INFOPLIST_FILE: "NO",
        APPLICATION_EXTENSION_API_ONLY: "YES",
        SKIP_INSTALL: "YES",
        CLANG_ENABLE_MODULES: "YES",
        LD_RUNPATH_SEARCH_PATHS:
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        CURRENT_PROJECT_VERSION: "1",
        MARKETING_VERSION: "1.0.0",
        CODE_SIGN_STYLE: "Automatic",
      });
    }
    return c;
  });
};
