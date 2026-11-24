Pod::Spec.new do |s|
  s.name           = 'PrivacyCover'
  s.version        = '0.1.0'
  s.summary        = 'Blurs the app the instant iOS takes it away from the Consumer'
  s.description    = 'Shows a blur in its own window on resign active and removes it on become active, from the main thread, with no JS round trip.'
  s.author         = 'Prydd'
  s.homepage       = 'https://prydd.co'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
