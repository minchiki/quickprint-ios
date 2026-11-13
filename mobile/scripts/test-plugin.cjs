const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const xcode = require("xcode");
const plist = require("@expo/plist").default;
const plugin = require("../plugins/withQuickPrint");

(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "quickprint-plugin-"));
  execFileSync("tar", [
    "-xzf",
    path.join(projectRoot, "node_modules/expo/template.tgz"),
    "-C",
    fixture,
  ]);
  const platformProjectRoot = path.join(fixture, "package/ios");
  const config = plugin({
    name: "QuickPrint",
    slug: "quickprint",
    ios: { bundleIdentifier: "local.quickprint.app" },
  });
  const modRequest = {
    projectRoot,
    platformProjectRoot,
    platform: "ios",
    projectName: "HelloWorld",
  };
  await config.mods.ios.dangerous({ ...config, modRequest, modResults: {} });
  const projectFile = path.join(
    platformProjectRoot,
    "HelloWorld.xcodeproj/project.pbxproj",
  );
  const project = xcode.project(projectFile);
  project.parseSync();
  await config.mods.ios.xcodeproj({
    ...config,
    modRequest,
    modResults: project,
  });
  await config.mods.ios.xcodeproj({
    ...config,
    modRequest,
    modResults: project,
  });
  fs.writeFileSync(projectFile, project.writeSync());
  const reparsed = xcode.project(projectFile);
  reparsed.parseSync();
  const target = Object.values(reparsed.pbxNativeTargetSection()).find(
    (t) =>
      typeof t === "object" &&
      String(t.name).replaceAll('"', "") === "QuickPrintShare",
  );
  assert(target);
  const targets = Object.values(reparsed.pbxNativeTargetSection()).filter(
    (t) => typeof t === "object" && t.name === '"QuickPrintShare"',
  );
  assert.equal(targets.length, 1, "Plugin must be idempotent");
  assert.equal(target.buildPhases.length, 3);
  const configs = Object.values(
    reparsed.pbxXCBuildConfigurationSection(),
  ).filter(
    (c) =>
      typeof c === "object" &&
      String(c.buildSettings?.PRODUCT_NAME).replaceAll('"', "") ===
        "QuickPrintShare",
  );
  assert.equal(configs.length, 2);
  assert(
    configs.every(
      (c) => c.buildSettings.APPLICATION_EXTENSION_API_ONLY === "YES",
    ),
  );
  const info = plist.parse(
    fs.readFileSync(
      path.join(platformProjectRoot, "QuickPrintShare/Info.plist"),
      "utf8",
    ),
  );
  assert.equal(
    info.NSExtension.NSExtensionPointIdentifier,
    "com.apple.share-services",
  );
  assert.equal(info.QuickPrintAppGroup, "group.local.quickprint.app");
  const sources = Object.values(
    reparsed.hash.project.objects.PBXSourcesBuildPhase,
  )
    .filter((s) => typeof s === "object")
    .flatMap((s) => s.files || []);
  assert(sources.some((s) => s.comment.includes("ShareViewController.swift")));
  const entitlements = await config.mods.ios.entitlements({
    ...config,
    modRequest,
    modResults: {},
  });
  assert.deepEqual(
    entitlements.modResults["com.apple.security.application-groups"],
    ["group.local.quickprint.app"],
  );
  console.log(
    "PASS: Share target, source phase, embedding/dependency creation, App Group, plist and idempotence. Swift compilation requires macOS/EAS.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
