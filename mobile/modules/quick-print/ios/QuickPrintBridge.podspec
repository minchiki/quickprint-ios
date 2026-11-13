Pod::Spec.new do |s|
  s.name = 'QuickPrintBridge'
  s.version = '0.1.0'
  s.summary = 'Pinned local print transport, Bonjour and Quick Look'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'QuickPrint'
  s.homepage = 'https://example.invalid/quickprint'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
