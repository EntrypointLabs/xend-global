Pod::Spec.new do |s|
  s.name           = 'HardwareKey'
  s.version        = '0.1.0'
  s.summary        = 'Secure Enclave P-256 key for the approval signer'
  s.description    = 'Generates and uses the ADR 0025 approval signer key in the Secure Enclave, with App Attest.'
  s.author         = 'Xend'
  s.homepage       = 'https://xend.global'
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
